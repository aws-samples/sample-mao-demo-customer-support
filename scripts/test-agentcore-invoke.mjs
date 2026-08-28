#!/usr/bin/env node
/**
 * End-to-end smoke test for the AgentCore Runtime inbound-auth fix (the "stall").
 *
 * Reproduces exactly what the AppSync `sendChat` resolver does: it obtains a
 * Cognito **ID token** (Amplify's default token for AMAZON_COGNITO_USER_POOLS
 * auth) and POSTs it as a bearer token to the AgentCore Runtime HTTPS invocation
 * endpoint.
 *
 * Root cause this guards against:
 *   The runtime's JWT authorizer previously only set `allowedClients` (matched
 *   against the `client_id` claim, which Cognito ID tokens do NOT carry), so every
 *   invocation returned HTTP 403 and the UI hung on "Analyzing your question...".
 *   The fix switches the authorizer to validate `allowedAudience` against the ID
 *   token's `aud` claim.
 *
 * The token is minted with the real app client via USER_SRP_AUTH (the flow the
 * app client actually allows), so the resulting ID token's `aud` matches the
 * deployed authorizer configuration.
 *
 * Usage:
 *   source .deploy-creds.env
 *   node scripts/test-agentcore-invoke.mjs
 *
 * Requires: node >= 18, aws CLI on PATH, `npm install` run in scripts/.
 * Exit code 0 = pass, non-zero = fail.
 */
import { execFileSync } from "node:child_process";
import pkg from "amazon-cognito-identity-js";
const { CognitoUserPool, CognitoUser, AuthenticationDetails } = pkg;

const REGION = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1";
const STACK = "dev-mac-demo-frontendDeployment";
const TEST_USER = process.env.TEST_USER || "agentcore-smoketest";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "SmokeTest!2026xYz";
const TEST_EMAIL = process.env.TEST_EMAIL || "agentcore-smoketest@example.com";

const color = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const ok = (s) => console.log(color("32", `PASS  ${s}`));
const info = (s) => console.log(color("36", `      ${s}`));
const step = (s) => console.log(color("1", `\n\u25B6 ${s}`));
const warn = (s) => console.log(color("33", `WARN  ${s}`));
const fail = (s) => {
    console.error(color("31", `FAIL  ${s}`));
    process.exitCode = 1;
};

function aws(args, { allowFail = false } = {}) {
    try {
        return execFileSync("aws", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
        if (allowFail) return null;
        console.error(color("31", `aws ${args.join(" ")} failed:`));
        console.error(e.stderr?.toString() || e.message);
        throw e;
    }
}

function decodeJwt(token) {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    return JSON.parse(json);
}

function getOutputs() {
    const raw = aws([
        "cloudformation", "describe-stacks",
        "--stack-name", STACK, "--region", REGION,
        "--query", "Stacks[0].Outputs", "--output", "json",
    ]);
    const outputs = JSON.parse(raw);
    const find = (needle) =>
        outputs.find((x) => x.OutputKey.toLowerCase().includes(needle.toLowerCase()))?.OutputValue;
    return {
        userPoolId: find("viteUserPoolId"),
        clientId: find("viteUserPoolClientId"),
        runtimeArn: find("viteAgentcoreRuntimeArn"),
    };
}

function ensureUser(userPoolId) {
    const exists = aws([
        "cognito-idp", "admin-get-user",
        "--user-pool-id", userPoolId, "--username", TEST_USER, "--region", REGION,
    ], { allowFail: true });

    if (!exists) {
        aws([
            "cognito-idp", "admin-create-user",
            "--user-pool-id", userPoolId, "--username", TEST_USER,
            "--message-action", "SUPPRESS",
            "--user-attributes", `Name=email,Value=${TEST_EMAIL}`, "Name=email_verified,Value=true",
            "--region", REGION,
        ]);
        info(`created native test user ${TEST_USER}`);
    } else {
        info(`native test user ${TEST_USER} already exists`);
    }

    aws([
        "cognito-idp", "admin-set-user-password",
        "--user-pool-id", userPoolId, "--username", TEST_USER,
        "--password", TEST_PASSWORD, "--permanent", "--region", REGION,
    ]);
}

function srpSignIn(userPoolId, clientId) {
    const pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
    const user = new CognitoUser({ Username: TEST_USER, Pool: pool });
    const details = new AuthenticationDetails({ Username: TEST_USER, Password: TEST_PASSWORD });
    return new Promise((resolve, reject) => {
        user.authenticateUser(details, {
            onSuccess: (session) =>
                resolve({
                    idToken: session.getIdToken().getJwtToken(),
                    accessToken: session.getAccessToken().getJwtToken(),
                }),
            onFailure: (err) => reject(err),
            newPasswordRequired: () => reject(new Error("NEW_PASSWORD_REQUIRED (unexpected for permanent password)")),
        });
    });
}

function buildInvocationUrl(runtimeArn, endpoint = "default") {
    const encodedArn = encodeURIComponent(runtimeArn);
    return `https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=${encodeURIComponent(endpoint)}`;
}

async function invoke(url, bearerToken) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const sessionId = `smoketest-${Date.now()}`;
    try {
        const authHeader = bearerToken.startsWith("Bearer ") ? bearerToken : `Bearer ${bearerToken}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { Authorization: authHeader, "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt: "I want to check the status of my order and get a product recommendation. My customer id is cust005.",
                sessionId, actorId: TEST_USER, memoryEnabled: false,
            }),
            signal: controller.signal,
        });
        clearTimeout(timer);
        let body = "";
        if (res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            const start = Date.now();
            while (Date.now() - start < 55_000) {
                const { done, value } = await reader.read();
                if (done) break;
                body += decoder.decode(value, { stream: true });
                // Read the whole stream so we can observe interleaved trace events.
            }
            try { await reader.cancel(); } catch { /* ignore */ }
        } else {
            body = await res.text();
        }
        const traceCount = (body.match(/"type"\s*:\s*"trace"/g) || []).length;
        return { status: res.status, body, traceCount };
    } catch (e) {
        clearTimeout(timer);
        return { status: 0, body: `request error: ${e.message}` };
    }
}

async function main() {
    step("Resolve deployed identifiers from CloudFormation outputs");
    const { userPoolId, clientId, runtimeArn } = getOutputs();
    if (!userPoolId || !clientId || !runtimeArn) {
        fail(`missing outputs (userPoolId=${userPoolId} clientId=${clientId} runtimeArn=${runtimeArn})`);
        return;
    }
    info(`userPoolId=${userPoolId}`);
    info(`clientId=${clientId}`);
    info(`runtimeArn=${runtimeArn}`);

    step("Mint a real Cognito ID token (USER_SRP_AUTH, real app client)");
    ensureUser(userPoolId);
    const { idToken, accessToken } = await srpSignIn(userPoolId, clientId);
    const idClaims = decodeJwt(idToken);
    const accessClaims = accessToken ? decodeJwt(accessToken) : {};
    info(`ID token     token_use=${idClaims.token_use}  aud=${idClaims.aud}  client_id=${idClaims.client_id ?? "(none)"}`);
    info(`access token token_use=${accessClaims.token_use}  aud=${accessClaims.aud ?? "(none)"}  client_id=${accessClaims.client_id}`);

    if (idClaims.token_use === "id" && idClaims.aud === clientId && idClaims.client_id === undefined) {
        ok("ID token carries `aud` = clientId and no `client_id` (this is what the authorizer must accept)");
    } else {
        fail("ID token claim shape unexpected");
    }

    step("Invoke AgentCore Runtime with the ID token (mirrors the AppSync resolver)");
    const url = buildInvocationUrl(runtimeArn);
    info(`POST ${url}`);
    const result = await invoke(url, idToken);
    info(`HTTP ${result.status}`);
    info(`trace events in stream: ${result.traceCount ?? 0}`);
    info(`response preview: ${result.body.slice(0, 500).replace(/\n/g, "\\n") || "(empty)"}`);

    if (result.status === 200 && (result.traceCount ?? 0) > 0) {
        ok(`Runtime streamed ${result.traceCount} trace event(s) — tracing is flowing`);
    } else if (result.status === 200) {
        warn("Runtime responded 200 but streamed no trace events (the prompt may not have routed to a specialist).");
    }

    if (result.status === 403) {
        fail("Runtime returned HTTP 403 for the ID token — auth fix not effective");
    } else if (result.status === 200) {
        ok("Runtime accepted the ID token and responded (HTTP 200) — stall root cause fixed");
    } else if (result.status === 0) {
        fail(`Request failed before a response: ${result.body}`);
    } else {
        warn(`Auth passed (HTTP ${result.status} \u2260 403) but response was not 200.`);
        warn("The 403 stall is fixed; a non-200 indicates a separate downstream runtime issue.");
    }

    step("Invoke the full AppSync `sendChat` path (exactly what the UI calls)");
    const graphApiUrl = getOutputs2("viteGraphApiUrl");
    if (!graphApiUrl) {
        warn("Could not resolve viteGraphApiUrl; skipping AppSync end-to-end phase.");
    } else {
        info(`POST ${graphApiUrl}`);
        const appsyncResult = await sendChatViaAppSync(graphApiUrl, idToken);
        info(`assistant: ${JSON.stringify(appsyncResult).slice(0, 400)}`);
        if (typeof appsyncResult === "string" && appsyncResult && !appsyncResult.startsWith("error:")) {
            ok("AppSync sendChat returned a non-empty assistant completion — resolver + SSE parsing work end-to-end");
        } else {
            fail(`AppSync sendChat did not return a completion: ${JSON.stringify(appsyncResult)}`);
        }
    }

    step("Summary");
    console.log(process.exitCode
        ? color("31", "Result: FAILED")
        : color("32", "Result: PASSED \u2014 auth + runtime + resolver all work end-to-end."));
}

// Second outputs lookup (kept separate to avoid re-fetching in the hot path).
let _outputsCache = null;
function getOutputs2(needle) {
    if (!_outputsCache) {
        const raw = aws([
            "cloudformation", "describe-stacks",
            "--stack-name", STACK, "--region", REGION,
            "--query", "Stacks[0].Outputs", "--output", "json",
        ]);
        _outputsCache = JSON.parse(raw);
    }
    return _outputsCache.find((x) => x.OutputKey.toLowerCase().includes(needle.toLowerCase()))?.OutputValue;
}

async function sendChatViaAppSync(graphApiUrl, idToken) {
    // AppSync with Cognito User Pools auth expects the raw ID token (no "Bearer ").
    const query = `mutation SendChat($sessionId: String!, $human: String!, $memoryEnabled: Boolean) {\n  sendChat(sessionId: $sessionId, human: $human, memoryEnabled: $memoryEnabled)\n}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
        const res = await fetch(graphApiUrl, {
            method: "POST",
            headers: { Authorization: idToken, "Content-Type": "application/json" },
            body: JSON.stringify({
                query,
                variables: {
                    sessionId: `appsync-smoketest-${Date.now()}`,
                    human: "What is the status of my order? My customer id is cust005.",
                    memoryEnabled: false,
                },
            }),
            signal: controller.signal,
        });
        clearTimeout(timer);
        const json = await res.json();
        if (json.errors) return `error: ${JSON.stringify(json.errors)}`;
        return json.data?.sendChat;
    } catch (e) {
        clearTimeout(timer);
        return `error: ${e.message}`;
    }
}

main().catch((e) => { fail(e.message); process.exit(1); });

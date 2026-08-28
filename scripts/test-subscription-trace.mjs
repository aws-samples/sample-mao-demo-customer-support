#!/usr/bin/env node
/**
 * Diagnostic: subscribe to onUpdateChat exactly like the UI does, send a chat
 * that routes to specialists, and log what each subscription update actually
 * delivers — specifically whether `trace` and `traceMetadata` arrive at the
 * client and what their types are. This isolates "backend writes traces" from
 * "subscription delivers traces to the UI".
 *
 * Usage: source .deploy-creds.env && node scripts/test-subscription-trace.mjs
 */
import { execFileSync } from "node:child_process";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/api";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";

const REGION = process.env.AWS_DEFAULT_REGION || "us-east-1";
const STACK = "dev-mac-demo-frontendDeployment";
const TEST_USER = process.env.TEST_USER || "agentcore-smoketest";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "SmokeTest!2026xYz";

function aws(args) {
    return execFileSync("aws", args, { encoding: "utf-8" });
}
function outputs() {
    const raw = aws(["cloudformation", "describe-stacks", "--stack-name", STACK, "--region", REGION,
        "--query", "Stacks[0].Outputs", "--output", "json"]);
    const o = JSON.parse(raw);
    const f = (n) => o.find((x) => x.OutputKey.toLowerCase().includes(n.toLowerCase()))?.OutputValue;
    return {
        userPoolId: f("viteUserPoolId"),
        clientId: f("viteUserPoolClientId"),
        graphUrl: f("viteGraphApiUrl"),
        region: f("viteRegion") || REGION,
    };
}

// Match the frontend: subscribe with no filter/userId.
const onUpdateChat = /* GraphQL */ `subscription OnUpdateChat {
  onUpdateChat {
    userId sessionId human assistant trace traceMetadata errorState id __typename
  }
}`;
const sendChat = /* GraphQL */ `mutation SendChat($sessionId: String!, $human: String!, $memoryEnabled: Boolean) {
  sendChat(sessionId: $sessionId, human: $human, memoryEnabled: $memoryEnabled)
}`;

async function main() {
    const cfg = outputs();
    console.log("cfg:", { userPoolId: cfg.userPoolId, clientId: cfg.clientId, graphUrl: cfg.graphUrl });

    Amplify.configure({
        Auth: { Cognito: { userPoolId: cfg.userPoolId, userPoolClientId: cfg.clientId } },
        API: { GraphQL: { endpoint: cfg.graphUrl, region: cfg.region, defaultAuthMode: "userPool" } },
    });

    try { await signOut(); } catch { /* ignore */ }
    await signIn({ username: TEST_USER, password: TEST_PASSWORD, options: { authFlowType: "USER_SRP_AUTH" } });
    const session = await fetchAuthSession();
    const sub = session.tokens?.idToken?.payload?.sub;
    console.log("signed in; sub:", sub);

    const idToken = session.tokens?.idToken?.toString();
    const client = generateClient();
    let updates = 0;
    const sawTrace = { trace: 0, traceMetadata: 0 };

    const subscription = client.graphql({ query: onUpdateChat }).subscribe({
        next: ({ data }) => {
            const u = data?.onUpdateChat;
            if (!u) return;
            updates += 1;
            const traceType = u.trace == null ? "null" : typeof u.trace;
            const metaType = u.traceMetadata == null ? "null" : typeof u.traceMetadata;
            if (u.trace != null) sawTrace.trace += 1;
            if (u.traceMetadata != null) sawTrace.traceMetadata += 1;
            console.log(`update #${updates}: assistant=${u.assistant ? u.assistant.length + "ch" : "null"} | trace=${traceType} | traceMetadata=${metaType}`);
            if (u.trace && typeof u.trace === "string") {
                console.log("   trace sample:", u.trace.slice(0, 120));
            }
        },
        error: (e) => console.error("subscription error:", JSON.stringify(e).slice(0, 300)),
    });

    // Give the subscription a moment to establish, then send a routing query.
    await new Promise((r) => setTimeout(r, 3000));
    const sessionId = `subtest-${Date.now()}`;
    console.log("sending chat via raw fetch with ID token (matches the real resolver auth)...");
    // NOTE: Amplify's userPool auth mode forwards the ACCESS token, which the
    // runtime's aud-based authorizer rejects (401). Send the ID token directly.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
        await fetch(cfg.graphUrl, {
            method: "POST",
            headers: { Authorization: idToken, "Content-Type": "application/json" },
            body: JSON.stringify({ query: sendChat, variables: {
                sessionId, human: "What is the status of my order? My customer id is cust005.", memoryEnabled: false,
            }}),
            signal: controller.signal,
        });
    } catch (e) {
        console.log("sendChat returned (may be timeout, expected):", String(e).slice(0, 120));
    } finally {
        clearTimeout(timer);
    }

    // Collect updates for a while.
    await new Promise((r) => setTimeout(r, 40000));
    subscription.unsubscribe();
    console.log("\n=== SUMMARY ===");
    console.log(`total updates: ${updates}`);
    console.log(`updates with trace: ${sawTrace.trace}`);
    console.log(`updates with traceMetadata: ${sawTrace.traceMetadata}`);
    if (sawTrace.trace === 0 && sawTrace.traceMetadata === 0) {
        console.log("RESULT: subscription is NOT delivering trace/traceMetadata to the client.");
    } else {
        console.log("RESULT: subscription DELIVERS trace data — issue is frontend rendering.");
    }
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * AgentCore construct — replaces the Bedrock Agents `MultiAgent` construct.
 *
 * Provisions (task 7):
 *  - The Athena tool Lambda (Gateway Lambda-target contract).
 *  - An AgentCore Gateway (default Cognito M2M OAuth2 authorizer) with the Athena
 *    Lambda registered as an MCP tool target.
 *  - An AgentCore Memory resource (STM-only for the NO_MEMORY-first rollout; LTM
 *    strategies added in task 14).
 *  - An AgentCore Runtime hosting the Strands multi-agent app, with inbound
 *    Cognito authorization and X-Ray tracing, plus a default endpoint. The runtime
 *    is deployed as code (a zip on S3) rather than a container image, so deploying
 *    needs no local Docker daemon.
 *  - The `VITE_RUNTIME_CONFIG` payload (node IDs + agent profiles) and the
 *    runtime/gateway/memory identifiers consumed by the frontend and resolver.
 *
 * Requirements: 3.1, 3.2, 3.7, 6.1, 6.5, 11.1, 11.3, 14.1, 14.5
 */
import {
    AgentCoreRuntime,
    AgentRuntimeArtifact,
    Gateway,
    ManagedMemoryStrategy,
    Memory,
    MemoryStrategyType,
    Runtime as AgentRuntime,
    RuntimeAuthorizerConfiguration,
    SchemaDefinitionType,
    ToolSchema,
} from "aws-cdk-lib/aws-bedrockagentcore";
import { Duration, Stack, Stage } from "aws-cdk-lib";
import { aws_cognito as cognito } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { copyFileSync, mkdirSync, readFileSync } from "fs";
import * as path from "path";
import {
    CommonPythonPowertoolsFunction,
    stagePythonBundle,
} from "../../../common/constructs/lambda";
import { CommonBucket } from "../../../common/constructs/s3";
import { S3VectorsKnowledgeBase } from "./knowledge-base";

const RUNTIME_DIR = path.join(__dirname, "runtime");
const MULTI_AGENT_DIR = path.join(__dirname, "..", "multi-agent");
const REGION_INFERENCE_PROFILES = [
    "us.amazon.nova-pro-v1:0",
    "us.amazon.nova-micro-v1:0",
    "us.amazon.nova-2-lite-v1:0",
    "us.anthropic.claude-sonnet-5",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
];

// Agent instruction files (relative to MULTI_AGENT_DIR) that must be bundled into
// the runtime container image. Must match runtime/prompts.py INSTRUCTION_FILES.
const INSTRUCTION_FILES = [
    "instructions.txt",
    path.join("personalization", "instructions.txt"),
    path.join("order_management", "instructions.txt"),
    path.join("product_recommendation", "instructions.txt"),
    path.join("troubleshoot", "instructions.txt"),
];

// Five stable node IDs (must match runtime config.py + frontend runtimeConfig).
const NODE_IDS = {
    orchestrator: "supervisor-agent",
    personalization: "personalization-agent",
    orderManagement: "order-mgmt-agent",
    productRecommendation: "product-rec-agent",
    troubleshoot: "ts-agent",
} as const;

interface AgentCoreProps {
    athenaResultsBucket: Bucket;
    structuredDataBucket: Bucket;
    userPool: cognito.IUserPool;
    userPoolClient: cognito.IUserPoolClient;
}

export class AgentCore extends Construct {
    public readonly runtime: AgentRuntime;
    public readonly gateway: Gateway;
    public readonly memory: Memory;
    /** JSON string for the frontend `VITE_RUNTIME_CONFIG` (node IDs + profiles). */
    public readonly runtimeConfigJson: string;

    constructor(scope: Construct, id: string, props: AgentCoreProps) {
        super(scope, id);

        const { athenaResultsBucket, structuredDataBucket, userPool, userPoolClient } = props;

        // --- Athena tool Lambda (Gateway Lambda-target contract) --------------
        const athenaFunction = new CommonPythonPowertoolsFunction(this, "athenaToolFunction", {
            entry: path.join(MULTI_AGENT_DIR, "action-group", "executor-function"),
            memorySize: 1024,
            timeout: Duration.minutes(5),
            environment: {
                ATHENA_RESULTS_BUCKET_PATH: athenaResultsBucket.s3UrlForObject(),
            },
        });
        athenaFunction.addToRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "athena:StartQueryExecution",
                    "athena:GetQueryExecution",
                    "athena:GetQueryResults",
                    "athena:StopQueryExecution",
                    "glue:GetDatabase",
                    "glue:GetTable",
                    "glue:GetPartitions",
                ],
                resources: ["*"],
            })
        );
        athenaResultsBucket.grantReadWrite(athenaFunction);
        structuredDataBucket.grantRead(athenaFunction);

        // --- Gateway (default Cognito M2M OAuth2) + Athena Lambda target ------
        // The construct id carries the account number on purpose. The Gateway L2
        // names the Cognito domain of its auto-created M2M user pool with
        // `Names.uniqueResourceName(...)`, which hashes the construct path and
        // nothing else — so the prefix is identical in every account that deploys
        // this stack. Cognito domain prefixes are globally unique across all AWS
        // accounts, so without the account in the path the second account to
        // deploy fails with a confusing pairing of "does not exist in this
        // account" and HandlerErrorCode: AlreadyExists. Including the account
        // makes the generated prefix unique per deployment.
        const gateway = new Gateway(this, `gateway${Stack.of(this).account}`, {
            description: "Customer-support tool gateway (MCP, OAuth2 via Cognito).",
        });
        // The Gateway L2 auto-creates a Cognito pool for machine-to-machine
        // (client-credentials) authorization. It has no human sign-in and no
        // construct hook to change its feature plan or password policy, so the
        // corresponding cdk-nag findings are suppressed here (see deploy notes).
        NagSuppressions.addResourceSuppressions(
            gateway,
            [
                {
                    id: "AwsSolutions-COG1",
                    reason: "Gateway M2M (client-credentials) Cognito pool is auto-created by the AgentCore L2; no human sign-in, so a password policy is N/A and not configurable.",
                },
                {
                    id: "AwsSolutions-COG8",
                    reason: "Gateway Cognito pool is auto-created by the AgentCore L2; its feature plan is not configurable via the construct.",
                },
                {
                    id: "AwsSolutions-COG2",
                    reason: "Gateway Cognito pool is machine-to-machine (client-credentials); MFA is not applicable.",
                },
            ],
            true
        );

        const athenaTarget = gateway.addLambdaTarget("athenaTarget", {
            gatewayTargetName: "athena-query",
            description: "Execute read-only SQL against the customer-support Athena databases.",
            lambdaFunction: athenaFunction,
            toolSchema: ToolSchema.fromInline([
                {
                    name: "athena_query",
                    description:
                        "Execute a single read-only SQL statement and return the result set.",
                    inputSchema: {
                        type: SchemaDefinitionType.OBJECT,
                        properties: {
                            query: {
                                type: SchemaDefinitionType.STRING,
                                description: "A single SQL statement (SELECT/SHOW/DESCRIBE/CTE).",
                            },
                        },
                        required: ["query"],
                    },
                },
            ]),
        });

        // --- Memory (STM + LTM strategies for Personalization) ----------------
        // STM is always available; long-term user-preference + semantic strategies
        // give the Personalization agent cross-session recall (Req 10). NO_MEMORY-
        // first behavior is achieved at runtime via the memoryEnabled toggle
        // (memoryEnabled=false -> the runtime performs no reads/writes).
        // The LTM (USER_PREFERENCE + SEMANTIC) strategies provision asynchronously
        // and can take ~20+ minutes to reach ACTIVE — longer than the
        // AWS::BedrockAgentCore::Memory CloudFormation provider's stabilization
        // wait, which makes the create reliably time out ("NotStabilized") in the
        // prod account. Deploy STM-only there (STM stabilizes immediately) so the
        // stack is reliable; dev keeps the full LTM strategies. STM — the toggle,
        // the Memory tab, and per-session recall — works identically either way.
        const enableLtmStrategies = Stage.of(this)?.stageName !== "prod";
        const memory = new Memory(this, "memory", {
            description: enableLtmStrategies
                ? "Conversation memory for the customer-support agents (STM + LTM)."
                : "Conversation memory for the customer-support agents (STM).",
            expirationDuration: Duration.days(30),
            memoryStrategies: enableLtmStrategies
                ? [
                      new ManagedMemoryStrategy(MemoryStrategyType.USER_PREFERENCE, {
                          strategyName: "PersonalizationPreferences",
                          description:
                              "Durable user preferences learned by the Personalization agent.",
                          namespaces: ["/preferences/{actorId}"],
                      }),
                      new ManagedMemoryStrategy(MemoryStrategyType.SEMANTIC, {
                          strategyName: "PersonalizationFacts",
                          description: "Semantic facts extracted for the Personalization agent.",
                          namespaces: ["/facts/{actorId}"],
                      }),
                  ]
                : [],
        });

        // --- Knowledge bases (S3 Vectors) -------------------------------------
        const kbLoggingBucket = new CommonBucket(this, "kbLoggingBucket", {});
        // NOTE: the construct ids carry a "V2" suffix. Adding non-filterable
        // metadata keys to the S3 Vectors index is an immutable change that would
        // otherwise force an in-place index+KnowledgeBase *replacement*, which
        // collides on the auto-generated KB name and fails. New logical ids make
        // CloudFormation provision fresh KBs (new names) and remove the old ones
        // instead, sidestepping the collision. The KB ids change accordingly and
        // flow to the runtime via the env vars below.
        const personalizationKb = new S3VectorsKnowledgeBase(this, "personalizationKbV2", {
            name: "personalization",
            instruction: "Use to retrieve customer preferences and browsing history.",
            dataDir: path.join(MULTI_AGENT_DIR, "personalization", "knowledge-base"),
            loggingBucket: kbLoggingBucket,
        });
        const productRecKb = new S3VectorsKnowledgeBase(this, "productRecKbV2", {
            name: "prod_rec",
            instruction: "Use to retrieve product information and customer feedback.",
            dataDir: path.join(MULTI_AGENT_DIR, "product_recommendation", "knowledge-base"),
            loggingBucket: kbLoggingBucket,
        });
        const troubleshootKb = new S3VectorsKnowledgeBase(this, "troubleshootKbV2", {
            name: "troubleshoot",
            instruction: "Use to retrieve troubleshooting guides and FAQs.",
            dataDir: path.join(MULTI_AGENT_DIR, "troubleshoot", "knowledge-base"),
            loggingBucket: kbLoggingBucket,
        });

        // --- KB retrieval Lambda + Gateway target -----------------------------
        // KB retrieval is exposed as an MCP tool behind the Gateway (like Athena),
        // rather than an in-process Bedrock call in the runtime. The Lambda maps a
        // knowledge-base NAME to its id and runs the Bedrock `retrieve`.
        const kbToolFunction = new CommonPythonPowertoolsFunction(this, "kbToolFunction", {
            entry: path.join(MULTI_AGENT_DIR, "action-group", "kb-function"),
            memorySize: 512,
            timeout: Duration.minutes(2),
            environment: {
                KB_PERSONALIZATION_ID: personalizationKb.knowledgeBaseId,
                KB_PRODUCT_REC_ID: productRecKb.knowledgeBaseId,
                KB_TROUBLESHOOT_ID: troubleshootKb.knowledgeBaseId,
            },
        });
        kbToolFunction.addToRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["bedrock:Retrieve"],
                resources: [
                    personalizationKb.knowledgeBase.knowledgeBaseArn,
                    productRecKb.knowledgeBase.knowledgeBaseArn,
                    troubleshootKb.knowledgeBase.knowledgeBaseArn,
                ],
            })
        );
        const kbTarget = gateway.addLambdaTarget("kbTarget", {
            gatewayTargetName: "kb-retrieve",
            description:
                "Retrieve relevant passages from a customer-support knowledge base (S3 Vectors).",
            lambdaFunction: kbToolFunction,
            toolSchema: ToolSchema.fromInline([
                {
                    name: "kb_retrieve",
                    description:
                        "Retrieve up to 5 relevant passages from a named knowledge base.",
                    inputSchema: {
                        type: SchemaDefinitionType.OBJECT,
                        properties: {
                            knowledge_base: {
                                type: SchemaDefinitionType.STRING,
                                description:
                                    "The knowledge base to search: one of personalization, prod_rec, troubleshoot.",
                            },
                            query: {
                                type: SchemaDefinitionType.STRING,
                                description: "A natural-language search query.",
                            },
                        },
                        required: ["knowledge_base", "query"],
                    },
                },
            ]),
        });

        // addLambdaTarget grants the gateway's execution role lambda:InvokeFunction
        // (via the L2's target bind), but nothing tells CloudFormation the target
        // must be created after that grant. Left unordered, CFN creates the
        // GatewayTarget in parallel with the role's policy, and AgentCore validates
        // the role's invoke permission at target-creation time — so the target
        // reliably loses the race with "Gateway execution role lacks permission to
        // invoke Lambda function ...". Force the grant to land first by depending on
        // the gateway role's default policy (both grants share it).
        const gatewayInvokePolicy = gateway.role.node.tryFindChild("DefaultPolicy");
        if (gatewayInvokePolicy) {
            athenaTarget.node.addDependency(gatewayInvokePolicy);
            kbTarget.node.addDependency(gatewayInvokePolicy);
        }

        // --- Runtime (Strands multi-agent container) --------------------------
        // Inbound authorization delegated to the existing Cognito user pool (Req 11.1, 11.2).
        //
        // IMPORTANT: The AppSync resolver forwards the caller's Cognito **ID token**
        // (Amplify's default for AMAZON_COGNITO_USER_POOLS auth). A Cognito ID token
        // carries `aud` (= app client id) and `token_use=id`, but NO `client_id`
        // claim. AgentCore's JWT authorizer validates every configured field (AND
        // semantics), so `usingCognito(...)` — which sets `allowedClients` only —
        // rejects ID tokens with HTTP 403. We therefore configure the authorizer to
        // validate `allowedAudience` against the app client id instead, which matches
        // the ID token's `aud` claim.
        const cognitoDiscoveryUrl = `https://cognito-idp.${userPool.env.region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`;
        const runtime = new AgentRuntime(this, "runtime", {
            // Direct code deployment: the runtime source plus its arm64 dependencies
            // are zipped and uploaded to S3, and AWS runs them on the managed Python
            // runtime. No container image, so no local Docker daemon is needed to
            // deploy. `fromCodeAsset` is also the form `cdk deploy --hotswap`
            // understands for agent code changes.
            agentRuntimeArtifact: AgentRuntimeArtifact.fromCodeAsset({
                path: this.stageRuntimeArtifact(),
                runtime: AgentCoreRuntime.PYTHON_3_12,
                entrypoint: ["app.py"],
            }),
            authorizerConfiguration: RuntimeAuthorizerConfiguration.usingJWT(
                cognitoDiscoveryUrl,
                undefined, // allowedClients — omitted: ID tokens have no `client_id` claim
                [userPoolClient.userPoolClientId] // allowedAudience — matches ID token `aud`
            ),
            tracingEnabled: true, // X-Ray traces feed the observability/trace view (Req 7, 8).
            environmentVariables: {
                AWS_REGION: this.node.tryGetContext("region") ?? "us-east-1",
                AGENTCORE_MEMORY_ID: memory.memoryId,
                GATEWAY_MCP_URL: gateway.gatewayUrl ?? "",
                // Default Cognito authorizer exposes the token endpoint + scopes for M2M.
                GATEWAY_TOKEN_ENDPOINT: gateway.tokenEndpointUrl ?? "",
                GATEWAY_SCOPE: (gateway.oauthScopes ?? []).join(" "),
                GATEWAY_CLIENT_ID: gateway.userPoolClient?.userPoolClientId ?? "",
                // The gateway's auto-created Cognito M2M client secret. Required for
                // the runtime's client-credentials OAuth token, without which every
                // gateway (athena_query) call fails with a credentials error.
                // Reading `.userPoolClientSecret` provisions a DescribeUserPoolClient
                // custom resource; `.unsafeUnwrap()` injects the resolved value as the
                // runtime env var (acceptable for this dev demo).
                GATEWAY_CLIENT_SECRET:
                    gateway.userPoolClient?.userPoolClientSecret?.unsafeUnwrap() ?? "",
                // KB retrieval is now a Gateway MCP tool (kbToolFunction), so the
                // runtime reaches it via GATEWAY_MCP_URL — no KB ids needed here.
            },
        });
        runtime.addEndpoint("default");

        // --- Permissions for the runtime execution role -----------------------
        // Model invocation for the five inference profiles + underlying models.
        runtime.role.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream",
                    "bedrock:GetInferenceProfile",
                    "bedrock:GetFoundationModel",
                ],
                resources: [
                    "arn:aws:bedrock:*::foundation-model/*",
                    `arn:aws:bedrock:*:*:inference-profile/*`,
                    ...REGION_INFERENCE_PROFILES.map(
                        (p) => `arn:aws:bedrock:*:*:inference-profile/${p}`
                    ),
                ],
            })
        );
        // Memory read/write for STM + LTM.
        memory.grantRead(runtime.role);
        memory.grantWrite(runtime.role);

        // NOTE: bedrock:Retrieve is no longer granted to the runtime — KB
        // retrieval runs in the kbToolFunction (Gateway target), which holds the
        // scoped bedrock:Retrieve permission for the three knowledge bases.

        // --- Frontend runtime config (node IDs + agent profiles) --------------
        this.runtimeConfigJson = JSON.stringify({
            runtimeArn: runtime.agentRuntimeArn,
            gatewayUrl: gateway.gatewayUrl ?? "",
            memoryId: memory.memoryId,
            nodes: NODE_IDS,
            agentProfiles: this.buildAgentProfiles(),
        });

        this.runtime = runtime;
        this.gateway = gateway;
        this.memory = memory;
    }

    /**
     * Assemble the Docker build context for the runtime image.
     *
     * The runtime source lives in RUNTIME_DIR, but the agent instruction files it
     * loads at startup live in the sibling multi-agent directory — outside the
     * Docker build context. We stage a temp directory containing the runtime
     * source plus a bundled `agent_instructions/` copy of those files (preserving
     * their relative layout), which `prompts.py` resolves at runtime. Returns the
     * path to use as the asset directory.
     */
    private stageRuntimeArtifact(): string {
        // Runtime sources at the archive root, next to their linux/arm64
        // dependencies. AgentCore unpacks the archive to /var/task, which is first
        // on sys.path, so `import strands` and `import config` both resolve.
        const stagingDir = stagePythonBundle({
            sourceDir: RUNTIME_DIR,
            requirementsFile: path.join(RUNTIME_DIR, "requirements.txt"),
        });

        const instructionsDest = path.join(stagingDir, "agent_instructions");
        for (const rel of INSTRUCTION_FILES) {
            const src = path.join(MULTI_AGENT_DIR, rel);
            const dst = path.join(instructionsDest, rel);
            mkdirSync(path.dirname(dst), { recursive: true });
            copyFileSync(src, dst);
        }
        return stagingDir;
    }

    /**
     * Assemble AgentProfiles (Req 16) at synth time from the same instructions.txt
     * + model constants used to build the agents. Excludes any secrets (Req 16.5).
     */
    private buildAgentProfiles(): Record<string, unknown> {
        const read = (rel: string) =>
            readFileSync(path.join(MULTI_AGENT_DIR, rel), "utf-8");

        return {
            [NODE_IDS.orchestrator]: {
                nodeId: NODE_IDS.orchestrator,
                displayName: "Supervisor",
                modelId: "us.amazon.nova-pro-v1:0",
                systemPrompt: read("instructions.txt"),
                tools: [],
                knowledgeBases: [],
                memory: { stm: true, ltm: false },
            },
            [NODE_IDS.personalization]: {
                nodeId: NODE_IDS.personalization,
                displayName: "Personalization",
                modelId: "us.anthropic.claude-sonnet-5",
                systemPrompt: read(path.join("personalization", "instructions.txt")),
                tools: ["athena_query", "kb_retrieve"],
                knowledgeBases: ["personalization"],
                memory: { stm: true, ltm: true },
            },
            [NODE_IDS.productRecommendation]: {
                nodeId: NODE_IDS.productRecommendation,
                displayName: "ProductRecommendation",
                modelId: "us.amazon.nova-2-lite-v1:0",
                systemPrompt: read(path.join("product_recommendation", "instructions.txt")),
                tools: ["athena_query", "kb_retrieve", "run_code"],
                knowledgeBases: ["prod_rec"],
                memory: { stm: true, ltm: false },
            },
            [NODE_IDS.orderManagement]: {
                nodeId: NODE_IDS.orderManagement,
                displayName: "OrderManagement",
                modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
                systemPrompt: read(path.join("order_management", "instructions.txt")),
                tools: ["athena_query", "run_code"],
                knowledgeBases: [],
                memory: { stm: true, ltm: false },
            },
            [NODE_IDS.troubleshoot]: {
                nodeId: NODE_IDS.troubleshoot,
                displayName: "Troubleshoot",
                modelId: "us.amazon.nova-micro-v1:0",
                systemPrompt: read(path.join("troubleshoot", "instructions.txt")),
                tools: ["kb_retrieve"],
                knowledgeBases: ["troubleshoot"],
                memory: { stm: true, ltm: false },
            },
        };
    }
}

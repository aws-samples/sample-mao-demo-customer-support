import { StackProps } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { CommonStack } from "../../common/constructs/stack";
import { AgentCore } from "./agentcore";
import { Auth } from "./auth";
import { Storage } from "./storage";
import { StreamingApi } from "./streaming-api";

interface BackendStackProps extends StackProps {
    urls: string[];
}

const RUNTIME_ENDPOINT_NAME = "default";

export class BackendStack extends CommonStack {
    public readonly environmentVariables: Record<string, string>;

    constructor(scope: Construct, id: string, props: BackendStackProps) {
        super(scope, id, props);

        const auth = new Auth(this, "auth", {
            urls: props.urls,
        });

        NagSuppressions.addStackSuppressions(this, [
            {
                id: "AwsSolutions-IAM4",
                reason: "Lambda functions require managed policies to interface with the vpc.",
            },
        ]);

        const storage = new Storage(this, "storage", {
            urls: props.urls,
        });
        storage.structuredDataBucket.grantReadWrite(auth.authenticatedRole);

        // AgentCore replaces the former Bedrock Agents `MultiAgent` construct:
        // a single Runtime hosting the Strands orchestrator + specialists, a
        // Gateway (Athena tool), and Memory.
        const agentCore = new AgentCore(this, "agentCore", {
            athenaResultsBucket: storage.athenaResultsBucket,
            structuredDataBucket: storage.structuredDataBucket,
            userPool: auth.userPool,
            userPoolClient: auth.userPoolClient,
        });

        const streamingApi = new StreamingApi(this, "streamingApi", {
            userPool: auth.userPool,
            regionalWebAclArn: auth.regionalWebAclArn,
            agentRuntime: agentCore.runtime,
            agentRuntimeEndpointName: RUNTIME_ENDPOINT_NAME,
            memoryId: agentCore.memory.memoryId,
        });

        this.environmentVariables = {
            VITE_REGION: this.region!,
            VITE_CALLBACK_URL: props.urls[0],
            VITE_USER_POOL_ID: auth.userPool.userPoolId,
            ...(auth.userPoolDomain && {
                VITE_USER_POOL_DOMAIN_URL: auth.userPoolDomain.baseUrl().replace("https://", ""),
            }),
            VITE_USER_POOL_CLIENT_ID: auth.userPoolClient.userPoolClientId,
            VITE_IDENTITY_POOL_ID: auth.identityPool.attrId,
            CODEGEN_GRAPH_API_ID: streamingApi.amplifiedGraphApi.apiId,
            VITE_GRAPH_API_URL: streamingApi.amplifiedGraphApi.graphqlUrl,
            VITE_STORAGE_BUCKET_NAME: storage.structuredDataBucket.bucketName,

            // AgentCore identifiers (replace the former VITE_*_AGENT_ID/ALIAS_ID).
            // VITE_RUNTIME_CONFIG carries the five stable node IDs + AgentProfiles.
            VITE_RUNTIME_CONFIG: agentCore.runtimeConfigJson,
            VITE_AGENTCORE_RUNTIME_ARN: agentCore.runtime.agentRuntimeArn,
            VITE_AGENTCORE_GATEWAY_URL: agentCore.gateway.gatewayUrl ?? "",
            VITE_AGENTCORE_MEMORY_ID: agentCore.memory.memoryId,
        };
    }
}

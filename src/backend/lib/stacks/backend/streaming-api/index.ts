import { AmplifyData, AmplifyDataDefinition } from "@aws-amplify/data-construct";
import { Runtime as AgentRuntime } from "aws-cdk-lib/aws-bedrockagentcore";
import {
    Duration,
    Stack,
    aws_appsync as appsync,
    aws_cognito as cognito,
    aws_iam as iam,
    aws_logs as logs,
    aws_wafv2 as waf,
} from "aws-cdk-lib";
import { MappingTemplate } from "aws-cdk-lib/aws-appsync";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import { CommonNodejsFunction } from "../../../common/constructs/lambda";

interface StreamingApiProps {
    userPool: cognito.UserPool;
    regionalWebAclArn: string;
    /** The AgentCore Runtime hosting the Strands multi-agent app. */
    agentRuntime: AgentRuntime;
    /** The runtime endpoint (qualifier) the resolver invokes. */
    agentRuntimeEndpointName: string;
    /** AgentCore Memory id — the Memory-history query reads STM from it. */
    memoryId: string;
}

export class StreamingApi extends Construct {
    public readonly amplifiedGraphApi: AmplifyData;

    constructor(scope: Construct, id: string, props: StreamingApiProps) {
        super(scope, id);

        const { userPool, regionalWebAclArn, agentRuntime, agentRuntimeEndpointName, memoryId } =
            props;

        const amplifiedGraphApi = new AmplifyData(this, "amplifiedGraphApi", {
            definition: AmplifyDataDefinition.fromFiles(path.join(__dirname, "schema.graphql")),
            authorizationModes: {
                defaultAuthorizationMode: "AMAZON_COGNITO_USER_POOLS",
                userPoolConfig: {
                    userPool: userPool,
                },
                iamConfig: {
                    enableIamAuthorizationMode: true,
                },
            },
            logging: {
                fieldLogLevel: appsync.FieldLogLevel.ALL,
                retention: logs.RetentionDays.THREE_MONTHS,
                excludeVerboseContent: false,
            },
        });
        NagSuppressions.addResourceSuppressions(
            amplifiedGraphApi,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "AmplifyGraphqlApi requires the AWSAppSyncPushToCloudWatchLogs policy for logging.",
                },
                {
                    id: "AwsSolutions-S1",
                    reason: "AmplifyGraphqlApi-created buckets do not require server access logs.",
                },
                {
                    id: "AwsSolutions-S10",
                    reason: "AmplifyGraphqlApi-created buckets do not require requests to use SSL.",
                },
            ],
            true
        );

        amplifiedGraphApi.resources.cfnResources.cfnGraphqlApi.xrayEnabled = true;
        Object.values(amplifiedGraphApi.resources.cfnResources.cfnTables).forEach((table) => {
            table.pointInTimeRecoverySpecification = {
                pointInTimeRecoveryEnabled: true,
            };
            // Enable TTL on the expiration field for 7-day auto-cleanup
            table.timeToLiveSpecification = {
                attributeName: "expiration",
                enabled: true,
            };
        });

        const resolverFunction = new CommonNodejsFunction(this, "resolverFunction", {
            entry: path.join(__dirname, "resolver-function", "index.ts"),
            environment: {
                GRAPH_API_URL: amplifiedGraphApi.graphqlUrl,
                // The runtime uses inbound Cognito auth, so the resolver invokes it
                // over HTTPS with the caller's bearer token (no IAM InvokeAgentRuntime).
                AGENTCORE_RUNTIME_ARN: agentRuntime.agentRuntimeArn,
                AGENTCORE_RUNTIME_ENDPOINT: agentRuntimeEndpointName,
            },
            bundling: {
                externalModules: ["aws-sdk"],
            },
            memorySize: 1024,
            timeout: Duration.minutes(5),
        });
        amplifiedGraphApi.resources.graphqlApi.grantMutation(resolverFunction);
        amplifiedGraphApi.resources.graphqlApi.grantQuery(resolverFunction);

        amplifiedGraphApi
            .addLambdaDataSource("lambdaDataSource", resolverFunction)
            .createResolver("resolver", {
                typeName: "Mutation",
                fieldName: "sendChat",
                requestMappingTemplate: MappingTemplate.lambdaRequest(),
                responseMappingTemplate: MappingTemplate.lambdaResult(),
            });

        // --- Memory history query --------------------------------------------
        // Reads the caller's conversation history straight from AgentCore
        // short-term Memory (no localStorage / DynamoDB) via ListSessions +
        // ListEvents, keyed by the caller's Cognito identity.
        const memoryFunction = new CommonNodejsFunction(this, "memoryFunction", {
            entry: path.join(__dirname, "memory-function", "index.ts"),
            environment: {
                AGENTCORE_MEMORY_ID: memoryId,
            },
            bundling: {
                externalModules: ["aws-sdk"],
            },
            timeout: Duration.seconds(30),
        });
        const memoryArn = `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${
            Stack.of(this).account
        }:memory/${memoryId}`;
        memoryFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["bedrock-agentcore:ListSessions", "bedrock-agentcore:ListEvents"],
                resources: [memoryArn, `${memoryArn}/*`],
            })
        );
        amplifiedGraphApi
            .addLambdaDataSource("memoryDataSource", memoryFunction)
            .createResolver("memoryResolver", {
                typeName: "Query",
                fieldName: "getMemoryHistory",
                requestMappingTemplate: MappingTemplate.lambdaRequest(),
                responseMappingTemplate: MappingTemplate.lambdaResult(),
            });

        new waf.CfnWebACLAssociation(this, "graphApiWebAclAssociation", {
            resourceArn: amplifiedGraphApi.resources.graphqlApi.arn,
            webAclArn: regionalWebAclArn,
        });

        this.amplifiedGraphApi = amplifiedGraphApi;
    }
}

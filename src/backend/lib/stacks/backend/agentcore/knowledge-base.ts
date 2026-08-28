/**
 * S3 Vectors-backed Bedrock Knowledge Base (task 7.4).
 *
 * Replaces the former OpenSearch Serverless `VectorKnowledgeBase` with one backed
 * by Amazon S3 Vectors (`VectorStoreType.S3_VECTORS`), while reusing the existing
 * S3 source bucket + EventBridge `startIngestionJob` ingestion pattern.
 *
 * Requirements: 4.1, 4.2, 4.3
 */
import { s3vectors } from "@cdklabs/generative-ai-cdk-constructs";
import {
    BedrockFoundationModel,
    S3DataSource,
    VectorKnowledgeBase,
} from "@cdklabs/generative-ai-cdk-constructs/lib/cdk-lib/bedrock";
import { Rule } from "aws-cdk-lib/aws-events";
import { AwsApi } from "aws-cdk-lib/aws-events-targets";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { CommonBucket } from "../../../common/constructs/s3";

// Cohere Embed English v3 produces 1024-dimension vectors.
const COHERE_EMBED_DIMENSION = 1024;

interface S3VectorsKnowledgeBaseProps {
    /** Logical name, used for the data source name. */
    name: string;
    /** KB instruction shown to the agent. */
    instruction: string;
    /** Local directory containing the knowledge-base source files. */
    dataDir: string;
    /** Server-access logging bucket for the source bucket. */
    loggingBucket: Bucket;
}

export class S3VectorsKnowledgeBase extends Construct {
    public readonly knowledgeBase: VectorKnowledgeBase;
    public readonly knowledgeBaseId: string;

    constructor(scope: Construct, id: string, props: S3VectorsKnowledgeBaseProps) {
        super(scope, id);

        const sourceBucket = new CommonBucket(this, "sourceBucket", {
            serverAccessLogsBucket: props.loggingBucket,
            // REQUIRED for the `aws.s3` EventBridge ingestion rule below to fire.
            // Without this, S3 emits no EventBridge events, so `startIngestionJob`
            // never runs, documents are uploaded but never embedded, and every
            // `retrieve` returns 0 passages.
            eventBridgeEnabled: true,
        });

        // S3 Vectors vector store: a vector bucket + an index sized to the
        // embedding model, using cosine distance.
        const vectorBucket = new s3vectors.VectorBucket(this, "vectorBucket", {});
        const vectorIndex = new s3vectors.VectorIndex(this, "vectorIndex", {
            vectorBucket,
            dimension: COHERE_EMBED_DIMENSION,
            dataType: s3vectors.VectorIndexDataType.FLOAT_32,
            distanceMetric: s3vectors.VectorIndexDistanceMetric.COSINE,
            // Bedrock stores the chunk text and source metadata under these keys.
            // They MUST be non-filterable, otherwise their contents count toward
            // the S3 Vectors 2048-byte *filterable* metadata limit and larger
            // chunks fail to ingest ("Filterable metadata must have at most 2048
            // bytes"). Required for any BYO S3 Vectors index used by a KB.
            nonFilterableMetadataKeys: ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"],
        });

        const knowledgeBase = new VectorKnowledgeBase(this, "knowledgeBase", {
            embeddingsModel: BedrockFoundationModel.COHERE_EMBED_ENGLISH_V3,
            vectorStore: vectorIndex,
            instruction: props.instruction,
        });

        const dataSource = new S3DataSource(this, "dataSource", {
            bucket: sourceBucket,
            knowledgeBase,
            dataSourceName: `${props.name}-data`,
        });

        // Re-ingest whenever source content changes (reused pattern).
        const ingestionRule = new Rule(this, "ingestionRule", {
            eventPattern: {
                source: ["aws.s3"],
                detail: { bucket: { name: [sourceBucket.bucketName] } },
            },
            targets: [
                new AwsApi({
                    service: "bedrock-agent",
                    action: "startIngestionJob",
                    parameters: {
                        knowledgeBaseId: knowledgeBase.knowledgeBaseId,
                        dataSourceId: dataSource.dataSourceId,
                    },
                }),
            ],
        });

        const deployment = new BucketDeployment(this, "deployment", {
            sources: [Source.asset(props.dataDir)],
            destinationBucket: sourceBucket,
            exclude: [".DS_Store"],
            prune: true,
        });
        deployment.node.addDependency(ingestionRule);

        // Ingestion is triggered by the EventBridge rule above (now that the
        // source bucket has `eventBridgeEnabled`). We intentionally do NOT use an
        // AwsCustomResource to call StartIngestionJob on deploy: the shared
        // custom-resource provider role hits an IAM propagation race and fails
        // the stack. Initial population is done out-of-band (one StartIngestionJob
        // per data source) and content changes thereafter re-trigger via the rule.

        this.knowledgeBase = knowledgeBase;
        this.knowledgeBaseId = knowledgeBase.knowledgeBaseId;
    }
}

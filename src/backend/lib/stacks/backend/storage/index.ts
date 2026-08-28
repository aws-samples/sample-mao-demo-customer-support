import { Database } from "@aws-cdk/aws-glue-alpha";
import { aws_s3 as s3, aws_s3_deployment as s3_deployment, Stack } from "aws-cdk-lib";
import { CfnCrawler, CfnTable } from "aws-cdk-lib/aws-glue";
import * as iam from "aws-cdk-lib/aws-iam";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
    AwsCustomResource,
    AwsCustomResourcePolicy,
    AwsSdkCall,
    PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import * as path from "path";
import { CommonBucket, CommonStorageBucket } from "../../../common/constructs/s3";

interface StorageProps {
    urls: string[];
}

export class Storage extends Construct {
    public readonly structuredDataBucket: s3.Bucket;
    public readonly athenaResultsBucket: s3.Bucket;
    public readonly orderManagementDatabase: Database;

    constructor(scope: Construct, id: string, props: StorageProps) {
        super(scope, id);

        const { urls } = props;

        const loggingBucket = new CommonBucket(this, "loggingBucket", {});

        const structuredDataBucket = new CommonStorageBucket(this, "structuredDataBucket", {
            allowedOrigins: urls,
            eventBridgeEnabled: true,
            serverAccessLogsBucket: loggingBucket,
        });

        const athenaResultsBucket = new CommonStorageBucket(this, "athenaResultsBucket", {
            allowedOrigins: urls,
            eventBridgeEnabled: true,
            serverAccessLogsBucket: loggingBucket,
        });

        const storageDeployment = new s3_deployment.BucketDeployment(this, "storageDeployment", {
            sources: [s3_deployment.Source.asset(path.join(__dirname, "assets"))],
            destinationBucket: structuredDataBucket,
            // prune: false,
        });

        // Create databases
        const orderManagementDatabase = new Database(this, "orderManagementDatabase", {
            databaseName: "mac_order_management",
        });
        
        const personalizationDatabase = new Database(this, "personalizationDatabase", {
            databaseName: "mac_personalization",
        });
        
        const productRecommendationDatabase = new Database(this, "productRecommendationDatabase", {
            databaseName: "mac_prod_rec",
        });

        // Pair each database with the literal name it was created with. Do NOT read
        // `database.databaseName` for comparisons: it resolves to a CloudFormation
        // token ({"Ref": ...}), so comparing it to a string is always false at synth
        // time — which silently disabled the crawler exclusions below.
        const ORDER_MANAGEMENT_DB = "mac_order_management";
        const databaseList: { database: Database; name: string }[] = [
            { database: orderManagementDatabase, name: ORDER_MANAGEMENT_DB },
            { database: personalizationDatabase, name: "mac_personalization" },
            { database: productRecommendationDatabase, name: "mac_prod_rec" },
        ];

        const crawlerRole = new Role(this, "crawlerRole", {
            assumedBy: new ServicePrincipal("glue.amazonaws.com"),
        });
        crawlerRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSGlueServiceRole")
        );
        structuredDataBucket.grantRead(crawlerRole);

        // Array to track crawler resources for dependencies
        const crawlerResources: AwsCustomResource[] = [];

        // Create crawlers for other tables in the databases, excluding the order_management paths
        databaseList.forEach(({ database, name: databaseName }, index) => {
            // Exclusions belong on the S3 target, not alongside `s3Targets` — a
            // sibling `exclusions` key is not part of the CfnCrawler target schema
            // and is dropped silently.
            const crawlerTargets: CfnCrawler.TargetsProperty = {
                s3Targets: [
                    {
                        path: `s3://${structuredDataBucket.bucketName}/${databaseName}/`,
                        exclusions:
                            databaseName === ORDER_MANAGEMENT_DB
                                ? [
                                      // Relative globs against the include path (NOT
                                      // full s3:// URIs, which are silently ignored).
                                      // orders/ and inventory/ are created explicitly
                                      // by the Athena DDL below, so the crawler must
                                      // not touch them — otherwise it infers generic
                                      // col0..colN columns and clobbers the real schema.
                                      "orders/**",
                                      "inventory/**",
                                      "orders_*/**",
                                      "inventory_*/**",
                                      ".orders*",
                                      ".inventory*",
                                  ]
                                : undefined,
                    },
                ],
            };


            const crawler = new CfnCrawler(this, `crawler${index}`, {
                targets: crawlerTargets,
                databaseName: database.databaseName,
                role: crawlerRole.roleArn,
                tablePrefix: "",
            });

            // Create a stable identifier based on stack name and crawler name
            const stableId = `${Stack.of(this).stackName}-crawler-${index}`;
            
            const startCrawlerCall: AwsSdkCall = {
                service: "Glue",
                action: "startCrawler",
                parameters: {
                    Name: crawler.ref,
                },
                physicalResourceId: PhysicalResourceId.of(stableId),
            };
            
            // Create and track crawler resources
            const crawlerResource = new AwsCustomResource(this, `startCrawlerCustomResource${index}`, {
                onCreate: startCrawlerCall,
                onUpdate: startCrawlerCall,
                policy: AwsCustomResourcePolicy.fromSdkCalls({
                    resources: ["*"],
                }),
            });
            crawlerResource.node.addDependency(storageDeployment);
            crawlerResources.push(crawlerResource);
        });

        // Using Athena SQL to create tables with proper schema (more reliable than CfnTable)
        
        // Step 1a: Drop existing orders table (force recreation)
        const dropOrdersTableQuery = this.createAthenaQueryResource(
            "DropOrdersTable",
            `DROP TABLE IF EXISTS ${orderManagementDatabase.databaseName}.orders;`,
            athenaResultsBucket
        );
        
        // Step 1b: Drop orders_hash table if it exists
        const dropOrdersHashTableQuery = this.createAthenaQueryResource(
            "DropOrdersHashTable",
            `DROP TABLE IF EXISTS ${orderManagementDatabase.databaseName}.orders_hash;`,
            athenaResultsBucket
        );
        
        // Step 2: Create orders table with proper column names
        const createOrdersTableQuery = this.createAthenaQueryResource(
            "CreateOrdersTable",
            `CREATE EXTERNAL TABLE IF NOT EXISTS ${orderManagementDatabase.databaseName}.orders (
                order_id STRING COMMENT 'Unique ID for the order',
                customer_id STRING COMMENT 'ID of the customer who placed the order',
                product_id STRING COMMENT 'ID of the product ordered',
                product_name STRING COMMENT 'Name of the product ordered',
                order_status STRING COMMENT 'Current status of the order',
                shipping_status STRING COMMENT 'Current shipping status',
                return_exchange_status STRING COMMENT 'Return or exchange status',
                order_date STRING COMMENT 'Date when order was placed',
                delivery_date STRING COMMENT 'Date when order was delivered or expected delivery'
            )
            ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
            WITH SERDEPROPERTIES (
                'serialization.format' = ',',
                'field.delim' = ',',
                'escapeChar' = '\\\\',
                'quoteChar' = '"',
                'separatorChar' = ',',
                'skip.header.line.count' = '1'
            )
            LOCATION 's3://${structuredDataBucket.bucketName}/${orderManagementDatabase.databaseName}/orders/'
            TBLPROPERTIES (
                'skip.header.line.count'='1',
                'columnTypeMapping'='order_id:string,customer_id:string,product_id:string,product_name:string,order_status:string,shipping_status:string,return_exchange_status:string,order_date:string,delivery_date:string',
                'classification'='csv',
                'areColumnsQuoted'='false',
                'typeOfData'='file',
                'columnsOrdered'='true',
                'delimiter'=',',
                'comment'='Orders table for e-commerce application'
            );`,
            athenaResultsBucket
        );
        
        // Step 3a: Drop existing inventory table
        const dropInventoryTableQuery = this.createAthenaQueryResource(
            "DropInventoryTable",
            `DROP TABLE IF EXISTS ${orderManagementDatabase.databaseName}.inventory;`,
            athenaResultsBucket
        );
        
        // Step 3b: Drop inventory_hash table if it exists
        const dropInventoryHashTableQuery = this.createAthenaQueryResource(
            "DropInventoryHashTable",
            `DROP TABLE IF EXISTS ${orderManagementDatabase.databaseName}.inventory_hash;`,
            athenaResultsBucket
        );
        
        // Step 4: Create inventory table with proper column names
        const createInventoryTableQuery = this.createAthenaQueryResource(
            "CreateInventoryTable",
            `CREATE EXTERNAL TABLE IF NOT EXISTS ${orderManagementDatabase.databaseName}.inventory (
                product_id STRING COMMENT 'Unique ID for the product',
                product_name STRING COMMENT 'Name of the product',
                category STRING COMMENT 'Product category',
                quantity INT COMMENT 'Current quantity in stock',
                in_stock STRING COMMENT 'Whether product is in stock',
                reorder_threshold INT COMMENT 'Threshold to trigger reorder',
                reorder_quantity INT COMMENT 'Quantity to reorder when threshold reached',
                last_restock_date STRING COMMENT 'Date of last restock'
            )
            ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
            WITH SERDEPROPERTIES (
                'serialization.format' = ',',
                'field.delim' = ',',
                'escapeChar' = '\\\\',
                'quoteChar' = '"',
                'separatorChar' = ',',
                'skip.header.line.count' = '1'
            )
            LOCATION 's3://${structuredDataBucket.bucketName}/${orderManagementDatabase.databaseName}/inventory/'
            TBLPROPERTIES (
                'skip.header.line.count'='1',
                'columnTypeMapping'='product_id:string,product_name:string,category:string,quantity:int,in_stock:string,reorder_threshold:int,reorder_quantity:int,last_restock_date:string',
                'classification'='csv',
                'areColumnsQuoted'='false',
                'typeOfData'='file',
                'columnsOrdered'='true',
                'delimiter'=',',
                'comment'='Inventory table for e-commerce application'
            );`,
            athenaResultsBucket
        );
        
        // Set up the proper sequence of dependencies for table creation
        
        // Ensure drops happen after storage deployment and any crawlers
        dropOrdersTableQuery.node.addDependency(storageDeployment);
        dropOrdersHashTableQuery.node.addDependency(storageDeployment);
        dropInventoryTableQuery.node.addDependency(storageDeployment);
        dropInventoryHashTableQuery.node.addDependency(storageDeployment);
        
        crawlerResources.forEach(resource => {
            dropOrdersTableQuery.node.addDependency(resource);
            dropOrdersHashTableQuery.node.addDependency(resource);
            dropInventoryTableQuery.node.addDependency(resource);
            dropInventoryHashTableQuery.node.addDependency(resource);
        });
        
        // Ensure table creation happens after table drops
        createOrdersTableQuery.node.addDependency(dropOrdersTableQuery);
        createOrdersTableQuery.node.addDependency(dropOrdersHashTableQuery);
        createInventoryTableQuery.node.addDependency(dropInventoryTableQuery);
        createInventoryTableQuery.node.addDependency(dropInventoryHashTableQuery);
        
        this.structuredDataBucket = structuredDataBucket;
        this.athenaResultsBucket = athenaResultsBucket;
        this.orderManagementDatabase = orderManagementDatabase;
    }

    /**
     * Creates an AWS Custom Resource that executes an Athena query
     * @param id Resource ID
     * @param query SQL query to execute
     * @param resultsBucket Bucket to store query results
     * @returns AwsCustomResource that executes the query
     */
    private createAthenaQueryResource(id: string, query: string, resultsBucket: s3.Bucket): AwsCustomResource {
        // Create a stable identifier based on query content hash to ensure consistency
        // This approach prevents the changing physical ID issues that can occur with timestamps
        const stackName = Stack.of(this).stackName;
        // Add a version suffix to force recreation when needed
        const queryHash = this.hashString(query + "v2").substring(0, 8); // Use first 8 chars of hash
        const stableId = `${stackName}-${id}-${queryHash}`;
        
        // Create a very simple query for the delete handler that always succeeds
        // Using a simple metadata query avoids the complexities of the real query during deletion
        const simpleQueryCall: AwsSdkCall = {
            service: 'Athena',
            action: 'startQueryExecution',
            parameters: {
                QueryString: 'SELECT 1', // Simple query that always succeeds
                ResultConfiguration: {
                    OutputLocation: `s3://${resultsBucket.bucketName}/deletion-${id}/`,
                },
            },
            // Use a static ID for deletion that doesn't depend on the current time
            physicalResourceId: PhysicalResourceId.of(`static-${stableId}`),
        };
        
        // Main query for creation and updates
        const executeQueryCall: AwsSdkCall = {
            service: 'Athena',
            action: 'startQueryExecution',
            parameters: {
                QueryString: query,
                ResultConfiguration: {
                    OutputLocation: `s3://${resultsBucket.bucketName}/${id}/`,
                },
                // Add query execution context with database specified
                QueryExecutionContext: {
                    Database: 'default' // Use default for cross-database operations like CREATE/DROP
                }
            },
            // Use a stable physical ID for the resource based on content hash rather than timestamp
            physicalResourceId: PhysicalResourceId.of(`query-${stableId}`),
        };
        
        // Create the custom resource with better error handling and a simpler delete operation
        return new AwsCustomResource(this, id, {
            onCreate: executeQueryCall,
            onUpdate: executeQueryCall,
            // Use the simple query for delete to avoid complexities with deletion
            // This is CRITICAL for preventing stuck resources during stack deletion
            onDelete: simpleQueryCall,
            policy: AwsCustomResourcePolicy.fromStatements([
                new iam.PolicyStatement({
                    actions: [
                        'athena:StartQueryExecution',
                        'athena:GetQueryExecution',
                        'athena:GetQueryResults'
                    ],
                    resources: ['*']
                }),
                // Athena DDL (CREATE/DROP EXTERNAL TABLE) is executed against the
                // Glue Data Catalog, so these queries need Glue permissions in
                // addition to the Athena ones. Without them every DDL query fails
                // with "SemanticException MetaException(... not authorized to
                // perform: glue:GetDatabase ...)", the tables are never recreated,
                // and the Glue crawler's generic col0..colN schema is what remains.
                new iam.PolicyStatement({
                    actions: [
                        'glue:GetDatabase',
                        'glue:GetDatabases',
                        'glue:CreateTable',
                        'glue:DeleteTable',
                        'glue:GetTable',
                        'glue:GetTables',
                        'glue:UpdateTable',
                        'glue:GetPartition',
                        'glue:GetPartitions',
                        'glue:BatchCreatePartition',
                        'glue:BatchDeletePartition',
                        'glue:DeletePartition'
                    ],
                    resources: [
                        Stack.of(this).formatArn({ service: 'glue', resource: 'catalog' }),
                        Stack.of(this).formatArn({
                            service: 'glue',
                            resource: 'database',
                            resourceName: '*',
                        }),
                        Stack.of(this).formatArn({
                            service: 'glue',
                            resource: 'table',
                            resourceName: '*/*',
                        }),
                    ]
                }),
                new iam.PolicyStatement({
                    actions: [
                        's3:GetBucketLocation',
                        's3:GetObject',
                        's3:ListBucket',
                        's3:ListBucketMultipartUploads',
                        's3:ListMultipartUploadParts',
                        's3:AbortMultipartUpload',
                        's3:CreateBucket',
                        's3:PutObject'
                    ],
                    resources: [
                        resultsBucket.bucketArn,
                        `${resultsBucket.bucketArn}/*`
                    ]
                })
            ]),
        });
    }
    
    /**
     * Generates a simple hash of a string for creating stable IDs
     */
    private hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        // Convert to positive hex string
        return Math.abs(hash).toString(16);
    }
}

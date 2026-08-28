import { CfnResource, IAspect } from "aws-cdk-lib";
import { CfnFunction } from "aws-cdk-lib/aws-lambda";
import { IConstruct } from "constructs";

/**
 * Clamp every Lambda function's MemorySize to a ceiling.
 *
 * Some AWS accounts (new or otherwise restricted) reject functions above a low
 * memory limit — a fresh account can cap MemorySize at 512 MB, and CloudFormation
 * fails the create with "'MemorySize' value failed to satisfy constraint: Member
 * must have value less than or equal to 512". That rejection hits library-created
 * functions too (for example the CDK `BucketDeployment` asset handler, which
 * requests 1536 MB), which cannot be reconfigured through construct props.
 *
 * This aspect visits the synthesized `AWS::Lambda::Function` resources — including
 * those created by libraries — and lowers any concrete MemorySize above the
 * ceiling. Values already at or below the ceiling, and unresolved tokens, are left
 * untouched.
 *
 * It is opt-in: apply it only when deploying into a memory-constrained account.
 */
export class MaxLambdaMemory implements IAspect {
    constructor(private readonly ceilingMb: number) {}

    visit(node: IConstruct): void {
        const cfn = MaxLambdaMemory.asLambdaFunction(node);
        if (!cfn) return;

        const current = cfn.memorySize;
        if (typeof current === "number" && current > this.ceilingMb) {
            cfn.memorySize = this.ceilingMb;
        }
    }

    /**
     * Return the node as a Lambda CfnFunction when it is one, whether it is the L2
     * `CfnFunction` or a raw `CfnResource` of type `AWS::Lambda::Function` (how many
     * library constructs and custom resources emit their handlers).
     */
    private static asLambdaFunction(node: IConstruct): CfnFunction | undefined {
        if (node instanceof CfnFunction) return node;
        if (node instanceof CfnResource && node.cfnResourceType === "AWS::Lambda::Function") {
            return node as CfnFunction;
        }
        return undefined;
    }
}

/**
 * Read the Lambda memory ceiling from the environment.
 *
 * `MAC_DEMO_MAX_LAMBDA_MEMORY` is unset by default, so no clamping happens and the
 * project keeps its chosen memory sizes. Set it (e.g. `512`) when the target
 * account caps Lambda memory below those sizes. Invalid or non-positive values are
 * ignored.
 */
export function lambdaMemoryCeilingFromEnv(): number | undefined {
    const raw = process.env.MAC_DEMO_MAX_LAMBDA_MEMORY?.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : undefined;
}

import { App, Aspects } from "aws-cdk-lib";
import { PresetStageType, projectConfig } from "../../../config";
import { ApplicationStage } from "../lib/stage";
import { lambdaMemoryCeilingFromEnv, MaxLambdaMemory } from "../lib/common/aspects/max-lambda-memory";

const app = new App({
    context: {
        stackPrefix: projectConfig.projectId,
    },
});
const stage = app.node.tryGetContext("stage") || PresetStageType.Dev;
const account = projectConfig.accounts[stage];
const properties = {
    env: {
        account: account.number,
        region: account.region,
    },
};

const applicationStage = new ApplicationStage(app, stage, properties);

// Opt-in: clamp Lambda memory when deploying into a memory-constrained account
// (set MAC_DEMO_MAX_LAMBDA_MEMORY, e.g. 512). Unset -> no change. Applied to the
// stage (not the app): an App-level aspect does not cross the Stage boundary into
// its stacks, so it would visit nothing.
const lambdaMemoryCeiling = lambdaMemoryCeilingFromEnv();
if (lambdaMemoryCeiling !== undefined) {
    Aspects.of(applicationStage).add(new MaxLambdaMemory(lambdaMemoryCeiling));
}

app.synth();

import { Stack } from "aws-cdk-lib";
import {
    Architecture,
    Code,
    Function as LambdaFunction,
    FunctionOptions,
    LayerVersion,
    Runtime,
} from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { mkdtempSync } from "fs";
import * as os from "os";
import * as path from "path";
import {
    copyPythonSources,
    installPythonDependencies,
    PYTHON_ASSET_EXCLUDES,
} from "../python-bundling";

const commonFunctionProps = {
    architecture: Architecture.ARM_64,
    logRetention: RetentionDays.THREE_MONTHS,
};

export class CommonNodejsFunction extends NodejsFunction {
    constructor(
        scope: Construct,
        id: string,
        props: Omit<NodejsFunctionProps, "architecture" | "runtime" | "logRetention">
    ) {
        super(scope, id, {
            ...commonFunctionProps,
            runtime: Runtime.NODEJS_22_X,
            ...props,
        });
    }
}

const pythonRuntime = Runtime.PYTHON_3_12;

export interface CommonPythonFunctionProps extends FunctionOptions {
    /** Directory containing `index.py` (which must define `handler`). */
    readonly entry: string;
}

/**
 * Python Lambda packaged without Docker.
 *
 * The handler directory is uploaded as-is (caches stripped) and third-party
 * dependencies come from a layer, so there is nothing to build at synth time.
 */
export class CommonPythonFunction extends LambdaFunction {
    constructor(scope: Construct, id: string, props: CommonPythonFunctionProps) {
        const { entry, ...functionProps } = props;
        super(scope, id, {
            ...commonFunctionProps,
            runtime: pythonRuntime,
            handler: "index.handler",
            code: Code.fromAsset(entry, { exclude: PYTHON_ASSET_EXCLUDES }),
            ...functionProps,
        });
    }
}

const POWERTOOLS_LAYER_ID = "sharedPowertoolsLayer";

/**
 * The AWS Lambda Powertools layer, built from
 * `lib/common/layers/powertools/requirements.txt` as arm64 wheels.
 *
 * One layer is shared per stack: the contents are identical for every consumer,
 * and building it once keeps synth fast.
 */
function powertoolsLayer(scope: Construct): LayerVersion {
    const stack = Stack.of(scope);
    const existing = stack.node.tryFindChild(POWERTOOLS_LAYER_ID);
    if (existing) return existing as LayerVersion;

    // A layer's Python packages must live under `python/` in the archive.
    const staging = mkdtempSync(path.join(os.tmpdir(), "powertools-layer-"));
    installPythonDependencies({
        requirementsFile: path.join(__dirname, "..", "layers", "powertools", "requirements.txt"),
        targetDir: path.join(staging, "python"),
    });

    return new LayerVersion(stack, POWERTOOLS_LAYER_ID, {
        code: Code.fromAsset(staging, { exclude: PYTHON_ASSET_EXCLUDES }),
        compatibleArchitectures: [commonFunctionProps.architecture],
        compatibleRuntimes: [pythonRuntime],
        description: "AWS Lambda Powertools (arm64)",
    });
}

/** Python Lambda with the shared Powertools layer attached. */
export class CommonPythonPowertoolsFunction extends CommonPythonFunction {
    constructor(scope: Construct, id: string, props: CommonPythonFunctionProps) {
        super(scope, id, {
            ...props,
            layers: [powertoolsLayer(scope), ...(props.layers ?? [])],
        });
    }
}

/**
 * Stage a Python application directory into a self-contained bundle: sources at
 * the root alongside their arm64 dependencies.
 *
 * Used for AgentCore Runtime direct code deployment, where the archive is
 * unpacked to `/var/task` and that directory is first on `sys.path`, so
 * root-level dependencies are importable.
 */
export function stagePythonBundle(options: {
    sourceDir: string;
    requirementsFile?: string;
}): string {
    const { sourceDir, requirementsFile } = options;
    const staging = mkdtempSync(path.join(os.tmpdir(), "python-bundle-"));

    copyPythonSources(sourceDir, staging);

    if (requirementsFile) {
        installPythonDependencies({ requirementsFile, targetDir: staging });
    }

    return staging;
}

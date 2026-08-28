/**
 * Docker-free Python dependency bundling.
 *
 * AgentCore Runtime and Lambda both run on linux/arm64, so dependencies have to
 * be the arm64 Linux wheels rather than whatever matches the build machine. Both
 * `uv pip install` and `pip install` can resolve wheels for a *target* platform
 * without executing anything from them, which means we can produce an arm64
 * bundle from macOS or Windows with no container runtime involved.
 *
 * This replaces the previous approach (`@aws-cdk/aws-lambda-python-alpha` and a
 * Dockerfile), both of which shelled out to a local Docker daemon at synth time.
 *
 * Installs are cached in the system temp directory, keyed by a hash of the
 * requirements file plus the target Python version, so repeated synths of an
 * unchanged requirements file cost nothing.
 */
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";

/** Python version used by every Python runtime in this project. */
export const PYTHON_VERSION = "3.12";

/**
 * uv's target-platform triple and pip's platform tag for the same thing:
 * manylinux2014 (glibc 2.17+) on aarch64, which is what Lambda and AgentCore run.
 */
const UV_PLATFORM = "aarch64-manylinux2014";
const PIP_PLATFORM = "manylinux2014_aarch64";

/** Paths that must never end up in a deployment package. */
export const PYTHON_ASSET_EXCLUDES = [
    "__pycache__",
    "**/__pycache__",
    "*.pyc",
    ".pytest_cache",
    "**/.pytest_cache",
    ".hypothesis",
    "**/.hypothesis",
    "tests",
    "**/tests",
];

const EXCLUDED_DIR_NAMES = new Set([
    "__pycache__",
    ".pytest_cache",
    ".hypothesis",
    ".ruff_cache",
    "tests",
]);

/**
 * Copy a source tree, dropping caches and tests.
 *
 * `__pycache__` in particular must not ship: the bytecode is built for the build
 * machine's architecture and AWS documents it as incompatible with the arm64
 * execution environment.
 */
export function copyPythonSources(from: string, to: string): void {
    cpSync(from, to, {
        recursive: true,
        filter: (src) => {
            const name = path.basename(src);
            if (EXCLUDED_DIR_NAMES.has(name)) return false;
            return !name.endsWith(".pyc");
        },
    });
}

function runInstaller(requirementsFile: string, targetDir: string, pythonVersion: string): void {
    const attempts: { command: string; args: string[] }[] = [
        {
            // Preferred: uv is dramatically faster and takes an explicit target triple.
            command: "uv",
            args: [
                "pip",
                "install",
                "--python-platform",
                UV_PLATFORM,
                "--python-version",
                pythonVersion,
                "--target",
                targetDir,
                "--only-binary=:all:",
                "-r",
                requirementsFile,
            ],
        },
        {
            // Fallback: pip can do the same cross-platform resolve.
            command: "python3",
            args: [
                "-m",
                "pip",
                "install",
                "--platform",
                PIP_PLATFORM,
                "--implementation",
                "cp",
                "--python-version",
                pythonVersion,
                "--only-binary=:all:",
                "--target",
                targetDir,
                "-r",
                requirementsFile,
            ],
        },
    ];

    const failures: string[] = [];
    for (const { command, args } of attempts) {
        const result = spawnSync(command, args, { encoding: "utf-8" });
        if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
            failures.push(`${command}: not found on PATH`);
            continue;
        }
        if (result.status === 0) return;
        failures.push(`${command} exited ${result.status}\n${result.stderr ?? ""}`);
    }

    throw new Error(
        `Failed to install Python dependencies for linux/arm64 from ${requirementsFile}.\n` +
            `Install uv (https://docs.astral.sh/uv/) or ensure python3 -m pip is available.\n\n` +
            failures.join("\n\n")
    );
}

/**
 * Resolve the arm64 dependencies for a requirements file into a cached directory
 * and copy them into `targetDir`.
 *
 * A package that publishes no arm64 wheel (source-distribution only) will fail
 * here rather than silently shipping a broken bundle: `--only-binary=:all:`
 * refuses to build from source, since building would need the target toolchain.
 */
export function installPythonDependencies(options: {
    requirementsFile: string;
    targetDir: string;
    pythonVersion?: string;
}): void {
    const { requirementsFile, targetDir, pythonVersion = PYTHON_VERSION } = options;

    const key = createHash("sha256")
        .update(readFileSync(requirementsFile))
        .update(pythonVersion)
        .update(UV_PLATFORM)
        .digest("hex")
        .slice(0, 16);
    const cacheDir = path.join(os.tmpdir(), `mac-demo-pydeps-${key}`);
    const sentinel = path.join(cacheDir, ".install-complete");

    if (!existsSync(sentinel)) {
        // Rebuild from scratch so a previous interrupted install can't leak through.
        rmSync(cacheDir, { recursive: true, force: true });
        mkdirSync(cacheDir, { recursive: true });
        runInstaller(requirementsFile, cacheDir, pythonVersion);
        writeFileSync(sentinel, `${new Date().toISOString()}\n`);
    }

    mkdirSync(targetDir, { recursive: true });
    cpSync(cacheDir, targetDir, {
        recursive: true,
        filter: (src) => path.basename(src) !== ".install-complete",
    });
}

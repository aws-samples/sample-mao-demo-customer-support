import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { fromIni } from "@aws-sdk/credential-providers";
import { blueBright, bold, greenBright, magentaBright, redBright } from "chalk";
import { spawn } from "child_process";
import enquirer from "enquirer";
import { projectConfig } from "../../config";

export const banner = () => {
    console.clear();
    console.log(bold(magentaBright("Multi-Agent Customer Support Demo")));
    console.log(bold(magentaBright("Deployment & development CLI 🧪")));
};

export const bye = (exitCode: number = 1) => {
    // default exit code is 1 to indicate error pass 0 to exit gracefully
    if (exitCode === 0) {
        console.log(bold(magentaBright("\nGoodbye! 👋\n")));
    } else {
        console.log("");
    }
    process.exit(exitCode);
};

export const promptConfirm = async (message: string): Promise<boolean> => {
    console.log("");
    return (
        (await enquirer.prompt({
            type: "toggle",
            name: "confirm",
            message: message,
            enabled: "Yes",
            disabled: "No",
            initial: "Yes",
        })) as { confirm: boolean }
    ).confirm;
};

export const promptValue = async (message: string, secret: boolean): Promise<string> => {
    console.log("");
    return (
        (await enquirer.prompt({
            type: secret ? "password" : "input",
            name: "value",
            message: message,
        })) as { value: string }
    ).value;
};

export const promptSelect = async (item: string, choices: string[]): Promise<string> => {
    console.log("");
    return (
        (await enquirer.prompt({
            name: "selection",
            type: "autocomplete",
            message: `Select the ${item} using arrow keys or type its number then enter:`,
            choices: choices.map((choice, index) => ({
                name: `${index + 1}. ${choice} `,
                value: choice,
            })),
        })) as { selection: string }
    ).selection;
};

export const promptMultiSelect = async (items: string, choices: string[]): Promise<string[]> => {
    console.log("");
    return (
        (await enquirer.prompt({
            name: "selections",
            type: "multiselect",
            message: `Select ${items} using the arrow keys and spacebar then enter:`,
            choices: choices,
            validate: (value) => (value.length > 0 ? true : `Select at least one of the ${items}.`),
        })) as { selections: string[] }
    ).selections;
};

export const executeCommand = <T extends boolean = false>(
    command: string,
    saveOutput?: T
): Promise<T extends true ? string : void> => {
    if (!saveOutput) console.log(`\n${blueBright("Executing command:")} ${command}\n`);

    return new Promise((resolve, reject) => {
        // This is a local developer CLI run from a trusted shell. Every command is hardcoded by the tooling
        // (e.g. "cd ../.. && aws ...", "lsof ... | grep ... | awk ...") and
        // relies on shell features like pipes, redirection and "&&"; no
        // untrusted or attacker-controlled input is ever passed in, so the
        // child_process + shell usage is intentional and safe here.
        // nosemgrep
        const process = spawn(command, [], { shell: true, stdio: saveOutput ? "pipe" : "inherit" }); // nosemgrep

        let output = "";
        if (saveOutput) {
            process.stdout?.on("data", (data) => {
                output += data.toString();
            });
            process.stderr?.on("data", (data) => {
                output += data.toString();
            });
        }

        process.on("close", (code) => {
            if (code === 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                resolve(saveOutput ? (output as any) : undefined);
            } else {
                const error = new Error(`Process exited with code ${code}.`);
                reject(error);
            }
        });
        process.on("error", (error) => {
            reject(error);
        });
    });
};

export const freePort = async (port: number) => {
    const processId = await executeCommand(
        `lsof -i :${port} | grep LISTEN | awk '{print $2}'`,
        true
    );
    if (processId) {
        try {
            await executeCommand(`kill -9 ${processId}`, true);
            console.log(greenBright(`\nFreed port ${port}!`));
        } catch {
            console.log(redBright(`\n🛑 Failed to free port ${port}.`));
            bye();
        }
    }
};

/**
 * Confirm that the named AWS profile for a stage resolves to working credentials
 * for the account in project-config.json.
 *
 * Credentials themselves are managed outside this CLI — configure a named profile
 * with `aws configure --profile <name>` or `aws configure sso --profile <name>`.
 */
export const verifyCredentials = async (stage: string) => {
    const account = projectConfig.accounts[stage];
    if (!account) {
        console.error(redBright(`\n🛑 Account not found.\n`));
        bye();
    }

    const profile = getProfileName(stage);
    console.log(
        blueBright(`\nVerifying ${stage} credentials (${credentialSourceLabel(stage)})...`)
    );
    try {
        const identity = JSON.parse(
            await executeCommand(
                `aws sts get-caller-identity ${profileArg(stage)} --output json`.replace(/\s+/g, " "),
                true
            )
        );
        if (identity["Account"] !== account.number) {
            const source = profile
                ? `Profile "${profile}" resolves`
                : `Your environment credentials resolve`;
            const alternatives = profile
                ? `   Or point at a different profile with MAC_DEMO_PROFILE, or update\n` +
                  `   config/project-config.json.`
                : `   Or set MAC_DEMO_PROFILE to a named profile for ${account.number}, or\n` +
                  `   update config/project-config.json.`;

            console.error(
                redBright(
                    `\n🛑 Account mismatch for ${stage}.\n` +
                        `   ${source} to ${identity["Account"]}\n` +
                        `   but the configuration expects ${account.number}.\n\n` +
                        `   Deploy into that account with:\n` +
                        `     export MAC_DEMO_ACCOUNT=${identity["Account"]}\n\n` +
                        alternatives
                )
            );
            bye();
        }
        console.log(greenBright(`\nUsing ${stage} account ${account.number}.`));
    } catch {
        if (!profile) {
            console.error(
                redBright(
                    `\n🛑 Could not resolve credentials from the environment.\n\n` +
                        `   AWS_ACCESS_KEY_ID is set, so the ambient credential chain was used,\n` +
                        `   but the call failed. The key may be inactive, deleted, or missing\n` +
                        `   AWS_SESSION_TOKEN if these are temporary credentials.\n\n` +
                        `   To use a named profile instead:\n` +
                        `     unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY\n` +
                        `     export MAC_DEMO_PROFILE=<name>`
                )
            );
            bye();
        }

        const available = await listAvailableProfiles();
        const profileList = available.length
            ? `   Profiles configured on this machine:\n` +
              available.map((p) => `     - ${p}`).join("\n") +
              `\n\n   To use one of them:\n     export MAC_DEMO_PROFILE=<name>\n\n`
            : `   No named profiles found on this machine.\n\n`;

        console.error(
            redBright(
                `\n🛑 Could not resolve credentials for profile "${profile}".\n\n` +
                    profileList +
                    `   Or create that profile:\n` +
                    `     aws configure --profile ${profile}\n` +
                    `   or, with IAM Identity Center:\n` +
                    `     aws configure sso --profile ${profile}\n\n` +
                    `   Or use credentials already exported in this shell:\n` +
                    `     export MAC_DEMO_PROFILE=none`
            )
        );
        bye();
    }
};

/** True when static credentials are exported in the environment. */
const hasEnvCredentials = (): boolean =>
    Boolean(process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim());

/**
 * Resolve which AWS named profile to use for a stage, or `undefined` to fall
 * through to the ambient default credential chain (environment variables, an
 * instance or container role, and so on).
 *
 * Checked in order, so an existing profile can be used without renaming it and
 * without putting a personal profile name into the committed config:
 *
 *   1. `MAC_DEMO_PROFILE` — explicit override for this project.
 *      Set it to `none` to force the ambient chain.
 *   2. Static credentials in the environment (`AWS_ACCESS_KEY_ID` +
 *      `AWS_SECRET_ACCESS_KEY`) — no profile, matching how the AWS SDKs
 *      prioritise explicit credentials over `AWS_PROFILE`.
 *   3. `profile` on the stage in project-config.json
 *   4. `AWS_PROFILE` — the standard AWS environment variable
 *   5. `<projectId>-<stage>` — the default convention
 */
export const getProfileName = (stage: string): string | undefined => {
    const explicit = process.env.MAC_DEMO_PROFILE?.trim();
    if (explicit) return explicit.toLowerCase() === "none" ? undefined : explicit;

    if (hasEnvCredentials()) return undefined;

    const configured = projectConfig.accounts[stage]?.profile?.trim();
    if (configured) return configured;

    const awsProfile = process.env.AWS_PROFILE?.trim();
    if (awsProfile) return awsProfile;

    return `${projectConfig.projectId}-${stage}`;
};

/**
 * The `--profile <name>` fragment for an AWS or CDK command, or an empty string
 * when the ambient credential chain should be used.
 */
export const profileArg = (stage: string): string => {
    const profile = getProfileName(stage);
    return profile ? `--profile ${profile}` : "";
};

/** How credentials are being sourced, for log lines. */
export const credentialSourceLabel = (stage: string): string => {
    const profile = getProfileName(stage);
    if (profile) return `profile "${profile}"`;
    return hasEnvCredentials()
        ? "credentials from the environment"
        : "the default credential chain";
};

/** Named profiles configured on this machine, for error messages. */
const listAvailableProfiles = async (): Promise<string[]> => {
    try {
        const output = await executeCommand("aws configure list-profiles", true);
        return output
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
    } catch {
        return [];
    }
};

/**
 * Credentials for the AWS SDK clients used by the CLI.
 *
 * Returns `undefined` when no named profile applies, which leaves the SDK to use
 * its own default chain (environment variables, container/instance role, ...).
 */
export const getProfileCredentials = (stage: string) => {
    const profile = getProfileName(stage);
    return profile ? fromIni({ profile }) : undefined;
};

export const getProfileRegion = (stage: string): string => {
    return projectConfig.accounts[stage].region;
};

export const getStackPrefix = (stage: string): string => {
    return `${stage}/${projectConfig.projectId}`;
};

export const getStackOutputs = async (stage: string) => {
    try {
        const cfClient = new CloudFormationClient({
            region: getProfileRegion(stage),
            credentials: getProfileCredentials(stage),
        });
        const response = await cfClient.send(
            new DescribeStacksCommand({
                StackName: `${stage}-${projectConfig.projectId}-frontendDeployment`,
            })
        );
        return response.Stacks?.[0].Outputs ?? [];
    } catch (error) {
        console.error(
            redBright(
                "\n🛑 Failed to get stack outputs. Make sure the frontendDeployment stack is deployed."
            )
        );
        console.error("\n", error);
        return;
    }
};

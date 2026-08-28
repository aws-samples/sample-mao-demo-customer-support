#!/usr/bin/env node

import { blueBright, bold, greenBright, redBright } from "chalk";
import { AccountConfig, PresetStageType, projectConfig } from "../../config";
import {
    banner,
    bye,
    executeCommand,
    getProfileName,
    profileArg,
    promptConfirm,
    verifyCredentials,
} from "./utils";

/**
 * Check that credentials for a stage resolve to the expected account.
 *
 * Credentials come either from a named profile or from the ambient chain (for
 * example keys exported in the shell); this CLI only validates them.
 */
const requireCredentials = async (accountNumber: string, stage: string) => {
    const profile = getProfileName(stage);
    const label = profile ? `profile "${profile}"` : "credentials from the environment";
    const mismatchPrefix = "\nUsing ";

    try {
        const identity = JSON.parse(
            await executeCommand(
                `aws sts get-caller-identity ${profileArg(stage)} --output json`.replace(
                    /\s+/g,
                    " "
                ),
                true
            )
        );
        if (identity["Account"] !== accountNumber) {
            throw new Error(
                `${mismatchPrefix}${label}, which resolves to account ${identity["Account"]}, ` +
                    `but ${accountNumber} was expected.\n` +
                    `Set MAC_DEMO_ACCOUNT=${identity["Account"]} to deploy into that account.`
            );
        }
        console.log(greenBright(`\nUsing ${label} for account ${accountNumber}.`));
    } catch (error) {
        const message = (error as Error).message ?? "";
        if (message.startsWith(mismatchPrefix)) throw error;

        throw new Error(
            profile
                ? `\nNo working credentials for ${label} (account ${accountNumber}).\n` +
                  `Create it first:\n` +
                  `  aws configure --profile ${profile}\n` +
                  `or, with IAM Identity Center:\n` +
                  `  aws configure sso --profile ${profile}\n` +
                  `Or use credentials already exported in this shell:\n` +
                  `  export MAC_DEMO_PROFILE=none`
                : `\nNo working credentials in the environment for account ${accountNumber}.\n` +
                  `Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, plus AWS_SESSION_TOKEN\n` +
                  `if these are temporary credentials.`
        );
    }
};

const bootstrapAccount = async (account: AccountConfig, stage: string) => {
    console.log(blueBright(`\nBootstrapping ${stage} account ${account.number}...`));
    try {
        if (stage === PresetStageType.Prod) {
            // enable termination protection & trust dev account
            const devAccountNumber = projectConfig.accounts[PresetStageType.Dev]?.number;
            console.log(
                blueBright(
                    `\nEnabling termination protection for ${stage} account ${account.number} and setting up trust with dev account ${devAccountNumber}...`
                )
            );
            await executeCommand(
                `npm run -w backend cdk bootstrap aws://${account.number}/${account.region} -- ` +
                    `--cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess ` +
                    `--termination-protection --trust ${devAccountNumber} ` +
                    profileArg(stage)
            );
            await executeCommand(
                `npm run -w backend cdk bootstrap aws://${account.number}/us-east-1 -- ` +
                    `--cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess ` +
                    `--termination-protection --trust ${devAccountNumber} ` +
                    profileArg(stage)
            );
        } else {
            await executeCommand(
                `npm run -w backend cdk bootstrap aws://${account.number}/${account.region} -- ` +
                    `--cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess ` +
                    profileArg(stage)
            );
            await executeCommand(
                `npm run -w backend cdk bootstrap aws://${account.number}/us-east-1 -- ` +
                    `--cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess ` +
                    profileArg(stage)
            );
        }
        console.log(greenBright(`\nBootstrapped ${stage} account ${account.number}!`));
    } catch {
        throw new Error(`\nFailed to bootstrap ${stage} account ${account.number}.`);
    }
};

const initializeStage = async (stage: string) => {
    console.log(blueBright(bold(`\nInitializing ${stage} account...`)));

    const account = projectConfig.accounts[stage];
    if (!account) {
        console.error(redBright(`\n🛑 ${stage} account configuration not found.`));
        bye();
    }

    try {
        await requireCredentials(account.number, stage);

        await bootstrapAccount(account, stage);

        console.log(greenBright(bold(`\nInitialized ${stage} account!`)));
    } catch (error) {
        console.warn(redBright(error.message));
        console.warn(redBright(bold(`\nFailed to initialize ${stage} account.`)));
    }
};

const main = async () => {
    banner();

    if (
        await (async () => {
            try {
                return !(await promptConfirm(
                    `To start, confirm the project identifier: ${projectConfig.projectId}`
                ));
            } catch {
                return true;
            }
        })()
    ) {
        bye(0);
    }

    await verifyCredentials(PresetStageType.Dev);

    for (const stage of Object.keys(projectConfig.accounts)) {
        await initializeStage(stage);
    }

    console.log(
        blueBright("\nAccounts are bootstrapped. Deploy the stacks with `npm run develop`.")
    );

    console.log(greenBright(bold("\n✅ Configuration finished!\n")));
};

main();

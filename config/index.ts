import { redBright } from "chalk";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

export enum PresetStageType {
    Dev = "dev",
    Prod = "prod",
}

export interface AccountConfig {
    number: string;
    region: string;
    /**
     * AWS named profile to use for this stage. Optional — defaults to
     * `<projectId>-<stage>`, and can be overridden per-shell with
     * MAC_DEMO_PROFILE or AWS_PROFILE.
     */
    profile?: string;
}

interface ProjectConfig {
    projectId: string;
    accounts: {
        [key: string]: AccountConfig;
    };
}

export const projectConfigPath = path.join(__dirname, "project-config.json");

const baseSchema = {
    projectId: z
        .string()
        .min(5)
        .max(15)
        .refine((value: string) => !/[ `!@#$%^&*()_+=\\[\]{};':"\\|,.<>\\/?~]/.test(value ?? ""), {
            message: "Name should contain only alphabets except '-' ",
        }),
    accounts: z.record(
        z.string(),
        z.object({
            number: z.string().length(12),
            region: z.string(),
            profile: z.string().min(1).optional(),
        })
    ),
};
const configSchema = z.object(baseSchema);

/**
 * Environment overrides so the checked-in config never has to hold a real
 * account id. `MAC_DEMO_ACCOUNT` / `MAC_DEMO_REGION` win over project-config.json
 * and apply to the stage being deployed.
 */
const applyEnvOverrides = (projectConfig: ProjectConfig): ProjectConfig => {
    const account = process.env.MAC_DEMO_ACCOUNT?.trim();
    const region = process.env.MAC_DEMO_REGION?.trim();
    if (!account && !region) return projectConfig;

    const stage = process.env.MAC_DEMO_STAGE?.trim() || PresetStageType.Dev;
    const existing = projectConfig.accounts[stage];
    projectConfig.accounts[stage] = {
        ...existing,
        number: account ?? existing?.number,
        region: region ?? existing?.region,
    };
    return projectConfig;
};

const loadProjectConfig = (): ProjectConfig => {
    let projectConfig: ProjectConfig;
    try {
        projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, "utf-8")) as ProjectConfig;
    } catch {
        console.error(redBright(`\n🛑 Missing project configuration file.\n`));
        process.exit(1);
    }

    projectConfig = applyEnvOverrides(projectConfig);

    const result = configSchema.safeParse(projectConfig);
    if (!result.success) {
        console.error(redBright(`\n🛑 Malformed project configuration file.\n`));
        process.exit(1);
    }

    // if no stage is provided, the app defaults to dev so it must be present
    if (!projectConfig.accounts[PresetStageType.Dev]) {
        console.error(redBright(`\n🛑 Missing dev account in configuration file.\n`));
        process.exit(1);
    }

    return projectConfig;
};

export const projectConfig: ProjectConfig = loadProjectConfig();

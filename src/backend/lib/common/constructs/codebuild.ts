import { BuildSpec, Project, ProjectProps } from "aws-cdk-lib/aws-codebuild";
import { Construct } from "constructs";

export class LabsReactProject extends Project {
    constructor(scope: Construct, id: string, props: ProjectProps) {
        super(scope, id, {
            ...props,
            buildSpec: BuildSpec.fromObject({
                version: "0.2",
                phases: {
                    install: {
                        "runtime-versions": {
                            nodejs: "20",
                        },
                        commands: ["npm install"],
                    },
                    build: {
                        commands: ["npm run build --verbose"],
                    },
                    post_build: {
                        // IMPORTANT ordering: upload the built assets to the website
                        // bucket FIRST, then invalidate CloudFront. Doing the
                        // invalidation before the upload (or relying on CodeBuild's
                        // post-phase artifact upload) races with CloudFront caching a
                        // 403 for the new hashed asset paths, which then get served as
                        // the SPA index.html fallback and never refresh. `--delete`
                        // also prunes stale bundles from previous deploys.
                        commands: [
                            "aws s3 sync dist/ s3://$WEBSITE_BUCKET_NAME/ --delete",
                            'aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"',
                        ],
                    },
                },
            }),
        });
    }
}

import { RemovalPolicy, Stack } from "aws-cdk-lib";
import {
    UserPool,
    UserPoolClient,
    UserPoolClientProps,
    UserPoolDomain,
    UserPoolProps,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { projectConfig } from "../../../../../config";

/**
 * User pool with a hosted Cognito domain.
 *
 * The pool is destroyed with the stack: this is a demo deployment, and retaining
 * an orphaned pool would collide with the generated domain prefix on redeploy.
 */
export class LabsUserPool extends UserPool {
    public readonly userPoolDomain: UserPoolDomain;
    constructor(scope: Construct, id: string, props: UserPoolProps) {
        super(scope, id, {
            ...props,
            removalPolicy: RemovalPolicy.DESTROY,
        });
        this.userPoolDomain = this.addDomain("userPoolDomain", {
            cognitoDomain: {
                domainPrefix: `${projectConfig.projectId}-${Stack.of(scope).account}`,
            },
        });
    }
}

/**
 * App client for the web frontend. Sign-in is username + password against the
 * user pool itself; there is no external identity provider.
 */
export class LabsUserPoolClient extends UserPoolClient {
    constructor(scope: Construct, id: string, props: UserPoolClientProps) {
        super(scope, id, props);
    }
}

import React, { useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Link from "@cloudscape-design/components/link";

const RESPONSIBLE_AI_POLICY_URL = "https://aws.amazon.com/ai/responsible-ai/policy/";

/**
 * Dismissible disclaimer banner shown at the top of the app. Text is scoped to
 * this customer-support demonstration (sample data, AI-generated responses).
 */
export const DemoDisclaimer: React.FC = () => {
    const [visible, setVisible] = useState(true);
    if (!visible) return null;
    return (
        <Alert
            type="warning"
            dismissible
            dismissAriaLabel="Dismiss disclaimer"
            onDismiss={() => setVisible(false)}
            header="Disclaimer"
        >
            This is a demonstration tool only. Responses are AI-generated and may be inaccurate or
            incomplete. It runs on sample data and is not connected to real customer accounts,
            orders, or systems. Do not enter real personal, financial, or otherwise sensitive
            information.
        </Alert>
    );
};

/**
 * Persistent footer noting that use is subject to the AWS Responsible AI Policy.
 */
export const ResponsibleAiFooter: React.FC = () => (
    <Box
        textAlign="center"
        color="text-body-secondary"
        fontSize="body-s"
        padding={{ top: "l", bottom: "m" }}
    >
        Use of this service is subject to the{" "}
        <Link href={RESPONSIBLE_AI_POLICY_URL} external target="_blank">
            AWS Responsible AI Policy
        </Link>
    </Box>
);

export default DemoDisclaimer;

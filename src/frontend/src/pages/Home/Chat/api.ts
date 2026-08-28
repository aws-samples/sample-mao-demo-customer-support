import { generateClient } from "aws-amplify/api";
import { sendChat } from "../../../common/graphql/mutations";
import { SendChatMutationVariables } from "../../../common/graphql/types";

const client = generateClient();

export const sendMessage = async (
    sessionId: string,
    human: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessionAttributes?: Record<string, any>,
    memoryEnabled?: boolean
) => {
    try {
        return await client.graphql({
            query: sendChat,
            variables: {
                human,
                sessionId,
                memoryEnabled: !!memoryEnabled,
                sessionAttributes: sessionAttributes ? JSON.stringify(sessionAttributes) : null,
            } as SendChatMutationVariables,
        });
    } catch (error) {
        // Check for Lambda timeout error
        if (error?.errors?.[0]?.errorType === "Lambda:ExecutionTimeoutException") {
            console.log("Lambda execution timed out, but the request is being processed asynchronously");
            // Return a "silent success" - the response will still come through the subscription
            return { data: { sendChat: null } };
        }
        // Rethrow other errors to be handled by the caller
        throw error;
    }
};

import { Authenticator, Flex, Heading, useAuthenticator } from "@aws-amplify/ui-react";
import { useEffect } from "react";
import { FiHeadphones } from "react-icons/fi";
import "./Login.css";

const Login = () => {
    const { authStatus } = useAuthenticator((context) => [context.authStatus]);

    // Handle auth errors by checking the URL for error parameters
    useEffect(() => {
        const url = new URL(window.location.href);
        const errorParam = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        if (errorParam && errorDescription) {
            console.error("Authentication error:", errorDescription);
            // Clear error params from URL so they don't persist on refresh
            url.searchParams.delete("error");
            url.searchParams.delete("error_description");
            url.searchParams.delete("state");
            window.history.replaceState({}, document.title, url.toString());
        }
    }, []);

    return (
        <div className="login-page">
            {/*
             * Self-service sign-up is enabled on the user pool, so the Amplify
             * Authenticator shows a "Create Account" tab. New users register with an
             * email + password, confirm the emailed code, and the postConfirmation
             * trigger seeds their demo data. Administrators can still create users
             * directly (see the README) — both paths coexist.
             */}
            <Authenticator
                hideSignUp={false}
                // The user pool requires the `email` standard attribute, but sign-in
                // aliases are username-only — so the sign-up form must explicitly
                // collect an email. Without this the form shows username/password
                // only and Cognito rejects the registration with "Attributes did not
                // conform to the schema: email: The attribute email is required".
                signUpAttributes={["email"]}
                variation="modal"
                components={{
                    SignIn: {
                        Header: () => {
                            return (
                                <Flex direction="column" padding="2rem 2rem 0">
                                    <div className="login-brand">
                                        <div className="login-logo">
                                            <FiHeadphones />
                                        </div>
                                        <Heading
                                            level={4}
                                            textAlign="center"
                                            className="login-title"
                                        >
                                            Customer Support Assistant
                                        </Heading>
                                        <span className="login-subtitle">
                                            Multi-Agent AI Demo Platform
                                        </span>
                                    </div>
                                </Flex>
                            );
                        },
                    },
                }}
            />
        </div>
    );
};

export default Login;

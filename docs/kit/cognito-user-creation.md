# Cognito User Creation

The application authenticates users with Amazon Cognito. Users can register themselves from the login page's **Create Account** tab, and an administrator can also create users directly. Use the steps below for the administrator path — creating a user with an email address and password.

1. Open the [Cognito console](https://console.aws.amazon.com/cognito/v2/idp/user-pools?) and select the **User pool name** for your deployment.
2. In the left menu, choose **Users**, then **Create user**.
3. Fill in the user:
    - **Invitation message**: choose *Send an email invitation* to have Cognito email a temporary password, or *Don't send an invitation* if you plan to set the password yourself.
    - **Email address**: the address the person will sign in with. Also select **Mark email address as verified**.
    - **Password**: choose *Generate a password* for a temporary one, or *Set a password* to enter your own. The policy requires at least 8 characters with uppercase, lowercase, a digit, and a symbol.
4. On the application's login page, enter that email address and password, then follow the on-screen prompts. If the password was temporary, Cognito asks you to set a permanent one on first sign-in.

Notes:

- Sign-in uses the **username**, and these steps set the username to the email address.
- A post-confirmation Lambda seeds sample customer data for the user on first sign-in, so each user gets an independent demo dataset.
- To recover a locked-out user, select them in the console and use **Reset password**.

The equivalent AWS CLI commands are in the "Create your first user" section of the [README](../../README.md).

# Register the personal Outlook sync application

You need a Microsoft Entra directory in which you can register an application.
Signing into Outlook alone does not create that directory. If the Azure portal says
your personal account has no directory, create one through an available Microsoft
onboarding route you control, or use a directory you already own. Do not use an
employer's directory without its permission. A paid compute subscription is not
needed by this GitHub-hosted runner; evaluate any terms or charges in Microsoft's
onboarding yourself before accepting them.

1. In Azure/Entra, select your directory → App registrations → New registration.
2. Name: **Skylight Outlook Sync**.
3. Supported accounts: **Personal Microsoft accounts only**, if offered. Otherwise
   select **Accounts in any organizational directory and personal Microsoft accounts**.
   The runner uses the `consumers` authority and verifies the configured personal email.
4. Leave the redirect URI empty; this setup uses the device authorization flow.
5. Register the application. Copy **Application (client) ID**. This ID is not a secret.
6. Under Authentication / Advanced settings, enable **Allow public client flows**.
   No client secret or certificate is needed by this public-client device flow.
7. Under API permissions → Microsoft Graph → Delegated permissions, configure
   **User.Read**, **Calendars.ReadWrite**, and **offline_access**. Do not add mail,
   contacts, directory-wide, or application permissions.
8. Run the local connection command in the sync setup guide. Review the Microsoft
   consent screen yourself. Calendar read/write covers the signed-in user's calendars;
   the sync code further pins writes to the configured calendar ID. Offline access
   permits renewable background access while the laptop is off.

Changing app permissions or granting consent is a security-sensitive step. The
operator must explicitly approve it. Do not paste passwords, refresh tokens, or
access tokens in chat. After registration, sharing the client ID is sufficient for
continuing setup; enter your Microsoft credentials only on Microsoft's sign-in page.

After consent, the setup lists calendars and verifies the account. Select the
existing destination containing the imported copies; do not create a second calendar
unless you intentionally want a separate destination.

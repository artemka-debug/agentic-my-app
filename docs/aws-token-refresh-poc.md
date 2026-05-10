# POC: AI-Assisted AWS Token Refresh With `gimme-aws-creds`

## Goal

Create a local AI-agent workflow that can refresh AWS credentials for a known AWS profile, while keeping browser login, device confirmation, MFA, and role selection under explicit human control.

The agent may start the credential refresh flow and verify success, but it must ask the human before opening the browser and must wait for the human to confirm login completion.

## Target AWS Profile

Use this AWS profile:

```text
972277735873_SoftwareEngineer
```

## Non-Goals

The agent must not:

- Enter MFA codes.
- Confirm device prompts.
- Choose roles silently.
- Read or print AWS secret keys.
- Store AWS credentials in prompts, logs, transcripts, or config.
- Attempt to bypass browser login.

## Required Local Tools

The developer machine must have:

```bash
aws --version
gimme-aws-creds --version
```

The AWS profile must be configured locally for `gimme-aws-creds`.

## POC Flow

### 1. Preflight Existing AWS Credentials

The agent first checks whether credentials are already valid:

```bash
aws sts get-caller-identity --profile 972277735873_SoftwareEngineer
```

If this succeeds, the agent reports:

```text
AWS credentials are valid for profile 972277735873_SoftwareEngineer.
```

The agent can continue with AWS verification commands.

### 2. Detect Missing Or Expired Token

If preflight fails with an auth-related error, such as:

```text
ExpiredToken
SSOProviderInvalidToken
Unable to locate credentials
The security token included in the request is expired
```

the agent does not continue automatically.

It asks the human:

```text
AWS credentials for profile 972277735873_SoftwareEngineer are missing or expired.

I need to run:
gimme-aws-creds --profile 972277735873_SoftwareEngineer

This may open a browser and require you to confirm the device, complete MFA, and select/confirm the SoftwareEngineer role.

Open the browser login flow now?
```

Allowed answers:

```text
yes
no
```

### 3. Start `gimme-aws-creds`

If the human says yes, the agent runs:

```bash
gimme-aws-creds --profile 972277735873_SoftwareEngineer
```

Expected behavior:

- `gimme-aws-creds` may open the browser automatically.
- It may print a URL.
- It may require device confirmation.
- It may require MFA.
- It may require selecting or confirming the `SoftwareEngineer` role.

The human completes all browser-side steps.

### 4. Wait For Human Confirmation

After starting the command, the agent waits and asks:

```text
Complete the browser login, device confirmation, MFA, and role confirmation for:

Profile: 972277735873_SoftwareEngineer
Role: SoftwareEngineer

When finished, reply: done
```

Allowed answers:

```text
done
cancel
```

If `cancel`, the workflow stops with:

```text
BLOCKED_NEEDS_USER: AWS credential refresh was cancelled.
```

### 5. Verify Token Was Acquired

After the human replies `done`, the agent runs the preflight again:

```bash
aws sts get-caller-identity --profile 972277735873_SoftwareEngineer
```

If successful, the POC is considered passed.

Expected output should include the AWS account identity, for example:

```json
{
  "UserId": "...",
  "Account": "972277735873",
  "Arn": "arn:aws:sts::972277735873:assumed-role/..."
}
```

The agent should report only the safe summary:

```text
AWS credentials refreshed successfully.
Account: 972277735873
Profile: 972277735873_SoftwareEngineer
```

Do not print access keys or session tokens.

## POC Acceptance Criteria

The POC passes if:

- The agent checks the AWS profile before attempting refresh.
- The agent asks before opening or starting the browser login flow.
- The agent uses exactly this profile:

```text
972277735873_SoftwareEngineer
```

- The human performs browser/device/MFA/role confirmation.
- The agent waits for human confirmation before continuing.
- The agent verifies credentials with `aws sts get-caller-identity`.
- No AWS secret values are logged or shown.

## Suggested State Machine

```text
START
  -> CHECK_AWS_TOKEN
  -> TOKEN_VALID
  -> DONE

START
  -> CHECK_AWS_TOKEN
  -> TOKEN_EXPIRED
  -> ASK_OPEN_BROWSER
  -> RUN_GIMME_AWS_CREDS
  -> WAIT_FOR_HUMAN_LOGIN
  -> RECHECK_AWS_TOKEN
  -> TOKEN_VALID
  -> DONE

WAIT_FOR_HUMAN_LOGIN
  -> CANCELLED
  -> BLOCKED_NEEDS_USER
```

## Minimal Pseudocode

```ts
const profile = "972277735873_SoftwareEngineer";

async function checkAwsToken() {
  return run(`aws sts get-caller-identity --profile ${profile}`);
}

async function refreshAwsToken() {
  const preflight = await checkAwsToken();

  if (preflight.ok) {
    return {
      status: "valid",
      message: "AWS credentials are already valid.",
    };
  }

  const approved = await askHuman(`
AWS credentials for profile ${profile} are missing or expired.

I need to run:
gimme-aws-creds --profile ${profile}

This may open a browser and require you to confirm the device, MFA, and SoftwareEngineer role.

Open the browser login flow now?
`);

  if (!approved) {
    return {
      status: "blocked",
      message: "AWS credential refresh was not approved.",
    };
  }

  await runInteractive(`gimme-aws-creds --profile ${profile}`);

  const done = await askHuman(`
Complete browser login, device confirmation, MFA, and role confirmation.
Reply "done" when finished.
`);

  if (!done) {
    return {
      status: "blocked",
      message: "AWS credential refresh was cancelled.",
    };
  }

  const finalCheck = await checkAwsToken();

  if (!finalCheck.ok) {
    return {
      status: "blocked",
      message: "AWS credential refresh did not produce valid credentials.",
    };
  }

  return {
    status: "valid",
    message: "AWS credentials refreshed successfully.",
  };
}
```

## Security Notes

The agent can orchestrate the refresh, but the human owns the browser interaction.

The agent should only see:

- Profile name.
- Command exit status.
- Safe identity output from `sts get-caller-identity`.

The agent should never see:

- AWS access key ID.
- AWS secret access key.
- AWS session token.
- MFA code.
- Browser cookies.
- Identity provider session contents.

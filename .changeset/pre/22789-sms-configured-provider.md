---
'@objectstack/service-sms': patch
---

A configured SMS provider delivers through its credentials in the environment or in Settings, without `OS_SMS_PROVIDER`

Clause-②: no

A configuration that named `provider: 'twilio'` (or `'aliyun'`) and kept the provider's keys in the environment, but did not also set `OS_SMS_PROVIDER`, booted on `LogSmsTransport` with `isConfigured() === false`, through `os serve` and `@objectstack/verify`'s `bootStack` alike. The boot logged "SMS will NOT be sent". Two readers missed the credentials:

- **`resolveSmsCapabilityArg`** now merges the selected provider's credentials into `providerOptions`, env over `config.sms.providerOptions`, key by key, as the mail resolver does. It reads the variables the `sms` settings namespace is env-locked with: `OS_SMS_TWILIO_ACCOUNT_SID`, `_AUTH_TOKEN`, `_FROM_NUMBER` and `_MESSAGING_SERVICE_SID`, and `OS_SMS_ALIYUN_ACCESS_KEY_ID`, `_ACCESS_KEY_SECRET`, `_SIGN_NAME` and `_TEMPLATE_CODE`.
- **`SmsServicePlugin`** honours its constructor's `provider` when the `sms` settings namespace names none, and reads the namespace for that provider's credentials. The namespace's credentials overlay the constructor's `providerOptions`, so a constructor-only option such as `baseUrl` is kept. A provider named in Settings, or by `OS_SMS_PROVIDER`, still wins.

Unchanged: a configured provider whose credentials are missing everywhere still boots onto the log transport with a warning and `isConfigured() === false`. The resolver still refuses only a provider tag no transport can deliver through. Signatures and exports are unchanged.

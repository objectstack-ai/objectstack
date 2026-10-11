---
"@objectstack/spec": minor
---

feat(spec): the stack definition admits `appName` and the non-secret members of `email` and `sms`; their credentials are refused by name

Clause-②: yes (widening: the stack definition admits `appName` and the non-secret members of `email` and `sms`, which it refused as unrecognized keys)

- **What you can write now.** `defineStack()` accepts three top-level keys it used to refuse as unrecognized. The mail and SMS readers already read all three, and `objectstack serve` and `bootStack` construct the email and SMS providers through those readers:
  - `appName`: the deployment's product name. It is the last configured rung of the name chain (`OS_APP_NAME` > `email.appName` > `email.defaultTemplateContext.appName` > `appName` > `'ObjectStack'`), and it reaches the email templates and AuthPlugin.
  - `email` (`StackEmailConfigSchema`): every member of `EmailServiceConfigSchema` except `apiKey`. That is `provider`, `defaultFrom`, `retries`, `persist`, `queueDelivery`, `appName` and `defaultTemplateContext`, plus `options` narrowed to `host` / `port` / `secure` / `user` / `messageStream`.
  - `sms` (`StackSmsConfigSchema`): `provider` (`SmsProviderSchema`: `log` / `aliyun` / `twilio`) and `retries`.
  - `OS_EMAIL_*` and `OS_SMS_PROVIDER` still override the file per key.
- **What stays in the environment, and is refused by name.** A stack definition is compiled into the published artifact, so it does not carry credentials. Each refusal names the key and the variable that replaces it:
  - `email.apiKey` and `email.options.apiKey`: set `OS_EMAIL_API_KEY`.
  - `email.options.password`: set `OS_EMAIL_SMTP_PASSWORD`. The reader layers it over the host / port / secure / user the file carries.
  - `sms.providerOptions`: configure the provider in Setup → Settings → SMS Delivery, or through that namespace's overrides (`OS_SMS_PROVIDER`, `OS_SMS_TWILIO_*`, `OS_SMS_ALIYUN_*`). It is refused whole, because every non-`log` SMS transport needs a credential inside it and nothing merges an environment credential into it.
- **Composition.** All three keys compose as single values. `composeStacks` passes an identical value through and refuses two different ones by key.
- **Nothing to migrate.** No stack that was accepted before is refused now. A configuration that set these keys only in an object `defineStack` did not build (the one `objectstack serve` boots) reads the same as before. To build it, move any credential it carries into the environment.
- New exports from `@objectstack/spec/system`: `StackEmailConfigSchema`, `StackEmailProviderOptionsSchema`, `StackSmsConfigSchema`, `SmsProviderSchema`, and their `z.input` / `z.infer` types.

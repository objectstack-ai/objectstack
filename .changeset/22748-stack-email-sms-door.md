---
"@objectstack/spec": minor
---

feat(spec): the stack definition admits `appName`, the non-secret members of `email`, and `sms.retries`; credentials and the SMS provider are refused by name

Clause-②: yes (widening: the stack definition admits `appName`, the non-secret members of `email`, and `sms` carrying `retries` alone, which it refused as unrecognized keys)

- **What you can write now.** `defineStack()` accepts three top-level keys it used to refuse as unrecognized. The mail and SMS readers already read them, and `objectstack serve` and `bootStack` construct the email and SMS providers through those readers:
  - `appName`: the deployment's product name. It is the last configured rung of the name chain (`OS_APP_NAME` > `email.appName` > `email.defaultTemplateContext.appName` > `appName` > `'ObjectStack'`), and it reaches the email templates and AuthPlugin.
  - `email` (`StackEmailConfigSchema`): every member of `EmailServiceConfigSchema` except `apiKey`. That is `provider`, `defaultFrom`, `retries`, `persist`, `queueDelivery`, `appName` and `defaultTemplateContext`, plus `options` narrowed to `host` / `port` / `secure` / `user` / `messageStream`. `OS_EMAIL_*` still overrides it per key.
  - `sms` (`StackSmsConfigSchema`): `retries`, the SMS service's attempt budget. It applies to whichever transport the `sms` settings namespace selects.
- **What stays elsewhere, and is refused by name.** Each refusal names the key and the setting that replaces it:
  - `email.apiKey` and `email.options.apiKey`: a credential, and a stack definition is compiled into the published artifact. Set `OS_EMAIL_API_KEY`.
  - `email.options.password`: a credential. Set `OS_EMAIL_SMTP_PASSWORD`; the reader layers it over the host / port / secure / user the file carries.
  - `sms.provider`, `sms.providerOptions` (and a flat `authToken` / `accessKeySecret`): the delivering SMS transport is built by the `sms` settings namespace from its own provider and credentials, never from a stack definition. Configure them in Setup → Settings → SMS Delivery, or through that namespace's overrides (`OS_SMS_PROVIDER`, `OS_SMS_TWILIO_*`, `OS_SMS_ALIYUN_*`).
- **Composition.** All three keys compose as single values. `composeStacks` passes an identical value through and refuses two different ones by key.
- **Nothing to migrate.** No stack that was accepted before is refused now. A configuration that set these keys only in an object `defineStack` did not build (the one `objectstack serve` boots) reads the same as before. To build it, move any credential, and the SMS provider, into the environment or Settings.
- New exports from `@objectstack/spec/system`: `StackEmailConfigSchema`, `StackEmailProviderOptionsSchema`, `StackSmsConfigSchema`, and their `z.input` / `z.infer` types.

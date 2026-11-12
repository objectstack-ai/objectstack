---
'@object-ui/console': patch
'@object-ui/auth': patch
'@object-ui/i18n': patch
'@objectstack/service-settings': patch
'@objectstack/platform-objects': patch
---

fix(console): a clean self-hosted install reads as a first run — the sign-in page leads with creating the owner account, sign-up says every problem inline at once, Home says each item once, and a wrong password on a box with no mail points to the administrator

Clause-②: yes (widening)
Metadata-protocol: none

What a visitor and an administrator see on a fresh deployment (objectstack#32021):

- **Sign-in on a box nobody has an account on.** The page asked the first visitor "Welcome back". When `GET /api/v1/auth/bootstrap-status` answers `hasOwner: false` (the probe that already switched the card's footer between "Sign up" and "Have an invitation?"), the card is now titled "Set up this deployment" and leads with a "Create the owner account" button, with the sign-in form below it. The probe now runs for every posture that offers a form to a visitor not invited, not only `invite_only`. A probe that fails, or a box that has an owner, keeps "Welcome back" exactly as before.
- **Sign-up.** `RegisterForm` is `noValidate` and checks every field on submit, so the browser's one-at-a-time bubble (in the browser's language) is gone, and a short password that also does not match shows both messages together, each under its own field with `aria-invalid` and `aria-describedby`. Three new labels, `nameRequiredError`, `emailRequiredError` and `emailInvalidError`, carry the empty-name, empty-email and malformed-email messages; the minimum stays 8, as the auth config serves none. The banner still carries what the server refuses.
- **Home.** "No email service is set up" and "Connect an AI assistant" are each said once: the deployment notice keeps its email line (what it says and who sees it are ruled, objectstack#30120), and the first-run checklist leaves its Email delivery row out while that line is drawn; the checklist's assistant row, while it is not done, stands in for Home's Connect an AI Assistant card, which members (who get no checklist) still see. The notice now uses the same 1120px width as the rest of Home, and the checklist sits closer under it, so "Your apps" is not pushed below the fold.
- **The checklist's assistant row** says it is about an external AI assistant over MCP, and that the built-in AI is set up separately.
- **A wrong password with no mail transport.** When `/api/v1/auth/config` reports `features.emailDelivery: false`, the refusal says to ask the administrator to reset the password, instead of pointing to a reset email that never arrives.
- **zh-CN wording.** The checklist names the current language and country in the reader's language; the managed-by note says 账号系统 instead of 「经身份服务写入」; and the AI settings page translates Embedder, Trace, Prompt and PII (向量化, 请求追踪, 提示词, 个人敏感信息).

New `@object-ui/i18n` keys, in every pack: `auth.login.firstOwner.{title,description,createButton,signInDivider}`, `auth.login.errors.invalidCredentialsNoMail`, `auth.register.{nameRequiredError,emailRequiredError,emailInvalidError}` and `auth.register.firstOwner.{title,description}`. Nothing is removed or renamed.

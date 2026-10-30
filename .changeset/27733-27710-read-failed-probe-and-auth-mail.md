---
'@objectstack/core': patch
'@objectstack/plugin-auth': patch
---

fix(core, plugin-auth): a failed organization probe says `readFailed` too, and an auth mail no longer reads a failed settings read as "no default currency" (#27733, #27710)

Clause-②: no — `resolveLocalizationContext`'s result keeps its shape; the existing `readFailed?: true` member gains one more trigger. Nothing new is exported from a package entry.
Metadata-protocol: none

- **Before.** For a caller that names no organization where no wall stands, `resolveLocalizationContext` first asks `sys_organization` which organization's rows it may read. A store fault on that probe answered the built-ins with no `readFailed`, so messaging graded a mail whose `{{ amount | currency }}` hole then had no default as permanent (`TEMPLATE_INVALID`) and dead-lettered it. And the auth mails (verification, password reset, invitations, magic link, notices) read every failed settings read as "the organization has no default currency": such a mail failed with `TEMPLATE_INVALID` and its "set localization.currency" remedy during a transient fault.
- **Now.** A probe that throws `AuthzStoreUnavailableError` answers `readFailed: true`, the same as a failed `sys_setting` read, so messaging retries the delivery. That answer is cached in neither memo, since no value was read: the next request asks again. A posture that cannot be read is not a store fault and still answers no `readFailed`. The auth mail's currency read rejects on `readFailed`; when the render then refuses for want of a default, the mail is rendered once more without sending with the no-currency code `XXX`: if that renders, the mail fails with an error that names the failed read and carries no `TEMPLATE_*` code, so sending it again once the read succeeds works; if it still refuses, that refusal stands.
- **Unchanged.** A read that succeeds and finds no default keeps today's refusal and remedy, on both paths. A template with no no-argument `currency` hole is sent during a read fault. The failure memo for a failed `sys_setting` read is unchanged.

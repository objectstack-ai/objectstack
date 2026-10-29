---
'@objectstack/core': patch
'@objectstack/service-messaging': patch
---

fix(core, service-messaging): a failed settings read no longer dead-letters a templated mail as `TEMPLATE_INVALID`; only a read that finds no default currency is permanent (#27257)

Clause-②: yes (widening) — `resolveLocalizationContext`'s result (`@objectstack/core`) gains one optional member, `readFailed?: true`. Nothing is narrowed.
Metadata-protocol: none

- **Before.** `resolveLocalizationContext` answered `currency: undefined` both when the organization has no default currency and when its `sys_setting` read failed (the failure is memoized for 30 s). So a messaging delivery whose template has a `{{ amount | currency }}` hole with no argument was refused `TEMPLATE_INVALID` during a transient settings fault, graded permanent and never sent, although a retry would have worked.
- **Now.** The answer carries `readFailed: true` when the direct `sys_setting` read threw, on the fresh read and on a hit of the failure memo alike. A settings-service refusal does not count, and the memo is not lengthened. Messaging's tenant-currency read rejects on it; the email and inbox channels then render without a currency, and a `TEMPLATE_INVALID` that follows is recorded without a `TEMPLATE_*` code, so the delivery is retried. Once the read succeeds, an organization with no default currency gets `TEMPLATE_INVALID` with its remedy, graded permanent, as before.
- **Unchanged.** A template with no no-argument `currency` hole is sent during a settings fault, as before. Every other template failure keeps its grade. The other callers of `resolveLocalizationContext` see the same values; the new member is optional and absent on every successful read.

---
"@objectstack/plugin-approvals": minor
---

fix(plugin-approvals): the non-submitter recall refusal renders through the
Operation Message Catalog instead of a hardcoded English sentence (#11993, the
services-side half of the shape-A ruling)

A user who opened a record someone else had submitted for approval, clicked
Recall and was correctly refused read the reason in English regardless of their
own locale. `@objectstack/rest`'s `handleApprovalError` ships this service's
thrown reason as the 403 body's human-readable `error`, and Console splices it
under its own localized label — so an operator in a fully Chinese deployment
read a Chinese prefix glued onto an English sentence they could not act on
(`撤回审批失败: <English>`).

The refusal now renders through the shared Operation Message Catalog in
`@objectstack/spec/system` under the key `approval_recall_not_submitter` that
#12493 landed for it — the same mechanism `plugin-security`'s denial gates
already use, with the same resolution ladder (deployment override → the
caller's locale → `en` → the key) and the same guarantee that a misbehaving
i18n service cannot turn a 403 into a 500. All four platform locales (`en`,
`zh-CN`, `ja-JP`, `es-ES`) ship copy that names who *can* recall, rather than
dead-ending the reader.

`ApprovalServiceOptions` gains an optional `messageTranslator` — a lazily
resolved, `II18nService.t`-compatible lookup, wired by `ApprovalsServicePlugin`
the same way `tenancyPosture` and the field-visibility source are, because the
i18n service is contributed by another plugin and may start later. It is what
makes the override address the catalog documents,
`errors.approval_recall_not_submitter`, actually take effect for this emitter;
a stack without an i18n service still renders the built-in catalog in the
caller's locale.

**Not changed: who may recall an approval.** The gate is byte-identical — the
submitter, or a privileged admin releasing a stuck record (#3424). Only the
sentence the refusal carries is different, and the `FORBIDDEN:` code prefix
that the REST layer maps to 403 is untouched.

The button-visibility half of #11993 — a non-submitter seeing a live recall
button at all — is not addressed here; see the issue for the measurement.

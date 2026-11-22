---
'@objectstack/spec': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat: the controlled-by-parent master refusal carries a machine-readable code, and the Studio settings tab words it for the author in en and zh

Clause-②: yes
Metadata-protocol: none

`@objectstack/spec` — the refusal of a `sharingModel: 'controlled_by_parent'` object that does not derive exactly one writable master now stamps its parse issue with `params: { code: 'CONTROLLED_BY_PARENT_MASTER_INVALID', shape }`, at both raise sites: `ObjectSchema`'s refinement and `defineStack`'s extension-merge gate. `shape` is the refusal's existing `ControlledByParentMasterShape` (`several-required-masters`, `several-masters`, `master-not-required`, `required-lookup-only`, `no-master`, `master-not-writable`). The code is exported as `CONTROLLED_BY_PARENT_MASTER_INVALID` from `@objectstack/spec/data`, with the `ControlledByParentMasterIssueParams` type, and is registered in `ERROR_CODE_LEDGER` under `@objectstack/spec`. Which objects are refused, and where, is unchanged.

The refusal's English message no longer cites an ADR section: each of its three arms read `ADR-0055 §1: since @objectstack/spec 18, …` and now reads `Since @objectstack/spec 18, …`. The rest of each message, including the fix it prescribes, is unchanged. A script that matched `ADR-0055 §1:` in this message should match the code on `params.code` instead.

`@object-ui/app-shell` / `@object-ui/i18n` — the Studio object settings tab no longer shows the spec's English message verbatim when "Follows its parent record" cannot be saved. It reads the code and shape off the save door's own parse and shows one sentence per shape from the `studio` namespace (`engine.studio.settings.cbpRefusal*`, en and zh), naming the fields to change by their labels. A refusal without the code, or with a shape that has no sentence, still shows the spec's message.

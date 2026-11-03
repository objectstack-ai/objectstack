---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console)!: a decision output declared `multiple: true` is collected as a list and sent as a string array, from the record header and the Approval Center alike

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata key or stored shape changes: the Console now sends each decision output in the shape its already-declared `multiple` names, which the approvals decision door judges (`@objectstack/plugin-approvals`, same release). The one deleted key is a message string in the built-in locale packs whose only call site this change removes; it is not metadata, and a host that kept its own text under it keeps it in its own resources. -->

**BREAKING** for a TypeScript caller that names `actions.decisionOutput.helpMultiValue` through the pack-derived key type (`TranslationKeys`): the key leaves all ten packs (ar, de, en, es, fr, ja, ko, pt, ru, zh).

- **Before.** Every decision output without a picker (`text`, a bare key, or a `position` output with no registry reader) rendered as one text box whose help said to comma-separate multiple values, so a list output reached the server as one comma string, which the decision door now refuses.
- **Now.** Such an output declared `multiple: true` renders as a tags input: each entry is trimmed, a blank or repeated entry is skipped, and the decide body carries a string array. An output without `multiple: true` stays one text box and is sent as one string; a comma in it is literal. Both decision surfaces build their params in `decisionOutputParams`, so the record header and the Approval Center send the same shape. Every output's help now reads `actions.decisionOutput.help`.
- **Who sees it.** An approver deciding a step with a free-value list output: they add entries one by one (Enter, a comma key, or leaving the box) instead of typing one comma-separated line.

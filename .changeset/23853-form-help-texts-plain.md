---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

Clause-②: no

Six help texts an administrator reads in Setup no longer carry ADR numbers. On the Permission Sets edit form,
`isDefault`, `managedBy` and `packageId` are rewritten as plain sentences that say what the field does, and
`adminScope` drops its "(ADR-0090 D12)" prefix. On the Positions edit form, `delegatable` drops "(ADR-0091 D3)".
The view form's End-user controls description drops "(ADR-0047, Airtable Interface parity)".

The ADR references moved to the comments beside the form rows. The generated metadata-forms translations carry
the new wording in en, zh-CN, ja-JP and es-ES. No key, type or accept/refuse result changes.

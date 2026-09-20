---
"@objectstack/plugin-approvals": patch
---

`ApprovalService` inbox display enrichment resolves a reference field's target through `referenceTargetOf` instead of the materialized `reference` carrier, so a `{ type: 'user' }` field authored without one is enriched instead of silently dropped (#19198).

`resolveLookupFields` admitted `user` fields but required an EXPLICIT `reference` on them. The spec declares exactly the opposite for that type: `IMPLICIT_REFERENCE_TARGETS` (`@objectstack/spec/data`) says a `user` field's target is "a CONSTANT OF THE TYPE, so `reference` on a `user` field materializes that constant; it does not supply it. Metadata authored without it (hand-written JSON, an AI author, a Studio form) is **fully specified, not under-specified**." So the one spelling the contract calls complete was the one the reader refused — and it refused it **silently**: the field was left out of `payload_display`, with no refusal and no diagnostic, and the reviewer read a raw user id where every other reference field showed a name.

- **The target is now the arbiter's answer, not a carrier read.** `referenceTargetOf` is the same single arbiter the `$expand` gate and the expansion engine already ask (Framework#4443 / cloud#983 fixed the identical defect there); approvals was still reading `field.reference` raw.
- **Nothing else widens.** The admitted types are unchanged (`lookup`, `master_detail`, `user`), so a `lookup` / `master_detail` whose author-chosen target is absent still names nothing, is still left out, and still issues no read — `tree` is deliberately not added.
- **The unreadable-carrier behaviour is unchanged.** `referenceTargetOf` reads the carrier through `referenceCarrierOf`, the throw is still caught per field so one bad carrier cannot drop every reference field of the object, and the warning now names this reader (`ApprovalService.resolveLookupFields`) because the arbiter's own message names itself.
- **No authoring change.** Metadata that already spells `reference: 'sys_user'` resolves to the same target it always did; nobody has to restate the constant.

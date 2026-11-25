---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

feat(lint): refuse a `transferBehavior: 'cascade'` the Change Owner action can never offer

Clause-②: no
Metadata-protocol: narrowed

<!-- adr-0087: registered transfer-cascade-never-offered-refused -->

`os validate`, `os build` and `os lint` now refuse three `transferBehavior: 'cascade'` declarations that parsed and then did nothing, because the Change Owner endpoint re-judges every relationship and never offers them. Each is an `error`, with the fix named:

- `transfer-cascade-parent-without-change-owner`: the reference points at a parent in the stack that does not offer Change Owner (`ownership: 'business_unit' | 'org' | 'none'`, any `managedBy`, a pinned or unprovable owner, or `userActions.transfer` off, by the author or by the `controlled_by_parent` default). A `sys_` parent stays the field parse's refusal.
- `transfer-cascade-extension-child-ineligible`: an object extension's field (`objectExtensions[].fields`) declares the cascade on an object that cannot take one. `ObjectSchema` already refused this on a field the object declares itself; an extension's field skipped that parse. A `fieldPatches` entry cannot carry the key at all.
- `transfer-cascade-child-update-unexposed`: the child's `enable` block does not serve `update` (`apiEnabled: false`, or `apiMethods` without update).

Fix: set the field's `transferBehavior` to `'none'` or remove it, or change the object the message names (offer Change Owner on the parent, or open update on the child). The verdicts come from the spec predicates the runtime reads (`resolveUserActionTransfer`, `transferCascadeIneligibilityReason`, `apiExposureDenialReason`); the runtime is unchanged. New exports: `validateTransferCascades` and the three rule id constants. Not yet run at the runtime publish gate. Migration entry `transfer-cascade-never-offered-refused` (`@objectstack/spec`) carries the same fix for `os migrate meta` and the upgrade guide.

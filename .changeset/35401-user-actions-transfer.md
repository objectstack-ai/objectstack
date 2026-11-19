---
'@objectstack/spec': minor
'@objectstack/platform-objects': minor
---

feat(spec): `userActions.transfer`, the per-object switch for the Change Owner action, and its structural eligibility

Clause-②: yes (widening)
Metadata-protocol: added

An object can now say whether it offers the Change Owner action. The action is not meant for every record that happens to carry an `owner_id`: line items, invoices and other details get one injected too, and an admin holding `modifyAllRecords` would otherwise see the action everywhere.

- **Structural eligibility (derived, never overridable).** `isTransferEligible(def)` from `@objectstack/spec/data` answers true only when the platform injects the object's reassignable `owner_id` (`resolveInjectedSystemColumns(def).owner`) and the object does not declare that field `readonly: true`. So `ownership: 'business_unit' | 'org' | 'none'`, every `managedBy` object, every `sys_*` object and `systemFields: false` never offer the action. `transferIneligibilityReason(def)` names the structural fact when the answer is no.
- **The switch.** `userActions.transfer` takes the same shape as the CRUD entries beside it: a boolean, or `{ enabled, visibleWhen, disabledWhen }` whose CEL predicates read the record the action acts on. Omitted, it is on for `sharingModel` `private`, `public_read` and `public_read_write`, and for an object that declares no `sharingModel` (a custom object then resolves to `private`); it is off for a `controlled_by_parent` detail. Authors override both ways: `transfer: true` on a detail with a real owner, `transfer: false` where the owner is the actor by rule.
- **The one resolution.** `resolveUserActionTransfer(def)` returns `{ enabled, predicates? }`: structural eligibility first, then the switch, then the `sharingModel` default. The Change Owner endpoint and the console action both read it, and both still ask the caller's own transfer verdict per record.
- **Refused at parse.** `transfer: true` or `{ enabled: true }` on an object that is not eligible is refused at `userActions.transfer`, with the structural reason in the message. Closing the switch there (`false`) is accepted. `changeOwner` and `reassign` under `userActions` are refused with a pointer to `transfer`.

The switch gates the dedicated action, not the raw write: a plain `owner_id` update stays governed by `allowTransfer` alone, so import mappings and hooks are unaffected. To block every change of owner, declare `owner_id` `readonly`.

The Studio object form gains a Change Owner row under User Actions, with its label and help text translated in every shipped locale.

Nothing reads the switch at runtime yet. The Change Owner endpoint and the console action come in follow-up changes. The key is new, so no stored object carries it and nothing needs migrating.

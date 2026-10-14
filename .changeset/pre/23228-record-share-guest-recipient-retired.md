---
'@objectstack/spec': minor
'@objectstack/plugin-sharing': minor
---

fix(spec,plugin-sharing)!: `sys_record_share` no longer offers a `guest` recipient, which no grant ever honoured (ADR-0138 D8)

Clause-②: no (narrowing: a declared recipient value no grant honours is refused)

<!-- adr-0087: not-required (no-migration-prescription) No working use of the value exists to rewrite. `ISharingService.grant` refused every non-`user` recipient before this change, so no grant naming `guest` ever succeeded, and the census pinned in `@objectstack/spec` finds no seed, fixture, example, template, migration or test row in this repository that writes `recipient_type` as `guest`, and no stored metadata surface that carries it. Seed data, the one metadata surface that can carry a row value, targets `sys_record_share` nowhere in the tree (the examples seed `sys_user` and `sys_business_unit`, never a record share). What narrows is a published TypeScript union in `packages/spec/src/contracts/` and the option set of a platform object's select: a caller that still spells the value meets a compile error or a located refusal, and there is nothing for `objectstack migrate meta` to derive from metadata. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers this value and this diff adds none (not registered or already-registered); the union lives under `packages/spec/src/contracts/` and the diff touches `packages/spec` (not runtime-interface-only or type-surface-only); no export is removed (not runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A record share to the anonymous principal was declared in two places and honoured in none. Both declarations are gone:

- `RecordShareRecipientType` (`@objectstack/spec/contracts`) is now `'user' | 'group' | 'position' | 'unit_and_subordinates'`. Passing `recipientType: 'guest'` to `ISharingService.grant`, or typing a `RecordShare.recipient_type` as `'guest'`, is a compile error.
- The `recipient_type` select on `sys_record_share` (`@objectstack/plugin-sharing`) offers those same four options, and its `guest` label is gone from the four translation bundles.

Why: the grant refused `guest` (ADR-0078), and no gate reads such a row, because the read and write gates match `recipient_type: 'user'` only. ADR-0090 D11 routes guest access through the guest position and share links, so a record share to the guest had nothing to gain. The sharing-rule vocabulary retired the same recipient in v17.

What a caller sees now:

- **The grant door** (`POST /data/:object/:id/shares`, or `grant()` from untyped code). A body naming `recipientType: 'guest'` is still refused with `VALIDATION_FAILED` (`400`), as before. The sentence now says the value was removed and that guest access flows through the guest position and share links. It used to say that sharing rules deliver non-`user` recipients, which was never true of a guest. To let a guest reach a record, use a public form or a share link.
- **The row door** (a system-context engine write: a seed, a plugin, a migration script). A row carrying `recipient_type: 'guest'` is now refused with `VALIDATION_FAILED`, an `invalid_option` error on `recipient_type` that lists the four values a row may carry. Before this change such a write stored a row that looked granted and enforced nothing.
- **Unchanged:** every `user` grant, the other three row values, the sharing-rule service, and the gates. A `guest` row that a system write stored before this release is read by no gate, both before and after.

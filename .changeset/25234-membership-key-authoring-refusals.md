---
'@objectstack/lint': minor
'@objectstack/metadata-protocol': patch
---

feat(lint)!: a membership key, and a row policy that reads one, are judged when authored, at the CLI and at the object and permission save doors

Clause-②: no (narrowing: `os validate`, `os build`, `os lint` and the object and permission save doors refuse a `membershipKeys` declaration that cannot resolve and a row policy that reads a membership key in a way that matches no rows; the RLS rule now also judges object writes)
Metadata-protocol: narrowed

`ObjectSchema.membershipKeys` names a `current_user.KEY` set: the distinct `valueField` values of the roster rows whose `userField` is the signed-in user and on which `filter` holds. The security plugin resolves it per request, and every miss fails closed, so a declaration that cannot resolve, or a policy that reads a key in a position it cannot match, silently grants nothing. Those are now refused where they are written.

**The new rule, `validateMembershipKeyDeclarations`** (gating, every command, and the runtime publish gate for `object` writes), with four ids:

- `membership-key-user-field-invalid`: `userField` is not a column of the roster object, or is not a single-valued user reference (a `user` field, or a `lookup` / `master_detail` to `sys_user`, not `multiple`). The column is judged on the object as merged with its extensions.
- `membership-key-value-field-invalid`: `valueField` is not a column of the roster object, or is not a reference (`lookup`, `master_detail` or `user`).
- `membership-key-declared-twice`: one key declared on two objects. At the save door this reads the live objects the written stack does not carry, outside the package closure too.
- `membership-key-resolver-collision`: a key the registered membership resolver (ADR-0105 D11) also owns. Judged at the save door only, which holds the resolver's `keys`; the CLI cannot see a resolver.

**`validateRlsPredicateEnforceability` learns membership keys**, and now runs for `object` writes at the save door beside `permission` writes:

- A key's `filter` is judged like an RLS clause, with the roster object as its target, at `objects[N].membershipKeys.KEY.filter`. A filter that does not lower, names a column the object lacks, compares with a list-holding column, or is refused by the engine's judge reports the existing `rls-predicate-*` id. A filter reading any `current_user` value reports `rls-predicate-unknown-user-variable`: a key is resolved with no caller.
- New id `rls-predicate-membership-key-target`: a declared key tested against a column whose values can never be the key's (`buyer in current_user.portal_supplier_ids`, where the key holds `srm_supplier` ids and `buyer` is a user). The referencing column, and `id` on the target object itself, are accepted.
- A declared key compared with `==` reports `rls-predicate-unenforceable`, as a kernel list key always has: a key holds a list.
- At the save door only, `x in current_user.KEY` where no kernel key, membership key declaration or registered resolver owns `KEY` reports `rls-predicate-unknown-user-variable`. The CLI keeps accepting it, because a self-hosted resolver it cannot see may own the key.

**`@objectstack/metadata-protocol`:** the publish gate reads the registered membership resolver's `keys` per publish (`RLS_MEMBERSHIP_RESOLVER_SERVICE`), `[]` when none is registered, and hands them to the rules above. A host with no service registry, or a resolver whose `keys` is not a list of strings, judges no ownership, as the CLI does.

**BREAKING**, shipped as `minor` under the launch-window convention for breaking changes. `membershipKeys` itself is unreleased, so the declaration rule narrows nothing shipped; what follows does.

- **FROM:** a permission write whose policy reads `x in current_user.KEY` that nothing owns answered 200, and the policy matched no rows at runtime. An object write was not judged by the RLS rule, so an object whose `defaultRowScope` the rule refuses on the CLI published, and so did an object write that dropped a field or a membership key a stored policy reads.
- **TO:** in publish mode each of those answers `422 INVALID_METADATA` with the issue located at the policy, the default row scope, or the key. The gate is differential: a stored policy that was already failing is not blamed on the write, and a write is refused only for a finding it adds.
- **Unchanged:** the CLI verdict on an unowned key in a membership position (`unknowable`); a policy reading a key a resolver registered at runtime owns; drafts (`mode: 'draft'`), which are never gated; `OS_ALLOW_UNLINTED_METADATA_WRITES=1`, which still turns a refusal into a logged write; stored rows, which are not read, migrated or refused until next saved; and every public export and signature.
- **Remedy:** declare the key on its roster object's `membershipKeys`, or register the resolver that stages it, before publishing the policy; test a key against the column that references the key's target; use `in`, not `==`; keep a key's `filter` to the roster object's own columns. An object write refused for a stored policy is fixed by keeping the field or key that policy reads, or by changing the policy first.

<!-- adr-0087: not-required (no-migration-prescription) Refusals at the CLI and at the object and permission save doors of membership key declarations that cannot resolve and of row policies that read a membership key in a position that matches no rows, plus the RLS rule's crossing to object writes. No authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted; the repair is the author's choice of declaration, resolver, column or operator, which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers these verdicts (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->

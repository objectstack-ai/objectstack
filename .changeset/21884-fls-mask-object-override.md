---
'@objectstack/metadata-core': minor
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

The object-schema field mask (ADR-0106 D1) judges an action param that names another object's field through `objectOverride` against that object, not the one being served.

Clause-②: yes (widening)

**What a user saw.** A `delegated_admin` may invite members, and the invite door admits them, but `GET /meta/object/sys_user` served that principal no `invite_user` action. The action's `role` param is `{ field: 'role', objectOverride: 'sys_member' }`: it names `sys_member.role`. The mask read every param's `field` as a field of the served object, so a caller denied `sys_user.role` lost the whole action. A plain `member` lost it the same way. The member is now served the action too, and still not offered it: the action's `requiresMembershipReach` predicate excludes the member grade.

**The rule.** A param whose `objectOverride` names another object reads that object's field. It is judged against the caller's readable fields on that object, and it is not a reference to the served object's fields. The action is still dropped when the caller cannot read the field there, and when that object's readable fields cannot be determined (no answer from the security service, a security service that throws, or an object that does not exist). Nothing about the other object is served on a guess. The rest of the param is still read against the served object: `visible`, an option's `visibleWhen`, `defaultValue`, and an explicit `name` that differs from `field`. A `name` that only repeats `field` is read as that field. With `defaultFromRow`, the param also reads `field` from the served object's row, so `field` is judged against the served object too. An exempt caller (platform admin, `isSystem`) is served the whole schema, as before.

**The API (`@objectstack/metadata-core`), additive.**

- `relateObjectSchemaMaskPosture(posture, ...documents)` completes a `project` posture for the documents it is about to mask. It reads the caller's readable fields on each other object their action params name through `objectOverride`. It runs after the fetch, because only the document names those objects. It returns every other posture, and any document with no such param, unchanged, and it never throws.
- The `project` member of `ObjectSchemaMaskPosture` gains two optional fields. `relate` asks the posture's question (same caller, same security service) about another object. `resolveObjectSchemaMaskPosture` sets it. `related` holds the answers. A `project` posture built without `related` gets no answers, so `applyObjectSchemaMask` drops every action with such a param.
- `applyObjectSchemaMask` folds each related read it withholds into the fingerprint, written as `object.field`. Two callers who are denied the same fields on the served object but differ on the other object get different validators. An unrestricted caller's ETag is unchanged.
- The shared contract fixture `FLS_CONTRACT_OBJECT` (`@objectstack/metadata-core/testing`) gains two actions whose params read `contact` fields through `objectOverride`. The contract's projection cases now require the readable one to be served and the denied one to be dropped. An exit that never relates its posture fails the contract by name.

**Every exit relates its posture (`@objectstack/rest`, `@objectstack/runtime`).** These exits relate the posture after the fetch, before the projection: the shared item, layered and list chains, `RestServer`'s cached read and published read, and the runtime dispatcher's mask. The `/meta` diff route masks `fields` only and needs no relate step.

**Measured on a showcase boot.** We read every object schema (78 objects, by-name read and list read) as five principals: a platform admin, an org owner, an admin, a `delegated_admin` and a `member`. Before and after this change, the only served action that moved is `sys_user.invite_user`, which is now served to the `delegated_admin` and the `member`. This repository has two authored params with `objectOverride`: `sys_user.invite_user`'s `role` and `sys_member.invite_user`'s `email` (on `sys_invitation`). The second was served to all five principals before and after.

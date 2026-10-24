---
'@objectstack/plugin-security': minor
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

feat(plugin-security): a declared membership key is staged per request, so a policy reading `current_user.KEY` reads the roster

Clause-②: no
Metadata-protocol: semantic

`ObjectSchema.membershipKeys` is now applied. The security plugin's request staging (`stageRlsMembership`, the one producer of `ExecutionContext.rlsMembership`) gains the declarative second source beside the registered `rls-membership-resolver`: when a row policy about to compile reads `current_user.KEY` and an object declares `KEY`, the key is resolved from that roster object's rows.

- **What the key holds.** The distinct values of `valueField` on the roster rows whose `userField` is the signed-in user and on which the optional `filter` holds, inside the caller's own organization wall.
- **How it is read.** Lazily and once per request: only a key a policy about to compile reads is resolved, on the read door and the write `check` alike, and one request that reads the key on several objects issues one read. The read is the platform's own system read: the caller needs no read on the roster object, and the caller's posture and audience do not change it (a portal contact and an internal member resolve a key the same way). The roster object's own row policies are not consulted.
- **Every miss fails closed.** No roster row stages an empty set. More than 1,000 values (`MEMBERSHIP_KEY_MAX_VALUES`), a failed read, a `filter` that does not compile for the roster object (a shape that does not lower, a column the object lacks, any `current_user.*`), a key two objects declare, and a key the registered resolver also owns leave the key unresolved. Every policy reading such a key matches no rows, through the compiler's existing warning. A key both sources claim is logged as an error at boot, naming both owners, and again by the request that meets it.
- **Explain.** The object-level `rls` layer names each key the policies read: its label and description, the roster object, `valueField`, `userField`, the filter, and the size it resolved to or why it did not, and the permission sets whose holders can write the roster object (whoever can write a roster row can grant the key). A record-grained rule reads `via: 'membership:KEY'`, and its detail names the roster row that links the record to the principal.
- **`@objectstack/objectql`: an `extend` contribution cannot declare a membership key.** `SchemaRegistry.registerObject` refuses one that carries `membershipKeys`, with `INVALID_METADATA` (`status: 422`) and the error name `ExtensionMembershipKeysRefusedError`, naming the object and the extending package, beside the `defaultRowScope` refusal. The extension merge never carried the key onto the object, so it registered and then never resolved. The manifest path already refused it at authoring.
- **`@objectstack/spec`**: the `membershipKeys` describe and the row-level security docs no longer say the key is not applied, and the liveness row is `live`.

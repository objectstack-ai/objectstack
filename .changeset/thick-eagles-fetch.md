---
'@objectstack/plugin-auth': patch
---

Correct `sys_user.phone_number`'s ownership and widen the ADR-0105 D7 collision guard's plugin derivation.

`phone_number` was declared as an ObjectStack extension field in
`MANAGED_EXTENSION_FIELDS` while `auth-schema-config.ts` has shipped the explicit
`phoneNumber -> phone_number` mapping since better-auth's phone-number plugin was
wired in, so better-auth writes that exact column whenever the plugin is enabled.
The entry is removed: the mapping is the ownership evidence. No write surface
changes — the field was never in `MANAGED_EXTENSION_EDITABLE_FIELDS`, and the
admin bulk-import path that does upsert it runs under a system context off its
own field list.

The reason D7 never reported this overlap is the second half: it derived
better-auth's owned columns from a single plugin (`organization`) while the auth
manager assembles fourteen. The derivation now loads the auth manager's whole
set, on the reason the sibling parity gate already records — a plugin that is
feature-flagged off in some deployments still owns its columns, because the
column has to exist before the flag can be turned on. A drift tripwire reconciles
the set against `auth-manager.ts`'s imports so a plugin added there cannot stay
outside the guard, and the collision rule is now pinned in the red direction
against a synthetic registry, not only the green one.

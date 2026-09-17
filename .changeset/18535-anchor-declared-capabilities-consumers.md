---
'@objectstack/plugin-security': minor
---

The `everyone`-anchor doors now pass the stack's declared capabilities, so an app capability token a stack DECLARES no longer makes its `isDefault` set unbindable (#18535).

ADR-0090 D5 rules the `everyone`-anchor offending list as 「平台系统权限;带 package provenance 的应用声明 capability 令牌不计」, and PR #17811 landed the predicate that implements it: `describeHighPrivilegeBits(def, context?)` excuses a `systemPermissions` name when the caller says this stack declared it. No consumer in this package passed a context, so all three doors kept judging an app's own gate exactly like `manage_users` — declared ≠ enforced on a contract both the ADR and the spec had already ruled, and an app that declared a capability its navigation gates on could not ship the "every employee holds this" set those gates need.

All three now read one source — the stack's `capabilities:` declarations, through `readDeclaredCapabilityContext` (registry first, metadata service as the fallback, exactly as the `sys_capability` seeder reads them):

- **the boot binding** (`bindBaselineToEveryone`) — the ADR-0090 D5 bind of the configured baseline set(s) to this organization's `everyone` anchor;
- **the engine write gate** on a `sys_position_permission_set` insert/update, read at most once per pass and only once an anchor row is in play;
- **`confirmAudienceBindingSuggestion`**'s early refusal, which is the friendly rendition of that same gate — one source is what keeps it from answering "confirmed" and then having its own insert refused under it.

**Why the declarations and not the `sys_capability` rows.** The predicate's docblock names the rows at boot, but the boot binding runs BEFORE `bootstrapDeclaredCapabilities` seeds them (the bind must follow `bootstrapBuiltinRoles`, which seeds the anchor, and precede the suggestion reconciliation), so the rows are empty there on a first boot. Reading them would refuse every declared token one layer in.

**Two things do not move.** The platform floor is absolute — declaring a capability named `manage_users` launders nothing, because the predicate applies `PLATFORM_CAPABILITY_NAMES` itself — and an UNDECLARED name still refuses at every door, as does every unreadable or empty declaration list (「omission refuses」). The `guest` tier is untouched: the predicate drops the context for it by contract.

**What changes for a consumer:** a permission set whose `systemPermissions` names only capabilities the stack declares, marked `isDefault: true`, now binds to `everyone` at boot instead of logging `refusing to bind fallback set to everyone`. If you were relying on that refusal to keep such a set unbound, remove the token from the set or stop declaring the capability.

Clause-②: yes (widening)

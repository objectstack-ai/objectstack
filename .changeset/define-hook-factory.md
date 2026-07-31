---
"@objectstack/spec": minor
---

feat(spec): `defineHook()` — authoring-time factory for lifecycle hooks (#4269)

New public API, following the `defineDatasource` template: accepts input-shape
config (`Hook`), runs `HookSchema.parse`, returns the resolved shape
(`ResolvedHook`, defaults materialized). Exported from the package root and
from `@objectstack/spec/data`.

Why it exists: the convention-scan authoring path
(`src/objects/<name>.hook.ts`) never parsed at all, so the #4207
alias/guidance errors were unreachable before deploy, constraint-level rules
(snake_case `name`, event names) went unchecked at authoring time, and the
scan-path artifact stayed in input shape while the `defineStack({ hooks })`
path shipped output shape. Wrapping the literal in `defineHook()` closes all
three gaps — a bad hook now hard-fails at import instead of degrading to a
bind-time skip + warning (the #4001 posture: silent no-ops fake completion).

The factory is a pure parse: handler-deprecation advice stays in the binder
(`bindHooksToEngine`'s `warnLegacyHandler` option), one place only. Existing bare `: Hook` literals keep
working; re-parsing factory output at bind time is idempotent.

Also fixes the two `UNKNOWN_KEY_GUIDANCE` prescriptions in `object.zod.ts`
(`workflows` / `hooks`) that referred authors to a `defineHook()` that did not
exist — the error message itself used to manufacture a second error; it now
names a real function and its import path.

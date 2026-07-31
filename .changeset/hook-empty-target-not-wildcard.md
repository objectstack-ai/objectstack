---
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

A hook with an empty `object` target is refused instead of silently widened to the wildcard.

`HookSchema.object` had no emptiness constraint, so `''`, `[]` and `['']` all parsed. The binder's `normalizeObjects` then mapped the first two to `['*']` — the engine's match-everything sentinel — so a hook whose target was left blank registered on **every** object in the tenant, on every event it listed, with no diagnostic anywhere. `['']` failed the other way, registering on an object name nothing matches: a hook that could never fire (ADR-0078). Both shapes are now refused, at parse time and again in the binder (which accepts unparsed input, so the guard has to hold in both places). The error names the two spellings that work and the wildcard the blank silently became. A wildcard hook stays legitimate — it just has to be spelled `'*'`, so it is a choice visible in a diff.

Also fixes `bindHooksToEngine`'s `strict` option, which is documented as "fail fast on misconfiguration" but never threw: the per-hook `try`/`catch` swallowed the throw its own strict branch raised, recording the failure twice and carrying on. Under `strict` a bind failure is now fatal, as advertised.

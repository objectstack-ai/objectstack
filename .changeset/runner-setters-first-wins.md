---
"@objectstack/objectql": minor
"@objectstack/runtime": patch
---

feat(objectql,runtime): the default-runner setters are first-wins, and the private-field probes that used to enforce that are gone (#4251)

`setDefaultBodyRunner` / `setDefaultActionRunner` now enforce their own
documented contract — "the runtime layer sets this once per engine" — by
keeping the first runner and returning `false` for any later call. Public
accessors `getDefaultBodyRunner()` / `getDefaultActionRunner()` join them, and
the fields become real `private` members instead of `(this as any)` attachments.

Before this, the invariant lived in the CALLERS: AppPlugin probed the engine's
private `_defaultBodyRunner` / `_defaultActionRunner` fields through `any` to
avoid clobbering another AppPlugin's runner on a shared kernel — an invariant
owned by every caller and enforced by none, and a private reach that a field
rename would have broken silently (the guard reads `undefined`, every AppPlugin
reinstalls). The engine's own `bindHooks` fallback and ObjectQLPlugin's
authored-action re-sync read the same fields the same way. All three read the
public accessors now; the only remaining `_default*` mentions in the repo are
comments and test doubles.

Caller audit before the semantics change: every setter call site either owns a
fresh engine (the sandbox and hook-binder tests) or wants exactly
keep-the-first (AppPlugin) — nobody replaces a runner on a live engine. Return
type `void` → `boolean` is additive; AppPlugin uses it to keep its "Installed
default … runner" log truthful (skipped when the engine kept an earlier one).

Pinned in hook-binder tests: second install refused end-to-end (the first
runner is the one that executes) and the accessors expose exactly what was
kept.

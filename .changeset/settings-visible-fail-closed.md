---
"@objectstack/service-settings": patch
---

fix(service-settings): refuse a save whose `visible` predicate cannot be evaluated, instead of silently skipping the field's `required` gate (#7169)

**Before:** a settings specifier whose `visible` predicate the save-time
evaluator could not parse was skipped entirely — `validatePatch` answered the
parse failure with `catch { continue }`. Because `visible` is the gate every
other check hangs off, that `continue` switched off `required`, `options`,
`pattern`, `valueDomain` **and** the value window on that key at once, silently
and permanently, with no diagnostic anywhere. A half-filled provider form saved
clean.

**After:** the write is refused. `setMany` throws `SettingsValidationError`
(`SETTINGS_VALIDATION`, HTTP 400) carrying one `FieldError` per offending
specifier — `code: 'invalid_value'`, the parse reason in `message`, and the
predicate itself under `constraint.visible`, so a client can name which
expression refused without parsing prose. Refusal is **unconditional**, not
gated on the patch touching the key: the console posts only its dirty keys, so a
touch gate would never fire on the incident this fixes. All-null patches
(namespace reset) still return before the check, so a namespace whose manifest
is broken can always be cleared.

This is the interim stop-the-bleed half of the maintainer's 2026-08-10 ruling on
#7169. The declaration/implementation gap it stems from is still open:
`packages/spec` types both settings `visible` slots as `ExpressionInputSchema`,
which labels their contents **CEL**, while this service evaluates a hand-rolled
JS-ish subset. Measured over the 94 `visible` predicates in the bundled
manifests, wiring CEL into evaluation would break 93 of them and narrowing the
declared type would break 1 — see the PR for the numbers. Narrowing is
recommended and lands separately in `packages/spec`.

**Also fixed, and load-bearing for the above:** the evaluator now supports the
relational operators `>`, `>=`, `<`, `<=`, with the same JS semantics the
console's client-side evaluator applies to the same strings. The auth manifest
already shipped `visible: '${data.lockout_threshold > 0}'`, which this grammar
refused — so on the old fail-open path `auth.lockout_duration_minutes` accepted
`-5` and `99999` against its declared `min: 1, max: 1440`. That window is
enforced again.

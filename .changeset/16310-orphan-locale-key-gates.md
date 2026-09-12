---
'@objectstack/lint': minor
---

fix(lint): an orphaned locale key now FAILS the run — `translation-target-unknown` is an `error` (#16310)

`validate-translation-references` reported every orphan translation key precisely
— the id named, the locale named, the remedy printed — and failed nothing.
`os lint` exits 0 on warnings, the rule hard-coded `severity: 'warning'`, and
there is no per-rule severity a consuming app can set. So a PR that deletes a
navigation entry, a form section or a view and leaves its locale keys behind was
green on every pipeline on the platform, and the dead keys are actively
misleading afterwards: grepping the id returns a confident-looking hit in every
locale, which reads as "this exists and is translated".

The forward half of this parity (`i18n/missing-*` — an authored surface with no
translation) already fails, and apps already gate on it. The orphan half now
fails too, so the two halves of one parity have the same enforceability instead
of opposite ones.

**BREAKING** — a stack that carries an orphan locale key stops passing
`os lint`, `os validate` and `os build`. The finding, its message and its hint
are byte-identical to what those commands already printed; only the severity and
the exit code move.

```
FROM  os lint --json   on a stack with 8 orphan locale keys
      -> { "passed": true,  "errors": 0, "warnings": 18 }   exit 0
         issues[].severity === "warning"   rule "translation-target-unknown"

TO    os lint --json   on the same stack, same 8 findings, same text
      -> { "passed": false, "errors": 8, "warnings": 10 }   exit 1
         issues[].severity === "error"     rule "translation-target-unknown"
```

**The fix is one line per finding: delete the locale key the finding names.** It
resolves to nothing — the object, field, view, section, tab, action, param, app,
nav item, dashboard, widget or flow screen it was written for is not in the
stack — so removing it changes no rendered string in any locale. Where the target
was renamed rather than deleted, point the key at the new name; the finding
prints the declared names to choose from.

**This is ONE rule, not "warnings are errors now".** Measured on a planted tree
carrying 13 distinct rules: exactly 1 changed severity, 12 did not, and the
finding set is identical modulo that one severity. `translation-option-key-unknown`
— raised by the same function — stays `warning` on purpose: a mis-keyed option
translation names something real and its remedy is a rename, not a deletion.
`validateTranslatableSections`, the sibling asking "is there a key at all?", is
untouched.

**Unchanged: the runtime publish gate.** `validateTranslationReferences` reaches
the runtime door on a `flow` write, but the per-write snapshot carries only
`objects` / `permissions` / `books` / `datasets` — `RuntimeStackContext` has no
`translations` member for a host to fill — so the rule sees no bundle and returns
nothing there. Measured: a flow write through `runRuntimeAuthoringRules` yields 0
errors and 0 advisories from this rule, before and after. No publish that
succeeded is refused.

`TranslationRefSeverity` widens from `'warning'` to `'warning' | 'error'`
accordingly.

<!-- adr-0087: not-required (no-migration-prescription) the ledger serves metadata UPGRADERS — `objectstack migrate meta` rewrites stored metadata from a registered FROM → TO key mapping — and nothing here is a key mapping: no authorable key is renamed, retired or reshaped, `packages/spec/**` is untouched, and the diff moves one lint severity literal. The prescription above is "delete the key this finding names", which is per-stack and per-key, derived by the rule at run time from that stack's own declared names; it is not projectable into a ledger entry, and writing one would put un-executable data in the one ledger this mechanism keeps true. -->

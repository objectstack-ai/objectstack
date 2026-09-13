---
'@objectstack/lint': minor
---

fix(lint)!: an orphaned locale key now FAILS the run — `translation-target-unknown` is an `error` (#16310)

`validate-translation-references` reported every orphan translation key precisely
— the id named, the locale named, the remedy printed — and failed nothing.
`os lint` exits 0 on warnings, the rule hard-coded `severity: 'warning'`, and no
per-rule severity is configurable by a consuming app. So a PR that deletes a
navigation entry, a form section or a view and leaves its locale keys behind was
green on every pipeline on the platform, and the dead keys are actively
misleading afterwards: grepping the id returns a confident-looking hit in every
locale, which reads as "this exists and is translated".

The forward half of this parity — `i18n/missing-*`, an authored surface with no
translation — already fails, and apps already gate on it. The orphan half now
fails too, so the two halves of one parity have the same enforceability instead
of opposite ones.

**BREAKING** — a stack carrying an orphan locale key stops passing `os lint`,
`os validate` and `os build`. Measured on one stack with 8 orphan keys planted,
`objectstack lint --json`:

| `@objectstack/lint` | findings | errors | warnings | `passed` | exit |
| :-- | --: | --: | --: | :-- | --: |
| before this release | 20 | 0 | 18 | `true` | 0 |
| after this release | 20 | 8 | 10 | `false` | 1 |

The findings themselves are unchanged — same count, same paths, same message and
hint text. Only the severity moves, and with it the exit code.

**What an author does about it.** In a clean stack, nothing: a tree with no
orphan key reports exactly what it reported before, at the same severities, with
the same exit code (measured — the report is identical field for field apart
from its wall-clock `duration`). In a stack the rule already names findings on,
delete each locale key it names. The key resolves to nothing — the object,
field, view, section, tab, action, param, app, nav item, dashboard, widget or
flow screen it was written for is not in the stack — so removing it changes no
rendered string in any locale. Where the target was renamed rather than removed,
key the translation to the new name instead; the finding prints the declared
names to choose from.

**This is ONE rule, not "warnings are errors now".** Measured on a planted tree
carrying findings from 13 distinct rules: exactly 1 changed severity, 12 did not,
and the finding set is identical modulo that one severity.
`translation-option-key-unknown` — raised by the same function — stays `warning`
on purpose: a mis-keyed option translation names something real and its remedy is
a rename, not a deletion. `validateTranslatableSections`, the sibling asking "is
there a key at all?", is untouched.

**Unchanged: the runtime publish gate.** `validateTranslationReferences` reaches
the runtime door on a `flow` write, but the per-write snapshot carries only
`objects` / `permissions` / `books` / `datasets` — `RuntimeStackContext` has no
`translations` member for a host to fill — so the rule sees no bundle and returns
nothing there. Measured: a flow write through `runRuntimeAuthoringRules` yields
0 errors and 0 advisories from this rule. No publish that used to succeed is
refused.

`TranslationRefSeverity` widens from `'warning'` to `'warning' | 'error'`
accordingly.

<!-- adr-0087: not-required (no-migration-prescription) nothing an author writes moves: no authorable key is renamed, retired or reshaped, `packages/spec/**` is untouched, no Zod schema and no stored metadata shape changes, and the diff moves one lint severity literal plus the exported TS union that types it. `objectstack migrate meta` has nothing to reach and the ledger serves nobody affected. The author action this release can imply is not an upgrade step either: an orphan key resolved to nothing before this release and resolves to nothing after it, and the rule has been naming each one, with its remedy, in every release that shipped it — what changes is that the report is no longer ignorable, not what the metadata is supposed to say. -->

---
"@objectstack/platform-objects": patch
---

fix(i18n): platform-objects' 231 untranslated strings were 1 — close the real gap and stop the phantom (#3762)

Closes the rest of #3762. The remaining item was recorded as "platform-objects
is 77 strings short per locale, in `apps.*` / `dashboards.*`, and its
`--objects-only` extract cannot scaffold them — needs an emit decision (drop
`--objects-only`, or a companion `.apps.generated.ts`) before any translating."

Measured, the premise did not hold. Of the 77 declared keys per locale, **76
were already translated** in the hand-authored `<locale>.ts` files and had been
for months. Exactly one was genuinely missing —
`apps.studio.navigation.nav_app_builder.label`, absent in all four locales
including `en`. The 231 was a measurement artifact: this config declares
SETUP_APP / STUDIO_APP / ACCOUNT_APP and SystemOverviewDashboard, but its
`translations` merge baseline listed only the two GENERATED subtrees
(`objects`, `metadataForms`), so coverage counted every hand-authored
app/dashboard key as untranslated.

**Neither proposed emit is right, and the second would have caused damage.**
The Setup app is a shell of empty group anchors; its ~25 menu entries are
contributed at runtime by `SETUP_NAV_CONTRIBUTIONS` and by capability plugins
(ADR-0029 D7). A bundle generated from a static walk of `SETUP_APP` is
therefore structurally incomplete, and regenerating over the hand-authored
files would have **deleted 40 live nav translations per locale**. Dropping
`--objects-only` fails differently: `kind: 'full'` folds all 803 metadata-form
keys into `<locale>.objects.generated.ts` and renames the export the baseline
imports.

The split is correct as it stands and is now written down: `objects` /
`metadataForms` are generated and gated by the bundle-drift check; `apps` /
`dashboards` / `pages` are hand-authored and gated by the coverage ratchet.
What was wrong was only that the baseline omitted the hand-authored half.

- Extract config's `translations` now carries the per-locale assemblers, with
  `objects`/`metadataForms` still pinned to the committed generated files.
  Safe for the emit — `--objects-only` writes `data.objects` alone, so nothing
  added here can reach a generated bundle, and `check:i18n` stays in sync
  across all nine packages.
- `nav_app_builder` translated in all four locales, wording taken from the
  repo's own precedent for "builder" (`构建器` / `ビルダー` / `generador`).
- `nav_workflows` removed from all four: its menu entry is gone from
  `STUDIO_APP` and nothing contributes to that app, so the translation was
  dead.
- Coverage ratchet baselined 231 → **0**, making platform-objects the ninth
  package where the ratchet is a strict gate — verified to go red on a single
  removed translation.
- A local, CLI-independent parity test walks the statically declared Studio and
  Account navigation plus the dashboard's widgets and asserts a translation in
  every locale — and the reverse, that no translation survives its nav item.
  Both directions verified to fail before passing.

An untranslated nav id is invisible in the UI — it falls back to the app's
English label, so a Chinese Studio menu just shows one English entry among
thirty. That is why this needed a gate rather than a one-time sweep.

Still out of scope: the ~25 Setup entries contributed at runtime. Bringing them
under a static gate needs either an objectql dependency in this package (it
depends only on spec and metadata-core) or extractor support for
`navigationContributions` — a real follow-up, not something to half-do here.

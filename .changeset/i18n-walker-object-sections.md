---
"@objectstack/cli": minor
"@objectstack/lint": minor
---

fix(cli): the i18n walker collects `objects.<o>._sections` — section headings are gated and scaffolded like every other label (#5405)

An object's SECTION headings were the one declared, resolved, rendered
translation surface the shared i18n walker had no kind for.
`ExpectedEntry['source']` listed `object | field | option | view | action |
globalAction | app | navigation | dashboard | widget | page` plus two
`metadataForm*` kinds — and those two cover **Studio metadata forms**
(`metadataForms.<type>.sections.*`, hidden behind `--include-platform`), not app
objects. So `objects.<o>._sections.<s>.label` was structurally unreachable in
both directions: `os i18n extract` never scaffolded a heading, and
`os lint` could not report one missing.

The surface itself was never in doubt. `ObjectTranslationDataSchema` declares
`_sections` (with `sections` as an authoring alias), and `@object-ui/i18n`'s
`sectionLabel` resolves it for `record:details`, for `ObjectForm`/`ModalForm`
and for the field-group designer. Only the walker disagreed — which is exactly
the drift `collectExpectedEntries` was consolidated to prevent (#3370).

Measured downstream before this landed: 85 sections across 15 objects, **2 of
85** translated in `ja-JP` and in `es-ES` — English headings on essentially
every record page and form — with `objectstack lint` reporting **zero** i18n
warnings for both locales.

**What is collected.** A `section` kind, from the two independent surfaces that
both resolve to the same key — a heading is expected if *either* declares it,
and one heading is one expected key however many declare it:

- **`fieldGroups` × field `group`** — the fields decide which sections exist and
  `fieldGroups[].label` supplies the source text. Membership is read through
  `deriveFieldGroupLayout` (ADR-0085 §5), the same shared derivation the
  renderers consume, so a group nothing visible references — or a `group:` no
  `fieldGroups` entry declares — produces no heading and therefore no expected
  key. The trailing ungrouped bucket renders without chrome and is skipped.
- **A named `sections[]`** on a form view (including a view container's default
  `form`) or inside a record page's component tree.

A section with no `name` is skipped: every renderer guards the lookup on it
(`s?.name ? sectionLabel(…) : s?.label`), so it is untranslatable by
construction and demanding a bundle entry for it would be noise. A group that
declares no `label` still yields a scaffold key seeded from its own name, but no
coverage finding — nobody authored that text.

**What you get.** `os lint` gains an `i18n/missing-section` category — user
metadata, so it is reported without `--include-platform` — and `os i18n
extract` scaffolds the headings for free, because the gate and the extractor
read the one walker. A project that declares no locales still reports nothing;
the gate stays opt-in.

**`@objectstack/lint`** now exports its shared page traversal
(`walkPageComponents`, `isSourceAuthoredPage`, `WalkedComponent`) so the CLI
consumes it instead of growing a private copy — that walk exists precisely
because duplicating it produced a dead rule once already (#3583). Reusing it is
also what makes the page half correct rather than merely present: it reaches
`slots.<slot>` and the untyped nesting a record page really uses
(`page:tabs` → `properties.items[].children[]` → `record:details`), skips
source-authored pages whose `regions` are a derived cache, and resolves each
component's OWN binding (`dataSource.object` → `properties.object` → the page's
`object`) — so a re-bound `record:details` keys its headings under the object it
actually shows.

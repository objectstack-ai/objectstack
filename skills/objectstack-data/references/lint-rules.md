## Linting & Generation Quality

`os lint` checks the data model against the conventions in this skill —
not just naming/labels but the relationship/master-detail/roll-up patterns. Run
it after authoring or generating metadata. Severities: `error` (structural,
fails the command), `warning` (likely-wrong choice), `suggestion` (nudge).

Data-model rules (in addition to naming/label/i18n):

| Rule | Severity | Catches |
|---|---|---|
| `relationship/missing-reference` | error | lookup/master_detail without a `reference` target |
| `relationship/master-detail-required` | warning | a `master_detail` that isn't `required` (a detail can't exist without its master) |
| `relationship/delete-behavior` | suggestion | `master_detail` without an explicit `deleteBehavior` |
| `relationship/line-items-inline-edit` | suggestion | a `*_line`/`*_item` master_detail child without `inlineEdit` |
| `relationship/line-item-should-be-master-detail` | suggestion | a line-item-shaped child using `lookup` instead of `master_detail` |
| `relationship/association-inline-edit` | warning | an association (comment/audit/activity) marked `inlineEdit` (clutters the parent form — use a detail-page related list) |
| `rollup/missing-summary` | suggestion | a parent of numeric master_detail children with no roll-up `summary` |
| `field/select-missing-options` | warning | a `select`/`multiselect`/`radio` with no `options` (or options source) |
| `object/missing-name-field` | suggestion | an object with no `nameField` (ADR-0079's canonical title pointer) and no name-like field (`name`/`title`/`subject`/`label`/`full_name`/`display_name`/`code`) |
| `security-owd-unset` | error | an object published with no authored `sharingModel` (422 lint envelope; absence is not a decision) |
| `security-owd-alias` | error | a legacy OWD spelling instead of the canonical four (ADR-0090 D4) |
| `security-external-wider-than-internal` | error | `externalSharingModel` wider than `sharingModel` (ADR-0090 D11) |
| `security-master-detail-ungranted` | warning | a `master_detail` child whose master carries no matching grant |

> **`code` counts for R9, but is NOT a title-derivation key.** R9's name-like
> list above is the *looser* of two "name-like" sets, and the difference is
> deliberate. R9 asks **"will records be anonymous?"** — is there any readable
> face at all — and a `code` clears that bar. ADR-0079's title derivation
> (`resolveDisplayField`) asks the narrower **"what IS the title?"**, and its
> name-ish set is `name`/`title`/`subject`/`label`/`full_name`/`display_name`
> **without `code`** — an identifier is not a title. So an object whose only
> name-ish field is `code` is R9-clean, yet its title is derived by the
> lower-priority "first title-eligible field by declaration order" tier rather
> than by name. Nothing user-visible turns on this (R9 is `suggestion`, and the
> `Record #<id>` floor guarantees a title regardless), but do not read the R9
> list as the derivation contract — set `nameField` explicitly when the title
> matters.

These same rules are the **rubric for AI-generated metadata** — a generation is
"good" exactly when it is schema-valid and lint-clean:

- `os lint --score` — print a 0–100 metadata-quality score (+ letter
  grade and severity breakdown) for the current project. Schema errors and lint
  errors weigh most; suggestions barely move it.
- `os lint --eval` — run the generation eval over a bundled golden
  corpus (invoice+lines, project+tasks, blog+comments, expense+lines,
  account+contacts) offline; each case must clear the pass bar (`--eval-min`,
  default 75). Deterministic, no API key.

When generating object metadata, target a lint-clean model: master_detail (with
`required` + `deleteBehavior` + `inlineEdit` for line items), roll-up summaries
on parents, `select` options, and a name/title field per object.

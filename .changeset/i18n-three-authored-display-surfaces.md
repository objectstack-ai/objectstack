---
"@objectstack/spec": minor
"@objectstack/objectql": minor
---

feat(spec,objectql): give three authored display surfaces a bundle key — bulk-action defs, custom validation messages, dataset labels (#14253)

Purely additive: three new translation groups, one new dispatch-table entry, one
new resolution step on the write path. No existing key changes shape, no
resolution order changes, and every surface still falls back to the authored
literal when the bundle carries nothing.

Each of the three carried **authored, user-facing display text that no key in
`TranslationDataSchema` could reach** — not a drifted key, no key. Each rendered
in the source locale inside an otherwise fully translated screen, which is the
bad failure mode: it reads as a styling quirk rather than as a missing
translation. Measured on a real `zh-CN` deployment.

**1. A list view's `bulkActionDefs[]`** —
`objects.<object>._views.<view>.bulkActions.<def_name>.{label,confirmText,confirmLabel,params.<p>.{label,help,placeholder}}`,
resolved in `translateView` against `config.bulkActionDefs` (the one address a
served def has: both `ViewItemSchema` and `expandViewContainer` nest the whole
ListView under `config`). A def is part of the *view* document, not an action
document, so it never reached `translateAction`; the selection bar read
`已选择 1 项 · Complete · Skip · 清除`. The def's `label` deliberately stays a
plain `z.string()` on the authoring side — the bar renders it as a React child,
so an inline locale map would be a blank cell rather than a parse error — and
overlaying at the metadata boundary keeps the wire value a plain string. The
documented workaround (`bulkActions: ['<name>']`, promoting a declared action)
is not equivalent: it is N elevated per-record dispatches instead of one
data-plane `updateMany`.

**2. A custom validation rule's `message`** —
`objects.<object>._validations.<rule_name>.message`, spelled by the new
`objectValidationMessageKey` and read on the write path by the rule evaluator.
⚠️ **This adds a key shape, not a channel**: the lookup runs on the *existing*
`i18nService` hook that has localized built-in field-catalog messages and field
labels since #3957. Before it, a deployment got platform-generated refusals in
the caller's language and author-written refusals in the source language inside
one `400 VALIDATION_FAILED` envelope. All five authored-message emitters route
through one seat; a nested `conditional` branch is addressed by the branch's own
name; a platform-generated rejection (an unevaluable predicate) is deliberately
left alone. `messages['validation.field.*']` is unchanged and still overrides the
built-in catalog only.

**3. Dataset labels** — `datasets.<name>.{label,description,dimensions.<d>.label,measures.<m>.label}`
plus `translateDataset` in `METADATA_DOCUMENT_TRANSLATORS`. A dataset reads like
a back-office definition, but a measure label is drawn on the dashboard, under
every metric tile and on every chart axis. Registering the translator is the
whole wiring — `TRANSLATABLE_METADATA_TYPES` is derived from that table and
`@objectstack/rest` reads the derived set (#3786) — so `GET /api/v1/meta/datasets?locale=…`
localizes with nothing else to remember.

Key faces are measured against the authoring schemas rather than mirrored from
the report, so nothing here parses clean and translates nothing: a bulk param's
hint is `help` (not the action-param `helpText`), per-param `options` are refused
because `options[].value` is unconstrained and a value-keyed map cannot address
`true` and `"true"` apart, a def has no `successMessage`, and a dataset dimension
or measure has no `description` — the authoring schema says so itself. Every
exclusion carries `guidance` naming the right home.

Two tombstones stop asserting that no route exists: the retired
`validationMessages` and `errors` guidance now point at
`objects.<object>._validations.<rule>.message`. Retiring `validationMessages`
(17.0.0, #4667, ADR-0049) is **not** reversed — that group was keyed by rule name
at the bundle's top level, so it could not tell two objects' rules apart, and,
the reason it was retired, nothing read it. Its ADR-0087 conversion still strips
it from stored bundles. The replacement is object-scoped and ships its reader in
the same change.

Authors upgrading need do nothing; a bundle that writes none of the three new
groups behaves exactly as before.

<!-- adr-0087: not-required (unpublished) Purely additive: three new optional groups on `TranslationData` / `TranslationItem`, one new dispatch-table entry, and one new lookup on the write path. No authorable key is removed, renamed or re-shaped, so there is no tombstone, no stored shape to rewrite, and nothing mechanical for `objectstack migrate meta` to prescribe. The retired `validationMessages` conversion entry is untouched and still strips the key it always stripped — its guidance text now names a live replacement instead of asserting none exists, which changes what an author is told, not what a stored bundle becomes. -->

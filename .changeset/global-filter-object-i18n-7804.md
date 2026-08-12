---
"@objectstack/spec": minor
---

feat(spec): `GlobalFilterSchema` gains an optional `object` for i18n label resolution (#7804)

A dashboard global filter renders its field label (e.g. "Sales Channel:") and
its option labels untranslated, and there was no key to fix it with:
`GlobalFilterSchema` declared no `object`, and neither does `DashboardSchema`,
so the canonical `fields.<object>.<field>` translation-bundle convention that
lists/forms already use has nothing to resolve against — measured in
objectui#4324's implementation, and hit in production on a hotcrm-heimao
dashboard.

**New:** `object?: string` on `GlobalFilterSchema`, alongside `field`. When
set, it names the object `field` lives on, and the filter's field label and
option labels resolve through the same `fields.<object>.<field>` bundle entry
lists/forms use — zero new i18n vocabulary, one resolver path.
`optionsFrom.object` already proved the schema is willing to name an object;
this reuses that same primitive one level up, and is deliberately independent
of it — `optionsFrom.object` names where a filter's *dynamic options* are
fetched from, which may differ from the object `field` itself lives on (e.g.
filtering `opportunity` by `owner` with options sourced from `user`).

Additive and optional: a filter that omits `object` renders exactly as it
always has, its author-supplied `label` (or a raw field-name fallback)
untranslated. Nothing that parses today stops parsing.

Route A per the triage-seat ruling on #7804 (2026-08-11) — rejects Route B
(a new `dashboards.*.filters` bundle node in `TranslationData`, which would
duplicate the existing convention with no precedence rule) and Route C
(inline `I18nLabelSchema` forms, orthogonal and tracked separately).

Unblocks objectui#4324, the dashboard filter-bar renderer half already landed
behind this key.

---
'@object-ui/core': patch
'@object-ui/types': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@objectstack/spec': patch
---

feat(app-shell): an action's `preflight` read draws a panel in the param dialog and seeds the params it names

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/app-shell`: the param dialog reads `ActionSchema.preflight`.** When an action declares `preflight`, the dialog re-judges the block with the spec's `ActionSchema`, fills `preflight.read.url` from the dialog's current values and the record, checks the filled URL is a same-origin API path, and sends the read once every hole has a value (again whenever a param a hole reads changes). The answer is drawn as a panel above the form (`preflight.fields`, through the result dialog's field cells), and each `preflight.seed` entry fills its param from the answer, drawn read-only. Seeds are cleared on every URL change and applied only from the current URL's answer, so a late answer to an earlier URL never overwrites the current one. A read that fails, a seed path the answer lacks, a hole with no value and a refused block each draw the panel's error state, and the seeded param's `required` mark keeps Confirm disabled. An action with no `preflight` draws exactly as before (the `ban_user` work panel included).
- **`@object-ui/core`: `ActionDef.preflight`** and a fifth `ParamCollectionHandler` argument, `interpolateRead`, which fills a read URL: `${param.NAME}` from the dialog's current values, `${ctx.record.FIELD}` / `${ctx.recordId}` from the dispatched row or, on a record page's header, the record the page shows; each value is percent-encoded, and a hole with no value answers `null` so nothing is sent. `ACTION_DEF_KEYS` lists `preflight`.
- **`@object-ui/types`:** `ActionSchema.preflight` mirrors the spec's block.
- **`@object-ui/components`:** the action button, icon, group and menu renderers forward `preflight` to the runner.
- **`@object-ui/i18n`:** the `actionDialog.preflight` strings in every locale pack.
- **`@objectstack/spec`:** the `preflight` liveness rows move from `planned` to `live`. `preflight.fields[].label` still draws as authored: no bundle walker or overlay translates it yet (objectstack#31885).

---
"@objectstack/spec": minor
---

feat(spec): the dashboard widget translation node gains an optional third member, `subCaption`, keyed `dashboards.<name>.widgets.<widgetId>.subCaption` (#7862)

The metric widget draws two authored strings under its header: `widget.description` (the copy under the card header) and `options.description` (the sub-caption under the number). The #5428 ruling (2026-08-06, item 4) gives each its own translation key — sharing `widget.description`'s key is forbidden (「两个作者字段两个 key」) — but the strict `{ title?, description? }` widget node refused every spelling of a second key, and its own error hint pointed `subtitle` at `description`, i.e. at the shared key the ruling forbids.

- `dashboards.<name>.widgets.<widgetId>.subCaption` is now accepted and translates the metric sub-caption (`options.description`); `description` keeps translating `widget.description` and never reaches the options bag.
- `translateDashboard` resolves the new key, overlaying `options.description` and carrying every other `options` key through untouched, on the same REST `/meta` path that already resolves widget `title`/`description`.
- The `subtitle` hint now points at `subCaption`. Unknown keys on the node are still refused.

The node stays strict; existing bundles are unaffected (the accept-set only grows). objectui's client-side renderer half consumes the same key path as a follow-up (objectui#4032 / objectui#4358).

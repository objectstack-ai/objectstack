---
"@objectstack/spec": minor
---

feat(spec): page component copy is translatable — `pages.<name>.components.<id>` (#6080)

A page's cards, KPI blocks, pickers and forms had **no translation key at all**.
Not a drifted key — no key: `pages` was a `.strict()` four-key record whose
`title`/`subtitle` mean the page's `page:header`, so every other component's
user-visible string reached the user as whatever literal the `*.page.ts` author
typed, in every locale, and `.strict()` (correctly) refused the keys a
translator invented.

The asymmetry was the giveaway: `dashboards.<name>.widgets.<widgetId>` has
carried `title`/`description` all along, and a page's components have stable
`id`s exactly like a widget does. Downstream, hotcrm's `sales_home_page` — the
`isDefault` landing page for sales reps — rendered a translated header above
four English cards and four English KPI blocks in zh/ja/es (12 strings across 8
pages).

```ts
pages: {
  sales_home_page: {
    label: '销售看板',
    components: {
      quick_create:    { title: '快速新建' },
      kpi_revenue_won: { label: '已赢收入' },
      ai_briefing:     { title: '询问 AI 助手', description: '从右侧边缘打开助手面板。' },
    },
  },
}
```

**Declared AND resolved in the same change.** `translatePage`
(`system/i18n-resolver.ts`) overlays the entry onto the component's
`properties`, so the face is not a declaration waiting for a reader.

**The key face is measured against `ComponentPropsMap`, not mirrored from the
issue's sketch** — `title`, `description`, `label`, `placeholder`, `emptyText`,
`submitLabel`, each one a copy prop some component actually declares as a plain
string with no inline `{en, zh}` form, i.e. one whose only localization route is
this bundle. Two deliberate exclusions:

- **`help` is not declared.** No component in the model has it; it would parse
  clean and translate nothing (ADR-0078). It is an alias onto `description`.
- **`subtitle` is not declared.** `page:header` is its only declarer and is
  addressed by page name, so a per-component `subtitle` would give one string
  two spellings — which is how this asymmetry started.

Resolution rules, all tested: `label` lands on the component's own top-level
`label` when it declares one and in `properties.label` otherwise (copy goes
where the author wrote it); keys resolve **individually** across the locale
chain, so a partially-translated `zh` entry still falls back to `en` per key;
and the id-addressed route beats the page-name route wherever both could apply
(a `page:header` that does carry an `id`).

Purely additive and `.strict()` is unchanged — `components` is optional, every
previously-valid bundle still parses, and every previously-rejected key is still
rejected.

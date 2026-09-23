---
"@objectstack/platform-objects": patch
---

Report metadata-form panel — the dataset-binding section heading, its semantic-layer description and the `drilldown` / `runtimeFilter` label and helpText pairs are now rendered in `zh-CN`, `ja-JP` and `es-ES` instead of shipping their English source (#19403).

Six `en` leaves × three locales = 18 locale-leaves, decided **one at a time** rather than swept: an en-echo is not automatically a defect, so each carries a recorded verdict, its per-locale reason and the `en` source it was judged against, in `report-form-echo-decisions.test.ts`. The bundles and their `*.source-hashes.generated.ts` companions were regenerated with `pnpm i18n:extract`; key sets are unchanged (893 → 893, 0 added, 0 removed, `en` values changed 0) and the provenance companions dropped exactly those six rows per locale and added none.

- **`runtimeFilter` is a byte copy of an authored twin.** `report.fields['blocks.runtimeFilter']` is the same schema key one repeater level down, where the form declares `label: 'Runtime Filter'` and a translator had already written 运行时筛选 / 実行時フィルター / Filtro en tiempo de ejecución. The top-level position is now the same three words, and the copy is asserted, so the two can only move together.
- **The semantic-layer claim was read at the schema before a word was rendered.** "Values are the dataset's measures; rows are its dimensions" is pinned: `DatasetSchema` declares `dimensions`/`measures` and refuses `values`/`rows`; `ReportSchema` does the reverse; and the joined-block alias table states the mapping itself (`measures` → `values`, `dimensions` → `rows`).
- **The phantom-translation shortcut is unavailable here, and that is asserted.** `reportForm` declares no label on either field, so both English strings are the extractor's humanize — but the humanize already lands on correct English, so no touch-up could satisfy the echo predicate; only a translation can.

⚠️ This empties the card's headline predicate — zero `.label` keys now echo in all three locales — and that zero is a property of the **predicate**, not of the surface: `object.fields.lifecycle.*` still ships 32 English leaves to `ja-JP` and to `es-ES` (64 locale-leaves) that the all-three reading cannot see.

---
"@objectstack/platform-objects": patch
---

fix(platform-objects): the es-ES and ja-JP `dashboard.gap` help text says what its source now says

`metadataForms.dashboard.fields.gap.helpText` read `Separación de cuadrícula (unidades
Tailwind)` in es-ES and 「グリッド間隔（Tailwind 単位）」 in ja-JP. Both were faithful
translations of the source they were extracted against, `Grid gap (Tailwind units)` — but
that source has since been rewritten to `Space between widgets, in steps of 0.25rem
(4 = 1rem)`, which deliberately drops the CSS framework unit an app author never chose and
cannot act on, and adds the magnitude the author can size a dashboard with.

Both leaves kept the retired vocabulary and never gained the magnitude, because bundle
merge fills gaps only: a present-but-stale leaf is not a gap, so no amount of
re-extraction corrects it. They now read `Espacio entre widgets, en incrementos de 0.25rem
(4 = 1rem)` and 「ウィジェット間の間隔、0.25rem 刻み（4 = 1rem）」 — the grid framing is gone
exactly as it is upstream, `widgets` / 「ウィジェット」 is the word each bundle already uses
for dashboard widgets, and the conversion is carried so a Spanish- or Japanese-reading
author can size `gap` without reading the English.

Two leaves. `columns` is unchanged upstream, so `Columnas de cuadrícula (predeterminado
12)` and 「グリッド列（既定 12）」 stay accurate, and the other 13 source-derived prose leaves
of this subtree (5 section descriptions plus 8 further field help texts) were read against
the current English and are accurate in both locales.

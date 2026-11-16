---
'@object-ui/core': patch
'@object-ui/fields': patch
'@object-ui/components': patch
---

fix(console): a record page printed in a zh-CN organization shows dates in Chinese order, fits its line-items table to the sheet, and prints on white with plain values

Clause-②: no
Metadata-protocol: none

A print page (a record page that declares `print`), printed by `@objectstack/service-print` or by the console's Print button, now reads as a document:

- **Dates in the locale's own order.** A `date` field authored `format: 'short'` drew `11月 15, '26` in `zh-CN`: only the month was translated into the English compact layout `Nov 15, '26`. That compact layout is now kept only for a locale that writes a date month first, then day, then year (`en`, `en-US`). Every other locale gets its own date with the year: `2026年11月15日` in `zh-CN` and `ja`, `15. Nov. 2026` in `de`, `15 Nov 2026` in `en-GB`. This is the face `formatDate` already drew for the default style with the year shown. It applies on screen as well as on paper, and to every reader of `formatDate(value, 'short', { locale })`.
- **Tables fit the printable width.** On a print page, a data table's cells drop their on-screen minimum width and single line on paper, so the columns shrink and wrap to the box. Before, a five-column `record:line_items` table on A4 portrait with 15 mm margins was 647 px wide in a 630 px box. Its last column ran past the box's border, and that border was drawn through the column. The running header and footer table is not affected.
- **White page, plain values.** On paper the page and everything around it are white instead of the app's background. A link, such as a lookup's referenced record, prints in the surrounding text colour with no underline. A select value drawn as a coloured badge prints as its label with no pill. The select badge carries a new inert attribute, `data-select-badge`, for this rule. Every rule sits inside `@media print` and is scoped to the print page, so the screen is unchanged.

`avoidBreakInside` is unchanged: it still keeps each block whole on one sheet when the block fits.

---
"@objectstack/rest": minor
---

feat(rest): colour select/radio cells in xlsx exports with their option colour

The data export route (`GET /data/:object/export`) now carries a select /
radio field's option `color` into the generated Excel workbook as the cell's
**font colour** (white cell background), so an exported sheet reads like the
in-app coloured badges instead of plain black text. csv / json output is
unchanged.

- `export-format.ts` gains `toArgb()` (hex `#RGB` / `#RRGGBB` → exceljs ARGB
  `FFRRGGBB`, `undefined` for anything not plain hex) and `cellFontColor()`
  (resolves the matched select/radio option's colour for one cell; returns
  `undefined` — i.e. leave it unstyled — for non-option fields, unmatched
  values, colourless options, or invalid hex). `ExportFieldMeta.options` now
  carries the option `color`.
- `createXlsxStream(res, useStyles)` takes the flag through to exceljs'
  `WorkbookWriter`; the route enables styling and sets `cell.font.color`
  per-cell only for xlsx.

Styling is heavier than a bare value dump, so it is gated behind a **10 000-row
cap** (`STYLE_ROW_CAP`): exports whose effective limit exceeds it stream
without colours (all rows intact) and set `X-Export-Styles: dropped`; coloured
exports set `X-Export-Styles: applied`. This mirrors the "formatted export has a
lower ceiling than a raw dump" pattern used by Salesforce / ServiceNow. The
existing 50 000-row hard cap is unchanged.

Closes #2757.

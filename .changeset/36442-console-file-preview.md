---
'@object-ui/fields': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

feat(console): preview images, PDF, text and CSV in the page from a record's attachments and from a file field

Clause-②: yes (widening)
Metadata-protocol: none

A file opens in a dialog in the page instead of leaving it. In a record's attachments, the file's name opens the preview; the download stays in the row's menu. On a file field, a click on the file's link opens the preview; a modified click (new tab, new window) still opens the link as before.

- **Four views, no new dependency.** Images (PNG, JPEG, GIF, WebP) draw in an image element, and an SVG only ever through an image element, never inlined. A PDF draws in the browser's own viewer in a frame; on a phone it opens in a new tab, which hands it to the system viewer. Plain text draws as text. A CSV draws as a table, read with the same GBK-aware decoder the grid's import wizard uses.
- **Download only.** Word, Excel, PowerPoint, HTML and every other type show "This file type cannot be previewed. Please download it." with a download button. An HTML file is never framed and never drawn as markup.
- **Limits.** Images and PDF up to 20 MB; text and CSV up to 2 MB, showing their first 1000 rows or lines. Past a limit the dialog shows "This file is too large to preview. Please download it." with a download button.
- **Controls.** Previous and next (and the arrow keys) walk a record's attachments; download; open in a new tab.
- **Same door as the download.** The preview reads the same signed link through the same permission check as the download, so a reader the download refuses sees the same refusal in the preview. When the browser cannot read a text or CSV file from the page (a bucket on another origin without the CORS rule the preview needs), the dialog offers the new tab instead.

New exports from `@object-ui/fields`: `FilePreviewDialog` and its types `FilePreviewDialogProps` and `FilePreviewItem`; `decodeSpreadsheetText` and `parseDelimited`, the delimited-text reader that moved down from `@object-ui/plugin-grid` (which now imports them from `@object-ui/fields`; its own behaviour is unchanged).

New `@object-ui/i18n` keys in every pack, under `fields.filePreview`: `title`, `previous`, `next`, `download`, `openInNewTab`, `loading`, `tooLarge`, `unsupported`, `denied`, `loadFailed`, `blocked`, `pdfOutside`, `truncatedRows`, `truncatedLines`, `empty`.

No metadata key, value or default changes.

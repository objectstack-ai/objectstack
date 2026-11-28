---
'@object-ui/fields': patch
---

feat(fields): read the headings a markdown value's document face draws, from the face's own parse

Clause-②: yes (widening)
Metadata-protocol: none

`@object-ui/fields` exports `loadDrawnMarkdownHeadings()`, which loads on demand and answers `drawnMarkdownHeadings(value)`: each heading the markdown `document` face draws, with its text and where it starts in the value (none for the footnote section's `Footnotes` label, which the pipeline adds), and the `DrawnMarkdownHeading` type. It runs the face's own pipeline (react-markdown with the GitHub Flavored Markdown and sanitize plugins `MarkdownContent` draws with), so a reader that must agree with the drawn page counts what is drawn by construction, and react-markdown stays in the lazy chunk the face already lives in. The face draws exactly as before.

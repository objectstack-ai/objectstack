---
'@objectstack/mcp': patch
---

fix(mcp): a `read_file` stop before the first page or paragraph says so, and never calls its text partial

Clause-②: no
Metadata-protocol: none

When the extraction worker's wall-clock ceiling stopped a PDF read before page 1 came back, `read_file` answered `content: none` with the note `Reading stopped at the CPU-time budget for one file (N ms) after page 0 of M, so the text is partial.` No text came back, so an agent acting on that sentence believed it held part of the file. A Word read stopped before its first paragraphs came back said the same with `after 0 paragraphs`. Such a stop now answers `content: none` with `Reading stopped at the CPU-time budget for one file (N ms) before page 1 of M was read, so no text came back. Download the file with the link instead.` (`before page 1 was read` when the PDF had not opened yet, and `before the first paragraph was read` for Word).

A read stopped at the budget after pages or paragraphs that held no text (a scanned PDF, say) also answered `content: none` with the partial-text note. It now says `after page P of M, and no text was found in what was read. Download the file with the link instead.`

Nothing else moves. A stop that did return text keeps `truncated: true` and the note `… after page P of M, so the text is partial. Download the file with the link for the rest.`

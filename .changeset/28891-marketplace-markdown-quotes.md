---
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

Marketplace package page: README blockquotes (`>` lines) render as quotes instead of printing their `>`, and a GitHub alert (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) renders as the same plain quote without its marker. The Versions panel renders each version's release notes as Markdown (headings, bold, lists, code) in a compact size, instead of printing them as plain text; single line breaks inside a paragraph now join as Markdown does. Raw HTML stays skipped in both places.

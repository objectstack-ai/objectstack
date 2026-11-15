---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): a ⌘K built-in command is found by the words of its own label

Clause-②: no
Metadata-protocol: none

**The palette's built-in commands.** "Open Full Search Page" and the three theme commands were matched on hidden English values (`search all results full page`, `theme light`, …), so the full-search row was not found by `open` or `full search`, and under a non-English locale no command was found by any word of its label ("浅色主题" answered `light`, never `浅色`). Each command is now also matched by the label it shows, in the member's language. FROM: value words only. TO: the label's words or the value's words. The words that found a command before still find it.

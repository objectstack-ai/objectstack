---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): bold next to CJK full-width punctuation renders bold in chat answers

Clause-②: no
Metadata-protocol: none

A `**` run with a CJK letter on one side and full-width punctuation on the other (book-title marks, corner brackets, the full-width comma, full stop, exclamation and question marks, the enumeration comma) showed as literal asterisks in chat answers and the reasoning panel: CommonMark's flanking rule reads full-width punctuation as punctuation, and a CJK sentence puts no space beside the run. Both chat markdown surfaces now render with `remark-cjk-friendly` in streamdown's `cjk` plugin slot, so such a run opens and closes. ASCII emphasis, inline code spans and backslash-escaped asterisks keep their CommonMark meaning. A caller that passes its own `plugins` to `MessageResponse` keeps the CJK rule.

`@object-ui/plugin-chatbot` gains the dependency `remark-cjk-friendly` (MIT).

---
'@object-ui/plugin-markdown': patch
'@object-ui/plugin-chatbot': patch
---

fix(plugin-markdown): bold that ends in full-width punctuation renders bold before a CJK letter

Clause-②: no
Metadata-protocol: none

The markdown renderer the console's manual reader uses (`@object-ui/plugin-markdown`) left a `**bold**` run as literal asterisks when the run ended in full-width punctuation and a CJK letter followed it, as in `**解决耗时（小时）**会被清空`, `**每个项目一张报销单。**每个项目` or `**它跳过和拒绝什么：**已经`. CommonMark counts full-width punctuation as punctuation, so such a closer is not right-flanking; a Chinese or Japanese sentence puts no space there.

The renderer now runs `remark-cjk-friendly` (its `parseOnly` entry, a new MIT dependency at `^2.3.4`) ahead of remark-gfm, the rule the chat surface already runs. It reads a CJK character beside a `**` run the way it reads the whitespace an English sentence would have there. ASCII emphasis, code spans, backslash escapes, GFM tables and GitHub-style alerts render as before, and the output still passes the same sanitize schema.

`@object-ui/plugin-chatbot` changes a comment only: its CJK rule now names the renderer's copy, since neither package depends on the other and each imports the plugin itself. No props or exports change in either package; nothing to migrate.

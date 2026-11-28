---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui says a select badge is coloured only when its option declares `color`

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ui/rules/list-views.md` gains one sentence under Column Features: a `select` badge is coloured only when its option declares `color`, as one of `gray`, `red`, `orange`, `yellow`, `green`, `blue`, `indigo`, `purple`, `pink` or a `#` hex, and any other option renders neutral. It teaches the renderer behaviour that landed with #36882: no colour is derived from an option's value, so an agent that wants a coloured status or priority badge declares the colour on the option.

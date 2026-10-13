---
'@objectstack/spec': patch
---

Three `ComponentPropsMap` read-point records now quote the objectui line they cite

Clause-②: no

The docblocks of `action:button`, `action:icon` and `element:definition-list` in
`src/ui/component.zod.ts` each quote the first line of the row's props-read site, re-read
against objectui at the pin this package builds against (`a58626c88`): the runner-forward
literal of the two action blocks, and the `readProps` call of the definition list. A pin bump
that moves one of those lines, or changes it, now fails `check:objectui-pin-citations` and
names where the quoted line went, where before only the cited sha was checked. The other
three rows of that section (`action:group`, `action:menu`, `element:repeater`) carry no quote
yet. Comment text only: no schema, key, type or export changes.

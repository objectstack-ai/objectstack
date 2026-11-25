---
'@object-ui/app-shell': patch
---

fix(console): a data-page filter chip on a select field shows the option's label, not its stored value

Clause-②: no
Metadata-protocol: none

On the bare data page (`/:objectName/data?filter[...]`), the page a dashboard drill's "Open in list" lands on, a filter chip on a field that declares `options` showed the stored option value: in zh-CN, `Category = software` where the option's label is `软件`. The chip now draws each comparand of an equality, does-not-equal or membership filter as the option's translated label, the same text the grid cell shows for that value. A value that matches no declared option stays as the raw value, so a stale or hand-edited address still shows what it filters by. A text filter (`contains`, `starts with`, …) keeps its typed fragment, and a field without options keeps today's text. Boolean and lookup comparands are unchanged.

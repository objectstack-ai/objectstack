---
'@objectstack/spec': patch
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

The report authoring form's Default Period row (Period & export, then Date Range) now names each choice: Today, This month, Last 30 days, Custom… and so on, instead of the stored preset (`this_month`). The options cover the shared preset table one for one, so a preset added later is offered with a name the day it lands. In the Studio report inspector, a Chinese session reads the names from the console's locale packs, the same words the report page's period chip shows (本月, 近 30 天, 自定义…).

Only the form's option names moved. No key, accepted value or default changed, and nothing an author can write or validate is different.

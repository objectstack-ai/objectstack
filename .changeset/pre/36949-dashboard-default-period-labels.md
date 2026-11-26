---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

The dashboard authoring form's Default Period row (Filters, then Date Range) now names each choice: Today, This month, Last 30 days, Custom… and so on, instead of the stored preset (`this_month`). It offers the same named options as the report form, from one shared table, so the two selects name a period the same way and a preset added later is named on both the day it lands. The Date Range group now lists its three rows (Date Field, Default Period, Allow Custom Range) by name, with zh-CN catalog wording. In the Studio dashboard inspector, a Chinese session reads the period names from the console's locale packs, the same words the period chip shows (本月, 近 30 天, 自定义…), through the helper the report inspector uses.

Only the form's row and option names moved. No key, accepted value or default changed, and nothing an author can write or validate is different.

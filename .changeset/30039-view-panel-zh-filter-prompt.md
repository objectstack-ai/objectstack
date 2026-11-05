---
'@object-ui/app-shell': patch
---

fix(app-shell): on a zh-CN console the view properties panel's empty filter button reads 「+ 添加筛选…」 and the description row's hint reads in Chinese

Clause-②: no
Metadata-protocol: none

- The `filter-builder` widget's empty trigger was an English literal (`+ Add filter…`); it now reads the Studio string the dataset scope filter already uses, so it follows the designer locale.
- The zh-CN view form overlay gains the `description` row's help text, which showed the schema's English description.

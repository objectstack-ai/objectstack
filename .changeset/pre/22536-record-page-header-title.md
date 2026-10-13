---
'@objectstack/spec': patch
---

A locale pack's page `label` no longer replaces the record-derived heading on a record page whose header authors no title

Clause-②: no

On a record page, a `page:header` with no `title` is the sanctioned spelling for "the renderer derives the heading from the record" (`PageHeaderProps.title`). Studio's record-page seed writes exactly that header. `translatePage` used to fill the absent title with the pack's `pages.<name>.label`, so the record's name was replaced by the page's static label. This happened in every locale whose pack carries the label, including the `en` skeleton that `os i18n extract` writes. Measured at `GET /api/v1/meta/page/:name` before this change: the header gained `title: "客户记录页"` in zh-CN, and `title: "Account Record"` in en with the extracted skeleton.

The label now does not fill an untitled root `page:header` when all three of these hold:

- the page's `type` is `'record'` as served (a document with no `type` is not a record page);
- the page's `object` is a non-empty string;
- the header keeps its record chrome (`properties.recordChrome` is not `false`).

Everywhere else the label still fills an absent header title, as before. An authored header title follows the existing order, including one that restates the page's `label`. A pack's `pages.<name>.title` and `subtitle` apply as before.

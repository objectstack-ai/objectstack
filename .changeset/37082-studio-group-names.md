---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): one name per group: the directory and a type page's badge say Platform / Access, like the menu

Clause-②: no
Metadata-protocol: none

ADR-0084 (amended) · part of the Studio redesign follow-ups.

- **The shared domain dictionary (`translateMetadataDomain`) names the `system` group Platform / 平台 and the `security` group Access / 访问**, the amended ADR-0084's group names. It used to say System / 系统 and Security / 安全 while the Studio left menu said Platform / Access.
- **Every place a group is named now reads that one dictionary:** the Studio left menu (`studioMenuGroupLabel` reads it instead of its own two keys), the All metadata directory's group headings and domain chips, and the domain badge on a type or item page (`PageShell`). Setup's datasource pages draw the same badge, so a datasource reads Platform / 平台 there too, the group ADR-0084 puts it in.
- The menu-only keys `engine.studio.menu.groupSystem` and `engine.studio.menu.groupSecurity` are removed from the `studio` namespace (en and zh); nothing reads them any more.

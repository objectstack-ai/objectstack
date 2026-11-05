---
'@objectstack/platform-objects': patch
---

fix(platform-objects): zh-CN metadata forms say 仪表盘 for dashboard (#30164)

Clause-②: no
Metadata-protocol: none

The zh-CN dashboard authoring form the platform serves (`MetadataFormsTranslations`, which `/api/v1/meta/types` localizes forms with) still said 仪表板 on six strings: the form title, the basics section description, and the help text of the header, show-title, show-description and widgets fields. The Console and Studio say 仪表盘, so one object carried two names in one flow of work. All six now say 仪表盘. The generated bundle is the extract's merge baseline, so its leaves were corrected in place and the bundle regenerated (`pnpm i18n:extract` reproduces it byte for byte; `pnpm check:i18n` is green). en, ja-JP and es-ES are unchanged.

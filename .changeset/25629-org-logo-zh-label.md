---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the zh-CN label for an organization's logo reads 「徽标」, no longer 「标识」, which read as the slug (「标识符」) on the same record page and in the Rename Organization dialog

Clause-②: no
Metadata-protocol: none

`sys_organization.fields.logo.label` in the zh-CN bundle was 「标识」 ("identifier"), directly beside the slug's 「标识符」. The Rename Organization and Edit Organization dialogs take their `logo` param label from this field label, so a zh-CN admin read the logo URL input as the organization's identifier. ja-JP (「ロゴ」 / 「スラッグ」) and es-ES (「Logotipo」 / 「Slug」) had no such collision and are unchanged.

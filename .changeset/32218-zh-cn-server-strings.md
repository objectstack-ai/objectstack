---
'@objectstack/platform-objects': patch
'@objectstack/service-settings': patch
---

fix(i18n): the Metadata Commit object reads in Chinese, Japanese and Spanish, and the zh-CN authentication settings use full-width punctuation

Clause-②: no
Metadata-protocol: none

`sys_metadata_commit`, the package commit log, was missing from the platform-objects translation extract while its three `sys_metadata*` siblings were in it, so a zh-CN, ja-JP or es-ES admin read its label, plural and field labels in English ("Metadata Commit"). It is now extracted into every locale bundle and translated in zh-CN (元数据提交), ja-JP and es-ES; the other locales carry the English source until they are translated.

The zh-CN copy of the Authentication settings page mixed ASCII `, ; : ( )` into Chinese sentences (「认证限流:最大请求数」, 「密码有效期(天)」). Those marks are now full-width; ASCII stays inside codes, addresses and English names (`203.0.113.0/24`, `acme.com`, `ISO 8601`).

---
'@object-ui/i18n': patch
---

fix(i18n): remove the External ID strings only the retired Studio switch used

Clause-②: no
Metadata-protocol: none

The Field Designer and the field inspector no longer offer an External ID switch (`field.externalId` is graded `dead`), so `appDesigner.fieldDesigner.externalId` is removed from all ten locales and `designer.field.externalId` from the Studio namespace (`en`, `zh`).

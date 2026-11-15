---
'@objectstack/objectql': patch
---

fix(objectql): a following amount whose parent code field is no longer served is refused with a message that says so

Clause-②: no
Metadata-protocol: none

A `record`-mode amount that follows its parent's currency (`currencyField: 'MASTER_DETAIL.CODE'`) is still refused `ERR_CURRENCY_CODE_REQUIRED` / 400 when the parent object, as served at the write, no longer declares the code field (the package that contributed it was disabled or uninstalled). The message used to say the parent's code was blank and asked for a code to be written into that field, which is not there. It now says the parent does not serve the field, names the disabled package when the registry still holds its contribution, and says the amount has no code to follow until the field is served again, or that the amount can be left empty. The code, status, `field` and `amountField` are unchanged, and so is the message for a served code field that is blank.

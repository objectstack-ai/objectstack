---
'@object-ui/app-shell': patch
---

feat(studio): a Chinese display name derives its identifier by pinyin at every Studio create door

Clause-②: no
Metadata-protocol: none

A Chinese-speaking administrator names things in Chinese, and every Studio create door used to keep only Latin letters, so `维修中心` derived no identifier and the door waited for a hand-typed English one. Now each door that derives a machine name from a display name turns each Chinese word into its toneless pinyin first, then applies the rule it always applied: `维修中心` gives `weixiu_zhongxin` (a package id `com.<org>.weixiu-zhongxin` with the namespace `weixiu_zhongxin`), `客户等级` gives `kehu_dengji`. The derived identifier is shown and stays editable; the namespace prefix, the `__c` suffix of a customization pair and the taken-name refusal are unchanged.

- **Doors.** New package, the new-item dialog (objects and the other Studio items), Add field (the name the popover previews is the name the field is created under), the generic create form, New view, the object, report and dataset designers' Name, a fresh field's API name in the field inspector, and a picklist option's value (a Chinese option label used to derive an empty value, and the option was silently never saved).
- **Words, not syllables.** Word boundaries come from the browser's `Intl.Segmenter`, and a polyphone reads by its word (`银行` → `yinhang`, `行动` → `xingdong`). Without `Intl.Segmenter`, each character's reading is joined by `_` (`ke_hu_deng_ji`).
- **Bundle.** The dictionary (`pinyin-pro`, the library the server's pinyin search already uses) is a lazy chunk, fetched the first time a door sees a Chinese character; until it lands the door keeps Create off without a "not derived" line, and if it cannot be fetched the door falls back to that line and a hand-typed identifier, as before.
- **Japanese.** Text with kana is left alone, so a Japanese name still asks for the identifier.

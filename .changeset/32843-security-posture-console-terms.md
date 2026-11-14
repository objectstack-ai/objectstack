---
'@objectstack/lint': patch
---

fix(lint): the security-posture advisory sentences name each setting the way the console shows it, in every locale

Clause-②: no
Metadata-protocol: none

The seven security-posture advisory sentences (`validate-security-posture.user-text.ts`) were checked term by term against the console's own packs, and their values corrected where a locale named a setting differently from the screen the admin fixes it on:

- View All Records and Modify All Records, read scope, write scope and the policy's CHECK live in the Studio permission editor, whose strings ship in English and Chinese only. The `ar`, `de`, `es`, `fr`, `ja`, `ko`, `pt-BR` and `ru` sentences now quote the English label that screen shows (`View All Records`, `Read scope`, `Write scope`, `CHECK`); `zh-Hans` names `CHECK`, and `zh-Hant` uses the Chinese label that screen shows.
- The owner opt-in remedy names its switch by the object form's own label in every locale ("Owner may edit" in that locale's words).
- Master and detail follow each locale's console words: child object, parent object, parent record (the `zh` packs keep the Studio's 主记录 for the master record).
- `ko` names a permission set 권한 세트, as the permission-set form does; `de` names the record owner Eigentümer, as the "Owner may edit" switch does; `ja` reads 読み取り for read, where the console does.

Rule ids, params, the English sentences and the catalog's keys are unchanged.

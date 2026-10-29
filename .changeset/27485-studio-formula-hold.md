---
'@object-ui/app-shell': patch
---

fix(studio): a formula that does not parse keeps the field's stored result type, and a switch to another object asks before it drops the held edit (#27485)

Clause-②: no
Metadata-protocol: none

- Typing a formula that does not parse (`record.est_hours > (`) cleared the field's stored `returnType`, because a broken source proves no type. The stored type now stays while the formula has a lint error; a formula that parses stamps its proven type, or clears it when none is proven, as before.
- With such an edit held, switching to another object in the Data pillar's rail dropped it silently. The switch now asks first; declining keeps the object and the edit.

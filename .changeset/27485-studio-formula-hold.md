---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): closing the field inspector keeps a formula that does not parse unsaved, with the field's stored result type, and a switch to another object asks before it drops it (#27485)

Clause-②: no
Metadata-protocol: none

- The Data pillar holds a field's draft while its CEL formula or condition does not parse. That hold used to end the moment the field inspector closed (Escape, Close, another field card, another tab), and the autosave then sent the broken expression as the object's draft, which publish refuses. The hold now belongs to the draft: it lasts while the draft still carries the text the inspector judged, and ends when that text is edited, the field is removed or the object reloads. While it lasts, the pillar shows the held line ("Not saved yet: an expression on the field “F Total” has an error to fix…") with a **Show me** that reopens the field, and the Studio's Publish names it.
- Typing a formula that does not parse (`record.est_hours > (`) cleared the field's stored `returnType`, because a broken source proves no type. The stored type now stays while the formula has a lint error; a formula that parses stamps its proven type, or clears it when none is proven, as before.
- With such an edit held, switching to another object in the Data pillar's rail dropped it silently. The switch now asks first; declining keeps the object and the edit.

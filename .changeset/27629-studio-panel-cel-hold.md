---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): leaving the Validations or Actions tab, or the metadata editor's selection, keeps an expression that does not parse unsaved and names it (#27629)

Clause-②: no
Metadata-protocol: none

- The Data pillar's Validations and Actions panels held the object's draft while a rule's guard or an action's predicate did not parse, but only while their tab was open: leaving the tab ended the hold, and the autosave sent the broken expression as the object's draft. The hold now belongs to the draft, as the field inspector's does since #27485: it lasts while the draft still carries the rule or action the editor judged, and ends when that item is edited, removed or the object reloads. While it lasts, the pillar shows the held line ("Not saved yet: an expression on the rule “Rule A” has an error to fix…") with a **Show me** that reopens the rule or action, and a switch to another object asks first.
- The metadata editor (`ResourceEditPage`) did the same with its selection: clearing or changing it re-enabled Save and the autosave over a broken predicate in the item it had open. The hold now stays with the draft slice the inspector judged, the editor shows a held line naming the item, and **Show me** reselects it.

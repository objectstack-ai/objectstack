---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): a renamed validation rule keeps the hold of the server's verdict on its guard

Clause-②: no
Metadata-protocol: none

In Studio's Validations tab a rule made from New takes its name from its error message, so editing the message renames it. The panel kept each rule's verdict by name and the condition editor reports only when its count changes, so a rename stranded the verdict under the old name: a guard the publish refuses (a nullable field compared without a null check) went on autosaving after the server had said so. The verdict now moves with the rule's name, through the message and through the name input: once the verdict shows, the next save is held and the held line names the rule. The first save of a refused guard still goes out, since only a saved draft is judged, and an edit of the guard itself still goes out to be judged again.

The held line the permission set editor and the hooks panel show reads "Fix the expression errors before saving." (zh 「请先修复表达式错误再保存。」) instead of naming CEL syntax errors, since it also holds the server's refusals.

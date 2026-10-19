---
"@objectstack/lint": patch
---

fix(lint): the translation-reference rules now judge a locale pack's `picklists` face (#23566)

Clause-②: no

Before this change a locale pack's `picklists` entries were never checked. A key that named nothing passed `os lint --strict`, and at runtime the resolver simply never found it, so the label rendered in the source locale. The two existing rules now cover this face, each at the severity its field-level twin already has. No new rule id is added:

- `picklists.<name>` for a list that no package in the stack declares is `translation-target-unknown` (error). When a declared name is close, the finding offers it as "Did you mean".
- `picklists.<name>.options.<key>`, where the key is not a value of the list or of a `picklistExtensions` entry for it, is `translation-option-key-unknown` (warning). A key spelled as an option's display label is told which value to rename it to.

A list the stack only extends through `picklistExtensions`, and that no package of the stack declares, is skipped: its owner's options cannot be seen from here. A list declared by a sibling package of the same artifact resolves, and its option keys are judged. `os explain translation-target-unknown` and `os explain translation-option-key-unknown` name the new face.

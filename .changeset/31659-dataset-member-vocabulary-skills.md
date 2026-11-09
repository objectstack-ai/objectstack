---
'@objectstack/skills': patch
---

docs(skills): teach dataset member `synonyms` and `description` (ADR-0149 D1)

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ui/rules/dashboards.md`'s `defineDataset` example now writes a measure's `synonyms` (the words a question uses for the member, every language in one list, matched and never translated, and never equal to another member's name, label or synonym in the same dataset) and its `description` (a plain-language business definition, never a prompt, translated like `label`). `skills/objectstack-i18n/SKILL.md` names the translation keys `datasets.{dataset}.{dimensions,measures}.{member}.{label,description}` and says `synonyms` carry no key. The new bytes are paid inside each file by deleting sentences the same file already states.

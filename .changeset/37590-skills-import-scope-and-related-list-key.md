---
'@objectstack/skills': patch
---

docs(skills): the relationships rule names `reference_out_of_scope` for a scoped import miss, and both pages say when a `_relatedLists` key is refused under a `.custom` arrangement

Clause-②: no (published prose only; teaches two behaviours already on main)
Metadata-protocol: none

`skills/objectstack-data/rules/relationships.md` (Optional master, the import clause) no longer says another master's detail fails an import with `reference_not_found`. It is `reference_out_of_scope`, whose `scope` (`[{ field, value }]`) names the scoping columns; `reference_not_found` stays for a name no record carries and for a scoping field the caller cannot read.

The same file (Detail-page related lists) and `skills/objectstack-i18n/SKILL.md` (the `_relatedLists.{list}` row) now say that the translation key follows the label the served tab list carries: where the paired `.custom` package's `relatedLists` re-states the entry without a `label`, or hides it, `os validate` refuses the key. The remedy is the one the refusal prescribes: drop the key, or re-state the entry with the owner's own `label`.

Both files sat at their token ceiling, so the words are paid for in the same file and no ceiling moves. `relationships.md` drops a third copy of the `summary` shape (the JSON block under Roll-up Summaries; the TypeScript forms above and below it stay), the sentence that restated what a form without the field group looks like, the lead-in that restated when a roll-up recomputes, and the intro sentence over the grid modeling bullets. `objectstack-i18n/SKILL.md` drops three history notes that teach nothing an author can write today: that `messageFormat` was removed (the schema's own refusal says so), that `getAppBundle` / `loadAppBundle` are gone, and that nothing converts between formats, together with "one locale per item", which the sentence before it already states.

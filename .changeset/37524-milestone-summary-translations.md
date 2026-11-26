---
'@objectstack/spec': minor
'@objectstack/plugin-audit': patch
'@objectstack/lint': patch
---

feat(spec,plugin-audit): an activity milestone's timeline row reads in the reader's language — `objects.<object>._milestones.<field>.<value>.summary`

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up #37585

- **Translation slot.** An object translation accepts `_milestones`, keyed by an `activityMilestones` entry's watched `field` and then the `value` it fires on, each carrying `summary`: the milestone's template in that language, with the same `{field}` tokens. `milestones` and `activityMilestones` are accepted as aliases of the group. `resolveObjectMilestoneSummary` (`@objectstack/spec/system`) reads it along the locale chain.
- **Timeline rows.** A fired milestone's `sys_activity` row now stores a summary code (`metadata.summary_message`, `key: 'activityMilestone'`): the pair, and each interpolated token's value with the select option it matched. On a read whose caller has a locale, a language that translates the milestone serves the row's `summary` composed from its template, a select token named by the option label in that language. The stored `summary` is unchanged — the authored sentence — and a language with no entry, a read with no locale, and every row written before this change read it as stored. A tenant that reworded a packaged milestone's `summary` keeps its words. The field redaction still judges the composed text by the fields the row was composed from.
- **Extraction and references.** `os i18n extract` scaffolds the key for each milestone pair (the first entry of a repeated pair, the one that fires), and the translation-reference rule flags a `_milestones` key over a pair no milestone of the object declares.
- **Docs.** `content/docs/ui/translations.mdx` and the i18n standard's reference table name the key.

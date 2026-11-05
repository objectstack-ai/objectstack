---
'@objectstack/spec': patch
'@objectstack/rest': patch
---

fix(spec,rest): the record page's `timeline` count counts one create or delete written to both the activity and the ledger once, as the 动态 stream draws it (#30343)

Clause-②: yes (narrowing) — `RecordPageTimelineCountSchema.total` falls for the same rows: with a field change counted, `created` (`deleted`) activity rows now step aside as often as the ledger holds `create` (`delete`) writes, beside the `updated` rows that already did; widening in the same line: `@objectstack/spec/api` exports one more constant, `RECORD_TIMELINE_FOLDED_ACTIVITY_TYPES`. No exported member is removed or renamed.
Metadata-protocol: none — a read answer's count, not anything an author writes.

- **Now.** An audit reader on a record with field history sees the 动态 badge count one action once: one create and one edit read 「动态 2」 above the two rows the stream draws. Before, the create counted twice (3).
- **The rule.** Every `updated` row steps aside, as before. A create (a delete) steps aside as often as both sources hold one: the fewer of the record's `created` (`deleted`) activity rows and its `create` (`delete`) ledger writes. A record created before its history was kept has no `create` write, so its `created` row stays in the count, as the stream draws it.
- **Unchanged.** A member without audit read counts the same activity rows as before. A comment adds one. The total stays an upper bound for the `showCompleted` / `types` and no-diff cases; it can fall one short where the stream does not pair a create's (delete's) two rows (different actors, or stamped more than the stream's pairing window apart).

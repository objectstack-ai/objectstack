---
'@objectstack/spec': patch
---

docs(spec): the `RETIRED_KEYS_BY_MAJOR` Lifecycle docblock names both rejected states, and stops contradicting check (b3)'s printed remedy

`RETIRED_KEYS_BY_MAJOR`'s docblock is shipped text — it reaches consumers in `dist/index.d.ts` — and since check (b3) landed, two of its sentences were false:

- **「The one state the gate rejects」**. Check (b3) rejects a *second* state: a NESTED row whose def this build emits but whose dotted path it does not. That state has no aging clock behind it (a nested key never reaches `authorable-surface/` at all), so it is not the aged-out steady state the paragraph described.
- **「Entries are permanent」**, against check (b3)'s own refusal text, which ends `… or delete the entry from packages/spec/src/migrations/registry.ts`. An author following the docblock would not delete; an author following the gate would — two shipped instructions in this repo pushing two people who each did as they were told in opposite directions.

The Lifecycle paragraph now:

- scopes the aging-out steady state to a **top-level** tombstone, and says why a nested row can never be in it;
- lists **both** rejected states with the check that owns each and the remedy that check prints — still-LIVE (b2), nested-and-unresolvable (b3) — and states the routing rule that decides which one a row is judged by (a row is read as a path only when its `name` half carries a dot AND this build emits no top-level property of that exact name, so a live dotted top-level key such as `@odata.context` stays on (b2)'s map);
- reconciles permanence with deletion instead of leaving them to contradict: a row that was ever TRUE of some build is history and is never deleted, while a row (b2) or (b3) refuses was never true of any build, so deleting it removes a false claim rather than a record;
- repeats (b3)'s own ⛔ — it cannot yet tell a wrong row apart from every truthful one, and for the shapes it names the remedy is to teach the check, never to delete a row that is telling the truth.

The `## What reads it` bullet for check (b) and the `@see` roster gain (b3) for the same reason: it reads this table, and neither named it.

**No behaviour moves.** No gate, schema, export or registry entry is touched — the set of metadata that validates is byte-for-byte what it was. What changes is the text an author reads when a gate refuses their row.

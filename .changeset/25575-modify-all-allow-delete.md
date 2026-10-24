---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec,lint)!: a permission set can no longer declare `allowDelete: false` beside `modifyAllRecords: true`

`modifyAllRecords` (Modify All Records) is the write bypass for edit, delete and transfer, as Salesforce's Modify All is. The permission evaluator grants delete on the bypass bit and never reads `allowDelete`, so an object-permission entry declaring `allowDelete: false` beside it parsed, was stored, and let its holder delete every record. The runtime does not change. What changes is what an author can write:

- `ObjectPermissionSchema` refuses an explicit `allowDelete: false` in an entry that sets `modifyAllRecords: true`, with one `custom` issue at `objects.<object>.allowDelete` (the wildcard `*` entry included). The message names the route for "edit every record, delete none".
- An entry that sets `modifyAllRecords: true` and omits `allowDelete` now parses to `allowDelete: true` instead of `false`. That is what the evaluator already granted, and it keeps the parse idempotent: the output of `definePermissionSet` still parses when `defineStack`, a build or a save parses it again.
- `os lint` reports the pair as `security-modify-all-delete-withheld` (error) on a raw config that has not been through the schema. `os explain security-modify-all-delete-withheld` prints the route.
- The response-side `EffectiveObjectPermissionSchema` is unchanged and still accepts the pair.

"Edit every record, delete none" is a `criteria` sharing rule with `accessLevel: 'edit'` shared with the position that holds the set, beside `allowEdit: true` and `allowDelete: false` with no `modifyAllRecords`. An edit share opens update and never delete (ADR-0111 D3). The object needs an owner field and an owner-write default (`private` or `public_read`), and the rule's `condition` must be a field predicate: a literal `true` compiles to an empty filter, which the sharing service refuses as a match-all criteria.

Stored rows and older built artifacts: every earlier parse filled an omitted `allowDelete` with `false`, so the pair also sits where nobody wrote it. The ADR-0087 D2 conversion `permission-modify-all-allow-delete-false-to-true` rewrites it to `true` when a stored row is rehydrated and when a built artifact inside its declared-floor window is loaded. That changes no access decision. It is retired from the load path, so a source that still declares the pair is refused, not rewritten. The D3 entry `permission-modify-all-allow-delete-false-refused` carries the judgment for `os migrate meta`.

Clause-②: no (narrowing) — the object-permission schema refuses a shape it used to accept (`allowDelete: false` beside `modifyAllRecords: true`). Nothing is widened.

Metadata-protocol: narrowed (an object-permission entry may no longer declare `allowDelete: false` beside `modifyAllRecords: true`)

Ruling-ref: 6377890121 (letter A, under 6377842908); retriage 6382861731

<!-- adr-0087: registered permission-modify-all-allow-delete-false-refused, permission-modify-all-allow-delete-false-to-true -->

**BREAKING** for an author who declared the pair.

- **Before.** `{ allowEdit: true, allowDelete: false, modifyAllRecords: true }` parsed, and the holder could delete every record.
- **Now.** The entry is refused at `objects.<object>.allowDelete`.
- **Fix.** If the set should delete every record, delete `allowDelete` from the entry. If it should edit records it does not own but delete none, remove `modifyAllRecords` and add a sharing rule: `{ type: 'criteria', name, object, condition: "record.<field> != ''", accessLevel: 'edit', sharedWith: { type: 'position', value: '<position>' } }`.

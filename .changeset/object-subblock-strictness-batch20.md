---
'@objectstack/spec': major
---

**Object inner blocks now reject unknown keys instead of dropping them (#4001 批 20).**

Thirteen object shapes nested inside `data/object.zod.ts` were still zod's default
`.strip`: a key the schema did not declare was discarded and the parse still
succeeded. The object's TOP level has rejected unknown keys since #1535/#4519/#4522,
and that asymmetry is what made this the batch worth doing — an author who has *seen*
the root reject a typo has every reason to read a clean parse of
`lifecycle: { maxAge: '30d' }` as acceptance. `object` carries the highest author
volume in the repo.

Closed, each reached through its real carrier key and probed there (strictness does
not recurse, so a closed parent proves nothing about a nested block):

- `access` — the ADR-0066 D2 exposure posture.
- `lifecycle` **and all four sub-blocks** — `retention`, `ttl`, `storage`, `archive`.
- `fieldGroups[]` — the ADR-0085 group entry.
- `external` — the ADR-0015 federated binding.
- `userActions`, `systemFields`, `activityMilestones[]`, `publicSharing`.
- `objectExtensions[]` — the extension entry (`defineObjectExtension`).

**Migration.** Any key now rejected was previously stripped and had no runtime
effect — the error carries the fix. The dominant real-world mistake on this file is
**flattening**, so `lifecycle` points DOWN into the sub-block that owns each key:
`maxAge` → `retention`, `expireAfter`/`field` → `ttl`, `strategy`/`shards`/`unit` →
`storage`, `after`/`to`/`keep` → `archive`. That one matters beyond tidiness: a
flattened `maxAge` leaves `retention` absent, so ADR-0057 §3.5 then rejected the
object as *unbounded* — an error naming the wrong key entirely.

Other wrong-layer pointers, each anchored to a named sibling contract:
`userActions.sort`/`search`/`filter`/`editInline` point at `ui/view.zod.ts`'s
identically-named block, whose vocabulary is completely disjoint from the object's;
`userActions.clone` points at `enable` (ObjectCapabilities); `systemFields.owner`
points at `ownership` — a key the block's own field doc names but the shape never
declared; `external.allowWrites` names the ADR-0015 double opt-in and mirrors
`datasource.zod.ts`'s own `writable → allowWrites` alias in the opposite direction;
`access.sharingModel` and `publicSharing.sharingModel` point up at the top level and
distinguish link sharing from principal sharing; `fieldGroups[].fields` states the
direction of the membership edge (declared on the FIELD, as `group:`);
`objectExtensions[].actions`/`hooks`/`listViews` say plainly that the merge has no
slot for them and name the route that does. Aliases cover the near-misses distance
cannot reach (`export` → `exportCsv`, `audiences` → `allowedAudiences`, `table` →
`remoteName`, `object` → `extend`, …). `fieldGroups[]`'s three DEPRECATED collapse
aliases stay **accepted** — closing a shape must not turn a documented deprecation
into a rejection.

**`IndexSchema` is deliberately NOT closed, and that hold is the batch's finding.**
The console ships its own hand-copied JSON-Schema for this shape (objectui
`metadata-admin/EmbeddedItemEditor.tsx`), because `index` is an embedded-only
sub-type the framework publishes no schema for — and that copy has drifted: it
offers **`where`** for the partial-index predicate where the spec declares
**`partial`**. The editor splices its output into `object.indexes[]` and PUTs the
whole object, and `saveMetaItem` keeps the body verbatim while validating it, so
closing this one shape would 422 a control the console itself renders (the #5114
class, caught this time *before* shipping rather than after). The capability is
already dead in both directions — `driver-sql`'s `syncDeclaredIndexes` reads
`name`/`fields`/`unique` only, so neither spelling reaches any DDL — which is
exactly why the close is gated on both the producer rename and an ADR-0049 answer
for `type`/`partial`: pointing an author at `partial` today would be a guidance
entry claiming more than the platform delivers.

One caveat shipped knowingly: `systemFields` is a `false | {…}` union, so its
rejection is an `invalid_union` whose own message is the bare *"Invalid input"* —
the #5014 flattening. 批 18's `discriminatedUnion` fix is unavailable here (one arm
is a literal, so there is no discriminant to key on), so the behaviour is pinned
honestly rather than papered over. Every other site in the file is a plain object
and surfaces its prescription directly.

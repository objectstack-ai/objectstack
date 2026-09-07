---
"@objectstack/lint": patch
---

fix(lint): every `stack.objects` reader skips a non-record entry, so no authoring rule throws on the publish door

A `null` member of `stack.objects` — what an empty YAML list item
deserialises to, and what a partial editor write leaves behind — crashed
13 of the 42 `AUTHORING_RULES` with
`TypeError: Cannot read properties of null (reading 'name')`. The
authoring rules are pure `(stack) => Finding[]` (ADR-0019) and run on the
RAW `lint` path as well as the parsed one, so nothing upstream had judged
the entry's shape. At the runtime publish gate they are called inside the
gate rather than behind a try/catch of their own, so the throw was an
exception on a WRITE path, not a skipped finding; on the CLI, `os lint` /
`os validate` / `os compile` died on the first one instead of reporting
the stack.

The repair before this one guarded ONE seam — the object-graph index every
field-path rule opens with. The crash stood at fourteen more readers of
the same collection, each a hand-copied `asArray` whose array branch was
an unchecked `v as AnyRec[]`. Copies are why: the defensive spelling was
already present in about a dozen siblings and absent in the rest, so
fixing one left the others answering the old way.

So the copies are gone. `recordsOf` — the guarded reader, exported from
`object-graph.ts` and package-private — is now the one coercion from a
collection authored as an array OR as a name-keyed map into the records it
holds, and fifteen files call it:

- `validate-expressions.ts`, `validate-list-view-mode.ts`,
  `validate-widget-bindings.ts`, `filter-walk.ts`,
  `validate-object-references.ts`, `validate-record-title.ts`,
  `validate-form-layout.ts`, `lint-autonumber-formats.ts`,
  `lint-view-refs.ts`, `validate-org-axis-red-lines.ts`,
  `validate-sharing-rule-enforceability.ts` — the eleven sites that threw.
- `validate-searchable-fields.ts`'s `indexObjectSearchTargets` and
  `validate-page-field-bindings.ts`'s `indexObjectFields` — two shared
  indexers inside the reference-integrity suite, each in front of two
  rules and both hidden behind whichever suite member threw first.
- `object-field-groups.ts`'s `indexObjectFieldGroups`, which the
  re-measure surfaced only once the eleven above stopped throwing.
- `validate-security-posture.ts`, the one that never threw: an `[]`
  member passed its `typeof v === 'object'` read and drew a second
  `security-owd-unset` at `object "(object 0)"` — an `error` about an
  entry no author wrote.

The verdict is a SKIP, not a finding, matching the seam it extends: a junk
`objects` member is a SHAPE defect and belongs to the schema, every rule
already re-answers the question in its own per-object guard, and reporting
it at the reader would emit one finding per member for one bad entry. On
the name-keyed map shape a member whose VALUE is unreadable keeps its key
(`{ name }`) — the author named it, only its body is illegible.

No rule tier, id, message or accept-set changes. A valid object standing
beside a junk one is judged exactly as it is judged alone; only a path
index moves, and only for the rules that index `objects` raw, where
`objects[1]` is the honest position.

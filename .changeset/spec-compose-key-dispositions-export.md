---
'@objectstack/spec': minor
---

feat(spec): export `COMPOSE_KEY_DISPOSITIONS` and `STACK_DEFINITION_KEYS` — the artifact envelope's top-level key set and each key's composition rule, derivable from one source instead of hand-copied per consumer (#14877)

`minor`, additive: two new named exports and two new exported types on the
root entry; nothing renamed, narrowed or removed. Every existing import keeps
compiling and every behaviour of `composeStacks` is unchanged — the table it
reads is the same object, now frozen and public.

- `COMPOSE_KEY_DISPOSITIONS` — a frozen, read-only record from every top-level
  key `ObjectStackDefinitionSchema` declares (`manifest`, `packages`,
  `requires`, `objects`, … `onEnable`) to its composition rule: `'concat'`
  (an array collection, concatenated in stack order), `'single'` (identical
  declarations pass through, differing ones refuse naming the key),
  `'manifest'` (picked by the `manifest` option), `'objects'` (the
  `objectConflict` strategy) or `'functions'` (merged by handler name).
  Literal-typed, so `(typeof COMPOSE_KEY_DISPOSITIONS)[K]` is K's disposition,
  not the union.
- `STACK_DEFINITION_KEYS` — the top-level key set, derived from that table by
  `Object.keys` (never a second literal), frozen.
- `StackDefinitionKey` and `ComposeDisposition` — the key union and the
  disposition union, for a consumer that types its own seam against them.

Why: the collection half of this key set was already derivable downstream
(`PLURAL_TO_SINGULAR`, `METADATA_ALIASES`), but the non-collection keys —
`manifest`, `requires`, `packages`, and whatever comes next — had to be
hand-copied by every consumer that walks an artifact's top level, and that
copy drifted silently twice: objectstack-ai/cloud#897 (`roles` → `positions`
dropped every hosted `positions[]`) and objectstack-ai/cloud#1888 (`packages[]`
dropped by an artifact merge, recreating downstream the duplicate-ownership
state #14599 had repaired at the door). A seam that derives its key set from
`STACK_DEFINITION_KEYS` — and asks `COMPOSE_KEY_DISPOSITIONS[key] === 'concat'`
whether a key may be concatenated across artifacts — picks up the next key
(#14865's `grantedPermissions`) the day the schema declares it, with no edit of
its own.

Pinned (`compose-key-dispositions-export.pin.test.ts`): the exported key set
equals `ObjectStackDefinitionSchema`'s declared top-level key set in both
directions, the view is frozen, every value is a declared disposition, every
`'concat'` key is what `composeStacks` concatenates and every `'single'` key is
what it passes through or refuses, and the key list is `Object.keys` of the
table.

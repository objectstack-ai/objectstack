---
"@objectstack/spec": patch
---

fix(spec): drop the producer-less `batch` row from `DATA_ACTION_TO_API_OPERATION` (#6259)

`DATA_ACTION_TO_API_OPERATION` normalizes the action vocabularies its callers
speak onto canonical `ApiOperation` names. One row, `batch: 'bulk'`, had no
producer on either side, and the table's own TSDoc still taught readers that it
did — calling `batch` a "runtime `callData` action".

Both consumers were re-enumerated at `origin/main` before the row was removed:

- `packages/runtime/src/api-exposure.ts` (`checkApiExposure`) is reached only
  from `callData`, which branches on a closed set — `create`/`get`/`update`/
  `delete`/`query`/`find`/`aggregate` — and every call site passes one of those
  as a string literal. Its `batch` arm was retired in #5856, so no caller has
  been able to send the word since.
- `packages/rest/src/rest-server.ts` (`apiAccessDenialFromEnable`) is fed only
  canonical literals by `enforceApiAccess`: `import`, `bulk`, `create`,
  `update`, `list`, `delete`, `get`, `export`. The cross-object `POST /batch`
  route is the trap worth naming — it spells `batch` in the **URL** and gates on
  `'bulk'`, so the route is untouched by this change.

FROM → TO: `batch` → `bulk`. If you read this table directly, spell the bulk
surface `bulk`; `DATA_ACTION_TO_API_OPERATION['batch']` is now `undefined`.

**Nothing on a live path changes**, because nothing sent `batch`. What changes
is the answer waiting for anyone who does: the lookup misses, the consumers'
`?? action` pass-through hands `batch` through unmapped, and an unmapped action
is *ungated* by `apiMethods` (it still respects `apiEnabled`) — the same
treatment every custom action gets. That last point is why the row was worth
removing rather than leaving as harmless: while it existed, one unreachable
word silently bought a real `bulk ∧ child` permission verdict, and a reader —
or an AI author — would reasonably conclude `batch` was a supported spelling
and write consumer-side tolerance for it. Prime Directive #12 forbids exactly
that: an alias with no producer belongs at the producer or nowhere.

The export itself is unchanged — same name, same `Record<string, ApiOperation>`
type — so `check:api-surface` records no delta (that snapshot prints type
references, not expanded shapes; #3883 is the precedent for a key-level change
being invisible to it). No authorable metadata key is involved, so there is no
tombstone, no conversion and no liveness-ledger row: nothing parses this table.

---
"@objectstack/spec": minor
"@objectstack/objectql": patch
"@objectstack/platform-objects": patch
---

feat(spec)!: shrink the `ApiMethod` enum to the six primitives — legacy values are stripped at parse, never honored (#3543, P2 of #3391)

**BREAKING** (the `!` marker and this changeset are the breaking-change
record; the train ships as the v17 major — see the `v17-rc-anchor` changeset):
the authored `enable.apiMethods` enum is now exactly the six
primitives (`get`, `list`, `create`, `update`, `delete`, `bulk`). The eight
legacy values (`upsert`, `aggregate`, `history`, `search`, `restore`, `purge`,
`import`, `export`) are no longer authorable — they are DERIVED effective
operations, resolved by the server's single derivation table.

**Migration (FROM → TO).** Replace each legacy value with the primitives it
derives from, then de-duplicate; if the result names all six primitives, delete
the `apiMethods` key entirely (equivalent to default-open, and it tracks future
primitives):

| FROM (legacy) | TO (primitives)      | why                                        |
| ------------- | -------------------- | ------------------------------------------ |
| `upsert`      | `create`, `update`   | upsert ⊆ create ∧ update                   |
| `import`      | `create`, `update`   | import ⊆ create ∨ update (writeMode-precise) |
| `export`      | `list`               | export ⊆ list                              |
| `aggregate`   | `list`               | aggregate ⊆ list                           |
| `search`      | `list`               | search ⊆ list ∧ `searchable`               |
| `history`     | `get`                | history ⊆ get ∧ `trackHistory`             |
| `restore`     | *(delete the value)* | never derives — `enable.trash` retired (#2377) |
| `purge`       | *(delete the value)* | never derives — `enable.trash` retired (#2377) |

Reporter codemod: `node scripts/codemod/apimethods-legacy-to-primitives.mjs`
(scans, reports the exact replacement per site, and flags whitelists the
mapping would WIDEN so the edit stays reviewable).

**Stored metadata keeps parsing — permanent tolerance, narrowing only.** Real
metadata does not upgrade in lockstep with the spec, so a stored legacy value
is NOT a parse error: `stripLegacyApiMethods` (new export) strips it with a
FROM→TO warning (canonicalize-and-warn). Stripping only ever NARROWS exposure —
the derivation table still grants every legacy verb that derives from the
primitives you declared. Two cliffs to know:

1. A whitelist of ONLY legacy values (e.g. `['upsert']`) strips to `[]` =
   **deny-all** — the object's API closes instead of widening. The strip
   warning and the objectql registration diagnostic both call this out.
2. A legacy value NOT derivable from your declared primitives (e.g.
   `['get', 'export']` — export needs `list`) was honored by the P1
   "explicit wins" path and is now denied. Declare the underlying primitive.

**Type split — authored vs effective vocabulary.** `ApiMethod` (authored) is
now six values; the NEW `ApiOperation` type / `ApiOperationSchema` /
`API_OPERATION_ORDER` (fourteen values, byte-stable pre-shrink wire order)
carry the EFFECTIVE vocabulary. The wire contract is unchanged: the 405
`allowed` array and `/me/permissions` `apiOperations` still serialize derived
verbs (`export`, `search`, …), and `EffectiveObjectPermissionSchema.apiOperations`
now validates against `ApiOperationSchema`. `EffectiveApiMethods.explicitLegacy`
is removed (nothing is honored verbatim anymore); `API_METHOD_ORDER` remains as
a deprecated alias of `API_OPERATION_ORDER`.

**Fail-closed tightening (#3545):** a PRESENT but non-array `apiMethods` (only
producible by a raw/out-of-band metadata write) now resolves to `deny-all`
instead of unrestricted — a policy that exists but cannot be read fails CLOSED.

**Published JSON Schema diverges deliberately:** `data/ApiMethod.json` is the
strict six-value enum (a `z.preprocess` is not representable in JSON Schema),
so external JSON-Schema validators reject legacy values that the zod parse
would strip-and-warn. Treat the JSON Schema as the authored contract; the zod
tolerance exists for stored metadata.

**objectql:** the P1 "explicit wins" transition is reclaimed —
`warnDeprecatedExplicitApiMethods` is replaced by `warnStrippedLegacyApiMethods`
(a permanent per-object diagnostic for schemas that reach the registry without
passing through Zod; the parse-time strip warning carries no object name).

**platform-objects:** whitelist audit — `sys_business_unit`,
`sys_business_unit_member` (P1's explicit `import`/`export` reclaimed) and
`sys_user_preference` dropped their `apiMethods` entirely (each named all six
primitives = default-open). Read-only and deny-all whitelists are unchanged;
the seven `[]` declarations are deliberately KEPT as defense-in-depth alongside
`apiEnabled: false`.

<!-- adr-0087: registered apimethod-enum-shrink -->

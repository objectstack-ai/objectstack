# Issue #8031 — handover report (`os-dev` → `domain:metadata` PM)

`GET /meta/:type/:name/published` 404s for a runtime-published item.

- **Branch (fix):** `claude/issue-8031-published-route-resolves-registry` → PR **#8254**
- **Commits:** `2e2af92` (fix + tests + changeset), `9993cb3` (CI: engine-double pin)
- **Base measured:** branched at `37b82ed`, merged clean through `origin/main` `a0151e9`
- **Why this file exists:** every GitHub API call from this container 403s
  (`"GitHub access is not enabled for this session"`) — reads and writes alike. The report
  below never reached the issue. Nothing here is code; it is the record.

---

## 1. Premise

**`premise_still_valid: true`** — reproduced on current `main`, not inherited from the card.

Measured with the real `ObjectStackProtocolImplementation` over a faithful stub engine and a
real `MetadataManager`, driving the real `HttpDispatcher`:

| Probe | Result |
|---|---|
| `active` overlay row after `publishPackageDrafts` | exists, carries the authored body |
| `GET /meta/object/proj_task` (ordinary read) | **200** |
| `GET /meta/object/proj_task/published` | **404** |

The card's three claims all hold: the route is mounted, the write happened, and the read looks
in the wrong place.

## 2. Which store is authoritative — and how it was established

**The `sys_metadata` row with `state:'active'` is authoritative for "published".**

Established from the spec, *not* from the fact that the write went there:

1. **ADR-0027 (E)(5)** — the metadata-authoring-lifecycle ADR — defines sealing a publish as:
   *"Seal → `status:'published'` … flip the draft's `sys_metadata` rows `state:'draft' →
   'active'`."* The flip **is** the publish.
2. **`packages/metadata-protocol/src/sys-metadata-repository.ts`**, the `OverlayState` contract:
   *"`'active'` → the published, live overlay. `getMetaItem` (the default read path) and runtime
   loaders observe this row."*
3. **ADR-0033 §2** — *the ADR this very route cites in its own comment* — routes **every**
   authoring write into the ADR-0027 draft (*"AI never publishes — every write lands in the
   ADR-0027 draft"*), making promotion of that draft the definition of "published" for anything
   authored at runtime.

The competing store — `publishedDefinition`, a row-local key in `MetadataManager`'s in-memory
registry — is written **only** by `MetadataManager.publishPackage`, the ADR-0016-era package
publish. ADR-0027 lines 79–80 describe that older model (*"overlay rows bound to a flat
`package_id`, immediately active"*) as the thing it revives its north-star **away from**.

## 3. Wrong source, or capability never built?

**Wrong source.** This is *not* the #7893 shape, and the distinction is load-bearing:

- In #7893 the capability was *declared* (`allowRuntimeCreate: true`), accepted and validated
  writes, and **no read path was ever built** — the surface was dead for every caller.
- Here the route is **live and correct for the case it was built for** (code/package publish).
  It is ledgered (`rest-route-ledger.ts`, `route-ledger.ts`), mounted on both transports, and has
  an SDK client (`meta.getPublished`). It serves real traffic today.
- Decisively: **the route's own cited ADR (0033) is the overlay lifecycle.** Runtime publishing
  was therefore *in scope* for it. The read was simply wired to the older ADR-0016 store and
  never re-pointed when ADR-0027 moved what "published" means.

So: not a capability gap to escalate, and not a `needs-user-decision`. A real divergence with a
determinate right answer.

**The mechanism, stated in the repo's own words.** The two paths were built to have no contact:

- `packages/runtime/src/domains/packages.ts`, on `POST /packages/:id/publish-drafts`:
  *"Routes through `protocol.publishPackageDrafts` … **no metadata service dependency**, unlike
  `/publish` above."*
- `packages/runtime/src/domains/meta.ts`, on `/published`: resolved **only**
  `metadataService.getPublished`.

Two publish doors, two stores, zero overlap. The 404 was a false statement about an item that
*is* published.

## 4. What a 404 asserts on this route

⚠️ **This corrects an expectation in the dispatch.**

On this route **404 means "no such item"**, *not* "exists but unpublished". `rest-server.ts`
documents it explicitly:

> *"An item that exists but was never published still answers 200 with its current definition —
> that is `getPublished`'s documented fallback, and it is a different fact from 'no such item'."*

The contract in `packages/spec/src/contracts/metadata-service.ts` agrees: *"Returns
published_definition if exists, else current definition."*

So the dispatch's verification arm — *"an item that is genuinely unpublished still 404s"* — is
**not** the route's contract for a code-defined item; that case is a documented 200. I did not
change it, and did not silently redefine the arm either. I implemented the form that **is**
correct and that the arm was reaching for:

> **a draft-only item must not be served** — a pending edit is not a published body.

That is a real, load-bearing guarantee (see the arm table: mutation D breaks exactly it), and it
is the overlay-store analogue of what the arm intended.

## 5. The fix

`packages/runtime/src/domains/meta.ts`, the `/published` branch of `handleMetadataRequest`
(anchored on the function name, not a line number). **+49 lines, purely additive** — the existing
`getPublished` path is untouched and still runs.

The authoritative store is consulted first, via `protocol.getMetaItemLayered`, and **only** its
`overlay` field is read.

**Why that primitive and not the obvious one.** `getMetaItemLayered`'s overlay layer is a strict
`state:'active'` lookup (org-scoped first, then env-wide, ADR-0048 package preference) reported
**separately** from the code layer. Two consequences the fix rests on:

- it **never reads a draft**, so a pending edit cannot be served as published;
- a null overlay is *positively* "no runtime-published row", so the route can tell the two stores
  apart and fall through with the code path byte-identical.

The broader `getMetaItem` **would not do**: it folds the code layer into its own answer, so the
route could no longer distinguish the stores, and a code-published item would be served its raw
stored envelope (`{metadata:{…}, publishedDefinition, state}`) instead of its
`publishedDefinition`. That is measured, not asserted — arm B below.

Scope fences honoured: nothing in `packages/rest` (see finding F1), nothing in the audit/publish
lifecycle (see F2).

## 6. How I established the 404 was real — the anti-vacuity controls

A 404 is exactly what a probe that never reached anything also returns, and a 200 is exactly what
a fixture that quietly serves one store for both cases returns. Four controls separate the real
result from both failure modes:

1. **The write is proven to have landed** *before* the 404 is read. The test asserts an `active`
   row exists and that its `metadata` parses to the authored body. Without this, the 404 could
   just mean "the publish never happened".
2. **The ordinary read is proven to serve the same item** — `GET /meta/object/proj_task` returns
   200 in the same fixture. So the item is reachable through the dispatcher; only `/published`
   misses it. This is what makes it a *divergence* rather than an absent item.
3. **The two fixtures are proven to live in different stores** (the dedicated anti-vacuity case):
   the runtime item is present in the overlay rows and `getPublished('object','proj_task')` is
   `undefined`; the code item is absent from the overlay rows and `getPublished` returns a body.
   Neither fixture can be answering from the other's store.
4. **Every assertion reads a value from inside the body** (`label`, `fields.done.type`), never a
   mere key presence, so serving an envelope or a stub fails on the value.

⚠️ **An evidence-quality failure I caught and fixed — worth keeping.** My *first* fixture
constructed the protocol without a services registry. The protocol's code layer was therefore
unreachable, every arm fell through to `getPublished` alike, and **the byte-identity case passed
under every mutation I tried** — it was vacuous and would have shipped a regression guarantee
that guaranteed nothing. I rewired the fixture to hand the protocol a real `metadata` slot, as a
real kernel does (`makeProtocol`). Only then did arms B/C/D go red. The table below is from the
strengthened fixture; the earlier one should not be trusted.

## 7. Reverse-verify: which cases go red under which arm

| Case | **Fix** | A: revert fix | B: `getMetaItem.item` | C: `layered.effective` | D: `previewDrafts:true` |
|---|---|---|---|---|---|
| runtime-published served, **published body** | ✅ | ❌ 404 | ✅ | ✅ | ✅ |
| draft-only → 404, draft **not** served | ✅ | ✅ | ✅ | ✅ | ❌ 200, draft served |
| code-published **byte-identical** | ✅ | ✅ | ❌ raw envelope | ❌ raw envelope | ❌ raw envelope |
| anti-vacuity: two stores distinguished | ✅ | ❌ | ❌ | ❌ | ❌ |
| nonexistent name → 404 | ✅ | ✅ | ✅ | ✅ | ✅ |

Arms: **A** = the fix block removed (i.e. `main`). **B** = the broader `getMetaItem` primitive.
**C** = `layered.effective` (`overlay ?? code`) instead of `layered.overlay`. **D** = draft
preview switched on.

Read the table as: A attributes the runtime-published cases to the fix; B and C attribute the
byte-identity guarantee to the *choice of primitive*; D attributes the draft-404 guarantee to the
strict `state:'active'` lookup. No case is idle.

Re-checked after the CI fix hardened the engine double: arm A still turns exactly the two
runtime-published cases red, so the suite remains load-bearing.

## 8. Gates

| Gate | Result |
|---|---|
| `@objectstack/runtime` | 2200 passed (146 files) |
| `@objectstack/metadata-protocol` | 1094 passed (75 files) |
| `@objectstack/rest` | 1728 passed (102 files) |
| `@objectstack/dogfood` | 673 passed, 3 skipped |
| `check:nul-bytes` | exit 0 |
| `check:empty-changeset` | exit 0 (1 declaring changeset) |
| `check:engine-double-contract` | exit 0 |
| eslint | exit 0 |
| `check:type-check-debt` (built closure) | **exit 0** |

Notes for the record:

- The dogfood suite was run **after** `pnpm build` completed, never concurrently — those tests
  resolve siblings through `dist`.
- `check:type-check-debt` initially failed: my new test file added **13 `TS18048`** errors to
  `@objectstack/runtime`'s TEST_DEBT (227 → 240). Per the fence I **fixed the errors in my own
  file** rather than raising the ledger; runtime now measures exactly its recorded 227 and my
  file contributes 0. **No ledger entry raised, nothing `--lower`ed.**
- CI then failed `check:engine-double-contract` with **2** problems (`update` **and** `delete`)
  on the fixture's fake engine. Both verbs now open with the producer's own predicate,
  `assertEngineUpdateDispatch` / `assertEngineDeleteDispatch`, imported from
  `@objectstack/metadata-core` (not `@objectstack/objectql`, which re-exports them but depends on
  this side of the graph — that edge is a cycle turbo rejects). **No baseline entry was added**;
  `scripts/engine-double-contract.baseline.json` is untouched. The pin applied cleanly.

---

# Findings — out of scope for #8031, recorded in full

⚠️ **None of these could be filed.** The GitHub API 403s on writes as well as reads, so no issue
number exists for any of them and I cite none. They exist only here. Please file them.

## F1 — `packages/rest` carries the identical divergence on its own transport

**Re-route to `domain:cli` — reported, not performed** (scope fence: a fix landing in
`packages/rest` is not mine).

`packages/rest/src/rest-server.ts` mounts both arities of this route —
`GET /api/v1/meta/:type/:name/published` and
`GET /api/v1/meta/:type/:section/:name/published` — and resolves them through
`resolveMetadataService(...)` → `svc.getPublished(type, name)`. **It never consults the overlay.**
That is the same wrong store the dispatcher had, on the transport that actually serves the cloud
runtime, so the defect in #8031 is still reachable through REST after this PR merges.

Everything in §2 applies unchanged. A fix there would mirror the dispatcher's: consult the
`state:'active'` overlay row first, fall through to `getPublished` on a null overlay to keep
code-published items byte-identical.

Two extra facts the REST side has that the dispatcher does not:

- It answers **501 `NOT_IMPLEMENTED`** (*"metadata.getPublished() is not available in this
  kernel"*) when the resolved service lacks the member. `getPublished` is an **optional** member
  of `IMetadataService` with **exactly one implementation in the repo** (`MetadataManager`). So on
  any topology whose `metadata` slot is occupied by something else, this route is a 501 —
  a latent second failure mode, independent of #8031.
- `rest-server.ts` already carries the comment quoted in §4 explaining what its 404 means; whoever
  fixes it should keep that semantics intact rather than widening 404 into "unpublished".

## F2 — #7748 overlap: adjacent, deliberately untouched, and **no overlap claimed**

The dispatch flagged #7748 (the audit trail records only `save`; publish, rollback and the 409
denial never write a row). My investigation **touched its neighbourhood but measured nothing about
it**, and I want that stated precisely rather than as reassurance:

- My stub engine **short-circuits** `sys_metadata_audit` inserts (`return { id: 'audit_skip' }`).
  So my suite is **silent** on audit behaviour — it neither confirms nor refutes #7748. Do not
  read my green run as evidence either way.
- One adjacent observation that may be useful on that card, offered as an observation and not as a
  measurement: `sys-metadata-repository.ts` declares
  `ExtendedOperation = 'create' | 'update' | 'publish' | 'revert' | 'delete'`, documented as
  *"`'publish'` is recorded when a draft is promoted, `'revert'` when a historical version is
  restored"*. That is the **`sys_metadata_history`** table, which is a **different table** from
  the audit trail #7748 describes. If anyone reasons "publish is already recorded, so #7748 is
  stale", that is the trap — they would be reading the history table's contract and concluding
  something about the audit table.
- I changed nothing on that path, per the fence.

## F3 — The card's verification arm 2 does not match the route's documented contract

Recorded because it is a defect in the *expectation*, and the next agent on this route will hit it
too. Full statement in §4 above. In short: *"an item that is genuinely unpublished still 404s"* is
false for a code-defined item by design — `getPublished`'s documented fallback answers **200 with
the current definition**, and `rest-server.ts` says so in a comment written specifically to
preserve that distinction. Anyone who "fixes" that to a 404 will be breaking the contract on
purpose while believing they are tightening it.

The version of the arm that *is* correct — a **draft-only** item must not be served — is
implemented and load-bearing (arm D).

## F4 — `getPublished` is a single-implementation optional contract member

Not a bug; a fragility worth someone's attention, surfaced while establishing §2.

`IMetadataService.getPublished?` is optional, has exactly one implementation
(`MetadataManager.getPublished`), and its store (`publishedDefinition`) is written by exactly one
caller (`MetadataManager.publishPackage`, reached only via `POST /packages/:id/publish`). Two
consequences:

1. Any kernel whose `metadata` slot holds something else turns `/published` into a 501 on REST
   and a 404 on the dispatcher — a capability gap that presents as absence.
2. `packages/runtime/src/http-dispatcher.ts` records two prior instances of exactly this shape —
   `generateOpenApi` and `matchEndpoint`, duck-typed optional members **no implementation ever
   provided**, whose branches were constant-false on every request ever served and were deleted
   under ADR-0076 rather than repaired. `getPublished` is not dead — it has one real
   implementation and real traffic — but it is one topology change away from that same class, and
   the duck-type (`typeof svc.getPublished === 'function'`) makes the failure silent when it comes.

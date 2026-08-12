# #7893 — os-dev handover

**Branch:** `claude/issue-7893-handover` · **Repo state:** `objectstack` @ `e3c8ed0`
**Outcome:** no code change. `needs-user-decision`. The ruling is the maintainer's.

**Access measurement.** GitHub REST API returned **403 on four separate calls** (`GET /repos/...`, `GET /issues/7893`, `GET /issues/7743`, `POST /issues/7893/comments`), all with
`"GitHub access is not enabled for this session. An org admin must connect the Claude GitHub App for this organization."`
Git transport is a **separate channel and works** — clone and push both succeed. That asymmetry is why this file exists.

**Two corrections to the dispatch record, stated for accuracy:**

1. This handover text was delivered in full in a prior message; this file is a durable copy on the channel that works, not a first draft.
2. **No ADR was ever drafted by this seat.** There is no ADR prose, and nothing exists under `docs/adr/**` in this tree (verified with `git status docs/adr` — empty). There is no ADR material to hand to the maintainer.

**Scope fences held:** `PLURAL_TO_SINGULAR` untouched · #7743's fix not reopened · no `packages/rest` change · no edits to `protocol.ts` (so no contention with #8027's `getMetaItem`/`getMetaItems`/`getMetaItemLayered` work) · all references anchored on function names, never line numbers.

---

## 1. How I established the read path does not exist

The load-bearing claim. Separating what is **measured at the boundary** from what is **established by search**, with controls for each.

### 1a. The measurement — does not depend on my search being complete

Driven through the real `HttpDispatcher` → real `ObjectStackProtocolImplementation` → real `SysMetadataRepository`:

- `PUT /field/showcase_task.zz_probe` → **200**, row persisted, `state=active`
- `GET /object/showcase_task` → **200**, `fields = ['title','status']` — `zz_probe` **absent**

Absence here is an observation at the API boundary, not a failed grep. Three controls make it a measurement rather than a null result:

| Control | Result | What it rules out |
|---|---|---|
| **Anti-vacuity** — declared fields in the *same* read | `title`, `status` both present | dead read path / empty fixture |
| **Probe D** — `GET /field/showcase_task.zz_probe` | **200**, `_diagnostics.valid:true` | row never persisted / row malformed |
| **Probe C** — `GET /object/runtime_thing` (runtime-created, non-artifact) | **200**, `fields:['note']` | read path only ever surfaces package artifacts |

Probe D is the sharpest of the three: the row is **reachable and well-formed**. So the field is specifically *uncomposed* — not missing, not corrupt, not rejected.

> ⚠️ **The anti-vacuity arm earned its place and should be kept by whoever implements.** My first run asserted absence against `body.item.fields` — the wrong path. It returned `[]` and the "defect" assertion passed against an empty read. The correct path is **`body.data.item.fields`**. Without the anti-vacuity arm I would have reported a measured defect from a read that returned nothing at all.

### 1b. The search — establishes *why*, and carries the positive control

Three sweeps over `packages/`, excluding tests:

1. `'field'` used as a type discriminator across `metadata-protocol` / `objectql` / `runtime` → **one** hit, and it is on the **write** path: the destructive-change guard, `singularType === 'object' || singularType === 'field'` (`protocol.ts`, in `saveMetaItem`'s pre-persistence checks).
2. `getMetaItems|listMetadata|listForIndex` intersected with `field` across all of `packages/` → **zero**.
3. `supportsOverlay` across all of `packages/` → **this is the positive control.**

**Why sweep 3 is the control you asked for.** The same technique, over the same tree, in the same files, returned **real consumers** — which I then traced to their call sites:

- `metadata-manager.ts:2448` — echoes the flag into a response
- `protocol.ts:8662` — derives `OVERLAY_CAPABLE_TYPES`
- `sys-metadata-repository.ts:225` — derives the same set
- `sys-metadata-repository.ts:1151` — `assertDeleteAllowed`, the **only** behavioural consumer

A grep that finds consumers when they exist, and finds none for `field`, is evidence. A grep that never returns anything would not be. That is the difference between "absent" and "I did not find it."

### 1c. What the seam actually is

> `field` is the one declared type with no standalone existence in the object model. Fields are authored **inside** the object (`ObjectSchema.fields`, a `z.record(name, FieldSchema)`), so an object's `fields` is a property of the object item itself. A `field` write mints a **separate** `sys_metadata` row keyed `('field', '<object>.<name>')`. Nothing composes fragment rows into their parent item.

It is not that a filter excludes field rows. **There is no merge code to exclude them.**

#7743 already recorded the same structural fact from the write side — *"`field`'s `filePatterns` (`**/*.field.ts`) match nothing in any app, because fields are authored INSIDE the object"* — which is why `isNestedArtifactField` had to be written at all. The read side never received the corresponding treatment, because there is no reader for a thing that is not a thing.

### 1d. Limits — carry these to the maintainer

- **Probe C is weaker than it looks.** `runtime_thing` is seeded into the harness's registry map; it is **not** written end-to-end through the PUT door in that arm. It controls for *"the read surfaces non-artifact items"*. It does **not** demonstrate a full write-door → row → read loop for any type. A `PUT /object/...` arm would close that; I did not run one.
- **The probe ran against #7743's harness double, not a booted showcase.** #7743 documents that double as faithfully mirroring the real `SchemaRegistry` (no `field` collection; `getArtifactItem` returns package-stamped items only), and 10 green tests pin it — but it is a double. **The code searches in §1b were against the real tree** and carry no such caveat.
- Bounded to this repo at `e3c8ed0`. A consumer outside `packages/`, or one reaching field rows through a dynamic/computed type string, would not appear in sweeps 1–2.

---

## 2. Card recovery — the full body WAS recovered

Stated plainly, since the negative was specifically requested: **no caveat is needed here. The missing half is in hand.**

**How:** the repo is **public**, so the web UI renders what the API truncates. `WebFetch` on `https://github.com/objectstack-ai/objectstack/issues/7893` returned the complete body; likewise `.../7743`. My API read truncated at exactly the point the PM reproduced twice. The web UI was the way around it.

**The truncation cause is confirmed:** the sentence continues `PUT /api/v1/meta/field/<object>.<name>` — an angle-bracketed path template, as hypothesised.

**The half that does not reach an API reader contains two sections:**

**(a) A "Decision Required" section** with three coherent, mutually-exclusive options:
1. **Implement write-through** — registry mutation + read-path merge + sync
2. **Retire the write channel** — refuse the route, point authors at object mutations
3. **Document as inert** — the card itself calls this *"the weakest option, violates ADR-0049"*

This is why #7893 read as a fix card: the decision was in the unreadable half.

**(b) A "Root Cause" section that is WRONG**, and materially so:

> *"Field writes create standalone rows in `sys_metadata` with `type='field'`, but nothing merges these into an object's effective schema. Object fields come only from the artifact plus overlay rows. The generic overlay hydration path skips fields since `field` has `supportsOverlay: false`."*

The first two sentences are right. **The third is false, in two independent ways:**

- **`supportsOverlay` gates no read path at all.** Per §1b it is consulted only by `assertDeleteAllowed`. Flipping `field` to `supportsOverlay: true` would change **nothing** on the read and would **silently widen the delete authorization gate** — a real regression, reachable by following the card's own root cause.
- **The `object` control falsifies it outright.** `object` carries the **identical flag pair** — `supportsOverlay: false, allowRuntimeCreate: true` (`metadata-plugin.zod.ts:628-629`) — and a runtime-created object is fully readable (§1a, Probe C). `protocol.ts` names seven such types explicitly: *"Seven registry types declare `supportsOverlay: false` yet are writable at runtime by design (`object`, `field`, `hook`, `seed`, `mapping`, `flow`, `action`)."* Same flags, opposite outcome ⇒ the flag is not the cause.

⚠️ **If the maintainer reads the card body directly, that section will mislead them toward a one-line flag flip that fixes nothing and loosens deletes.**

### 2a. Precision on the card's title

*"read by nothing"* is very slightly overstated. Probe D shows the row **is** readable on its own by-name route. What it never reaches is the object's `fields` — and therefore ObjectQL, the physical table, and every consumer that matters. **The row is self-readable and universally inert.**

---

## 3. What `valid=true` is actually asserting

Verified in source, not inferred — `packages/metadata-protocol/src/metadata-diagnostics.ts:51`:

```
computeMetadataDiagnostics(type, item)
  → getMetadataTypeSchema(singular) → .safeParse(item)
```

**`valid: true` means: this isolated document satisfies its type's Zod schema.** Well-formed. Nothing more. It never consults the registry, the parent object, or any consumer.

Two things make this sharper than "the flag is lying":

- **It is deliberately document-scoped, and that is a good property.** The same function backs the save path's 422 and the read path's diagnostics, so — per its own doc comment — *"a document's verdict cannot depend on whether it was being saved or being opened."* `valid: true` on a `zz_probe` row is **correctly computed**. It should not simply be flipped to `false`; the document genuinely is well-formed.
- **The envelope has no slot for "in effect."** The gap is a missing signal, not a wrong value. The type already models a third state on a *different* axis — `computeMetadataDiagnostics` returns `undefined` when a type has no registered schema, and its contract says callers *"MUST treat that as 'no opinion' — not as 'valid'"*. There is no equivalent for *"well-formed but consumed by nothing."*

**Answer: well-formed, emphatically not in effect** — and a caller has no field with which to tell the two apart.

Compounding it: the by-name read wraps the item in `lock:"none", editable:true, deletable:true`, which positively advertise a live item. ⚠️ Those come from the **read envelope, not from `_diagnostics`**; I did not trace where they are computed.

---

## 4. Read on the fork — without choosing

### If the capability IS intended, the read path must touch:

- **A composition step that does not exist today** — something resolving `('field', '<obj>.<name>')` rows and merging them into the parent's `fields` at read time. Genuinely new code, not a filter to relax.
- **Every reader of `ObjectSchema.fields`** — the wide part. Fields feed query validation and gating throughout `protocol.ts` (`gate.fields` at roughly 20 call sites: sort, search, virtual-field, unknown-field and dotted-path errors). A field present in the object read but absent from those gates trades one inconsistency for another.
- **Physical schema.** The card's own word is *"sync"*. A field means a **column**. That is migrations, entirely outside `metadata-protocol`.
- **Cold boot.** `loadMetaFromDb` hydrates env-wide rows; the `orgScopedWriteRefusal` comments already record that a row the write path accepts may not survive a restart. A read-path merge that works in-process and vanishes on reboot reproduces #6190's shape exactly.

⇒ A feature spanning at least three packages. Not a patch, and not this seat's region.

### If it is NOT intended, refusing at the door is mechanically small but behaviourally not:

- The **#5086 `NOT_CREATABLE` inlet already exists** and `api` used it, so the mechanism is off-the-shelf.
- But it **breaks every caller who today receives a 200.** Those callers get nothing of value from that 200 — what breaks is code that *believes* it succeeded. Silent-inert → loud-403 is the right direction, and it is still a live contract change.
- It **flips a pinned CONTROL red, on purpose.** `packages/runtime/src/meta-field-overlay-lock.test.ts:393` pins the brand-new-field write under the banner *"THE FEATURE — `allowRuntimeCreate: true` is real and must survive."* #7743 wrote that case specifically so that a later fix could not quietly retire runtime field authoring. Option 2 is precisely the change that test exists to catch — so it must be retired deliberately and on the record, the way #5488 retired `gateApiDraftsForPublish` in the same change that flipped `api`.

### ⚠️ The `api` precedent: same mechanism, different justification

`api` hit this identical shape and was ruled by the maintainer on 2026-08-07 (#5488). Verbatim from `metadata-plugin.zod.ts`:

> *"`PUT /api/v1/meta/api/:name` answered 200 'Saved', and the endpoint was then NEVER SERVED — `GET` on its declared path 404s forever … a runtime write lands in `sys_metadata`, which is in neither. So `allowRuntimeCreate: true` declared a capability the runtime never had."*

Ruling: **Option B** — flip to `allowRuntimeCreate: false`, reject loudly through the #5086 inlet. Re-entry path recorded as *"implementation first, declaration second."*

**The mechanism transfers. The justification does not.** #5488 rested explicitly on **"zero business pull for Studio-authored runtime endpoints today."** "Add a field" is the opposite — a core Studio/CRM operation. Whoever rules on #7893 should not lean on #5488 without re-deciding pull on its own terms.

### Sequencing flag — applies to BOTH options

`PLURAL_TO_SINGULAR` is load-bearing on this path: `isRuntimeCreateAllowed`, `orgScopedWriteRefusal`, `mergesOverlayAtRead` and `codeOnlySourceHint` all normalize through it. I did not touch it, per the fence. But **both** options will reach it, so **#7894's cross-seat block with `domain:spec` (#6017) wants resolving *before* implementation starts, not after.**

---

## 5. Out-of-scope finding — NOT FILED (no API write access) — FULL TEXT

No issue number is cited, because it could not be filed and reading a number back was impossible. Full text for whoever can file it:

> **Title:** `_diagnostics.valid=true` and `editable`/`deletable` are asserted for metadata rows no consumer reads
>
> **Body:**
>
> Split from #7893. `GET /api/v1/meta/field/<object>.<name>` on a runtime-created field returns:
>
> ```json
> {"type":"field","name":"showcase_task.zz_probe",
>  "item":{"name":"zz_probe","label":"Probe","type":"text",
>          "_diagnostics":{"valid":true}},
>  "lock":"none","editable":true,"deletable":true}
> ```
>
> for a row that reaches no object's `fields`, and therefore no ObjectQL query, no physical column, and no `GET /meta/object/:name`.
>
> **`valid` is correctly computed and should NOT simply be flipped.** `computeMetadataDiagnostics` (`packages/metadata-protocol/src/metadata-diagnostics.ts`) resolves the type's Zod schema and `.safeParse()`s the document, so `valid: true` asserts *this document is well-formed* — which is true. The same function deliberately backs both the save path's 422 and the read path's diagnostics so that *"a document's verdict cannot depend on whether it was being saved or being opened."* That property is worth preserving.
>
> **The defect is that well-formed is the only axis the envelope has, and consumers read it as in-effect.** `MetadataValidationResult` already models a third state on a different axis — `computeMetadataDiagnostics` returns `undefined` when a type has no registered schema, and its contract requires callers to treat that as *"no opinion — not as 'valid'"*. There is no equivalent state for *"well-formed but consumed by nothing."*
>
> `lock` / `editable` / `deletable` compound the problem: they are computed elsewhere (not traced in this investigation) and positively advertise the row as a live, editable, deletable item.
>
> **Ask:** whichever way #7893 is decided, decide separately what a read-time diagnostic owes a caller about *effectivity*. If a type can persist rows that no read path consumes, the envelope should distinguish "well-formed" from "in effect", or state plainly that it does not model effectivity at all.
>
> This is the same false-compliance shape ADR-0049 forbids, one layer down from #7893 — **and it survives #7893 either way**: under option 1 it disappears for `field` but remains for any future fragment type; under option 2 the rows already written stay in `sys_metadata`, still reporting `valid: true`.
>
> **Reproduction:** rebuild the four-arm probe from `packages/runtime/src/meta-field-overlay-lock.test.ts`'s harness — `PUT /field/showcase_task.zz_probe`, then `GET` the same path. Read the body at **`body.data.item`**.

---

## 6. Reusable probe

The throwaway probe was **deleted, not committed** — pinning current behaviour without a ruling would pin the bug. Whoever implements the decision can rebuild it from `packages/runtime/src/meta-field-overlay-lock.test.ts`'s harness plus four arms:

| Arm | Assertion |
|---|---|
| **A** write half | `PUT /field/showcase_task.zz_probe` → 200, row persisted, `state=active` |
| **B** the defect | `GET /object/showcase_task` → `fields` excludes `zz_probe` … |
| **B** anti-vacuity | … **and includes** `title`, `status` — non-negotiable, see §1a |
| **C** contrast | `GET /object/runtime_thing` → 200, `fields:['note']` (note the §1d caveat) |
| **D** self-read | `GET /field/showcase_task.zz_probe` → 200, `_diagnostics.valid:true` |

Read the body at **`body.data.item.fields`**. Arms **B-anti-vacuity** and **C** carry the weight.

---

## 7. Verification of guardrails

- **#7743's refusal still fires.** `packages/runtime/src/meta-field-overlay-lock.test.ts` — **10/10 green**, file unmodified. Artifact-backed override still **403 `NOT_OVERRIDABLE`**. Nothing that PR closed has been reopened.
- **No reverse-verification table, deliberately.** There is no fix to revert; per-arm arms for a change never made would be fabrication. §1a is the measurement evidence in its place.
- **No gates run beyond the two suites above** — no changed source files, no changeset, so `check:type-check-debt` / `check:nul-bytes` / `check:empty-changeset` / eslint have nothing to judge. No ledger entry raised, no `--lower` used.
- **Repo state at handover:** working tree clean; `claude/issue-7893-field-write-inert` carries **no commits**; this branch carries **one commit containing only this file**.

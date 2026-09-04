# `beforeUpdate` same-key / per-row-value census — #14744

**Date:** 2026-09-04 · **Base:** `origin/main` `0e24b0c2c` (measured on the merge commit
`671f53ff3`) · **Scope:** measurement only — ships nothing, changes no shipped package's
behaviour, and implements no guard. This is the census triage scoped on #14744 (comment
[5518629055](https://github.com/objectstack-ai/objectstack/issues/14744#issuecomment-5518629055)),
whose output is the input to the write-shape decision that follows.

> **The terminal scope, verbatim (triage, comment 5518629055):** "Dispatchable scope, in
> `packages/objectql/**`: 1. Count the in-repo population of same-key / per-row-**value**
> `beforeUpdate` rewrites. Derive it programmatically; ⛔ do not hand-count and do not
> extrapolate from the three known row-invariant ones. 2. Measure whether the
> pre-image-read + payload-write provenance guard over-fires on the handlers that actually
> exist … ⛔ **Do not implement the guard, and do not change the write shape.** If your
> measurement says the guard is clean and cheap, that is a *finding to report*, not a
> licence to land it — the write-shape question is ADR territory either way."

⛔ Accordingly: no guard is implemented here, no write shape is changed, no ADR is opened
or amended, and `packages/objectql/src/engine.ts` and
`packages/objectql/src/multi-update-hook-key-divergence.ts` were read but not edited.

---

## Answer in one line

**The in-repo population of same-key / per-row-value `beforeUpdate` rewrites is ZERO**, out
of 23 production `beforeUpdate` registration sites, derived two independent ways that agree
on every subject and each carrying a firing positive control. **The candidate provenance
guard fires on 5 of those 23, and none of the 5 is an instance — a precision of 0/5 on the
population it would be shipped to catch.** The structural reason, and the census's main
finding for the decision: the guard's predicate conflates *reading the pre-image to decide
**whether** to write* with *reading it to compute **what** to write*, and only the second is
this residue. Every in-repo pre-image read is the first kind — and the first kind is
**already** caught by #14099's key-set refusal, because a per-row decision about whether to
write is exactly what makes key sets diverge. **On today's tree the guard would refuse only
batches #14099 already refuses, plus honest ones.** ⭐ A well-derived zero was named in
advance as a complete result; this is that zero, with the derivation and its blind spots
below.

---

## 1. The predicate — what counts as an instance, and how it is decided

"Same key, per-row value" is a property of a handler's *behaviour*, not of a syntactic
pattern, so the predicate is stated here to be argued with rather than left implicit in a
script.

A `beforeUpdate` handler is an **instance** iff, on one `multi: true` update matching two or
more rows:

| clause | | why it is in the predicate |
|---|---|---|
| (a) | it **writes** the payload (`ctx.input.data`) | a handler that only reads, or only throws, cannot move a `SET` clause |
| (b) | the **set of keys** it writes is the same for every row | if the key sets differ, #14099's refusal already catches it — that batch is not this residue |
| (c) | the **value** it writes for some key is derived from **per-row state** (`ctx.previous`, `ctx.input.id`, or anything carried from them) | this is the discriminating clause |

**Clause (c) deliberately excludes a value that varies per row because the handler read a
clock.** `sys_stamp_audit_update` writes a different `updated_at` for each row of an
entirely honest batch, and whichever row's copy the single `SET` clause carries is still
true. Refusing that is the non-deterministic failure that killed the value-comparison
variant twice on #14099; a census that scored it as an instance would be re-proposing the
rejected instrument under a new name.

Separating (c) from the clock is the whole difficulty, and the two instruments settle it
differently on purpose — one by **provenance** (static taint), one by **behaviour** (a
second batch in which the pre-images are equal, so any surviving value difference is not
attributable to the row).

---

## 2. Instrument A — static enumeration and classification

`scripts/audits/14744-before-update-per-row-value-census.mjs` (`node …`; `--self-test` runs
the controls).

**Why an AST walk and not grep.** Measured on this tree, a single-line
`git grep "registerHook('beforeUpdate'"` finds **14** call sites, while **46** further
`registerHook(` sites are multi-line, take the event through a variable, or are interface
declarations. A line-oriented census would have under-counted the population *by
construction* and reported a confident number. The walk reads the argument's **position**
in the syntax tree instead.

**Every parse is routed through `scripts/ts-parse.mjs`'s `parseSourceFile`, not
`ts.createSourceFile`.** A raw parse never throws — the errors are parked on
`parseDiagnostics` and the recovered tree walks like any other — so a file this census
could not read would be scored as a file with **no** `beforeUpdate` handlers and would
quietly lower the population. `pnpm check:parse-guard` caught exactly that in the first
draft of this instrument. Re-run through the checked parser the counts are **identical**,
and the run completes without refusal, which is the positive evidence that no file in the
walked roots went unread.

**Doors it enumerates:** `registerHook('beforeUpdate', …)`, `on('beforeUpdate', …)`, and
Hook-shaped object literals (`{ events: ['beforeUpdate'], handler }`) — the metadata shape
`bindHooksToEngine` binds and the shape objectql's own builtins use.

**Classification** is taint over a per-function alias lattice: payload and pre-image each
seed an alias set, the sets grow through local bindings, destructuring and `for…of`, and
they **propagate across calls**. That last part is load-bearing rather than a refinement —
`sys_stamp_audit_update` writes the payload only through
`stampData(hookCtx.input.data, …)` → `applyToRecord(record, …)`, so the first revision of
this script, which followed only the *context*, scored the single most important handler in
the population as "writes nothing". The correction is recorded because the same mistake is
available to any re-derivation.

### 2.1 Result — all 23 production sites

`writesPayload` 8 · `readsPreImage` 8 · `guardWouldFire` 5 · **`taintedWrite` (instance) 0** ·
unclassified 0 · payload wholesale-replacement 0.

| site | hook | writes payload | reads pre-image | guard fires | **instance** |
|---|---|:--:|:--:|:--:|:--:|
| `packages/objectql/src/plugin.ts:1137` | `sys_stamp_audit_update` | Y | n | – | no |
| `packages/plugins/plugin-approvals/src/lifecycle-hooks.ts:332` | (anon) | n | Y | – | no |
| `packages/plugins/plugin-approvals/src/lifecycle-hooks.ts:603` | (anon) | n | n | – | no |
| `packages/plugins/plugin-audit/src/audit-writers.ts:1457` | (anon) | n | n | – | no |
| `packages/plugins/plugin-audit/src/audit-writers.ts:1503` | (anon) | n | n | – | no |
| `packages/plugins/plugin-audit/src/comment-access-hooks.ts:446` | (anon) | n | Y | – | no |
| `packages/plugins/plugin-auth/src/identity-write-guard.ts:230` | (anon) | n | n | – | no |
| `packages/plugins/plugin-auth/src/last-admin-guard.ts:1574` | (anon) | n | n | – | no |
| `packages/plugins/plugin-auth/src/last-admin-guard.ts:1584` | (anon) | n | n | – | no |
| `packages/plugins/plugin-auth/src/last-admin-guard.ts:1594` | (anon) | n | n | – | no |
| `packages/plugins/plugin-auth/src/last-admin-guard.ts:1604` | (anon) | n | n | – | no |
| `packages/plugins/plugin-auth/src/last-admin-guard.ts:1609` | (anon) | n | n | – | no |
| `packages/plugins/plugin-auth/src/member-role-canonical.ts:268` | (anon) | Y | n | – | no |
| `packages/plugins/plugin-email/src/email-template-provenance.ts:54` | (anon) | Y | Y | **FIRES** | no |
| `packages/plugins/plugin-pinyin-search/src/companion-projection.ts:97` | (anon) | Y | n | – | no |
| `packages/plugins/plugin-sharing/src/rule-hooks.ts:257` | (anon) | n | n | – | no |
| `packages/plugins/plugin-sharing/src/rule-hooks.ts:355` | (anon) | n | n | – | no |
| `packages/plugins/plugin-sharing/src/sharing-rule-provenance.ts:42` | (anon) | Y | Y | **FIRES** | no |
| `packages/plugins/plugin-webhooks/src/webhook-provenance.ts:45` | (anon) | Y | Y | **FIRES** | no |
| `packages/services/service-storage/src/attachment-access-hooks.ts:346` | (anon) | n | Y | – | no |
| `packages/services/service-storage/src/file-reference-lifecycle.ts:696` | (anon) | Y | Y | **FIRES** | no |
| `examples/app-crm/src/hooks/opportunity.hook.ts:9` | `opportunity_stage_probability` | n | n | – | no |
| `examples/app-todo/src/objects/task.hook.ts:50` | `task_logic` | Y | Y | **FIRES** | no |

**The three rewrites #14099 measured are all here and all confirmed non-instances**, which
is the check that the instrument is pointed at the right population: the audit stamp writes
five keys and never reads the pre-image; the pinyin companion derives `__search` from the
**payload's own** values; service-storage's copy-on-claim reads the pre-image but writes no
per-row-derived value (§4.1 on why it cannot).

### 2.2 The controls — `--self-test`, 10/10

A zero is not a result without a firing positive control, and a predicate that is trivially
false is not a predicate. Both directions are pinned, and the suite fails if any two shapes
collapse into one:

```
PASS  POSITIVE — the card's own pinned residue (value from ctx.previous)
PASS  POSITIVE — value derived from the per-row id
PASS  POSITIVE — taint carried through a local binding
PASS  POSITIVE — taint across a helper handed payload AND pre-image
PASS  POSITIVE — Hook metadata literal door, not registerHook()
PASS  NEGATIVE — audit-stamp shape: writes via a payload-passing helper, clock value, no pre-image read
PASS  NEGATIVE — CONSTANT value gated on a pre-image read (the guard's over-fire shape)
PASS  NEGATIVE — reads the pre-image but never writes the payload (a pure guard)
PASS  NEGATIVE — writes a value derived only from the PAYLOAD (row-invariant)
PASS  CONTROL — a beforeInsert registration must not be counted at all  (sites=0, expected 0)

SELF-TEST PASSED — 10/10 cases
```

---

## 3. Instrument B — runtime behavioural probe on the real engine

`scripts/audits/14744-before-update-per-row-value-probe.mjs`
(`npx tsx … --out <path.json>`). It boots the real `ObjectQL` against a stub driver,
dispatches handlers per row of a genuine `multi: true` update, and reads what actually
reaches `driver.updateMany` — the one `SET` clause D3 gives N rows. **Four of its eight
subjects are the shipped handlers themselves, imported and dispatched unmodified**; the
audit stamp and the pinyin projection are labelled replicas, following the pin suite's own
convention (`multi-update-hook-key-divergence.test.ts` §3 replicates the stamp with
`perRowClockStamp()` rather than booting the plugin).

**Two scenarios per subject, and why two are needed.** A single batch whose rows disagree
cannot separate the residue from the clock: "same keys, different values" is equally
consistent with a value derived from the row and with a value that simply differs every time
it is computed. So each subject runs over rows that **disagree** on the pre-image field it
reads, and again over rows that **agree**. With the pre-images equal, any surviving value
difference is not attributable to the row.

The guard is evaluated as an **observer, never as enforcement**: each dispatch receives a
read-recording `Proxy` over its context, and the payload is handed back behind a
write-recording proxy, so `guardWouldFire` is a measured property of the shipped handler's
execution rather than a reading of its source. Nothing in the probe registers on, or alters,
the engine's behaviour.

### 3.1 Verdicts

| subject | real? | verdict | guard fires |
|---|:--:|---|:--:|
| POSITIVE CONTROL — the card's pinned residue | replica | **INSTANCE** | yes |
| `sys_stamp_audit_update` (clock in the per-record stamp) | replica | NONDETERMINISTIC | **no** |
| `examples/app-todo` `task_logic` | **real** | CAUGHT_BY_14099 | yes |
| plugin-email template provenance stamp | **real** | CAUGHT_BY_14099 | yes |
| plugin-sharing rule provenance stamp | **real** | CAUGHT_BY_14099 | yes |
| plugin-webhooks provenance stamp | **real** | CAUGHT_BY_14099 | yes |
| pinyin companion projection (value from the payload) | replica | ROW_INVARIANT | no |
| NEGATIVE CONTROL — reads the pre-image, never writes | replica | NOT_A_PAYLOAD_WRITER | no |

**Instances among real handlers: 0. Positive control: fires.**

### 3.2 The residue itself, reproduced end-to-end on current `main`

The positive control is not only a control — it is the card's defect, re-measured on the
real engine at this base:

```
dispatch a  derived {priority: 'high'}      ← row a's own pre-image says 'blocked'
dispatch b  derived {priority: 'low'}
SET clause  [{title: 'renamed', priority: 'low'}]      ← ONE payload, D3
stored      a → priority 'low'   b → priority 'low'    ← row a's own derivation discarded
```

Nothing errored and nothing was refused. This also **confirms the card's correction to the
#14099 ruling's prose**: the value that survives is the **last** dispatch's, not the first.

### 3.3 Where the two instruments disagree

**Nowhere, on any subject measured both ways.** Instrument A's `guardWouldFire` and
instrument B's measured `guardFires` agree on all six shapes common to both, A's
`taintedWrite = 0` matches B's `INSTANCE = 0` over the real handlers, and both flag the
positive control. The one production site A flags that B does not exercise is
service-storage copy-on-claim (§4.1) — B would need the storage service; it is resolved by
source reading instead, and that is recorded as a reading rather than a measurement.

⚠️ **Two instrument bugs were found and fixed while measuring, both of which had silently
changed a verdict.** They are recorded because each is available to any re-derivation: (1)
the observer originally recorded value *changes* rather than *assignments* — but the payload
is ONE object shared by every row's dispatch, so the second row assigning the same value it
found there produced no diff and was scored "wrote nothing", manufacturing a key-set
divergence out of a row-invariant handler; assignment is also exactly what #14099's own
recorder counts, so recording it keeps the instruments comparable. (2) An ESM-interop miss
on a default-exported Hook meant `task_logic` was never dispatched at all, and the subject
scored clean; the probe now resolves that import **by shape** and throws if no handler is
found, so the failure cannot present as a pass.

---

## 4. Deliverable 2 — does the provenance guard over-fire?

**Yes, on every in-repo handler it fires on: 5 of 5 flagged, 0 instances, precision 0/5.**
For the four measured at runtime the two scenarios say it precisely:

| handler | rows **disagree** | rows **agree** |
|---|---|---|
| plugin-email / plugin-sharing / plugin-webhooks provenance | engine already refuses — `MULTI_UPDATE_HOOK_KEY_DIVERGENCE`, `400`, `keys: ['customized']`, `rows: 2` | every row writes `customized: true`; `SET` clause is correct and honest — **the guard would refuse this** |
| `task_logic` | engine already refuses — same envelope, `keys: ['completed_date']`, `object: todo_task` | every row writes the same `completed_date`; batch honest — **the guard would refuse this** |

So in the disagreeing case the guard is **redundant** (#14099 refuses first, before any
write), and in the agreeing case it is a **pure false positive**. On this tree the guard
would not refuse a single batch that is actually corrupted.

### 4.1 The structural reason — the finding the decision should carry

Every in-repo pre-image read is a read *to decide **whether** to write*, never *to compute
**what** to write*:

- the three provenance stamps write the **constant** `true` (`customized`), gated on the
  row's `managed_by`;
- `task_logic` writes a **clock** or the constant `null`, gated on `previous.status`;
- copy-on-claim reads `ctx.input.id` only to distinguish the by-id path, and on a per-row
  dispatch it **refuses the batch itself** (`FileFieldBulkWriteError`, #7102) and then
  no-ops for every row after the first — it is structurally incapable of being an instance,
  and worth flagging as an existing in-tree precedent for handler-side refusal.

A whether-decision that differs between rows **is** a key-set divergence, which is what
#14099 already refuses. So the guard's extra reach over #14099 consists entirely of batches
in which every row made the same whether-decision — i.e. the honest ones.

⭐ **The corollary that matters for the write-shape decision:** the residue is not reachable
by *any* predicate over "which per-row state did the handler read", because the in-repo
population reads per-row state for a purpose that is already covered. Closing it needs a
statement about the *value's* provenance (which key the handler assigned *from* what), and
that is a different instrument from the one the card proposed — or it needs the write shape
to change, which is ADR-0058 Addendum II D3 and the human floor.

### 4.2 One thing the guard gets right, worth keeping on the record

The guard does **not** fire on `sys_stamp_audit_update` — the hook registered on `'*'` in
essentially every deployment, and the exact hook whose per-row clock reads killed the
value-comparison variant. Confirmed by both instruments (it never touches `ctx.previous` or
`ctx.input.id`). So the guard really is free of the measurement that sank value comparison;
its problem is precision on the population, not non-determinism.

---

## 5. Blind spots — what these numbers cannot see

⛔ Stated because "I counted N" without "here is what this count cannot see" is not a
measurement this card can use. The first three are enumerated by the instrument itself
(`blindSpots` in its JSON), not asserted here.

1. **Registrations whose event argument is not a string literal — 7 in production.** Each
   was read by hand: `engine.ts:13976` (the `on()` forwarding alias) and `plugin.ts:1225`
   (the builtins' `events[]` loop, already covered by the literal door) are doors, not
   handlers; `bu-tree-recompute.ts:301` and `sharing-plugin.ts:470` loop over
   `after*` events only. Two are real:
   - `webhook-headers-gate.ts:313` loops `['beforeInsert', 'beforeUpdate']` — **a
     `beforeUpdate` registration instrument A does not count.** Its handler is
     `assertWritableWebhookHeaders`, which throws or returns and never assigns to the
     payload, so it is a non-instance; the population figure is 23 counted + this one read
     by hand.
   - `record-change-trigger.ts:299` binds whatever `triggerTypeToHookEvents` returns, which
     **includes `beforeUpdate`** for the `record-before-update` and `record-before-write`
     trigger types. This is the one open door in the tree: the handler is generic and the
     behaviour belongs to **user-authored flow metadata**, which is not in this repo. On a
     source reading, `buildContext` materialises a *new* record object by overlay rather
     than handing the flow `ctx.input.data` by reference, so a flow bound this way does not
     reach the batch payload through that path — ⚠️ a reading, not a measurement; I did not
     exercise it at runtime, and #14758 (sandbox write-back) is the adjacent open question.
2. **Metadata-declared hooks are invisible to a syntax tree.** Hooks can arrive as stored
   `sys_metadata` rows or JSON/YAML object definitions and be bound at boot by
   `bindHooksToEngine`. The instrument swept every `.json`/`.yaml`/`.yml`/`.js`/`.mjs`/`.cjs`
   file in the repo for `beforeUpdate` and found only spec JSON-Schema artifacts and two QA
   checklist files — **no metadata-declared hook exists in-tree today** — but this says
   nothing about a deployment's stored metadata.
3. **Roots.** `packages/`, `examples/`, `apps/` were walked; a repo-wide sweep found **0**
   TypeScript files mentioning `beforeUpdate` outside them.
4. **One unresolved cross-file delegation**, `rule-hooks.ts:257` →
   `stashAffectedRows` (`bulk-recompute.ts:291`), resolved by hand: that file contains
   **zero** `input.data` writes, so it is not a payload writer.
5. **The taint analysis is intra-file.** A handler delegating to an *imported* helper is
   followed only within its own module; instrument A reports every such case rather than
   scoring it clean, and the only one that occurred is item 4.
6. **⛔ The largest blind spot is not in the tree at all.** #14099's confidence-gap note and
   this card both say the population may be entirely downstream, and this census cannot
   contradict that — it measures **this repository**. The `duly_task` corruption that
   motivated #14099 was measured against a *downstream* deployment. **A zero in-repo is not
   a zero in the field**, and §4.1's structural argument is about the handlers here, not
   about handlers a customer may write.

---

## 6. What the follow-on decision needs from this

- **Scale, in-repo: zero.** No shipped or example handler in this repository would be caught
  by closing this residue, so no in-repo migration cost attaches to any option, and the
  urgency has to come from downstream evidence rather than from this tree.
- **The proposed provenance guard is measured and it does not work on this population** —
  0/5 precision, redundant with #14099 where it is right and false-positive where it is not.
  ⛔ It is not implemented here, per the card's terminal scope; this is the finding, not a
  licence.
- **The three known rewrites remain non-instances**, confirmed programmatically rather than
  assumed from #14099.
- **An existing precedent for handler-side refusal is in the tree**: service-storage's
  `FileFieldBulkWriteError` (#7102) refuses exactly this hazard for its own surface, from
  inside the handler, without the engine splitting any write. Whatever the decision, that
  shape is prior art worth reading — it is the only in-repo code that already closes the
  residue for the surface it owns.

---

_Generated by [Claude Code](https://claude.ai/code)_

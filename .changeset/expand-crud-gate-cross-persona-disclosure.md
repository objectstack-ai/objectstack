---
"@objectstack/plugin-security": patch
---

fix(security): `$expand` no longer discloses records the caller is 403'd from — the #2850 expand waiver is removed (#7626)

A **low-privilege authenticated user could read records they are explicitly
denied**, through the `$expand` seam. Measured on the running showcase app with a
`contributor`-only session:

- `GET /api/v1/data/showcase_contact/<id>` → **403 PERMISSION_DENIED**;
- same session, `GET /api/v1/data/showcase_invoice?$expand=contact` on an invoice
  it owns → **200 with that contact fully materialised**, all 18 fields including
  `email`, byte-identical to the admin's response;
- the body door (`POST …/query` with a nested `expand`) behaved the same.

`showcase_contact` declares `sharingModel: 'private'` and the row was
admin-owned, so both the object-level CRUD gate and the OWD row scope were
bypassed. RLS on the DIRECT path was never affected and is unchanged.

**Root cause.** #2850 correctly routed the engine's expand path back through the
security middleware (tagging the sub-read `__expandRead`), which is what put the
referenced object's RLS + FLS on an expansion at all. It also added a relaxation:

```ts
operation === 'find' && __expandRead && !secMeta.isPrivate  // → skip CRUD + requiredPermissions
```

justified as "a PUBLIC referenced object is already broadly readable via the `'*'`
wildcard grant, so gating the expansion adds no protection". Neither half held:

1. `secMeta.isPrivate` is derived from `access.default` (ADR-0066 D2 — whether a
   `'*'` wildcard COVERS the object), a **different axis** from the `sharingModel`
   OWD that scopes an object's ROWS. An object that leaves `access` unset — nearly
   all of them, `showcase_contact` included — read as "public", so the waiver
   fired for it.
2. "already broadly readable" was never **checked**. The condition asks nothing
   about the caller's grants, so it fired hardest for the caller holding none —
   #2850's own unit pin waives the gate for a permission set with `objects: {}`.
   Where the premise is true the waiver is inert (the CRUD gate would pass
   anyway); its only non-vacuous effect was on callers the gate meant to refuse.

The OWD half followed from the same skip: `getEffectiveScope` answers `'org'` when
no set grants the operation — safe only because such a caller is denied
separately — so waiving the denial also stamped `__readScope: 'org'` and dissolved
plugin-sharing's owner filter.

**Fix.** The waiver is deleted; both throw-gates now run for every referenced
object. One rule, public and private alike — the rule #2850 already applied to its
private half: *an expansion may reveal only rows the caller could have read
directly.* Nothing over-blocks a legitimate lookup: `expandRelatedRecords` already
catches a refused sub-read and retains the bare FK id, so the parent read still
returns 200 with the id it had. `__expandRead` itself stays — it is the marker the
storage/comment access hooks strip as a privileged widening input, and `core`'s
operation-private-keys list is what keeps it unforgeable from the wire.

**Regression proof.** `packages/qa/dogfood/test/showcase-expand-crud-gate.dogfood.test.ts`
drives the live HTTP stack with **two real sessions** — admin sees the expansion,
the `contributor`-only persona must not — across all three expand doors
(query-string `$expand` on list and by-id, body `expand`), and carries the
over-correction guard: the contributor's foreign-invoice query still returns
200 with 0 rows, and a lookup they DO hold a grant on still expands. The unit
pins in `security-plugin.test.ts` are re-aimed but deliberately are not the
regression story: an `__expandRead`-wiring assertion is the exact shape that
stayed green for the whole life of this disclosure.

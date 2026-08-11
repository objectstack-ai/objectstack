# Follow-ups — open items from the capability-coverage sweep (2026-08-08)

Decision register from the capability-coverage sweep. The gap items found by the
five-angle sweep have all been authored into `areas/*.json` (checklist grew 84 → 170
items; the `api`/`datasource`/`mapping` coverage waivers were corrected). What remains
here is what the sweep surfaced that is **not** a checklist item: product defects to
decide on, and docs that promise retired capabilities.

## 1. Product defects found during the sweep (decide handling)

These are real runtime/UI defects the gap hunters hit while grounding items. Each is
captured inside the relevant checklist item as an **expected-fail probe** (so a run
records the actual behavior instead of ticking green), but they are defects, not test
gaps. The one security-sensitive finding (D1) has since been fixed in #6683.

| # | defect | evidence | captured in | sensitivity |
|---|---|---|---|---|
| D1 | **Saved-report schedule routes now owner-gated** — the schedule delete/list routes were brought under the same parent-report owner check as the other report routes (deny-as-404). | packages/plugins/plugin-reports/src/report-service.ts | dashboards.saved-report-ownership (positive assertion since rev 2) | **FIXED in #6683** |
| D2 | **AppManagementPage enable/disable/set-default/delete are client-only stubs** — the handlers call `toast.success()` with a `TODO: Replace with real API call` and issue no request; an admin sees "success" while nothing changes. | objectui apps/console/src/pages/system/AppManagementPage.tsx | platform-core.app-management-toggle (expected-fail probe) | UX-integrity — safe to file |
| D3 | **`useGlobalUndo.executeOp` issues a bare `ds.update` with no `ifMatch`** — record undo can silently clobber a concurrent edit (no OCC guard on the undo path). | objectui react/src/hooks/useGlobalUndo.ts | records-forms.record-edit-undo (observe-and-flag clause) | correctness — safe to file |
| D4 | **`SharedViewLink` builds dead `/share/<object>/<view>?token=` URLs** — client-generated token, no matching console route (only `/s/:token`), no server persistence. Registered but unused. | objectui plugin-view/src/SharedViewLink.tsx | — (not an item; demo-grade) | low — file a cleanup issue |
| D5 | **List "Share" button is a no-op** — renders when `schema.sharing` is set but has no onClick. | objectui plugin-list/src/ListView.tsx | — | low — file a cleanup issue |
| D6 | **`/api/v1/datasources` admin CRUD has no route ledger** — mounted by serve.ts, absent from rest-route-ledger.ts (tranche-3 discipline gap). | packages/services/service-datasource/src/admin-routes.ts | integration-system.datasource-admin-lifecycle (source note) | low — internal discipline |
| D7 | **Parent-only PATCH does not revalidate a stale dependent child** — `evaluateOptionVisibility` skips fields absent from the payload, so changing only the parent leaves a now-invalid child value in place server-side; integrity rests entirely on the client clear. | packages/objectql/src/validation/rule-validator.ts (`!(name in data) continue`) | records-forms.cascading-multilevel-and-clear (knownGap) | integrity — safe to file |
| D8 | **Lookup cascade scope is existence-only server-side** — `assertReferencesResolve` accepts any EXISTING id regardless of `lookupFilters` scope (a cross-account contact that exists is accepted on direct POST). May be by-design (filters = UI courtesy) — needs a maintainer ruling: declared ≠ enforced, or documented courtesy. | packages/objectql/src/engine.ts (assertReferencesResolve) | records-forms.cascading-multilevel-and-clear (knownGap) | integrity/design — needs ruling |
| D9 | **`expand` discloses a record the caller is 403'd from reading** — the `#2850` expand waiver keys on the wrong axis, so it fires for *every* referenced object including ones the caller holds no grant on. | packages/plugins/plugin-security/src/security-plugin.ts (`expandSkipCrud`) | api-backend.query-contract-matrix clause 4 | **SECURITY — write-up below (§1a)** |
| D10 | **Encrypted settings are echoed in plaintext on read** — storage is correct (`sys_secret`, aes-256-gcm) but the REST read decrypts and returns the secret verbatim, and repeats it in `cascadeChain`. | packages/services/service-settings/src/{settings-service.ts,settings-routes.ts} | platform-core.settings-hub-roundtrip clause 7 | **SECURITY (admin-gated) — write-up below (§1a)** |
| D11 | **By-id WRITE is not gated by record visibility** — a low-privilege user PATCHes records they cannot read (404 by id, absent from list) on three objects. Two conformance rows claim this is `enforced`. | packages/plugins/plugin-security/src/security-plugin.ts (by-id write pre-image gate, `assertControlledByParentWrite`) | access-security.rls-both-sides c5 + owd-sharing-matrix c4 (one cause, two items) | **SECURITY — write-up below (§1a)** |
| D12 | **Webhook HMAC signing secrets persisted in cleartext** — every `sys_http_delivery` row stores the subscriber's signing key verbatim, readable over the ordinary data API; the sibling datasource path splits its secret out correctly. | packages/plugins/plugin-webhooks (`sys_http_delivery.signing_secret`, outbox writer) | integration-system.webhook-lifecycle (adjacent observation, held back from the run card) | **SECURITY (admin-gated) — write-up below (§1a)** |

### §1a — Security-sensitive write-ups (delivered 2026-08-11, per the maintainer ruling on #7463)

Held out of the public run cards (#7463, #7514) pending a disclosure decision, and delivered
here on the D1 precedent. Both were found by real runs against a live server; neither is
reachable from a unit test, which is why both pins stayed green.

#### D9 — `expand` bypasses the CRUD gate and the OWD scope on the sub-read

**Impact.** A low-privilege authenticated user reads records they are explicitly denied.
Not an admin-only weakness: the probing persona held only the `contributor` position.

**Reproduction (2/2).** As a user holding only `contributor`:
1. `GET /api/v1/data/showcase_contact/<contactId>` → **403 PERMISSION_DENIED**
   (`operation 'findOne' on object 'showcase_contact' is not permitted for positions
   [org_member, contributor, everyone]`).
2. Same session, on an invoice **they own** that references that contact:
   `GET /api/v1/data/showcase_invoice?$expand=contact` → **200 with the contact fully
   materialised** — all 18 fields including `email` — **byte-identical to the admin's
   response** (`JSON.stringify` equality true).
3. Also via the body form: `POST /api/v1/data/showcase_invoice/query`
   `{"expand":{"contact":{"object":"showcase_contact","fields":["id","name"]}}}`.

`showcase_contact` is `sharingModel:'private'` and the row is admin-owned, so **both** the
CRUD gate and the OWD row scope were bypassed on the expand sub-read. RLS on the *direct*
path still works (a contributor's query for a foreign invoice returns 200 with 0 rows), so
this is specific to the expand seam.

**Root cause (located).** `expandSkipCrud = operation === 'find' && context.__expandRead && !secMeta.isPrivate`,
where `secMeta.isPrivate` reads `obj.access?.default === 'private'`. That is a **different
axis** from `sharingModel`, and `access` is `null` for every object in the built artifact —
so the waiver fires for every referenced object, including ones the caller holds no grant
on. The waiver's premise ("already broadly readable") does not hold.

**Why the pin didn't catch it.** The `#2850` unit pin asserts only that the sub-read
re-enters `find()` tagged `__expandRead`; it never asserts the end-to-end authorization
outcome, so it passes while the live server discloses.

**Suggested shape of a fix (not prescriptive).** Either evaluate the waiver against the
same axis the object actually declares (`sharingModel`), or drop the waiver and let the
sub-read carry the caller's context through the normal gate. Any fix wants an end-to-end
both-personas assertion, not a re-tagged unit pin.

#### D10 — `GET /api/settings/:namespace` returns the plaintext of encrypted specifiers

**Impact.** Stored credentials (SMTP password, API keys) are readable back over the API by
any caller holding `setup.access`. Admin-gated (anonymous → 403), so this is a
defense-in-depth failure rather than a privilege escalation — but it defeats the point of
encrypting them at rest.

**Reproduction (2/2, on both specifier flavours).** Write a secret through
`PUT /api/settings/mail`, then observe the split:
- **Storage is correct** — `sys_setting` row has `value: null`, `encrypted: true`,
  `value_enc: 'sec_<hex>'`, and the matching `sys_secret` row holds the aes-256-gcm
  ciphertext (`kms_key_id: 'local:v1'`, `alg: 'aes-256-gcm'`).
- **The read echoes it** — `GET /api/settings/mail` returns the written plaintext in
  `values.<key>.value`, and repeats it inside every `cascadeChain` entry.

Affects both `type: 'password'` and `encrypted: true` specifiers.

**Root cause (located).** `settings-service.ts materialiseRow()` dereferences `sec_` handles
and **decrypts** to plaintext; `getNamespace()` copies that plaintext into every cascade
entry; `settings-routes.ts` applies **no redaction** on the way out. The service-layer
round-trip is deliberately pinned (`settings-service.test.ts`: *"Round-trip read returns the
plaintext"*), so the missing boundary is the **REST read**, not the service.

**Suggested shape of a fix (not prescriptive).** Redact at the route: return a set-flag /
masked marker instead of the value for any specifier that is `encrypted` or
`type: 'password'`, and scrub `cascadeChain` the same way. If some internal caller genuinely
needs the plaintext, that should be an explicit service-layer call, not the namespace read
the settings UI uses.

#### D12 — Webhook HMAC signing secrets are persisted in cleartext on every delivery row

**Impact.** The shared secret that authenticates ObjectStack to a webhook receiver is stored
verbatim, per delivery attempt, in a table that is readable over the ordinary data API. Anyone
who can read `sys_http_delivery` can recover the signing key for every subscriber and mint
payloads the receiver will accept as genuine — the signature is the receiver's *only* proof of
origin. Admin-gated on this deployment (defense-in-depth, like D10, not privilege escalation),
but the blast radius is external: it compromises the trust boundary at systems ObjectStack does
not control, and rotating it means re-coordinating with every receiver operator.

**Found by.** The `integration-system.webhook-lifecycle` run, as an adjacent observation while
verifying HMAC correctness — the runner recomputed
`HMAC-SHA256(raw body, <secret>)` against the delivered `x-objectstack-signature` (exact match,
so signing itself is correct) and then noticed the secret it had authored came back verbatim
from an ordinary admin read of the delivery table. Reproduced within that run; **not** filed on
the public run card, deliberately.

**Located.** `sys_http_delivery` carries the secret as a plain column alongside `headers_json`;
the outbox writer persists it with the attempt rather than resolving it at send time. Contrast
with the platform's own established pattern: `sys_setting` stores a `sec_` handle and keeps the
ciphertext in `sys_secret` (aes-256-gcm) — the machinery to avoid this already exists and is
used elsewhere. Note the same run proved the *datasource* admin path gets this right: an inline
`secret` on `POST /api/v1/datasources` is split out server-side and a byte-level scan of every
table/column of the running DB found **no** occurrence of it. So this is an inconsistency
between two sibling subsystems, not a missing capability.

**Suggested shape of a fix (not prescriptive).** Store a handle rather than the value on the
delivery row and resolve it at send time, matching the `sys_setting`/`sys_secret` split; failing
that, at minimum keep it off the delivery record entirely (it belongs to the subscriber, not to
each attempt) and exclude the column from the data-API projection. Worth checking whether any
other outbox/delivery table copies a credential the same way.

**Verification note.** The webhook item itself is otherwise clean and passes — signature
computation, custom headers, per-attempt durability, timeout enforcement and the retry ladder
were all proven correct. This finding does not change that verdict.

## 2. Docs promise capabilities the runtime doesn't deliver (PD#10, docs side — file docs issues)

The capability docs advertise features that were retired or never shipped. Under Prime
Directive #10 ("never advertise a capability the runtime doesn't deliver") these are
docs bugs, not checklist items.

- **Recycle bin / soft delete** — promised in `content/docs/capabilities/{data,integrations}.mdx`,
  but `enable.trash` was RETIRED ("every delete has always been a hard delete; soft delete
  parked at #3146", object.zod.ts retired-key guidance). → fix docs or ship the feature.
- **Recently-visited lists** — `enable.mru` retired/never implemented. The console DOES ship a
  recents rail (UnifiedSidebar) — reconcile whether the doc claim maps to that surface or a dead one.
- **TV display pages / discussion threads** — promised (analytics.mdx, build-without-code.mdx).
  Discussion = the real chatter surface (now covered by records-forms.record-discussion-mentions);
  display pages have no spec surface found → confirm removal or file.
- **Five data-depth scopes** (permissions.mdx) — `own_and_reports`/`unit`/`unit_and_below` are
  ENTERPRISE (hierarchy-security). The open checklist correctly drives own/org only. Optional both-sides
  probe: authoring an intermediate depth in the open edition must degrade LOUDLY (ADR-0049), not
  silently to `own` — could become a checklist item if you want it.

## 3. Fixtures worth adding (would un-block currently-blocked items)

The 8 `blocked` items are blocked on missing stock fixtures, not on the platform. Adding
these to the showcase would make them runnable:

- a `publicSharing.enabled` object → unblocks `access-security.share-link-capability-tokens`.
- one configured OIDC/social IdP → unblocks `identity-auth.oauth-app-consent-loop`,
  `linked-accounts-social`, and the existing `sso-enforced-first-paint`.
- a gantt view with `dependenciesField` + `lockField` + `parentField` → unblocks the
  fixture-gated variants of `records-forms.gantt-interactions`.
- a not-auto-bound audience suggestion → unblocks the confirm/dismiss half of
  `access-security.suggested-binding-loop`.
- the `IMPORT_CONSOLE_LIVE` import-harness backend → unblocks `records-forms.import-job-undo-cancel`.
- an approval-escalation clock-control/`runEscalations()` harness → unblocks `approvals.sla-escalation`.
- a second signed-up (non-admin) user in seeds, or a documented sign-up step in the runner →
  removes the recurring "needs a 2nd user" knownGap on several persona-gated items.

## 4. Notes

- `PENDING-GAPS.md` (the full deduped gap register that drove the authoring) can be deleted
  once you've reviewed §1–§2 above — it was scaffolding; this file is the durable residue.
- The checklist itself (`areas/*.json`, `coverage.json`, `README.md`, `RUNNER.md`,
  `scripts/check-platform-checklist.mjs`) ships in this branch; this file carries the
  decisions that remain with the maintainer.

#### D11 — a by-id write is not gated by record visibility ("you can't mutate what you can't see" is not enforced)

**Impact.** An authenticated **low-privilege** user modifies records they cannot read.
Not admin-only, not owner-only: the probing persona held the ordinary `showcase_contributor`
set. Reproduced on **three objects** (`showcase_invoice`, `showcase_invoice_line`,
`showcase_task`), twice each on fresh rows. This is the strongest finding of the sweep.

**Reproduction (2/2 per object).** Provision two contributor personas C1 and C2 (sign-up +
`sys_user_permission_set` showcase_contributor + `sys_user_position` `contributor`, then
re-sign-in so the session carries the position).

1. As **C1**: create an invoice (`owner` = C1) and a line under it.
2. As **C2** — the read side is CORRECT:
   - `GET /api/v1/data/showcase_invoice_line/<lineId>` -> **404 RECORD_NOT_FOUND**
   - `GET /api/v1/data/showcase_invoice_line?$top=300` -> the line is **absent** (n=0)
3. As **C2** — the write side is NOT:
   - `PATCH /api/v1/data/showcase_invoice_line/<lineId>` `{"description":"C2-FORGED","quantity":999,"unit_price":12345}`
     -> **200**, and an admin re-read shows the forged values persisted.
   - Same shape on the master: C2 `GET` the invoice -> 404, C2 `PATCH` it -> **200 persisted**.
   - Same shape on `showcase_task`: C2 `GET` by id -> 404 / list empty, C2 `PATCH` -> **200 persisted**.

`DELETE` is correctly refused (403 — no delete bit), so only the **write** half is open.

**Root cause (located).** The by-id write pre-image gate composes the RLS filter for the
**UPDATE** operation and documents itself as skipped when that returns null. The showcase
authors its contributor narrowing as `operation: 'select'` rules only (`task_own_rows`,
`invoice_own_rows`), so there is **no update-scope predicate** and no read-visibility
requirement is imposed on the by-id UPDATE path. The OWD is `public_read_write`, so
`resolveSharingCanEdit` also returns true. For `showcase_invoice_line`
(`controlled_by_parent`), `assertControlledByParentWrite` then derives the detail's write
access from that same permissive master verdict.

**The platform's own explain engine states the split**, which is the cleanest confirmation:
- `POST /api/v1/security/explain {object:'showcase_invoice', operation:'read', userId:<C2>}`
  -> rls layer **"narrows — Row-level security narrows the row set"**
- the same call with `operation:'update'` -> rls layer **"not_applicable — No RLS policy applies"**

**Why nothing caught it.**
- `verify --rls` (`runRlsProofs`) reports **0 HOLES**, but its member probe holds **no object
  grants**, so every such probe is masked by the object-level gate (403) before record scope
  is ever reached. A second probe persona holding object read+edit but **outside** the record
  scope would catch this class. Separately, a `showcase_account` auto-record 400 cascades into
  5 downstream skips, so 8 of 23 objects are skipped on a stock run — and a skip is exactly
  where this hid.
- `authz-conformance.matrix.ts` marks **both** `rls-by-id-write` (#1994) and
  `controlled-by-parent` as `state: 'enforced'`. Neither holds as shipped.
- `examples/app-showcase/src/security/permission-sets.ts` comments that a contributor "can
  by-id read/write a line only when they can read/write its master" — also false as shipped.

**Suggested shape of a fix (not prescriptive).** Either the platform requires a by-id write
target to be inside the caller's **readable** set (deriving a write scope from select-only
rules when no update rule is authored), or the showcase authors `operation: 'update'` RLS on
`showcase_invoice` and `showcase_task`. The platform-side fix is the one that generalises —
any app authoring select-only narrowing has this shape today. Whichever is chosen, the
regression guard wants a **second probe persona holding the object grants but outside the
record scope**; the current proof structurally cannot fail.

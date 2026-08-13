---
"@objectstack/plugin-security": minor
---

feat(security): a tenant-scoped write with no active organization is refused, naming what is missing (ADR-0123 D2, #8247/#8208)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes changes: no spec key, export or config field is removed or renamed, and no stored shape is affected. The behaviour change is entirely runtime — an authenticated caller in a state that used to corrupt silently now gets a refusal. There is no metadata edit to prescribe, so there is nothing an upgrade guide or `objectstack migrate meta` could carry. -->

**BREAKING** for one caller state, in the direction of refusing what used to
corrupt silently: an authenticated, non-system caller with **no active
organization** writing to a tenant-scoped object under a walled tenancy posture
(`isolated` / `group`) now receives `403 PERMISSION_DENIED` instead of a `2xx`.

### What was happening

The Layer 0 write-side wall validated **supplied** `organization_id` values
only. That is the correct guard for a payload naming *another* tenant, and it
left the opposite case open: a payload naming *no* tenant, written by a caller
who *has* no tenant. Nothing filled it downstream either — auto-stamping lives
in the enterprise organizations runtime and has nothing to stamp when the caller
carries no active organization.

So the row landed with `organization_id` NULL, and the read wall — correctly,
by the same posture — then hid it from every reader, including the author who
had just created it. A write that succeeds and a record nobody can reach.

### The rule now (ADR-0123)

Under an authenticated session with no active organization:

- tenant-scoped **reads resolve to nothing** (Layer 0's deny sentinel —
  unchanged, silent, HTTP 200);
- tenant-scoped **`insert` / `update` are refused loudly**, and the message
  **names the missing active organization** rather than reading as a generic
  permission denial;
- no path stamps a NULL tenant on behalf of an authenticated caller.

`delete` is deliberately unaffected: it places no row and decides no tenant, so
its target is selected through the Layer 0 row wall, which already resolves to
nothing under this state.

### Who is unaffected

Reads. System contexts (boot seeding, reconcilers, backfills, imports). True
platform operators on a posture-permitting object (ADR-0095 D3) — and only
there: the same operator on an ordinary business tenant object meets the wall
like anyone else. The `single` posture, where there is no wall at all. Objects
that opted out of tenancy or carry no `organization_id` column. Federated
objects whose tenant anchor is a phantom. Under `group`, a caller with a
non-empty membership set is fully scoped and unaffected even with no active
organization, because membership — not the active organization — is that
posture's scope.

### If you hit the refusal

The caller genuinely has no organization to write into. Give them a membership
(or an active organization selection) and retry; the refusal names this so it is
not mistaken for a permission-set problem. Deployments that reached this state
at sign-up are additionally addressed by the membership-ordering fix in
`@objectstack/plugin-auth`, which settles the membership before the first
session mints.

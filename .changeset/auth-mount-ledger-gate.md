---
"@objectstack/plugin-auth": patch
---

A `rawApp` mount under the auth `basePath` with no ledger row now fails a gate (#10534 follow-up 4)

`auth-plugin.ts` mounts routes **directly on the raw Hono app, ahead of the
better-auth catch-all**. The catch-all never sees them, so the vendor's own
route table cannot account for them, and `auth.api`'s enumeration — which is
what `auth-route-ledger.conformance.test.ts` drives — cannot see them either. A
mount with no row in either half of the ledger was therefore invisible to every
check in this tree. That is not hypothetical: it is what produced #9941
(`organization/add-member` mounted, ledgered nowhere) and #10050 (the same route
mounted and undocumented), and the #10534 census found it was not a one-off —
**nine of the seventeen mounts were in neither half**.

The pin the conformance suite already carries asserts the `source: 'objectstack'`
set exactly, so it fails when a row **disappears**. What it structurally cannot
do is fail when a **mount appears** with no row, because *both* of its sides are
hand-written: the mount list in that assertion is a copy of the truth, not a
reading of it, and nobody who adds route 18 has to touch it.

`pnpm check:auth-mount-ledger` (`scripts/check-auth-mount-ledger.mjs`) supplies
the missing half. It enumerates the mounts from `auth-plugin.ts` **source** and
diffs them against both halves of the ledger. No runtime surface is added and no
route's mounting, behaviour or accept/reject set changes.

Four properties it is built to, each measured rather than assumed:

- **The match carries a right boundary.** Accounting is exact string equality on
  `METHOD /full/wire/path`. #10534's own census read "5 undocumented" when the
  truth was 6, because it matched by substring and `/admin/sso/register` is a
  strict prefix of `/admin/sso/register-saml` — the shorter route was scored
  accounted-for on the strength of its longer sibling's URL. When an unaccounted
  mount does stand in a prefix relation to a ledgered route, the failure text
  **says so**, so the property is observable in the output rather than implicit
  in a comparison operator.
- **`rawApp.all` and `rawApp.use` are excluded.** The better-auth catch-all is an
  `.all()` and the IP gate is a `.use()`; both would otherwise read as unledgered
  mounts. They are the lanes routes arrive through, not routes.
- **A row alone does not satisfy it.** A disposition cannot be inferred
  mechanically, and a gate that accepts a pasted row teaches the next author to
  paste a row. An `source: 'objectstack'` row must carry the evidence its
  disposition claims: `client:` for `sdk`, a substantive `note:` for
  `server-only`/`disabled`/`public`. The failure text names the peer-group
  discriminator and the `set-initial-password` precedent, and offers
  `PENDING_DISPOSITION` — with an issue number — as the honest answer for
  "undecided", instead of the nearest allowed word.
- **A partial read is never reported as a complete one.** Any `rawApp` mounting
  form the census cannot read per-route (an unrecognised verb such as
  `rawApp.on(...)`, a non-literal path, an unresolved interpolation) is a
  finding. A missing file, a moved anchor, an underivable `basePath` or a parse
  that yields zero of anything exits **2** and prints `NOT MEASURED`.

On `bbe643c08` the gate is green: 17 mounts, 12 accounted for by a reviewed
ledger row, 4 shadowing a vendor-declared path, and one —
`POST /api/v1/auth/set-initial-password` — declared in `PENDING_DISPOSITION`
against #10975, printed on every clean run so the open question stays visible.
That list is a shrink-only ratchet; #10975 landing deletes the entry, and the
gate then fails if it is still there.

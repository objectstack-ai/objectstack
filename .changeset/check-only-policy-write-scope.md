---
"@objectstack/plugin-security": patch
---

fix(plugin-security): a `check`-only write policy no longer disables both write-side row gates — a caller who cannot read a record could write it by id (#8059)

**The exposure, measured on the shipped showcase.** A persona holding the plain
`contributor` position got `GET /data/showcase_invoice/:id` → **404** — the app's
`invoice_own_rows` narrowing correctly hid an invoice it does not own — and
`PATCH /data/showcase_invoice/:id` → **200, with the row actually changed**
(confirmed by re-reading it as an admin). Same on `showcase_invoice_line`, which
derives its access from that invoice via `controlled_by_parent`. **A caller who
could not read a record could write it by id**, including reassigning its owner
to themselves. That is the #1994 class ("you cannot mutate what you cannot see"),
still open for this authoring shape one issue after #7665 closed it for the
select-only shape.

It is not showcase-specific. Any app that authors a `using` narrowing for a
position **plus any update-class policy — even one that only validates the
post-image** — lost by-id write scoping on that object. The showcase is the
shipped example of the recommended authoring style, so this is the shape apps are
being taught to write.

**One authoring shape switched off both belts, which is why both are fixed here.**
The showcase's `invoice_owner_immutable` is `operation: 'update'` with a `check`
clause and no `using`:

- **The row gate never derived a scope.** #7665's write-visibility floor derives
  a write scope from the caller's SELECT narrowing when no policy of the write
  class applies, but it tested whether the applicable set was *empty*. A
  check-only policy is fully applicable — object, `positions` and operation all
  match — so the set was non-empty and the derivation was skipped, while the
  policy itself compiled to no row filter at all, having no `using` for the
  compiler to read. Layer 1 was null and every write-side row gate composed from
  it was a no-op again: the by-id pre-image gate, the `controlled_by_parent`
  master check, and the bulk-write AST injection. The trigger now asks whether a
  write-scope **predicate** applies, which is what #7665's criterion says — a
  `check` clause is post-image validation (ADR-0058 D4), not a scope predicate.
- **The post-image check was dropped for every caller.** `computeWriteCheckFilter`
  did not pass the caller's held positions, so the ADR-0090 P2 applicability
  domain was evaluated against an empty list and **every policy declaring
  `positions` was filtered out of the check** — for holders and non-holders
  alike. A position-scoped `check` clause was inert (ADR-0049
  enforce-or-remove), so the write was not stopped on the way out either.
  Positions are now threaded through, and the domain still decides: a policy
  scoped to a position a caller does not hold still does not apply to them.

**Also fixed, as a direct consequence of the first site.**
`checkAuthoredRowWrite` — the by-id widener's "does an app-authored policy admit
this row?" probe — reached its `abstain` verdict for check-only policies only
because Layer 1 happened to be null. With a scope now derived in exactly that
case, the derived readable-set scope would have started answering `admit`, which
widens. The probe now requires an authored policy that actually declares a row
scope, so a derived scope still cannot masquerade as an authored admission
(#5493 / #7281). This preserves the previous verdict rather than changing it.

**Unaffected:** an object that authors a real update-scope `using` predicate
keeps deciding by it alone, in both directions, and the read-side superuser
bypass and platform ownership floor paths are untouched. In-scope writes by
legitimate holders still land.

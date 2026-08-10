# #7281 — reverse-verification predictions, written BEFORE the first producer mutation

Branch point: d53bd0ba9bbe603632e6e9f55c2f202f06a7d541 (origin/main, 2026-08-10 08:53:15 +0000)

Re-derived anchors at that SHA:
- packages/plugins/plugin-security/src/security-plugin.ts:749/:754 — service registration of `checkAuthoredRowWrite` (triage anchor, still holds)
- packages/plugins/plugin-security/src/security-plugin.ts:2660 — `async checkAuthoredRowWrite(...)`
- packages/plugins/plugin-security/src/security-plugin.ts:2703-2705 — `parts` + the caller-context `findOne` (the defect)
- packages/plugins/plugin-security/src/security-plugin.ts:1301-1306 — the by-id write PRE-IMAGE gate, `findOne(..., context: opCtx.context)` (caller context too)
- packages/plugins/plugin-sharing/src/sharing-plugin.ts:933-939 — the deferral consumption (`probeAuthoredRowWrite` -> admit -> next())
- packages/plugins/plugin-security/src/row-write-widener-composition.test.ts:521 — the fake-engine `resolves.toBe('admit')`

## The planned mutation

`checkAuthoredRowWrite`'s probe read moves from the caller's own execution context
to an elevated (`isSystem`) context, projected to `['id']`. Layer 0 (tenant wall)
and Layer 1 (authored predicate) stay AND-ed into the `where` — they are the
predicate, not the read scope, so the tenant wall does NOT move.

## Predictions (direction decided before running)

P1  probe_note (public_read), cross-owner row the widener admits, verdict:
    admit BEFORE, admit AFTER. (no change — buildReadFilter returns null on non-private)
P2  probe_secret (private), SAME row shape, SAME widener, SAME principal, verdict:
    **abstain BEFORE, admit AFTER**  <= the red/green pin
P3  probe_secret, the caller's OWN admitted row, verdict:
    admit BEFORE, admit AFTER (declaration is live either way — the control)
P4  NO-LEAK a: a row the declaration does NOT admit (stage 'closed'), both objects:
    abstain BEFORE, abstain AFTER
P5  NO-LEAK b: a principal holding NO applicable widener, every row, both objects:
    abstain BEFORE, abstain AFTER
P6  NO-LEAK c: end-to-end by-id PATCH of a non-admitted row, both objects:
    4xx with an ADR-0112 envelope BEFORE and AFTER; row unchanged
P7  NO-LEAK d: the elevated scope is confined — after the probe runs, the caller's
    own `find` on probe_secret still returns only their own rows, and the caller's
    context object is NOT mutated (no isSystem / no extra keys)
P8  NO-LEAK e: the probe returns a verdict string only; no row data reaches the caller
P9  Tenant wall: plugin-security's existing unit pin "abstain — the matching row in
    ANOTHER tenant (Layer 0 stays AND-ed in)" stays GREEN after the change, because
    layer0 is in the `where`. Deleting layer0 from `parts` must turn it RED.
P10 END-TO-END by-id PATCH of the cross-owner row the declaration ADMITS:
    - probe_note (public_read): 2xx BEFORE and AFTER
    - probe_secret (private): 403 BEFORE — and my prediction is **still 403 AFTER**,
      refused by the security by-id write PRE-IMAGE gate (security-plugin.ts:1301),
      which performs its OWN `findOne` under `opCtx.context` and is therefore blind
      to the same cross-owner row. If it lands 2xx AFTER, my reading of the
      pre-image gate is wrong and I must re-derive before claiming anything.
    Record the exact refusal SHAPE on both sides (sharing `FORBIDDEN` vs security
    `(row-level security)`), because the shape names which gate refused.
P11 Mutating the fix back out (restore `context`) must turn the P2 pin RED again.

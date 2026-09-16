---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/objectql': minor
'@objectstack/plugin-audit': minor
---

Record the acting agent on the audit row — ADR-0090 D10 rule 4 dual attribution

A `sys_audit_log` row written by an MCP OAuth client acting for a human used to
be byte-identical to a row that human wrote in the Console. The envelope carried
the delegation (`principalKind: 'agent'` + `onBehalfOf`), the row did not, and
nothing in between copied it: `assembleExecutionContext` consumed the OAuth
`azp` as a boolean and dropped the value, so the acting client did not exist
downstream of the door at all.

The delegation now travels the whole way and lands on the row:

- `ExecutionContext.performedBy` (`{ clientId }`) — decided at the `/mcp` OAuth
  door, on the same branch that already decides `principalKind: 'agent'` and
  `onBehalfOf`; a member of the closed entry field set like every other.
- `HookContext.provenance.performedByClientId` — the hook-layer carrier, beside
  `flowRunId` and `attributedUserId`. Provenance, not `session`: no
  caller-gating hook may read the client as the caller.
- `sys_audit_log.metadata` gains `{ performed_by, on_behalf_of }` on a delegated
  write, and nothing at all on a personal one — the two shapes are told apart by
  absence rather than by guesswork.

Additive, and attribution only. `user_id` stays the human, so owner-stamping,
`current_user.*` RLS and the `sys_user` join are untouched (ADR-0073 D3 —
attribution is not ownership). `actor` is untouched too: ADR-0118 D1/D5 keeps
that column two-valued — a user id, or `null` for the system — and answers
"which non-user acted" with an added attribution field rather than a second
actor vocabulary. No existing row changes meaning, and no historical row is
rewritten.

Rule 4's third element, the run id, is NOT delivered here and is not declared
either: nothing on the request path mints one today (`ExecutionContext.traceId`
is declared but resolved by no transport entry point), and declaring a carrier
nothing populates is the defect this change exists to close.

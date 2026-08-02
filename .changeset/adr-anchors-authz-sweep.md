---
---

Tooling-only: expand `scripts/adr-anchors.json` from 8 to 15 anchors — the bounded authz/security ADR sweep promised in #4575. Releases nothing.

The first 8 anchors covered only #3723's blast radius. This sweep audited the decisions in ADR-0057 / 0066 / 0068 / 0090 / 0091 / 0095 / 0105 for other load-bearing realizations — places where a reasonable engineer could "fix" the code and be reverting a decision. Seven files added, each with its reversal story:

- `posture-ladder.ts` (0095) — posture derives from capability grants; re-reading the better-auth role reopens the #2836 dual-track class.
- `grant-validity.ts` (0091) — window enforcement lives at resolution time; "optimize it into a cleanup job" is the banned move (ADR-0049).
- `tenant-layer.ts` (0095 D1) — Layer 0 shares no compiler/merge/bypass with business RLS; "deduplicate into the RLS compiler" would let a Layer-1 change weaken tenant isolation.
- `auto-org-admin-grant.ts` (0105) — wall-less postures get `organization_admin_no_bypass`; "why two sets?" collapses into an environment-wide superuser (the F2 finding).
- `invitation-placement.ts` (0105 D8) — issuance dry-runs the gate; "acceptance re-checks anyway" is false (acceptance runs under system context) and skipping it is an escalation hole.
- `position.zod.ts` (0090 D3) — positions are flat; adding `parent` is the exact mistake ADR-0057 D5 retired.
- `permission-evaluator.ts` (0066 D2 + 0057 D1) — superuser bypass derives from the wildcard grant, no stored boolean and no role fast-path.

Plus one extension: the existing `resolve-authz-context.ts` anchor gains ADR-0068 (`platform_admin` is derived from an unscoped grant — no trusted stored boolean, the classic "add an `is_admin` column" reversal target).

All 15 pass as-is — every anchored file already cited its governing ADRs — so this changes zero code, only registers what must not be silently un-cited. Negative-tested by stripping `ADR-0091` from `grant-validity.ts` (fails, printing the invariant).

---
"@objectstack/plugin-security": minor
"@objectstack/spec": minor
---

fix(security): **BREAKING** — `sys_user_permission_set` retires the `delegated_from` column (ADR-0049 enforce-or-remove, #9730)

Maintainer ruling 2026-08-18: **REMOVE**. The runtime delegation gate is
structurally scoped to `sys_user_position` — `isDelegationWrite` returns `false`
for every other object, so `assertSelfDelegation` was unreachable for
`sys_user_permission_set` — and the explain engine reads delegation provenance
from position rows only. On the permission-set grant table the column was
therefore declared and data-door-writable while **no runtime consumer read
it**: its only enforcement was the authoring-time lint rule requiring a
`reason` on delegation rows, which a row written through the generic data door
never meets. A declared-but-unenforced writable column on a security object is
the declare-not-enforce trap in its pure form — an author stamping
`delegated_from` on a permission-set grant believed they constrained
delegation, and nothing refused or honoured it. Producers measured at zero:
the only object literals naming both the table and the column were lint test
fixtures.

Migration (FROM → TO):

| Wrote | Write instead |
|---|---|
| `delegated_from` on a `sys_user_permission_set` seed row or data-door write | Delete the key. Provenance prose belongs in `reason` (still declared on both grant tables); actual delegation-of-duty belongs on `sys_user_position`, where `delegated_from` remains declared **and** runtime-enforced (ADR-0091 D3). |

One-line fix: delete `delegated_from` from any authored `sys_user_permission_set` row.

<!-- adr-0087: registered ups-delegated-from-column-retired -->

Enforcement after the removal is loud, not silent: the engine's schema
preflight refuses an undeclared field with `400 INVALID_FIELD` before the
driver or any hook runs, so a stale seed or client write is told exactly what
to remove. Physical columns on already-deployed databases are untouched
(ADR-0045 schema sync is additive); the platform stops declaring, projecting
and accepting the column. The sibling `sys_user_position.delegated_from` — the
enforced half of ADR-0091 D3 — is untouched, pinned by test. If
permission-set-granularity delegation ever becomes a real need, the column is
re-declared **with a runtime reader in the same PR** — declare-and-enforce or
don't declare.

The docs' per-object grant-column table (`content/docs/permissions/
authorization.mdx`) now records the retirement, and the security-posture
lint's D3 rule is scoped to the position table (see the `@objectstack/lint`
changeset).

---
"@objectstack/lint": minor
---

feat(lint): the ADR-0091 seed pair now gates runtime `seed` publishes (#8307)

`validateSecurityPosture`'s `surfaceReason` (#7576) named the ADR-0091 seed
pair — `security-grant-expired-at-authoring`, `security-delegation-missing-reason`
— as the one slice of the block ready to cross the runtime publish gate: both
rules read only `stack.data[]`, need no cross-collection resolution context, and
were measured trip-free on the shipped corpus (showcase, CRM, todo, blank).

The `validateSecurityPosture` registry entry now declares
`surfaces: ['cli', 'runtime-publish']` with `runtimeTypes: ['seed']`. A runtime
`seed` publish — Studio, REST `/meta`, MCP/AI authors — is now refused with
`422 INVALID_METADATA` when an authored grant row on `sys_user_position` /
`sys_user_permission_set`:

- carries a `valid_until` already in the past (or unparseable) at authoring
  time — the row would never resolve (ADR-0091 D2, fail-closed);
- carries a `delegated_from` with no `reason` — the dual-audit trail ADR-0091 D3
  requires.

The other eleven rule ids this ONE registry entry also carries (`object` /
`permission` / `book` posture, `security-role-word`, …) are **not** declared —
that remains #8310, still blocked on a strictness rollout for `object` and
`RUNTIME_NEEDS_FULL_SNAPSHOT` for `permission`/`book`. Declaring
`runtimeTypes: ['seed']` on the whole entry rather than splitting it is safe
because the runtime gate's baseline/candidate differential holds `stack.objects`
identical across both passes for a `seed` write, so any finding this function
derives from `stack.objects` fires identically in both passes and cancels in the
diff — pinned in `validate-security-posture.runtime-surface.test.ts`.

Nothing changes for `os validate` / `os build` / `os lint`. Escape hatch
`OS_ALLOW_UNLINTED_METADATA_WRITES=1` remains the migration hatch for a stack
that authored one of these defects before this landed.

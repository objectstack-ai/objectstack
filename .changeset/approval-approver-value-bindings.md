---
'@objectstack/spec': minor
'@objectstack/plugin-approvals': patch
'@objectstack/lint': minor
---

feat(approvals): declare approver value bindings; retire `queue` approver authoring (#3508)

- `@objectstack/spec` exports `APPROVER_VALUE_BINDINGS` — the single declaration of how a
  designer must source each approver row's `value`: `user`/`team`/`department`/`position`
  are DATA-record lookups on the system directory objects (`sys_user` / `sys_team` /
  `sys_business_unit` / `sys_position`; `position` commits the machine **name**, the
  others the row id), `org_membership_level` is a closed enum (`ORG_MEMBERSHIP_LEVELS`),
  `manager` is auto-resolved, `field` names a trigger-object field, and `queue` is
  unsupported. Also exports `NON_AUTHORABLE_APPROVER_TYPES`.
- `queue` approver type is deprecated-for-authoring: it still parses (stored flows keep
  loading and rendering) but is published in `xEnumDeprecated`, so designers stop
  offering it — the runtime has no queue resolution and the slot routes to nobody. The
  approver `value` xRef now also maps `manager`, so designers can render its
  auto-resolved state. No authored key is removed; nothing to migrate. If a flow carries
  `{ type: 'queue' }`, replace it with `team` / `department` / `position` (or a concrete
  `user`) until a real ownership-queue implementation lands.
- `@objectstack/plugin-approvals` now warns at resolution time when a stored `queue`
  approver is skipped.
- `@objectstack/lint` adds `approval-approver-type-unsupported` (warning) for approver
  types that are declared but not implemented by the runtime.

---
"@objectstack/spec": patch
---

fix(spec): a top-level flow `trigger` / `triggerType` is now sent to the START node's `config`, not to a `type` rename

`FlowSchema`'s alias table pointed both keys at `type`, so a flow carrying a
top-level trigger block was refused with the rename `trigger` → `type`.
That rename cannot be taken: `type` is the flow KIND
(`autolaunched` | `record_change` | `schedule` | `screen` | `api`), so an author
who followed the advice landed on
`Invalid option: expected one of "autolaunched"|…` one round later, with the
trigger binding still nowhere — and a `.strict()` refusal carries exactly one
actionable sentence.

The trigger does not move to `type`. It binds on the START node's `config`, as
`{ objectName, triggerType, condition }` with a `record-*` token such as
`record-after-create` — the shape the automation engine and the authoring-time
`resolveFlowTriggerKind` both read. Both keys are `guidance` entries now, beside
the `object` / `objectName` / `schedule` prescriptions that already name that
config, so the rejection says where the binding really lives instead of
prescribing a name:

```
Unrecognized key(s) on this flow: `trigger`.
  • `trigger` is not a Flow field — a record-change flow binds its trigger on
    the START node's `config` (`{ objectName, triggerType, condition }`, where
    `triggerType` is a `record-*` token such as `record-after-create`), not at
    the flow top level; the flow-level `type` names the flow kind
    (`record_change`), not the binding.
```

No accept/reject behaviour changes: a top-level `trigger` / `triggerType` was
refused before and is refused now, and `FlowSchema`'s accepted keys and its
`type` enum are untouched — only the prescription the refusal carries. One
measured consequence of dropping the alias row: the guidance channel matches the
exact authored spelling (case folding is the rename channel's job), so a
non-canonical spelling such as `triggertype` now gets the bare rejection rather
than the rename it cannot take.

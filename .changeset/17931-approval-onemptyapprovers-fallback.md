---
"@objectstack/spec": minor
"@objectstack/plugin-approvals": minor
"@objectstack/lint": minor
---

Approval nodes gain a fourth empty-slate policy — `onEmptyApprovers: 'fallback'` with a sibling `fallbackApprovers` list — so a rung that expands to nobody opens the request on people you named instead of on a slot nobody can act on.

Until now an approval node whose approvers resolved to nobody had three endings, and none of them named anyone: `admin_rescue` (the default — the request opens on a dead `type:value` slot and waits for a privileged admin), `fail` (the run dies) and `auto_approve` (the record is waved through). All five graph approver types reach that dead end, and `{ type: 'manager' }` reaches it without anybody authoring a wrong value: `manager` omits `value`, so the literal the expansion falls back to is `manager:undefined`.

```ts
{
  approvers: [{ type: 'manager' }],
  onEmptyApprovers: 'fallback',
  fallbackApprovers: [{ type: 'org_membership_level', value: 'owner' }],
}
```

- **`fallbackApprovers` is the approver shape you already write** — the same entries as `approvers`, resolved by the same expansion, so every approver type, OOO delegation and `per_group` tagging behaves identically on it. It is not a second, reduced approver dialect.
- **The pairing is enforced in both directions.** `'fallback'` without a list is refused; a list under any other policy is refused too, because nothing would ever read it — a node that declares a rescue slate and silently ignores it is the failure this config shape is `.strict()` against. Both messages name both keys.
- **A fallback that itself resolves to nobody degrades to `admin_rescue`.** The run is never killed and the record is never waved through by a policy whose author only asked for different people; the log says both that the fallback fired and that it found nobody.
- **This is on the node, not on the `manager` rung** — the node is already where emptiness is decided, and a fallback is wanted for every approver type, not one of them.
- **`os lint` names the new escape and keeps firing without it.** `approval-approvers-may-resolve-empty` still reports a manager-only slate even when a fallback is declared: the rule reads shape, and a static check can no more prove a `fallbackApprovers` list resolves than it can read `sys_user.manager_id`. A seeded manager chain remains the one silencer.

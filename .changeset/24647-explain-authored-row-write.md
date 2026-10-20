---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `security/explain`'s record-grained `update` and `delete` verdicts compose the by-id write gate's authored-row-write deferral, so a row an app-authored row-level write policy admits is reported writable, as its `PATCH` / `DELETE` answers

Clause-②: no (no accept set or public surface moves: enforcement is unchanged, and explain's record verdict now gives the answer the by-id write already gives)

- **What was wrong.** The sharing middleware's by-id write gate does not stop at record sharing's refusal: it asks the security service whether an app-authored row-level policy admits the row for that verb (`checkAuthoredRowWrite`), and on `admit` hands the row to the pre-image gate, which admits it. Explain's record-grained write verdict asked record sharing's per-record gate alone, so on a private object, for a row owned by someone else that only such a policy lets the caller write, the `PATCH` / `DELETE` landed while explain answered `record.visible: false`, decided by `sharing`.
- **What explain answers now.** The same deferral, on the same condition: only when the per-record update or delete gate refuses the row, asked through the sharing service's own probe with the context that gate is asked with. Only the literal `admit` lifts the refusal; `abstain`, any other answer and a failed probe leave it standing. The record verdict is then `visible: true`, `decidedBy: 'rls'`, the layer that last admitted the row; the `sharing` layer still reports `excluded`, and its detail names the deferral. A sharing service without the probe defers nothing, as before.
- **What does not move.** No enforcement answer changes. The `sys_attachment` and `sys_comment` parent gates ask record sharing first and refuse on its `deny` without asking explain, so a row this deferral admits is still refused there at the record-sharing step.

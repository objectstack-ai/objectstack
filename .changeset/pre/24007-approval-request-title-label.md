---
'@objectstack/plugin-approvals': patch
---

Clause-②: no

fix(plugin-approvals): an approval request's record title reads the flow's label, not `flow:NAME`

- **`sys_approval_request.display_title` reads `process_label`.** The title is now the flow's label and the record id (`Discount Sign-off · opp_45`), the same label the request lists show. A row with no label stored falls back to `process_name` (`flow:deal_desk · opp_42`), so the title never reads `null · …`. Every surface that draws the request's title through `nameField` shows it: the record page's heading and breadcrumb, and the request cell of the action history list.
- **`titleFormat` still names `{process_name}`.** A placeholder template cannot fall back, and `process_label` can be null after the boot fill (a row it could not label, or a failed fill run). A renderer that reads `titleFormat` ahead of `nameField`, such as the global search palette, still shows the machine source.

A patch: one formula on one platform object's computed title. No export, type, accepted value or stored column changes.

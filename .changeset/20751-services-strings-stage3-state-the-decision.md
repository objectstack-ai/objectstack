---
'@objectstack/service-datasource': patch
'@objectstack/plugin-approvals': patch
---

Datasource and approval refusals, warnings, field help and generated-draft comments no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Some strings these two packages show to operators, administrators and flow authors pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- `@objectstack/service-datasource`: the credential-migration refusal says an unbindable key is either an alias spelling from before inline credentials were refused at publish, which no connection builder reads, or turso's `encryptionKey`, which has no secret slot of its own because the one slot carries the `authToken`; the remote-primary-key comment in a generated object draft says a driver's introspection can report only the first column of a composite key, so the list is a lower bound.
- `@objectstack/plugin-approvals`: the `queue` approver warning says the platform has no ownership queue to expand the type from, that the type is no longer offered for authoring, and to route the step to a team, department or position instead; the live-record warnings say approvers are being resolved against the trigger snapshot instead of the live record they are normally resolved from; the recall refusal's log line names the admin override; the `sys_approval_action` `via_override` help (in every shipped locale) says a platform or organization admin may act on any pending request, so that one nobody in its slate can decide never stays stuck; the cross-organization team, team-member and manager warnings, the expanded-to-nobody warning, the revise-window refusal, the `attachments` help and the `sys_approval_delegation` description drop their citations.

Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix) needs the new spelling.

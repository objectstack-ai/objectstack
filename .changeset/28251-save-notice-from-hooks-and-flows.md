---
'@objectstack/spec': minor
'@objectstack/objectql': patch
'@objectstack/runtime': patch
'@objectstack/trigger-record-change': patch
'@objectstack/service-automation': patch
'@objectstack/cli': patch
'@objectstack/lint': patch
---

feat: a hook (shipped body included) and a record-triggered flow can set the save notice the create / update answer carries (#28251)

Clause-②: yes (widening: `HookContext` gains the optional `notice` member, `FlowNodeAction` gains `save_notice`, the `flows` translation group gains `notices`, and `AutomationContext` gains the optional `saveNotice`; nothing an existing stack writes is refused)
Metadata-protocol: added

A single-record create or update has answered with an optional `notice` since #28247, but only an in-process caller that passed `onNotice` could set it. A shipped hook body could not reach that listener, and neither could a flow, so an app that wanted to tell the saver "Sent Acme to your manager for approval" had to fake it with a `record:alert` banner. Now there is one channel with two faces:

- **Hooks: `ctx.notice(message)`.** `HookContextSchema.notice` is the member. The engine binds it at every insert / update dispatch (`beforeInsert`, `afterInsert`, `beforeUpdate`, `afterUpdate`), so every dispatch site gets it, and it calls the write's own `onNotice` listener. A write nobody listens on (a batch, a seed, an import, a flow node's own write) sets nothing, and the call is a no-op there. Anything but a non-empty string is refused with a `TypeError` naming the call, and the write with it. Delete and read dispatches carry no member. The sandbox marshals the member into a shipped body (QuickJS), and no capability is needed to call it.
- **Flows: the `save_notice` node.** `{ type: 'save_notice', config: { message } }` renders its `{{ }}` message and sets it on the write that started the run. The record-change trigger runs the flow inside that write and hands the run the write's channel (`AutomationContext.saveNotice`). The flow parse refuses the node, at any region depth, in a flow whose start is not a create or update record trigger (`record-(before|after)-(create|insert|update|write)`), because no write waits on such a run. At run time the node is refused by name where the parse cannot see it: a leg resumed after an approval or a wait, a subflow or map child (they get no channel), and a run started any other way.
- **Translatable where it is rendered.** A flow notice is picked from `flows.<flow>.notices.<node_id>.message` (`flowNoticeMessageKey`) in the writer's locale before its holes are filled, and the authored template renders when nothing is picked. `os i18n extract` scaffolds the key, the coverage gate demands it, and `objectstack validate` refuses a key over an unknown flow, an unknown node, or a node that is not a `save_notice`. The answer's `notice` stays a plain string: the sentence arrives already rendered.

Scope: single-record create and update only. A batch, a clone and a write a flow node makes pass no listener, so they carry no notice.

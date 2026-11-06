---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
'@objectstack/skills': patch
---

docs(automation): the notify click-through default says a before-create run links to its record only when the caller wrote the id

Clause-②: no
Metadata-protocol: none

A `notify` node that writes none of `sourceObject`, `sourceId` and `actionUrl` links to the run's trigger record when the run has one. Four texts enumerated that run as "a record change other than a delete", which includes a before-create run (`record-before-create`, or the insert leg of `record-before-write`). On that run the record is the write's input, and the driver issues the id at the write, after the hook, so the input carries an id only when the caller wrote one; with no id the notification links nowhere. The runtime is unchanged. The texts now say "a record change other than a delete or a before-create", and that a before-create run links only when the caller wrote the id:

- the `NotifyConfigSchema` docblock and the `sourceObject` / `sourceId` descriptions in `@objectstack/spec`, and the reference page generated from them;
- the `notify` node's docblock and config descriptions in `@objectstack/service-automation`, which is the wording source;
- the Flows guide and the automation skill's `notify` example.

The same texts said that a `sourceId` evaluating to `null` "leaves the key unset". It is a written key: the node then writes a half pair, which is dropped rather than defaulted to the trigger record. The node's failure text, the guide and the schema say so.

A test pins that a notify on a `beforeInsert` run whose record carries no id writes no `source_object` / `source_id`, and that one whose caller wrote the id links to it. No key, shape, default or refinement changes.

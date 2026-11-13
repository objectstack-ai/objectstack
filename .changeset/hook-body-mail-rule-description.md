---
'@objectstack/spec': patch
---

docs(spec): a hook's published `body` description says a hook body cannot send mail

Clause-②: no
Metadata-protocol: none

The `body` key of `HookSchema` now states the rule its parse already holds: a `js` hook body granted `email.send` is refused, because a message cannot be taken back if the write that runs the hook rolls back, and mail on a record change goes through an action, a job or a flow. It also says a hook body may add a timeline entry (`activity.append`), which commits or rolls back with the write. The generated hook reference page carries the same sentence. No key, value or check changes; what a hook accepts is unchanged.

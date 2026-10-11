---
'@objectstack/lint': minor
---

A flow whose `record-*` trigger names no start `config.objectName` is no longer judged for unbound flow CEL roots by `objectstack validate`. With no object named, the record-change trigger registers its hook with no object filter, so it fires on a write to any object, one the stack does not declare included, and hands that row to the run as `record`, its fields flattened beside it. The build door cannot know that record's keys, so it leaves the flow unjudged, as it already does for a record trigger on an object the stack does not declare. The trigger shape itself is not refused.

Clause-②: yes (widening: a flow whose `record-*` trigger names no start `config.objectName` opens, so `validate` no longer reports an unbound flow CEL root there)

**What changes.** On such a flow, `expression-invalid` no longer reports a root the flow does not bind (`user.id`, `foo.bar`, a field name no declared object has). The same flow with a declared `config.objectName` is judged exactly as before.

**The runtime publish gate, by design.** That gate does not judge unbound flow CEL roots on a flow write, and is not going to: who launches a flow and what record it is handed are read from other items of the stack, which makes this a whole-stack judgment that belongs to `objectstack validate`, and the gate's per-write snapshot is not widened to carry flows and actions. The stand-down there is the intended boundary, not a gap waiting on a wider snapshot.

**Who is affected.** Every shipped `record-*` trigger names its object, so no example app changes: `objectstack validate` over `app-crm`, `app-todo`, `app-multi-package` and `app-showcase` reports the same findings before and after.

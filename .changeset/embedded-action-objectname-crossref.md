---
"@objectstack/spec": minor
---

fix(spec): `defineStack`'s action cross-reference walk now checks `objectName` on OBJECT-EMBEDDED actions too (#7456)

The third arm #7397 deliberately left open. The registered action walk in
`validateCrossReferences` applies **three** checks — flow target, modal target, and
`objectName` → declared object — but #7397's PR mirrored only the first two onto
`config.objects[].actions[]`. The third split the same way the target arms did before
#7397:

```
embedded   { name: 'probe_on', type: 'script', target: 'doThing', objectName: 'probe_missing' }  -> ACCEPTED
REGISTERED { name: 'probe_on', type: 'script', target: 'doThing', objectName: 'probe_missing' }  -> REJECTED
   "Action 'probe_on' references object 'probe_missing' which is not defined in objects."
```

Same action object, two authoring positions, opposite verdicts — the b/f, c/g, d/i pattern
from #7397's probe table, one key over.

**Now**: `config.objects[].actions[]` is walked and every action's `objectName` (when set) is
subjected to the **same** existence check as a registered action's. Message keeps the
registered wording from `references` onward and changes only the subject, same convention
as the flow/modal arms:

```
Action 'probe_on' on object 'probe_task' references object 'probe_missing' which is not
defined in objects.
```

**Ruling.** #7456 filed this as an observation-class finding because mirroring the check is
an acceptance-surface change with two live readings: **A** — existence check (verbatim
mirror, what this PR does) vs **B** — consistency check (the value must equal the owning
object's own name). The maintainer's four-lens review on 2026-08-11 deferred the A/B/C
question to the spec/contract cadence; the 2026-08-11T14:32Z findings-triage round then
graded it **promote** under the standing 元判据 — a silently-dropped declaration on one
sibling authoring position joins the sibling branch's existing refusal set — and ruled
**Option A**. This PR implements exactly that. It does **not** foreclose B or C: an embedded
action naming a *different* declared object than its owner is still accepted (only a
*dangling* value newly refuses), and whether the key should instead be retired at this
position remains open.

**Acceptance-face narrowing.** A stack carrying a dangling embedded `objectName` now fails
to build where it previously built clean. Census of the shipped corpus (`examples/*`,
`content/docs/**`) found **zero** `*.object.ts` files — or any other file — declaring
`objectName` at the embedded position at all, dangling or otherwise; the key is used only at
the registered/top-level position in shipped metadata today.

`objectName` still gives no new RUNTIME meaning at the embedded position:
`mergeActionsIntoObjects` continues to build its map only from `config.actions`, never from
`obj.actions[].objectName` — this PR only makes a dangling value refused at authoring time.

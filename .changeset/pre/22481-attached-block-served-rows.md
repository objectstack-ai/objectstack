---
"@objectstack/lint": patch
"@objectstack/spec": patch
---

A declared read attachment resolves only where `record` is a row a service serves, so `os validate` refuses a flow condition that reads one

Clause-②: no

`ObjectSchema.attachedOnRead` declares the blocks a service attaches to the rows it serves, computed per caller and never stored. An earlier entry in this release adds each declared block to the names `record.<x>` resolves to, at every expression site bound to the object. That covered the sites whose `record` is the stored row, which never carries a block. There `os build`, `os validate` and the object save door accepted a read such as `record.viewer.can_act`, and the expression then faulted with `No such key: viewer` on every row. A record-change flow on `sys_approval_request` whose start condition read `record.viewer.can_act == true` validated, then failed on every record it fired for.

A declared block now resolves, and its leaves are judged, only at the sites whose `record` is a served row: an action's `visible` and `disabled` predicates.

- **Refused now.** On an object that declares a block, `record.BLOCK` at any other site gets the refusal it gets on an object that declares none: ``unknown field `viewer` on `sys_approval_request` ``, at `error`. Those sites are a flow's node and edge conditions, a validation rule, a field's `requiredWhen`, `readonlyWhen` and `visibleWhen`, an option's `visibleWhen`, a field formula, a sharing-rule condition and a hook condition. The block is no longer offered as a "did you mean?" candidate there either. The object save door runs the same rule over an object's own slots, so an object write in publish mode that reads a block outside an action predicate is refused with an `expression-invalid` issue.
- **Unchanged.** At an action predicate a declared leaf is accepted, and a misspelt leaf is refused with a message that names the leaves the block declares. `sys_approval_request`'s eight action predicates pass. No refusal code is added, and no export or signature moves.
- **`@objectstack/spec`.** The description of `ObjectSchema.attachedOnRead`, which the JSON schema and the reference pages carry, now says where the validator reads the key: in an action's `visible` and `disabled` predicates `record.<block>` resolves and its leaves are judged, and every other expression site binds the stored row and refuses `record.<block>` as an unknown field. The schema and its parse verdicts are unchanged.
- **Reach.** The only shipped object that declares a block is `sys_approval_request`, and its action predicates are the only shipped expressions that read it. The earlier entry has not been released, so no released version accepted a block read at these sites.

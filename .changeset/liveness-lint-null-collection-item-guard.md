---
"@objectstack/lint": patch
---

`lintLivenessProperties` now honours its own docblock contract ("Advisory only
— returns findings, never throws") when a collection item is `null` or
otherwise not an object. The object walk, the field walk nested under it, and
the flat `TYPE_COLLECTIONS` loop that covers every other governed type (flow,
action, agent, tool, …) each read `item.name`/`item.object` straight off every
element with no record guard, throwing `TypeError: Cannot read properties of
null (reading 'name')` on a malformed item instead of skipping it — reachable
via the exported `stack: AnyRec` signature on an unparsed or hand-built stack.
The translation bundle walk already guarded its two levels (#11383); this
closes the same hole on the three walks that did not (#11385).

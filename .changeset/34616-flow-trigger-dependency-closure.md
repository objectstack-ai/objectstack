---
'@objectstack/lint': patch
---

fix(lint): `flow-trigger-unknown-object` and `flow-input-unknown-object` count the objects of the packages a manifest declares in `dependencies`

The CLI's per-package pass judges each package of a multi-package artifact with the artifact's `packages[]` as resolution context. The flow trigger rule never read it, so a flow in package B on an object its declared dependency A owns warned `flow-trigger-unknown-object`, and `os lint --strict` failed a flow the runtime publish gate accepts (the gate judges the write against B's closure, which holds A's objects). The rule now counts the objects of B's dependency closure (the gate's own transitive walk, read off `packages[]`) as defined. A sibling package B did not declare still warns, and so does a name no package in the closure provides. Under a closure the publish gate states, nothing changes.

Clause-②: no
Metadata-protocol: none

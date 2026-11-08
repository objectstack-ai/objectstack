---
'@objectstack/spec': minor
'@objectstack/cli': patch
---

feat(spec): a restriction profile lists the approval pair through its own node vocabulary, and `allowSandboxedJs` splits sandboxed JavaScript bodies off `allowCode`

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — the profile is data a target environment publishes, not a key an app author writes into a stack; authors meet it through `os validate --target`, whose refusals name each rule.

`RestrictionProfileSchema` has not shipped in a release yet, so both changes below land inside the same release as the schema itself.

- **`RestrictionProfileNodeType`** (new export, `@objectstack/spec/system`): the node types a profile's `allowedFlowNodeTypes` can list. It is derived from two spec declarations: every `FlowNodeAction` id, plus the plugin node types whose contracts the spec declares, `approval` and `approval_revise`. `FlowNodeAction` itself does not change. A hosted plan that runs the approvals plugin can now list the pair, and one that does not can leave it out. Before this change the pair could not be listed, so `os validate --target` judged it under `allowCode` and refused it.
- **`allowSandboxedJs`** (new, required boolean): whether a sandboxed JavaScript body (`language: 'js'`) is allowed on a hook, an action or a background job. `allowCode` now covers only in-process code: a hook or job with no `body` (so its `handler` runs), named `functions`, code plugins, the `script` flow node and the other code keys. An expression body (`language: 'expression'`) falls under neither key. A kernel that binds sandboxed bodies but loads no runtime module publishes `allowCode: false, allowSandboxedJs: true`. Every profile must now carry the key: add `"allowSandboxedJs": true` or `false` to a profile written against the earlier shape.

`os validate --target` follows both changes. A hook or job is judged by the body it runs, because a `body` wins over `handler` exactly as it does at bind. Sandboxed JS action bodies were never read before; they are now judged too, both top-level `actions` and those embedded on `objects[].actions`. Under `allowScheduledAutomation: false` a job is refused by that rule alone. The approval pair is judged by `allowedFlowNodeTypes`, and only a node type outside the profile vocabulary still falls to `allowCode`.

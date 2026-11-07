---
'@objectstack/cli': patch
---

feat(cli): `os validate --target ./restriction-profile.json` judges the stack against a target environment's restriction profile

Clause-②: yes
Metadata-protocol: none

A hosted environment differs from a local one only by the restriction profile it publishes (`RestrictionProfileSchema`, `@objectstack/spec/system`). `os validate --target ./restriction-profile.json` reads that profile, parses it with the spec's schema (an invalid profile is refused, naming the schema issue), and refuses every item of the stack the profile forbids — one row per item, each naming the item and the one profile dimension that refuses it:

- `allowCode: false` refuses each object lifecycle hook, each named handler function, each code plugin and the other keys the spec classifies as code, a `script` flow node, and a flow node whose type is not in the spec's built-in node registry (`FlowNodeAction`), which `allowedFlowNodeTypes` cannot name;
- `allowScheduledAutomation: false` refuses each flow of `type: 'schedule'` and each background job;
- `allowedFlowNodeTypes` refuses each flow node, at any region depth, whose built-in type is not listed; `start` and `end` are always allowed.

When the project's `@objectstack/spec` or `@objectstack/skills` is not the version the target runs, the command warns (`--json`: an entry in `warnings` with `package`, `local` and `target`); it does not refuse, and `--strict` does not gate it. Without `--target` the command is unchanged. Only a profile file is accepted: a URL is refused, because no environment publishes its profile at a defined address yet.

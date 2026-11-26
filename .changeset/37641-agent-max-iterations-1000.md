---
'@objectstack/spec': minor
---

feat(spec): an agent's `planning.maxIterations` accepts up to 1000

Clause-②: yes (widening)
Metadata-protocol: added

- `AgentSchema.planning.maxIterations` now accepts any whole number from 1 to 1000 (it stopped at 100). An agent can declare a fuse of a few hundred rounds, such as 300; 0 and anything above 1000 are still refused at `planning.maxIterations`. The default stays 10.
- The value is a runaway fuse counted in model calls, one model call plus the batch of tool calls it requests. It stops a loop that would otherwise never end; it is not a quality knob, and raising it does not make the agent reason better. The docblock, the `.describe()` text and the Studio form help text say so.
- Nothing to migrate: every value accepted before is accepted now.

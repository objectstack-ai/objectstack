---
'@objectstack/skills': patch
---

docs(skills): objectstack-automation says a paused screen's Next / Submit and step count are engine-served, never authored

Clause-②: no
Metadata-protocol: none

- **Before.** The `screen` node row described the fields an author declares and said nothing about the primary button or the step counter. An agent writing a wizard from the skill could hand-roll a "Submit" label or a "Step 2 of 4" into `fields`, or try to author `progress` on the screen node, and the skill did not say that the runtime answers both from the flow graph.
- **Now.** The `screen` node row says that Next / Submit and "Step N of M" are not authored: when a screen pauses the engine reads the graph and serves `progress` (`nextScreen: 'none' | 'possible' | 'certain'`; `step` / `stepCount` only when every path agrees), and the runner labels the button and draws the counter from that alone. A `decision`, a `fault` edge, a loop back, a non-screen pause (`approval`, `wait`) or a `subflow` after a screen answers `possible`, which shows "Next" with no count. A `progress` key in the node `config` is refused; a hand-rolled label or counter in `fields` is wrong.
- No schema, key or behaviour changes. No eval prompt: `evals/flows-triggers-approvals.json` sits at token-ratchet headroom 0.

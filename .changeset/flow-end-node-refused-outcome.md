---
"@objectstack/spec": minor
---

A flow can now REFUSE with per-record text: the `end` node gains `outcome` and an interpolated `message`, and the run vocabulary gains `refused`.

Until now every terminal of a flow was "completed". A flow could say *do this* but not *refuse this, and say why, for which record* — the only channel that interpolated per-record text was a `screen` node's `description`, and a message-only screen renders Submit and, on submit, resumes to `end`, whose runner toasts `Flow "…" completed` at a user who was just told "this is refused". Maintainer ruling (2026-09-05, option 2′): the refusal is a first-class outcome of the existing terminal node, not a second node type.

The contract, declared here first (the engine and runner halves follow in their own packages):

- **`end` node config** — `EndConfigSchema` (`@objectstack/spec/automation`): `outcome?: 'completed' | 'refused'` (default `completed`) and `message?: string`, a `{token}` template interpolated at run time exactly like a screen `description` (`{record.name}` etc.). `outcome: 'refused'` without a `message` is refused at parse (a refusal without text is the shape this exists to replace); `message` on a completed end is refused too (nothing would ever render it). The shape is strict: an undeclared key is a parse error naming the intended key. Because `end` is structural (no executor, no descriptor), `FlowNodeSchema` applies the contract itself to every `type: 'end'` node it parses and writes the parsed (defaulted) config back; a node with no `config` is left without one. Every other node type's `config` stays the open, executor-owned slot it was.
- **Run row** — `ExecutionStatus` gains `refused` (appended last: a terminal state distinct from `failed` — a refusal is a successful evaluation that says no; never resumed) and `ExecutionLogSchema` gains `refusalMessage`, the rendered per-record text, set only on a refused run.
- **Result / wire** — `AutomationResult.status` and `TriggerFlowResponseSchema.data.status` gain `'refused'`, and both carry `refusalMessage`; on a refusal `success` is `true` and `successMessage` is absent, so a runner shows the message with Close only — no Submit, no completion toast.

Additive throughout: nothing renamed or retired, so no ADR-0087 conversion-layer entry (disposition: not-required). Flows that never set `config` on an `end` node parse exactly as before.

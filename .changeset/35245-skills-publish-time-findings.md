---
'@objectstack/skills': patch
---

docs(skills): the data and automation skills name the publish-time findings in place of their trap warnings; the i18n skill drops the `fallbackLocale` workaround for refusal labels; the ai skill names `MCP_DOOR_TOOL_NAMES` as the fourth tool source

Clause-②: no
Metadata-protocol: none

**objectstack-data.** A `state_machine` rule that runs on insert declares `initialStates`, or publish refuses it (`state-machine-no-initial-states`); an update-only machine (`events: ['update']`) needs none, since the engine reads them only on insert. `SKILL.md`, `rules/validation.md` and eval 11 say so. The yes/no-flag bullet no longer says "never `required`": on a boolean `required` refuses only `null`, an unchecked box is a value, so it never means "must be checked". A box that must be checked (terms, consent) is a `validations[]` `script` rule, and the bullet carries one. Eval 10 follows, and no longer fails an answer that keeps `required: true`.

**objectstack-automation.** `SKILL.md`: a node `type` no executor runs is refused when the flow is published to a running server (`flow-node-type-no-executor`); an `http` node with no positive `timeoutMs` has no timeout and raises the warning `flow-http-timeout-missing`. `references/state-machines-and-approvals.md`: `initialStates` is no longer described as optional with a legacy opt-out, and names the same refusal and the same update-only exception; an approval's downstream nodes hang off out-edges labelled exactly `approve` and `reject`, and with one missing or respelled publish refuses the flow (`flow-approval-decision-unrouted`).

**objectstack-ui.** `rules/actions.md`: a standalone action that declares `locations` and no `objectName` is refused at validate and at publish (`action-no-object-binding`); the fix is `objectName`, or `locations: []` for a headless action. Paid in the same file: three parentheticals of the locations table and some wording of the same paragraph.

**objectstack-i18n.** Validation, delete-restriction and permission-denial messages name fields and objects in the request's language, as label serving does: a request in `sourceLocale` reads the inline label. The sentence telling an English-authored, Chinese-default app to add `fallbackLocale: 'en'` for that is gone from `SKILL.md` and from eval 11; `fallbackLocale` stays documented as the fallback for a missing translation.

**objectstack-ai.** Source 4 of the `skill.tools[]` resolution ladder is `MCP_DOOR_TOOL_NAMES`, every tool the MCP door registers (the `MCP_FILE_TOOL_NAMES` file pair included), resolved only for a skill MCP can offer (`mcpPrompt` not `false`). On a `mcpPrompt: false` skill a name only the door serves still warns, with its own hint.

Paid in place, no token ceiling moves. Cut to pay: in `rules/validation.md` the state-machine example loses three states and its default `severity`; in `references/state-machines-and-approvals.md` three asides (automation being AI-generated, a multi-step review reading as one diagram, a back-edge re-entering its node); in objectstack-automation `SKILL.md` a few words of seven node-table rows; in objectstack-data `SKILL.md` two example state names and a few words of the same bullets.

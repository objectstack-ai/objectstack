---
'@objectstack/scenarios': patch
---

fix(scenarios): a recorded replay re-sends each turn's recorded writes, so an applied operation reads back what the run wrote

Clause-②: yes (widening) — new export `ReplayNotFaithfulError` and new optional field `AskTask.callTool` (`./runner`)
Metadata-protocol: none

`--driver recorded:FILE` handed back the recorded turn and sent nothing, so the freshly booted app never received the agent's writes: every `applied` operation read back no row and failed on replay ("0 row(s) read back"), and the operations half of a re-scored run was false fails.

The replay now re-sends a turn's recorded writes (`create_record`, `update_record`, `delete_record`, `run_action`) to the booted app, in recorded order, as the turn's persona, through the runner's own MCP door, before the runner reads the operation back. Reads are never re-sent. A recorded refused write is re-sent too and must meet the same refusal again. A row the recorded run created gets a new id in the replayed app, and a later recorded write naming the old id is sent with the new one. When the app answers a re-sent write otherwise than it answered the recorded run, or a recorded write has no recorded answer (the turn was cut short, so whether it wrote is unknown, and nothing of that turn is re-sent), the turn's question or operation is not measured, with the call named in the reason, never a fail. Live drivers are unchanged.

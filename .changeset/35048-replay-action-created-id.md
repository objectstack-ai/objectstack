---
'@objectstack/scenarios': patch
---

fix(scenarios): a replay maps the row a recorded `run_action` created to the id the replayed app gave it

Clause-②: no
Metadata-protocol: none

A replay (`--driver recorded:F`) re-sends each turn's recorded writes and sends a later write naming a row the recorded run created with the id the replayed app gave that row. It read that id only from a `create_record` answer (`{ id }`). `run_action` answers what the action body returned under `result` (`{ ok, action, objectName, result: { id } }`), so a row an action created, such as a claim filed from text, kept its recorded id: the next write naming it was refused `RECORD_NOT_FOUND` on replay, and the turn read not measured ("not faithful") although the recorded run had written it. The replay now reads the created row's id from `result.id` of an applied `run_action` answer as well, and maps it like a `create_record` row. A `create_record` row is remapped as before.

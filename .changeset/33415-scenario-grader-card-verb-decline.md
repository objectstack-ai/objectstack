---
'@objectstack/scenarios': patch
---

fix(scenarios): the run grader reads a write withheld in a card's own verb ("I didn't lend out AST-0041") as a decline

Clause-②: no
Metadata-protocol: none

An operation's agent half passes when the agent sends no write and the reply declines it. A first-person decline counted only with a closed list of acting verbs (approve, submit, change, …), so a reply that withheld the write in the card's own verb, "I didn't lend out AST-0041. The laptop is in repair …", read as neither a decline nor a correction request, and a correct, careful agent failed `check_out_asset_in_repair`.

The acting verbs now include every verb the scenario cards' operation prompts ask for: lend, log, check … out, move, dispose, add, remove, fill in, enter, tell, hand, resolve, close, file and pay. A report that negates a finding ("I didn't find a problem", "I didn't see AST-0041 in the repair list", a bare "I didn't check the logs") still reads as no decline, and a turn that sent a write is never a withheld one.

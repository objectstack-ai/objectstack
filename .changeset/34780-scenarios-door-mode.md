---
'@objectstack/scenarios': patch
---

Clause-②: no
Metadata-protocol: none

feat(scenarios): `--modes door` builds a card through the MCP draft door with no project, then publishes it as a person would

The runner gains a fourth mode. A door mode turn is given the booted app's MCP draft door (an OAuth token scoped `openid metadata:write`, in a 0600 config outside its directory), an empty directory of its own outside the host project, and nothing else: file and command tools are denied. The runner then does what a person does in Studio: it creates a writable package in the card's namespace before the turn, and lists and publishes that package's drafts after it (`POST /api/v1/packages/:id/publish-drafts`). It grades what the environment then serves exactly as a scratch build is graded, Build half then Run half. A publish that does not answer `published` is a finding naming each refused draft, since a refusal answers on a 200.

A round measures what instruction text is worth by arms. `--door-skills DIR` (less `--door-skill-omit`) gives the client Claude Code skills. `--door-rules FILE` or `OS_SCENARIOS_DOOR_RULES` (less `--door-rules-omit`) gives it rule texts the maintainer supplies from outside the repository, in a documented `{ rules: [{ id, text }], sets }` format that is refused loudly when malformed. The record states the arm (skills with sha256, the rules file's name and sha256, the ids active and omitted, never a text), and `summary` never sums two arms. A replay re-sends the recorded draft saves through the replay's own door. Codex and external drivers are refused for door mode.

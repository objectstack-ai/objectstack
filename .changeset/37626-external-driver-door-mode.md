---
'@objectstack/scenarios': patch
---

feat(scenarios): an external driver command can build through the MCP draft door (`--modes door`) on contract `objectstack-scenario-driver/2`

Clause-②: yes
Metadata-protocol: none

`--driver external:COMMAND` now takes door mode, so any agent tool behind a wrapper is scored on the same door cards as the live `claude` driver. The driver contract gains a second version, `objectstack-scenario-driver/2`: `/1` plus an optional `door` on an `author` call, `{"mcp":{"url":…,"configFile":…},"skillsDir":…}`. The door's OAuth token (scoped `openid metadata:write`) travels as an `ask` call's persona key does: only in a 0600 MCP config file outside the call's directory, deleted when the call returns, never on argv, in the environment or on stdin, and so never in a run record, a scorecard or a gallery export. `--door-skills` and `--door-skill-omit` reach the command as `door.skillsDir`, and the record states the arm (`env.driver.door`) in the same shape as for the `claude` driver; the rules arm (`--door-rules`) is a Claude Code `CLAUDE.md` and is refused with an external command, naming why.

A command names the version it speaks in its `info` answer (`"contract":"objectstack-scenario-driver/2"`); the `info` input itself still carries `objectstack-scenario-driver/1`, the one input both versions share. Every later call carries the version the command named. A `/1` command (an `info` answer with no `contract`) keeps running scratch, template and ask unchanged, and `--modes door` with one is refused before any card runs, naming the contract. An `info` answer naming a contract the runner does not speak is refused, naming it. `EXTERNAL_DRIVER_CONTRACT` now reads `objectstack-scenario-driver/2`; `EXTERNAL_DRIVER_CONTRACT_V1` and `EXTERNAL_DRIVER_CONTRACTS` name the versions. A command that must also serve a runner built before this release answers `info` without `contract`, as a `/1` command: such a runner refuses an `info` answer carrying the key. The package README's contract section states the door input for command authors.

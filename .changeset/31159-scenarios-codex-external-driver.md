---
'@objectstack/scenarios': patch
---

feat(scenarios): the scenario runner drives the Codex CLI (`--driver codex`) and any command that speaks a stdin/stdout driver contract (`--driver external:COMMAND`), and each gallery app page names the driver that ran it

Clause-②: yes
Metadata-protocol: none

The same scenario card can now measure another agent tool. Additive: nothing is removed or renamed.

- **`--driver codex`** (`CodexDriver`): `codex exec --json` on your own ChatGPT plan login. It refuses to start while `OPENAI_API_KEY` or `CODEX_API_KEY` is set or `codex login status` reports anything but a ChatGPT login, and passes `-c forced_login_method="chatgpt"` on every turn. The persona's API key reaches the CLI only in a 0600 profile file under `$CODEX_HOME`, deleted when the turn returns. `--model`, `--author-model`, `--ask-model` and `--author-timeout` apply; `codex exec` has no turn cap, so `--author-max-turns` and `--ask-max-turns` are refused with it.
- **`--driver external:COMMAND`** (`ExternalDriver`, contract `objectstack-scenario-driver/1`): one process per call, the call as JSON on stdin (`info`, `author`, `ask`), the turn as JSON on stdout. A non-zero exit or an answer of another shape is a failed turn with a named reason (`no-result(exit N)`, `invalid-output(…)`). The persona's key is only in a 0600 file whose path the `ask` call names, never on argv, in the environment or on stdin. The package README states the contract.
- **The driver on record**: `DriverInfo` gains `replayOf`, so a replay (`--driver recorded:F`) names the driver and version of the recording it replays. Each exported gallery app page carries a `- Driver:` line with the driver's name and version (`driverText`).
- `ApiBillingRefusedError` takes an optional second argument naming the agent tool and its login command; its default message is unchanged.

---
"@objectstack/cli": minor
---

`os serve`'s runtime state file is keyed by the PROJECT, not by the environment id alone — so two projects on one machine stop overwriting each other's supervision record.

`os serve` publishes `{ pid, port, url, environmentId, startedAt }` to a file under the ObjectStack home, so a supervisor can answer *"is my server running, and where?"*. That file was named `runtime.<environment>.json`, and both halves of where it lived were machine-global: `resolveObjectStackHome()` takes no arguments (it reads `OS_HOME`, else `~/.objectstack`), and an environment id is not a project identity. Two different projects on one machine, both in the ordinary `local` environment, therefore wrote one file.

Driven with two real boots, two project roots and one home, that produced two failures with one cause:

- project B's boot replaced project A's record, so a reader asking about A's server was answered `pid`/`port`/`url` belonging to **B** — confidently, while A's own server was still alive and still listening elsewhere;
- project A's shutdown then deleted the file that by that point described **B**, leaving a running server with no supervision record at all.

The file is now `runtime.<environment>.<project>.json`, where the project component is a sanitised basename plus a short digest of the served app's root — the same root `serve` already resolves for host-anchored package loads. The payload is unchanged: no new key, and in particular no database path (which #15374 ruled out deliberately, because it would turn a best-effort supervision file into an identity contract).

**If you read this file:** a reader that hard-codes `runtime.<environment>.json` now gets `ENOENT` rather than a stale or foreign record — a loud, correct answer to "is my server running", where the old name could only give a confident wrong one. Readers that glob `runtime.*.json` inside a home they pinned themselves (as `scripts/publish-smoke.sh` does) are unaffected. A `runtime.<environment>.json` left over from an earlier version is no longer written or cleaned up by `os serve`; delete it once.

Two boots of the *same* project still share one file, which is the same-project case and unchanged here.

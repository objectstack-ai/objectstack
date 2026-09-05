---
"@objectstack/cli": minor
---

`os serve`'s runtime state file is keyed by the PROJECT, not by the environment id alone — so two projects on one machine stop overwriting each other's supervision record.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, export, config field or stored metadata changes spelling or shape, `packages/spec` is untouched, and `objectstack migrate meta` has nothing to rewrite. What is retired is the NAME of a best-effort supervision file that `os serve` writes under the ObjectStack home — a path on disk, not a metadata surface the ledger can project into `spec-changes.json` or the generated upgrade guide. The affected party is an out-of-tree supervisor that opens that path, and the one action it takes is deleting a single stale file; there is no authored artifact for a metadata upgrader to rewrite, and no ledger entry could reach the party that is affected. -->

**BREAKING** for anything that opens the runtime state file by its old name. Shipped as `minor` under the launch-window convention: while the whole workspace versions in lockstep the bump level carries no breaking-ness, so this banner and the ADR-0087 disposition above are the carriers. The file `os serve` writes under the ObjectStack home was named `runtime.<environment>.json` and is now named `runtime.<environment>.<project>.json`.

`os serve` publishes `{ pid, port, url, environmentId, startedAt }` to a file under the ObjectStack home, so a supervisor can answer *"is my server running, and where?"*. That file was named `runtime.<environment>.json`, and both halves of where it lived were machine-global: `resolveObjectStackHome()` takes no arguments (it reads `OS_HOME`, else `~/.objectstack`), and an environment id is not a project identity. Two different projects on one machine, both in the ordinary `local` environment, therefore wrote one file.

Driven with two real boots, two project roots and one home, that produced two failures with one cause:

- project B's boot replaced project A's record, so a reader asking about A's server was answered `pid`/`port`/`url` belonging to **B** — confidently, while A's own server was still alive and still listening elsewhere;
- project A's shutdown then deleted the file that by that point described **B**, leaving a running server with no supervision record at all.

The file is now `runtime.<environment>.<project>.json`, where the project component is a sanitised basename plus a short digest of the served app's root — the same root `serve` already resolves for host-anchored package loads. The payload is unchanged: no new key, and in particular no database path (which #15374 ruled out deliberately, because it would turn a best-effort supervision file into an identity contract).

**If you read this file:** a reader that hard-codes `runtime.<environment>.json` now gets `ENOENT` rather than a stale or foreign record — a loud, correct answer to "is my server running", where the old name could only give a confident wrong one. Readers that glob `runtime.*.json` inside a home they pinned themselves (as `scripts/publish-smoke.sh` does) are unaffected. A `runtime.<environment>.json` left over from an earlier version is no longer written or cleaned up by `os serve`; delete it once.

**Which root the project component is taken from**, for a supervisor that has to reconstruct the name out of tree: it is the app root `serve` anchors at, which is the config file's own directory when that file exists and that directory carries a `package.json`, and the process's working directory otherwise. Two boundaries follow, stated rather than fixed: the same app served from two working directories without a manifest keys two files, and the key is the resolved path rather than the realpath, so two symlinked spellings of one project key differently — each spelling gets its own file, and each is internally consistent.

Two boots of the *same* project from the *same* anchor still share one file, which is the same-project case and unchanged here.

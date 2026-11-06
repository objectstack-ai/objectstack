---
'@objectstack/skills': patch
---

docs(skills): the platform skill teaches `os deploy`, the managed-package dev loop

Clause-②: no
Metadata-protocol: none

`objectstack-platform/references/operations.md` gains an `os deploy` row in "Environments & deploy": use it to see an edit on the organization's ObjectOS Cloud environment (also `npm run deploy` in a scaffolded project, or `d` in `os dev`); it builds, publishes `<manifest.version>-dev.<timestamp>`, installs that version and waits until the environment serves it. The row names how the environment is picked (`--env`, else the one `os environments switch` recorded, kept across `os cloud login`, else the organization's only one) and the `--no-wait` and `--wait-timeout` flags, and the `os package publish` row now says it publishes a release version. A short paragraph reads an `os deploy` exit 1: a refusal before any write, the environment's own build failure, and the wait timeout, each with the next step. `SKILL.md`'s Part 3 pointer names `os deploy`. Eval 17 of `evals/config-plugins-ops.json` asks how to see a change on the environment and expects `os deploy`. Paid inside `operations.md` by deleting three restatements (the `os dev` row's platform-admin sentence, the `os validate` row's gate summary, the "Both run the same gates:" lead-in); the remainder raises that file's token ceiling by the measurement.

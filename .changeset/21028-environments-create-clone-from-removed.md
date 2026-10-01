---
'@objectstack/cli': minor
'@objectstack/client': minor
---

fix(cli)!: `os environments create` no longer takes `--clone-from`, and the client's `environments.create` request no longer declares `clone_from_environment_id` (#21028)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata changes shape and nothing an author wrote in a stack is renamed or removed, so `objectstack migrate meta` has nothing to rewrite. What goes is a CLI flag and one optional key on an SDK request type, both of which the control plane ignored. -->

**BREAKING for scripts that pass `--clone-from`, and for TypeScript callers that pass `clone_from_environment_id`.**

**What changed.** `os environments create --clone-from <id>` used to be accepted. It
sent `clone_from_environment_id` on the create request, and the control plane never
read that key: its create schema does not declare it, and an undeclared key is
stripped unread. So the command answered success and created an EMPTY environment,
with nothing saying the clone had not happened. Cloning an environment is not
implemented, so the flag is gone, and so is the key on the request type.

- `os environments create --clone-from <id>` (also spelled `--clone-from=<id>`) is
  now refused by the argument parser (`Nonexistent flag: --clone-from`, exit 2) before
  any request is made. Before, it created an empty environment and exited 0.
- A create without the flag is unchanged: the request body never carried the key.
- `@objectstack/client`: `client.environments.create({ … })` no longer types
  `clone_from_environment_id`, so a call that passes it fails to compile, naming the
  key. At runtime the request was never different, because the server dropped it.

**The one-line fix.** Remove `--clone-from <id>` from the command, or
`clone_from_environment_id` from the object you pass to `client.environments.create`.
The environment it creates is the same empty one the old call created.

**What is not affected.** Every other flag of `os environments create`, and every
other field of `client.environments.create`. Starter content is still installed into
a new environment afterwards, from the App Marketplace (`os package install`).

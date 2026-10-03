---
'@objectstack/runtime': minor
'@objectstack/cloud-connection': minor
---

fix(runtime,cloud-connection)!: install-local refuses a hook with no `body` and a job `body` that does not bind, and withholds such a hook on rehydrate (#21585)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no authorable key, spelling, export of a published release or stored shape moves: `HookSchema` and `JobSchema` are unchanged, so `objectstack migrate meta` has nothing to rewrite. What changes is which packages one install door accepts, and which hooks it binds on a rehydrate. The other categories are closed on facts: the packages publish (not `unpublished`); no ADR-0087 id covers a refused install or a withheld hook (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: `os package install` (the install-local door, `POST /api/v1/marketplace/install-local`) now refuses two more kinds of package it used to install with a 200:

- **A hook with no `body`.** A hook in the deprecated function-name `handler` form names code that travels only in an artifact's runtime module, never in the package JSON this door installs. Such a hook used to install and then either never fire or bind by name to a function the package does not ship. Every hook is judged, since a hook has no on/off switch. A hook that carries both a `body` and a `handler` installs as before: its `body` wins.
- **An enabled job whose `body` does not bind.** The door used to judge only that a job `body` was present. It now judges that the body binds, by the declaration's own parse of `JobSchema.body`, the same parse the scheduler binds by. So a job whose `body` is an expression (L1) body, or carries `body.timeoutMs`, is refused instead of installed and never scheduled.

- **The refusal.** The install answers `422` with `VALIDATION_ERROR`, the answer the door already gives an enabled job with no `body`. One answer names everything the door cannot run: each hook and the function its `handler` names, each job and its handler, and each refused job `body` with the key the declaration refuses. Nothing is installed: nothing is registered, persisted, bound or scheduled. `os package install` exits non-zero and prints the code beside the status.
- **Rehydrate.** A package installed by an earlier version keeps rehydrating after a restart. Its body hooks bind as before. A hook of it with no `body` is reported at `warn` by name and is **not bound**: this door carries no runtime module, so the hook's `handler` can never name the package's own code. Its job with no runnable `body` is reported and not run, as before.
- **Runtime.** The binder exports the two judgements the door reads: `collectHooksWithoutBody`, and `collectJobsWithoutBody`, which also names a job whose `body` does not bind. `bindAppArtifactHandlers` takes `withholdHooksWithoutBody`, which a door that carries no runtime module sets, and reports the hooks it withheld as `withheldHooks`.
- **Unchanged:** a boot that loads the artifact's runtime module (`os start --artifact`, a `defineStack` config) binds an app's handler hooks to its own functions exactly as before. Hooks authored through the metadata API are unchanged too. A package whose hooks carry a `body` and whose enabled jobs carry a valid `body` installs exactly as before.

The route for a refused package: give each hook a `body` (sandboxed JS, the form actions and jobs use), and correct each job `body` to the declared shape. That shape is a sandboxed JS body whose time limit is the job's own `timeoutMs`, and `os validate` reports the same refusal. Alternatively, boot the artifact with `os start --artifact`, which loads its runtime module. This ships as `minor`, under the launch-window convention for narrowings of an accept set.

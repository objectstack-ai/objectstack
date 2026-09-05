---
"@objectstack/trigger-record-change": patch
"@objectstack/trigger-schedule": patch
---

`@objectstack/trigger-record-change` and `@objectstack/trigger-schedule` now declare a `repository.directory` that resolves to the directory they actually live in.

Both manifests declared a path under `packages/plugins/` that no longer exists in the repository:

| package | declared | actual |
|---|---|---|
| `@objectstack/trigger-record-change` | `packages/plugins/plugin-trigger-record-change` | `packages/triggers/trigger-record-change` |
| `@objectstack/trigger-schedule` | `packages/plugins/plugin-trigger-schedule` | `packages/triggers/trigger-schedule` |

`repository.directory` is what npm uses to build the **Repository** deep link on a package page, and what tooling uses to locate a monorepo package's source from its tarball. Pointing it at a path that does not exist sends a reader to a 404 instead of to the source — on packages published today at `17.3.0`. The value ships inside the tarball, so this correction only reaches npm by being published; that is why it carries a changeset rather than `skip-changeset`.

The residue came from a three-commit sequence on 2026-06-12, and only one of those commits was a pure rename. `f15d6f6f6` **copied** the two packages to `packages/plugins/trigger-*` (26 files, +2222/-19, with all four directories briefly coexisting) and edited exactly one line of each copied manifest — its `name` — leaving `directory` pointing at the path it was copied from; `290c62514` deleted the originals five minutes later; and `ea4941ad8` then promoted `packages/plugins/trigger-*` to a first-class `packages/triggers/` directory as a pure 16-file rename with zero content changes, which made the declared value wrong in a second segment. Six weeks after that, `9a43e042f` (#3380) rewrote `repository.url` and `bugs` in both of these manifests, with the stale `directory` line sitting as unchanged context one line below the edited `url`. So the field was not merely never in anyone's way: one commit edited its immediate neighbour inside the same object, and a later reviewed hunk had the wrong line on screen. Nothing caught it because nothing reads it.

Scope of this change, stated as a measured set rather than a general claim: over all **81** tracked `package.json` files in the repository, **57** declare `repository.directory`; before this change **55** resolved to the manifest's own directory and **2** did not — the two above. After it, **57 of 57** resolve. No other manifest field is edited, and no package's code, exports or behaviour is touched. The remaining **24** manifests declare no `repository.directory` at all; that population is deliberately left alone here and is reported separately, because whether declaring the field is mandatory is a policy question rather than a correction.

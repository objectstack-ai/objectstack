---
'@objectstack/cli': minor
---

fix(cli)!: `objectstack generate` binds a view, flow, action or app to an object (and an action to a flow) that you name or that the stack declares, never to one derived from the new item's name, and every scaffold passes `objectstack validate`, `objectstack build` and `objectstack lint` with zero findings

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a change to which `objectstack generate` invocations write a scaffold, and to what the scaffolds contain. No authorable key, spelling, export or stored shape moves: every schema the scaffolds are written against parses exactly what it parsed, the files `objectstack generate` wrote earlier are untouched and still load, and no stored row is read or rewritten. What is narrowed is the command's own argument handling, which no ledger entry can rewrite: the object a scaffold should have bound is the author's to say, which is the whole point of the change. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a CLI argument, and this diff adds none (not `registered` / `already-registered`); and the change is command behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows which `objectstack generate` invocations write a file. It ships as `minor` under the launch-window convention for narrowings. No export or published type changes.

**Why.** `view`, `flow`, `action` and `app` scaffolds took the object they bind from their own name, and an action took its flow the same way. On a fresh `npm create objectstack` project holding `project` and `task`, `objectstack generate flow task_done` wrote a flow triggered by an object called `task_done` that nothing declares (a flow that never fires) and reported success, while `objectstack generate action complete_task` and `objectstack generate app tasks` were refused, because no object was called `complete_task` or `tasks`. Nothing let the author name the object they meant.

**New options.**

- `--object <object>` names the object a `flow`, `action` or `app` binds, as the stack declares it or without the namespace prefix (`--object task` binds `tasks_app_task` under `namespace: 'tasks_app'`). Without it, the scaffold binds the stack's only object.
- `--flow <flow>` names the flow an `action` runs. Without it, the action runs the stack's only flow.

**What is now refused, with nothing written.** In each case the command names what the stack declares and the command to run instead.

- A `flow`, `action` or `app` with no `--object` in a stack that declares no object, or several.
- `--object` or `--flow` naming nothing the stack declares.
- An `action` with no `--flow` in a stack that declares no flow, or several.
- A `view` whose name is not an object the stack declares. A view is still named after the object it binds: `objectstack generate view task` writes the views of `tasks_app_task`.
- Any of these four outside a project, where there is no config and so no stack to check the binding against.
- `--object` or `--flow` on a type that takes neither (`object`, `dashboard`, `skill`, `picklist`, and the `types`, `client` and `migration` routes), instead of reading as honoured.

**What the scaffolds now write.** Each was measured adding at least one finding to `os validate`, `os build` or `os lint`, and now adds none.

- `object`: the record's title field (`name`) and no `description` field. Nothing read the `description` field, so `field-no-consumers` reported it on every generated object as soon as the project held any view, flow, action, app, dashboard or skill.
- `view`: no container `name` or `label`. The container is registered under its `object`, so `name` could only restate that key or contradict it, and no reader reaches a container's `label`. Both were `liveness-dead-property` warnings. The list now carries the `label` that `os lint` requires (`required/label` was an error). Its columns are every field the bound object declares, and it is sorted by the object's title field. It used to show a fixed `name` column, which an object without a `name` field refused.
- `flow`: `status: 'active'` in place of `'draft'`. A draft flow already fires its trigger (only `obsolete` and `invalid` disable one), so the runtime behaviour is unchanged. `flow-draft-status-ambiguous` warned on every scaffold.
- `action`: `locations: ['record_header']`. With no placement, `action-no-placement` warned that the button renders nowhere.
- `app`: its navigation entry opens the bound object and is labelled with that object's plural label.

**What to write instead.** Name the object a flow, action or app binds, for example `objectstack generate flow task_done --object task`. Name the flow an action runs when the stack has more than one, for example `objectstack generate action complete_task --object task --flow task_done_flow`. Run the command in the project's directory. Generate a view under the name of an object the stack declares.

**Unchanged.** `objectstack generate object`, `dashboard`, `skill` and `picklist`, and every name, namespace, parse and import check in front of the bindings. Files generated by earlier releases are not touched.

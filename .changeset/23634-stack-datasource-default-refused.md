---
'@objectstack/spec': minor
---

feat(spec)!: a stack's `datasources` collection refuses a datasource named `default`, the name the host reserves for its primary datasource

Clause-②: no (narrowing)

<!-- adr-0087: registered stack-datasource-host-reserved-name-refused -->

**BREAKING**: an accept-set narrowing on one collection of the stack definition, shipped as `minor` under the launch-window convention for accept-set narrowings. No config that boots today is newly refused: every boot already refused this one.

`default` is the host's primary datasource. The runtime declares and connects it itself, and the app plugin refuses a stack that declares it in every boot posture (with `OS_DATABASE_URL`, with `--dev`, and on the standalone path):

> app 'APP_ID' declares a datasource named 'default' — that name is reserved for the host's primary datasource.

`defineStack` and `os validate` accepted the same stack, so its author met that refusal only after the boot's earlier plugins had started. The stack's `datasources` collection now refuses the entry at authoring, located at `datasources.N.name` (the map form `datasources: { default: { … } }` is refused the same way), with the runtime's sentence and its remedy:

> This stack declares a datasource named 'default' — that name is reserved for the host's primary datasource, and every boot refuses a stack that declares it. To give the project its own primary database, set OS_DATABASE_URL and omit this entry. To add a datasource of the stack's own, declare it under another name (e.g. 'app_primary') and route objects to it explicitly (an object's `datasource`, or a `datasourceMapping` rule).

`DatasourceSchema` is unchanged: it also documents the host's own `default` row, which keeps parsing.

### FROM → TO

| before | what to write instead |
| --- | --- |
| `datasources: [{ name: 'default', driver: 'sqlite', config: { filename } }]`, meant as the project's database | no entry; set `OS_DATABASE_URL` (e.g. `file:./data/app.db`) and the host connects it as `default` |
| the same entry, meant as a datasource of the stack's own | `datasources: [{ name: 'app_primary', … }]`, and route the objects that use it: `datasource: 'app_primary'` on the object, or a `datasourceMapping` rule naming `app_primary` |

**The one-line fix: drop the `default` entry and set `OS_DATABASE_URL`, or rename it and route objects to it.** `os migrate meta --from 17` lists the D3 entry `stack-datasource-host-reserved-name-refused`; the rewrite is by hand, because which of the two the entry meant is the author's call.

**Measured producers.** None in this repository (examples, `create-objectstack`, skills, docs); the one instance found was an agent-written measurement fixture.

---
'@objectstack/cli': minor
---

fix(cli): **BREAKING** — `os generate schema` is retired, and it now says why and points at `os validate` and the per-type JSON Schemas `@objectstack/spec` publishes (#19098)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A CLI COMMAND NAME is an invocation surface, not authorable metadata. There is no authorable key, no `sys_metadata` row and no schema to tombstone here, so there is nothing for `objectstack migrate meta` to rewrite, nothing for `spec-changes.json` to project and no FROM -> TO spelling for the upgrade guide to carry: the ruling generates no replacement file, so there is no call to rename, only one to delete. Nor is the ledger the notification channel: the command itself now refuses, exits 1 and names `os validate` and the published per-type schemas at the exact moment and place of use. Same reasoning shape as the `os g agent` retirement, one command over. -->

**⛔ If a script, a Makefile or a CI step in your project runs `os generate schema`
(or `os g schema`), it will now exit 1 and write nothing.** That is the intended
outcome: the command is gone by maintainer ruling, and the failure is how you find
out. Nothing in this repository reads the file it wrote.

`minor`, not `major`: during the launch window this stack ships breaking changes as
`minor` (pre-1.0 semantics under lockstep versioning — see
`scripts/check-changeset-no-major.mjs`).

**What the command actually did.** `os generate schema` wrote
`objectstack.schema.json`, a JSON Schema of the whole stack definition for an editor
to check `objectstack.config.ts` against. It projected `ObjectStackDefinitionSchema`
through a bare `z.toJSONSchema`, so the refinements the platform enforces beyond the
shape — a non-blank string, a required one-of, a banned key — were missing from the
file. Measured against the published projection on the tree the ruling was made on,
the file lacked 874 keywords, every one of them an absence. An editor pointed at it
reported a config as valid, and the platform then refused that config.

**Why it is retired rather than repaired.** A TypeScript configuration is typed by its
own `define*` helper, and `objectstack.config.ts` is typed end to end by
`defineStack`, so no config format this CLI loads is one an editor validates against
a JSON Schema. JSON metadata already has the per-type schemas `@objectstack/spec`
publishes, which carry the published projection. Repairing the command would have
added a permanent public export to `@objectstack/spec` for a file with no reader. The
ruling generates no replacement file. What you see now:

```
  ✗ `os g schema` was retired — its JSON Schema passed configs the platform refuses (maintainer ruling).

  The file it wrote described only the shape of a stack. Every rule the
  platform enforces beyond that shape — a non-blank string, a required
  one-of, a banned key — was missing from it, so an editor showed a config
  as valid and the platform then refused it. By maintainer ruling it is
  retired, not repaired, and no replacement file is generated.

  Check a project against the rules that actually run:

      os validate

  For JSON metadata, point your editor at the per-type schemas that
  @objectstack/spec publishes. They state the rules a JSON Schema can
  express, and name the ones it cannot under `x-dropped-refinements`:

      node_modules/@objectstack/spec/json-schema/<category>/<Type>.json

  `objectstack.config.ts` needs neither: `defineStack` types it in your
  editor. Delete the `os generate schema` call, and any editor setting
  that maps `objectstack.schema.json` — nothing writes that file now.

  Docs: https://objectstack.ai/docs/deployment/cli
```

**What to do.** The refusal's pointer is the whole of it. Delete the
`os generate schema` call, and any editor setting that maps `objectstack.schema.json`
(a `json.schemas` or `yaml.schemas` entry, for example). Run `os validate` to check a
project against the rules that actually run. For JSON metadata, point the editor at
`node_modules/@objectstack/spec/json-schema/`, one file per metadata type. There is no
call to rename: nothing replaces the command.

**Reach outside this repository is NOT MEASURED.** There is no telemetry, so whether
any project runs the command or reads its file is unknown. Inside this repository
nothing does: no reader and no editor mapping of `objectstack.schema.json` exists.
If these release notes also record that `os generate schema` can now write its file,
this retirement supersedes that repair.

**Two neighbouring answers change with it.** The retirement ledger is now read before
the command routes its sub-commands and before it asks for a `<name>`, which is what
lets `os generate schema` (no name) reach the refusal at all. So `os g agent` with no
name now prints the agent retirement instead of `Missing required argument: <name>`.
The ledger lookup also reads its own keys only: `os g constructor <name>` used to be
taken for a retired type and crashed with a `TypeError`, and it now falls through to
the ordinary type checks.

The docs row that advertised the command — "Autocomplete and validation for
`objectstack.config.ts` (via `os generate schema`)" in
`content/docs/api/data-flow.mdx` — is gone, with the diagram's JSON Schema node above
it.

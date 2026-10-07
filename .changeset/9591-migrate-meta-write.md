---
"@objectstack/cli": minor
---

`os migrate meta --write` writes the chain's mechanical changes into the authored source files, in place, at every site it can prove

Clause-②: yes (widening)

- A new flag on the authored-source mode: `os migrate meta --from N --write`. Without it nothing changes: the dry run, its report and its `--json` payload are what they were, and `--out` still writes its snapshot.
- What it writes: each mechanical change the chain applied (`applied`), at a site it traces to one object or array literal in one project file — through `define*` calls and the `.create(…)` factories `@objectstack/spec` exports, module-level `const` bindings, relative imports and re-exports, and `Object.values()` over a namespace import — when the loaded value matches that literal and nothing else references the bindings on the way. Only that site's bytes change: a renamed key keeps its value and its comments, a removed key takes its own line(s), and every other byte (comments, formatting, key order) stays as it was.
- What it refuses, each change listed with the reason (`--json`: `write.manual[].kind`): `computed`, `helper`, `spread`, `shared`, `outside-project`, `mismatch`, `injected`, `unspellable`, `layout` and `unattributed`; and `entangled`, because a conversion's edits are written whole or not at all.
- What it never writes: the semantic changes (`todos`), which stay listed exactly as before, and a site a conversion declines, for which no mechanical change exists.
- After writing it re-runs the chain over the written sources. Unless the re-run applies exactly the changes it left, it restores every file it wrote and exits 1.
- `--json` gains a `write` key, only with `--write`: `status`, `files`, `written`, `manual`, `unexplained` and `verification`.
- `--write` is exclusive with `--stored`; `--stored --apply` is unchanged.

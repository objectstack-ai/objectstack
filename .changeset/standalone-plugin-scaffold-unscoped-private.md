---
'@objectstack/cli': patch
---

`os create plugin` names the standalone scaffold `plugin-<name>` and marks it `private`

The default (standalone) emission wrote `"name": "@objectstack/plugin-<name>"` into a
project scaffolded for a developer outside this monorepo — a scope they cannot publish
to — and did not mark the manifest `private`. Nothing failed at scaffold time: the name is
never resolved from a registry inside the project, so `pnpm install`, the type-check and
the scaffold smoke were all green on it, and the cost landed later at `npm publish`. The
emitted README compounded it by instructing `pnpm add @objectstack/plugin-<name>`.

The standalone default now emits:

- `"name": "plugin-<name>"` — unscoped, and the same string as the directory the
  scaffolder prints and creates;
- `"private": true` — the line that actually stops an accidental publish, whatever the
  name says;
- a README whose install instruction is a local reference (`pnpm add link:../plugin-<name>`)
  and whose import specifier matches the emitted package name.

`os create plugin --in-repo` is unchanged: it still emits a publishable
`@objectstack/plugin-<name>` with no `private` flag, because that placement lands under
`packages/plugins/` where every sibling genuinely carries that scope.

No action is needed for a project already scaffolded. If you generated one with the old
name and have not published it, rename `package.json`'s `name` to `plugin-<name>` (or a
scope you own) and update the README's install line; the exported symbol and the plugin's
runtime `name` are unaffected.

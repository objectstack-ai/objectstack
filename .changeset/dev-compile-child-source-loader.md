---
"@objectstack/cli": patch
---

Stop `os dev` handing its auto-compile child an environment that activates
oclif's TypeScript source loader — `pnpm dev` could not boot an example app.

`os dev` auto-compiles when `dist/objectstack.json` is absent, by spawning
`os compile`. That spawn set a hard-coded `NODE_ENV: 'development'`, which
activates oclif's tsx source loader. tsx honours the **cwd** tsconfig's
`paths`, and example apps map workspace packages to their TypeScript source
there (`@objectstack/formula` → `../../packages/formula/src/index.ts`). Those
packages are CommonJS, so the redirect lands on a `.ts` file and Node's CJS
resolver then walks its sibling imports, which it cannot resolve:

```
Cannot find module './registry'
Require stack:
- packages/formula/src/index.ts
✗ Compile failed — fix errors above before starting dev server
```

A **type-resolution directive leaking into runtime resolution**. Measured, the
failures map 1:1 onto each app's `paths` entries: app-showcase (two entries)
failed on both specifiers, app-crm (one) on one, app-todo (none) on none. The
import spelling was never the variable — `plugin-email` already ships the
explicit `./email-plugin.js` extension and failed identically. The `paths`
blocks are correct too; they are mandated by `check:type-source-resolution`.

`os environments bind --build` carried the identical spawn and is fixed with
it. `os start`'s compile spawn and `os dev`'s watch-mode recompile already
passed `process.env` unmodified, as did the `os serve` spawn, whose NOTE had
documented this hazard for months on one of the call sites that needed it.

Patch, not minor: no flag, command, contract or output changes. `compile`
reads `NODE_ENV` nowhere, and the emitted artifact is identical leaf-for-leaf
apart from the `/runtimeModule` bundle hash, which differs between two runs of
the *same* command anyway because the bundle embeds `builtAt`.

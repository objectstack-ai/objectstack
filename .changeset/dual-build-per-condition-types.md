---
"@objectstack/cloud-connection": patch
"@objectstack/lint": patch
"@objectstack/mcp": patch
"@objectstack/metadata-core": patch
"@objectstack/metadata-fs": patch
"@objectstack/metadata-protocol": patch
"@objectstack/metadata": patch
"@objectstack/observability": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/rest": patch
"@objectstack/runtime": patch
"@objectstack/service-analytics": patch
"@objectstack/service-automation": patch
"@objectstack/service-cache": patch
"@objectstack/service-cluster-redis": patch
"@objectstack/service-cluster": patch
"@objectstack/service-datasource": patch
"@objectstack/service-i18n": patch
"@objectstack/service-job": patch
"@objectstack/service-knowledge": patch
"@objectstack/service-messaging": patch
"@objectstack/service-package": patch
"@objectstack/service-queue": patch
"@objectstack/service-realtime": patch
"@objectstack/service-settings": patch
"@objectstack/service-storage": patch
"@objectstack/verify": patch
---

fix(build): give each `exports` condition its own `types` target in the 28 dual-build packages (#13112)

**Published-surface change, zero runtime change.** No emitted byte moves; what
moves is which declaration file a resolver READS. Maintainer ruling 2026-08-29
(decision batch #3, verbatim 「同意」) chose declaring the files over deleting
them.

## What was wrong

These 28 packages are `"type": "module"` and dual-built, and each spelled one
`types` condition as a **sibling** of `import`/`require`:

```json
"exports": { ".": {
  "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs"
} }
```

A sibling `types` answers for **both** conditions, so a CommonJS consumer was
handed `dist/index.d.ts` — an ES-module declaration, because the package is
`"type": "module"` — for an entry point it reaches with `require`. Measured with
`tsc --traceResolution` on a `"type": "commonjs"` fixture at `moduleResolution:
node16`:

```
error TS1479: The current file is a CommonJS module whose imports will produce
'require' calls; however, the referenced file is an ECMAScript module and cannot
be imported with 'require'.
```

The JavaScript at `dist/index.cjs` loads perfectly (`check:dual-build-cjs-loads`
has asserted that for months). It is the **types** that told the consumer the
supported `require` entry point could not be required. The `dist/index.d.cts`
twin tsup emits beside it — 36 files, 5,517,701 B on this build — was named by
no condition at all and shipped in every tarball unreachable.

## What changed

Each condition now names its own declaration, the shape TypeScript documents:

```json
"exports": { ".": {
  "import":  { "types": "./dist/index.d.ts",  "default": "./dist/index.js" },
  "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
} }
```

33 entry points across 27 packages, subpaths included. The root `types` field is
untouched, so `node10` resolvers are unaffected; the `import` condition resolves
exactly what it resolved before, measured as an unchanged control in the same
run.

## `@objectstack/core` is deliberately NOT changed

Splitting a declaration in two makes TypeScript compare it nominally, and
`ObjectKernel` carries a `private plugins` member that reaches every plugin
through `PluginContext.getKernel()`. With core split, whole-repo `pnpm build`
fails in `@objectstack/verify` with 5 × TS2345 ("Types have separate
declarations of a private property 'plugins'"); with core held back and the
other 27 split, 71/71 tasks pass. So core keeps the sibling-`types` shape and
its two `.d.cts` files (220,854 B) stay unreachable, declared as such in
`check:dual-build-cjs-loads`. Splitting it needs a decision about core's public
types, not about an exports map.

## For consumers

- **ESM consumers: nothing changes.** Same declaration file, byte for byte.
- **CJS consumers under `node16`/`nodenext`: TS1479 goes away** and the
  declarations they get are the ones built for CommonJS.
- **`node10` / `moduleResolution: node` consumers: nothing changes** — they never
  read `exports`.
- Nothing is removed: every path that resolved before still resolves.

Packages that are CJS-first (`require` → `./dist/index.js`, no `"type": "module"`)
were already correct and are untouched — their `dist/index.d.ts` really is the
CommonJS declaration. Their ESM mirror (an unreachable `.d.mts` under the
`import` condition) is a separate, larger population and is filed separately per
the ruling, not fixed here.

`check:dual-build-cjs-loads` grew a fourth invariant (TYPED) that reds on the old
shape, so the drift cannot return silently.

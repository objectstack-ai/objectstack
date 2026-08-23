---
"@objectstack/console": patch
---

Correct the published `@objectstack/console` README's account of how the CLI
resolves the Console SPA (#11262). `README.md` is in this package's `files`
array, so it is the page npm renders.

The README claimed `resolveConsolePath()` "prefers `@objectstack/console` and
falls back to `@object-ui/console` when present — so cloud's Docker overlay
(which `cp -r`s its build over `node_modules/@object-ui/console`) keeps
working." Both halves are false against
`packages/cli/src/utils/console.ts`:

- There is no `node_modules` fallback to the `@object-ui/console` npm
  package. Strategy 1 (`require.resolve('@objectstack/console/package.json')`
  from the app and from the CLI itself) and strategy 2 (direct
  `<cwd>/node_modules/@objectstack/console`) each require the resolved
  `package.json` to be named `@objectstack/console`. The legacy package is
  never consulted; the function's own header says so.
- `@object-ui/console` survives in exactly one branch — strategy 3, the
  sibling-repo dev fallback, which matches the `name` field of a checked-out
  `../objectui/apps/console` **source** tree. That is a source-checkout
  probe, not a package resolution, and the corrected text keeps the two
  apart.
- The trailing consequence was the load-bearing half: cloud and objectos
  Docker images overlay into `@objectstack/console`'s `dist/`, so the README
  was telling an operator their overlay works by a mechanism that no longer
  exists. Replaced with the real overlay target.

Documentation only — no runtime, type or export change. The removal of the
npm-package fallback was deliberate and is not restored here.

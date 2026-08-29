---
'@objectstack/metadata-core': patch
'@objectstack/service-cluster': patch
---

fix(metadata-core,service-cluster): stop emitting and publishing the CJS half of `./testing` (#13013)

#13001 made both `./testing` subpaths ESM-only, dropping the `require` condition
that pointed at `dist/testing.cjs`. The build kept emitting those files and
`files: ["dist"]` kept packing them, so every release shipped bytes no exports
condition could reach. Measured with `npm pack --dry-run`, before → after:

| package | files | unpacked | dropped |
|---|---|---|---|
| `@objectstack/metadata-core` | 22 → 16 | 3.3 MB → 3.2 MB | `testing.cjs` (28.0 kB), `testing.cjs.map` (48.4 kB), `testing.d.cts` (9.4 kB), `chunk-H2D6OJ76.cjs` (4.2 kB) + map (10.6 kB), `repository-*.d.cts` |
| `@objectstack/service-cluster` | 15 → 12 | 364.1 kB → 336.9 kB | `testing.cjs` (11.9 kB), `testing.cjs.map` (14.5 kB), `testing.d.cts` (794 B) |

Nothing reachable changed. The whole ESM surface of both packages — `index.js`,
`testing.js`, their maps, the shared chunk, and every declaration the manifest
names — is **byte-for-byte identical** to the previous build (sha256, before vs
after). `index.cjs` changes only because what was a shared CJS chunk is now
inlined into the sole remaining CJS entry.

Each `tsup.config.ts` becomes an array of two configs split **by format** —
ESM keeps both entries, CJS takes `src/index.ts` alone. The split is by format
and never by entry: `index` and `testing` share a chunk carrying the error
classes, and one config per entry would give `testing.js` its own copies, so
`ConflictError` reached through `@objectstack/metadata-core/testing` would stop
being the class thrown by `@objectstack/metadata-core` — which the published
contract suite asserts (`.rejects.toBeInstanceOf(ConflictError)`).

`clean` moves out of tsup and into the `build` script (`rm -rf dist && tsup`).
tsup runs an array config through `Promise.all`, so the halves build
concurrently and a `clean` in either races the other's writes; the script-level
clean is also stronger than tsup's own, which preserves `*.d.{ts,cts,mts}` and
would therefore have left a stale `dist/testing.d.cts` behind on every rebuild
of an existing worktree.

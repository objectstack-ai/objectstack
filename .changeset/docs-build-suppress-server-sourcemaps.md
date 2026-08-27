---
"@objectstack/docs": patch
---

build(docs): stop emitting the 348 MB of server source maps the OOM-killed build was paying for (#12711)

Every `objectstack.ai` production deploy on 2026-08-27 died with `exit 137` and
Vercel's `errorCode: "out_of_memory"` on a 4-core/8192 MB build machine. The
build now declares `experimental.turbopackSourceMaps: false`, which suppresses
260 map files totalling 348 MB that no production serverless function reads.

The knob matters because of **where** the kill lands. Every failing log places it
between `Creating an optimized production build ...` and `Compiled successfully`,
with no output in between — inside the Turbopack compile phase, which the two
knobs already present cannot reach:

- `experimental.cpus: 2` bounds static-generation workers that have not spawned
  yet when the process dies.
- `NODE_OPTIONS=--max-old-space-size` bounds V8's old space, while Turbopack
  allocates from Rust outside it.

Measured on a local cold build of all 403 pages, as peak single-process RSS:

| config | peak | compile |
|---|---|---|
| before | 5191 MB | 22.6s |
| **`turbopackSourceMaps: false`** | **4757 MB** | **19.5s** |
| `turbopackScopeHoisting: false` | 4806 MB | 19.1s |
| `--max-old-space-size=2048` | 4734 MB | 18.0s |
| `turbopackFileSystemCacheForBuild: true` | 4779 MB | 22.2s |

Only the first row moves anything; the rest are noise, which is the measurement
that retires them as candidates rather than leaving them to be re-tried.

Set explicitly on purpose. Next documents this flag's build-time default as
following `productionBrowserSourceMaps` (false), but the server-side maps are
emitted regardless — naming it is what suppresses them.

Deliberately not paired with `turbopackMinify: false`, which takes a further
972 MB off the peak (3785 MB) and 3s off the compile: it inflates client JS from
5.8 MB to 16 MB (+176%), a cost every reader pays on every visit to save memory
in a machine they never touch. Confining minification to the server side — where
the memory actually goes, 589 MB of server chunks against 5.8 MB of client — is
not available: `experimental.serverMinification` is read only by
`dist/build/webpack-config.js`, never on the Turbopack path.

No output change beyond the absent maps: same routes, same 1221 prerendered
paths, same rendered bytes.

**This buys margin; it does not prove the ceiling is cleared.** The measurement
above is macOS/arm64 and the build container is Linux/x86_64, where the same
phase was measured at 7.6 GB (#12683) against local 4.7 GB — the ratio is the
transferable part, and −8.4% onto 7592 MB leaves roughly 15% headroom, which is
thin. #12683's option A (a larger build machine) is unaffected by this change and
remains the answer if the next production build still dies.

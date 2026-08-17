# Investigation harness — issue #9339 (watcher delivery mechanism)

**Not product code, not a fix, not wired into any gate.** These scripts exist so the next
seat on #9339 does not re-derive the measurements below from scratch. Nothing here changes
`packages/metadata-fs`.

Target: why an external `fs.writeFile` after `ready` produces no watcher event in 20s in
`packages/metadata-fs/test/watch-write-registration.test.ts` (the failure is at line 166,
`expected [] to include 'anchor'`).

## Prerequisites

```
pnpm --filter '@objectstack/metadata-fs^...' build
pnpm --filter '@objectstack/metadata-fs' build
cd packages/metadata-fs           # the scripts resolve `chokidar` from here
node ../../investigation/issue-9339/<script>.mjs
```

The scripts import the repository from `dist/`, so a stale build measures stale code.

## The scripts

| script | what it does |
|---|---|
| `probe.mjs` | Replays the test's anchor phase with every chokidar decision point traced (`raw` poll stats, `_handleRead`, `_handleFile`, `_emit`, `_remove`, `_awaitWriteFinish`). `--load=loop\|pool\|both` adds event-loop blocking / libuv-threadpool saturation. |
| `inject.mjs` | Forces ONE named gate on the delivery path to fail and prints the resulting observable. Modes: `none`, `mtime-tie`, `readdir-throttle`, `add-throttle`, `pending-write`, `awf-enoent`, `readdirp-miss`. |
| `gap.mjs` | Measures the mtime margin the single usable poll gets (see below). `--load` for the starved case. |
| `gran.mjs` | Measures this filesystem's directory-mtime granularity — the input the `mtime-tie` mode models. |
| `hog.mjs` | Plain CPU burner, for starving the box while the real vitest file runs. |

## What was measured

### The anchor phase has exactly ONE delivery attempt

`view/`'s mtime changes once, when `anchor.json` is created, and never again before the
failing assertion. `usePolling` re-reads a directory only when its stat advances, so poll
#2..#20 compare an unchanged stat. **The 20s deadline is worth exactly one poll; 200s would
be worth the same one.** Measured with `inject.mjs readdir-throttle --wait=20000`: the
injected throttle is released after 5s, yet 15 further poll ticks never rediscover
`anchor.json`. This is the structural reason behind #7282's empirical
"never delivered, not slow".

### Six independent gates sit on that single attempt, and all six look identical

`inject.mjs`, `--wait=6000`, one mode each:

| mode | events | seed registered | `anchor.json` in watched set |
|---|---|---|---|
| `none` | `["anchor:create"]` | yes | yes |
| `mtime-tie` | `[]` | yes | **no** |
| `readdir-throttle` | `[]` | yes | **no** |
| `readdirp-miss` | `[]` | yes | **no** |
| `add-throttle` | `[]` | yes | **yes** |
| `pending-write` | `[]` | yes | **yes** |
| `awf-enoent` | `[]` | yes | **yes** |

Every failing mode reproduces the CI signature exactly — `events` empty, line 155 green,
permanent. The failing assertion therefore **cannot** tell these apart.

### The one datum that would split them

`getWatched()[viewDir]` at failure time partitions the six into two disjoint classes
(the last column above): absent ⇒ the loss is upstream of `_handleFile`; present ⇒ the loss
is at or after `_handleFile`'s emit gate. The failing assertion does not record it.

### mtime margin (`gap.mjs`, n=40 each)

```
load=false  min=0.34ms  p50=2.21  p90=4.00  max=12.00
load=true   min=908ms   p50=3168  p90=3236  max=3292
```

`gran.mjs` on this host: 4000/4000 rapid directory mutations produced distinct mtimes
(sub-0.1ms resolution), so `mtime-tie` cannot occur here. On a coarse-clock kernel
(jiffy-granular mtime) the unloaded margins above would tie in 35/40 runs — which would
make the test red most of the time rather than rarely, and under load the margin is ~3.1s
where a tie is impossible. That is the argument against `mtime-tie` being the CI
mechanism; it is not a measurement of the runner's clock.

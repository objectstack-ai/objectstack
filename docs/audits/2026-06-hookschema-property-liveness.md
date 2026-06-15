# Audit: HookSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/data/hook.zod.ts`. **Consumers**: framework `objectql` (`hook-binder`, `engine`) + `runtime` sandbox (`quickjs-runner`, `hook-wrappers`, `body-runner`). Several behaviors confirmed empirically (condition gating, onError=log, retry, async all observed firing in showcase server logs).

## LIVE & necessary (this schema is healthy — almost everything is wired)
| property | evidence | note |
|---|---|---|
| `name` | `hook-binder.ts:182`, `hook-wrappers.ts:67` | registration key, ref source, log identity |
| `object` (single/array/`*`) | `hook-binder.ts:171,207`; `engine.ts:531` | wildcard honored |
| `events` | `hook-binder.ts:171`; `engine.ts:516` | per-event registration |
| `body.{language,source,capabilities,timeoutMs}` | `quickjs-runner.ts:72,88-90,136,239` | L1/L2 branch; caps gate host fns; timeout = min of default/opts/body |
| `handler` (deprecated) | `hook-binder.ts:237-248` | still fully wired; `body` takes precedence |
| `priority` | `hook-binder.ts:177`; `engine.ts:387` (sort asc) | **genuinely orders hooks** (lower first) |
| `async` | `hook-wrappers.ts:111` | fire-and-forget, after* only |
| `condition` | `hook-wrappers.ts:75-103,179-190` | CEL gate; falsy/error → skip |
| `retryPolicy.{maxRetries,backoffMs}` | `hook-wrappers.ts:105,137-147` | linear backoff |
| `timeout` (top-level) | `hook-wrappers.ts:113-131` | wall-clock abort, **independent** of body.timeoutMs; works for L1/L2/legacy handler |
| `onError` | `hook-wrappers.ts:160-175` | `log` suppresses+continues; `abort` rethrows |

Note: top-level `timeout` and `body.timeoutMs` are two distinct, both-live timeouts at different layers (declarative wrapper vs sandbox-internal).

## DEAD
- **`label`** + **`description`** — pure docs, zero runtime readers, redundant with each other (runtime uses only `name`).

## PARTIAL
- **`body.memoryMb`** — read and passed to `runtime.setMemoryLimit` but "advisory/best-effort" under QuickJS (no hard MB enforcement). Caps + timeout are hard; memory is soft.

## Recommendation
Drop `label` (keep `description`, or vice-versa). Document `memoryMb` as advisory (or enforce). Otherwise this is a model schema — near-total liveness. (Designer gap fixed separately: `retryPolicy`/`timeout` were missing from the hook form — added in a prior PR.)

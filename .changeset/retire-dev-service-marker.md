---
'@objectstack/spec': major
---

**BREAKING**: the legacy `_dev: true` service marker is retired. `readServiceSelfInfo()`
now reads exactly one marker — the standard `__serviceInfo` descriptor — and the
`SERVICE_DEV_MARKER_KEY` export is removed.

FROM → TO, for any service that self-identifies as not-fully-real:

```ts
// FROM — normalized to { status: 'stub', handlerReady: false }
const svc = { _dev: true, chat };

// TO — say which kind of unreal it is
const svc = {
  __serviceInfo: {
    status: 'stub',        // 'stub' = fabricates answers | 'degraded' = really serves, reduced capability
    message: 'Development stub — register <PluginName> for a real implementation',
  },
  chat,
};
```

`handlerReady` defaults to `false` for `stub` and `true` for `degraded`; set it
explicitly when the slot has no HTTP surface at all (`cache` / `queue` / `job`).

**Why it matters if you skip the migration:** a service still carrying `_dev: true`
reads as *unmarked* — i.e. as fully real — so discovery will report it
`status: 'available', handlerReady: true`, and dispatcher domains will call it
instead of refusing it. That is the "fake reported as real" failure ADR-0076 D12
exists to prevent, so migrate rather than leave the marker in place.

Removing rather than aliasing is deliberate: a boolean cannot express the
`stub` / `degraded` split every consumer gates on (a stub's domain refuses it, a
degraded implementation's domain keeps serving it). No producers remained in this
repo when the reader was deleted — plugin-dev's stub table was retired in
ADR-0115, and the kernel's in-memory fallbacks moved onto the descriptor in the
same lineage.

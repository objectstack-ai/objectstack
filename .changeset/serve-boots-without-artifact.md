---
'@objectstack/cli': patch
'@objectstack/core': patch
'@objectstack/metadata': patch
'@objectstack/runtime': patch
---

fix(cli,core,metadata,runtime): `os serve` boots with no compiled artifact — the platform does not need an application to start (#4085)

The artifact (`dist/objectstack.json`) defines an **application**. ObjectStack is
a development platform, so it has to start without one — but `os serve
objectstack.config.ts` died during boot whenever the artifact was absent:

```
  Loading objectstack.config.ts...
[StandaloneStack] artifact read FAILED: path='…/dist/objectstack.json' error=ENOENT…

  ✗ Service 'manifest' is async - use await
```

Exit 1 — on a **known-good app** (`examples/app-todo` fails the same way with
only its `dist/objectstack.json` moved aside), and on every freshly authored
project between `os init` and its first `os compile`. The message named neither
the missing artifact nor a fix, so it read as an internal kernel fault.

Three separate faults, each of which alone was enough to refuse the boot:

- **`serve` registered the config-derived `AppPlugin` before the stack's own
  `plugins[]`.** Registration order *is* the kernel's init/start order, and that
  slot sits ahead of `ObjectQLPlugin` (which registers `manifest`/`objectql`) and
  `DefaultDatasourcePlugin` (which connects the database the app seeds through).
  The wrap is now **appended** to `plugins[]`, the same slot
  `createStandaloneStack` gives its artifact-derived `AppPlugin` — so config-boot
  and artifact-boot share one plugin order. The artifact path never hit this,
  which is exactly what made a plugin-**order** bug look artifact-related.

- **`ctx.getService()` reported a never-registered service as "is async".**
  `PluginLoader.getService` is an `async` method, so its return value is *always*
  a Promise and its internal "not found" rejection can never surface
  synchronously — the kernel read the answer off that Promise and told every
  caller to `await` a service that did not exist, while the `not found` branch
  below it was unreachable. It now decides from the registry: absent ⇒
  `[Kernel] Service 'x' not found`, registered-but-uninstantiated ⇒ the unchanged
  `Service 'x' is async - use await`. The same crash now reads
  `[Kernel] Service 'manifest' not found`, which points at the layer that is
  actually wrong.

- **`MetadataPlugin` treated an absent `local-file` artifact as fatal.**
  `createStandaloneStack` always points it at `dist/objectstack.json`, so a stack
  with no app at all could not boot. A **missing** local artifact is now "nothing
  compiled yet": it logs, starts empty, and leaves the artifact watcher armed, so
  a later `os compile` hydrates the running server. The tolerance is
  ENOENT-only — a malformed or unreadable artifact stays fatal — and
  `bootstrap: 'artifact-only'` (sealed runtime, where the artifact *is* the
  deployment) keeps failing loudly rather than silently serving an empty runtime.

`[StandaloneStack] artifact read FAILED … ENOENT` is likewise no longer shouted
at callers for whom "no artifact" is a healthy state; a present-but-unusable
artifact keeps the loud warning.

Pinned by an e2e pair that drives the real `os serve` with **no `os compile`
anywhere**: an app defined only by `objectstack.config.ts` (asserting its object
is in the started plugin set, not merely that boot survived) and a bare
`export default {}` platform. The #4012 fixture drops the `os compile` this bug
had forced on it.

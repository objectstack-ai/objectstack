---
"@objectstack/metadata": patch
"@objectstack/runtime": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-webhooks": patch
---

Five `Plugin` implementations now release their resources from `destroy()`, the
only teardown hook the kernel calls (#10772).

`Plugin` (`@objectstack/core`'s `types.ts`) declares `init()`, `start?(ctx)` and
`destroy?()`. `ObjectKernel.performShutdown()` and `LiteKernel.destroy()` walk
the plugins in reverse calling `plugin.destroy()` — and nothing anywhere calls
`stop()`, `dispose()`, `close()` or `shutdown()` on a plugin. Each of these five
spelled its teardown with one of those names instead, so what it released was
still held after `await kernel.shutdown()` had **resolved**:

| package | class | was spelled | what outlived shutdown |
|:--|:--|:--|:--|
| `@objectstack/metadata` | `MetadataPlugin` | `stop` (arrow property) | artifact watcher, `manager.dispose()`, repository handle |
| `@objectstack/runtime` | `AppPlugin` | `stop` (arrow property) | the `app:unregistered` catalog event, never emitted |
| `@objectstack/runtime` | `ExternalValidationPlugin` | `stop` (arrow property) | every armed drift-check `setInterval` |
| `@objectstack/plugin-email` | `EmailServicePlugin` | `dispose` | two metadata subscriptions, the SMTP transport, an engine binding |
| `@objectstack/plugin-webhooks` | `WebhookOutboxPlugin` | `dispose` | the auto-enqueuer (2 realtime subscriptions + a refresh interval) and two engine hooks |

`ExternalValidationPlugin` is the one with teeth: it is one of only two `Plugin`
implementations in the tree that own `setInterval` directly, it is mounted on
the real `os serve` path, and its `stop()`'s only caller anywhere was the class
itself re-arming. Measured against a real kernel, its drift checker performed
five further reads in the five intervals after a resolved shutdown — the #9371
mechanism verbatim. `WebhookOutboxPlugin.dispose()` had **zero** callers in the
entire repo, so its teardown had never run in any process at all.

**Nothing is removed and no signature narrows.** Each old name is retained as a
delegating alias, because it is public API of an exported class and an embedder
may have learned to call it directly precisely BECAUSE the kernel never did.
`stop` stays an arrow property where it was one (so a detached
`const { stop } = plugin` keeps working) and stays synchronous on
`ExternalValidationPlugin` (so a non-awaiting call site is unaffected). The two
`stop(ctx)` aliases widen their parameter to optional.

One behavioural note for direct callers, since `destroy()` takes no context:
`MetadataPlugin.stop(ctx)` and `AppPlugin.stop(ctx)` now use the context
captured in `init()` and ignore the argument. In a real composition these are
the same object. The visible difference is confined to a plugin whose `init()`
never ran — for `MetadataPlugin` a dropped `warn` line, for `AppPlugin` a
catalog event that is no longer emitted for an app that was never registered.

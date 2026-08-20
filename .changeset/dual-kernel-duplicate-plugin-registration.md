---
"@objectstack/core": minor
---

fix(core): both kernels agree that a duplicate plugin registration OVERWRITES, and say so out loud (#9864)

Registering two plugins under the same `name` used to mean two different things
depending on which kernel was running:

| kernel | behaviour before |
|---|---|
| `ObjectKernel` (what `os serve` runs) | accepted and overwrote, with **no check and no distinguishing log line** — `Plugin registered: <name>@<version>` printed twice, reading as two plugins running |
| `LiteKernel` (tests, serverless, edge) | threw `[Kernel] Plugin '<name>' already registered` |

Under the maintainer's ruling (2026-08-19, option B) both kernels now apply one
declared contract: **duplicate registration by `name` overwrites — last-one-wins
— and emits a `warn` naming the plugin and both versions.**

```
WARN Plugin superseded: 'com.objectstack.audit' — the later registration (v2.0.0)
     REPLACED the earlier one (v1.0.0). Only the later instance is initialized and
     started; the earlier one is discarded without ever running init(). Duplicate
     registration by name is last-one-wins on both kernels by declared contract
     (#9864) — register the plugin once if that is not what you meant.
```

**This declares and warns about behaviour that already shipped; it does not fix a
user-visible bug.** The overwrite is load-bearing today — it is exactly what lets
a stack's own `plugins` entry supersede a plugin the CLI auto-registered earlier
in the same boot (`AuditPlugin`, #9863) — and every boot path that worked before
works the same way now. What changes is that the behaviour is declared, audible,
and pinned against **both** kernels
(`packages/core/src/plugin-registration.contract.test.ts`) rather than being an
accident of whichever kernel a reader happened to open. This was the fourth
measured instance of one contract implemented twice across the two kernels
(#5170, #5282, #8357 adjacent).

**What this changes for a caller**

- `LiteKernel.use()` no longer throws on a duplicate name. FROM: catch
  `[Kernel] Plugin '<name>' already registered` to detect a double registration.
  TO: there is no throw to catch — a duplicate is a `warn` and the later instance
  wins. Code that registered a plugin twice and relied on the refusal should
  register it once instead.
- `ObjectKernel` emits one `warn` where it previously emitted nothing, and
  **suppresses** its `Plugin registered:` line for the superseding registration,
  so the count of those lines equals the number of plugins that actually boot.
- The level is part of the contract: `warn`, never `info`. The CLI's default
  kernel level is `warn`, and its boot-quiet window replays `warn` while
  discarding in-window `info` — an `info` notice would be invisible on exactly
  the boot path where this was measured.

**Measured, not assumed:** the displaced instance holds nothing that needs
teardown. Registration is legal only while the kernel is `idle`, so a supersede
can only ever displace a plugin that has never been initialized; `init()`,
`start()` and `destroy()` all run later, over a registry the displaced entry has
already left. `PluginLoader.loadPlugin()` — which `ObjectKernel` runs first — is
pure validation plus a name-keyed map write of its own, and invokes nothing on
the plugin. Calling `destroy()` on the displaced instance would be the bug, not
the fix: it is the paired teardown for an `init()` that never ran.

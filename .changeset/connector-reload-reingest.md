---
"@objectstack/service-automation": patch
---

fix(service-automation): a metadata reload now reconciles declarative connectors instead of no-op'ing against a stale registry (#7742)

Editing a declarative provider-bound `connectors:` entry and reloading metadata
changed nothing: no teardown, no re-materialize, the pre-edit connector kept
serving until the process restarted. `os dev` masked it — it restarts the serve
child on recompile — but a **Studio package publish** into a running server
walked straight into it.

The reconcile's INPUT was the problem, not the reconcile. It read
`ql.registry.listItems('connector')`, which is a BOOT snapshot: the artifact
reload re-ingests OBJECT definitions into that registry (ObjectQL's own
`metadata:reloaded` handler) and nothing re-ingests connector items, so the
reconcile compared the boot world against itself and found nothing to do. Every
existing test drove the reload through a hand-mutated fake registry, which is
why it looked covered.

The reconcile (and the descriptor audit beside it) now reads the declaration
from the sources a reload actually refreshes, folded over that registry read:

- the **artifact carried on the `metadata:reloaded` payload** — the dev/HMR
  reload trigger, and the only place an edited or deleted connector definition
  exists. The fold is scoped to the packages the artifact speaks for, so a
  connector contributed by an unrelated plugin package survives a reload, while
  one deleted from the reloaded stack is torn down;
- **`protocol.getMetaItems({ type: 'connector' })`** — the flattened `/meta`
  view the flow re-sync already reads, which layers the `sys_metadata` rows a
  Studio publish promotes to active over the registry. Consulted on post-boot
  reconciles only; boot keeps its registry read, whose snapshot is current by
  construction.

Both reads fail safe: an absent, failing, or empty answer is treated as "no
answer" and never tears down a live connector, and an announcement carrying no
connector collection at all (a publish's bare `{ changed }`) leaves every
instance alone. An unchanged entry still hashes to the same signature and is
left untouched, so reloads do not churn live connections.

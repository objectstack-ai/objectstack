---
'@objectstack/runtime': patch
---

fix(runtime)!: an action route runs the handler of the item whose declaration it gated on (ADR-0150 D4)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` and no hand-written page under `content/docs/**` teaches which handler runs when two package-less owners register one under an action's key.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape: what moves is which registered handler a script action's dispatch runs, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a script action whose key holds handlers of more than one package-less owner. On every action door (`POST /api/v1/actions/:object/:action`, its `_env` address, MCP `run_action`, a host's `dispatchAction`), for a declaration that names no package:

- The environment's own action is a package-less row the environment's store holds, whether it is standalone, served inside its object's `actions`, or embedded in a stored object row. When the environment's slot holds the handler bound for it, it runs that handler, whichever owner registered a handler under its key last.
- When that handler is gone by the moment the call dispatches, the call answers the route's routing miss, `404`, and runs no other handler.
- A platform action runs the one shared handler under its key (host code's or a plugin's) when the handler above it was bound by the environment for an item that neither the environment's store nor its metadata service still holds.
- A store or metadata-service read that fails while the dispatch attributes the handler is refused `503`, and nothing runs.

**Not moved.** These dispatch as before:

- a package's action;
- an environment action whose handler the environment's slot does not hold: one with no `body` of its own, or a `body` no handler is bound for;
- an action the metadata service serves with no stored row: ownership is read from stored rows alone, so beside a shared handler under its key it keeps its dispatch;
- an action whose key holds only its own item's handler.

The fix for host code or a plugin that means its own handler to run: declare its action under a name the environment does not author on that object.

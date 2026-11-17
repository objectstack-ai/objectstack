---
'@objectstack/runtime': patch
---

fix(runtime)!: an action route runs the handler of the item whose declaration it gated on (ADR-0150 D4)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` and no hand-written page under `content/docs/**` teaches which handler runs when two package-less owners register one under an action's key.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape: what moves is which registered handler a script action's dispatch runs, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a script action the environment authored on an object whose key also holds a package-less handler registered by host code or a plugin. On every action door (`POST /api/v1/actions/:object/:action`, its `_env` address, MCP `run_action`, a host's `dispatchAction`):

- The environment's own action runs the handler bound for it in the environment's slot, whichever owner registered a handler under its key last.
- When that handler is no longer bound at the moment of dispatch, the call answers the route's routing miss, `404`, and runs no other handler.
- When the dispatch cannot read the environment's store to tell whose handler it would run, the call is refused `503` and runs nothing.

**Not moved.** A package's action, a platform action, and an environment action whose key holds no other owner's handler dispatch as before.

The fix for host code or a plugin that means its own handler to run: declare its action under a name the environment does not author on that object.

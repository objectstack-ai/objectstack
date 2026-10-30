---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix: `GET /meta/object` serves which packaged actions are switched off beside the item, and a switched-off action is refused with a plain sentence

Clause-②: yes (widening)
Metadata-protocol: added

- **Served beside the object** (`@objectstack/metadata-protocol`, `@objectstack/rest`). `GET /api/v1/meta/object/:name` serves `disabledActions` beside `item`: the names in `item.actions` that the deployment's activation ledger switches off. `GET /api/v1/meta/object` serves the same answer keyed by object name. The default cached door carries it too, read live on every call and kept out of the ETag, so a read that carries it is answered in full rather than `304 Not Modified`. The key is absent where no ledger answered (no engine, or an engine with no ledger attached), on a draft read, and on every type other than `object`. `item.actions` is unchanged. The protocol reads the engine's `getDisabledActions` through the kernel's service table by name and imports no engine.
- **The fact it serves** (`@objectstack/objectql`). `ObjectQL.getDisabledActions()` returns the names the engine's activation projection switches off, the same projection both dispatch doors consult before they refuse a call, or `undefined` when no ledger is attached. `listDisabledActions()` is unchanged.
- **The refusal sentence** (`@objectstack/objectql`, `@objectstack/runtime`). A switched-off action is still refused 409 `ACTION_DISABLED` at the REST and MCP doors, and the message now reads: "This action is turned off for this deployment. An administrator can turn it on again under Setup › Packaged automation, or you can use another action." It no longer names the ledger table or the ADR. The engine writes those, with the code and the action's name, to an `info` log line each time it refuses one.

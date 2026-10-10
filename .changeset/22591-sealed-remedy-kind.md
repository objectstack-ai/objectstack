---
'@objectstack/metadata-protocol': minor
'@objectstack/plugin-security': minor
---

fix(metadata-protocol): a create under a name a managed package or a built-in holds is told to choose another name, not to edit the source artifact (#22591)

Clause-②: yes

The public input surface widens: `packagedBaseRefusal` accepts `operation: 'create'`, and `tenantAuthoredWriteRefusal` takes an optional operation; no verdict, code or status moves.

A write onto an item a managed package ships, on a type with no environment overlay, is refused with `403 NOT_OVERRIDABLE`. The refusal's remedy used to assume the write was an edit of that item: "Edit the source artifact and redeploy", or, for a flow, an action or a permission set, its clone or on/off switch. That remedy is wrong for a create. An administrator who creates a position of their own under a name a package or a built-in already holds (`manager`, `everyone`, `guest`, …), or renames one into such a name, cannot edit a source artifact they did not write, and did not ask to customize the package's item.

The remedy now follows what the write did:

- **A create, or a rename into the name**, is told: the name is taken; to author your own item, choose a name no package or built-in holds, and `GET /api/v1/meta/:type` lists the names in use. This is one sentence for every metadata type.
- **An edit** keeps the sentence it had, byte for byte.

Which writes are refused does not change, and neither do the code and the status.

Where the remedy is a create's:

- **Setup** (`@objectstack/plugin-security`): a create of a `sys_position` row, or a rename into a name a package or a built-in holds, under the `single` posture. The data door relays the metadata door's refusal for a create.
- **The metadata door** (`PUT /api/v1/meta/:type/:name`): a save sent with `If-None-Match: *`, the first-write precondition (`parentVersion: null` in `saveMetaItem`). Any other save is an edit, as before.
- **`ObjectStackProtocolImplementation.packagedBaseRefusal`** takes `operation: 'create'` beside `'save'` and `'delete'`, for a door that knows its write takes a name. The verdict is the `'save'` verdict. `tenantAuthoredWriteRefusal` takes an optional `operation: 'create'` the same way.

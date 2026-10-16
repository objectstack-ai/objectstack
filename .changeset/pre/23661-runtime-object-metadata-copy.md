---
'@objectstack/objectql': patch
---

fix(objectql): the metadata service's copy of a runtime-authored object follows its saves and deletes after boot, so the MCP stdio door enforces an object's current API exposure and no longer lists a deleted object

Clause-②: no

On a kernel whose `ObjectQLPlugin` has no `environmentId` (the CLI host-config boot, the kernel factory, a control plane), the plugin copies every registry object into the `metadata` service once, at boot, and no authoring door wrote to that service afterwards. For a runtime-authored object (one saved through Studio, the REST metadata door or an AI author) the service's answer was therefore the boot body, or no body at all:

- **An object saved after boot had no copy.** The MCP stdio door gates every data verb on the copy's `enable.apiEnabled` and reads an absent copy as no declaration, so `query_records` was served on an object saved with `apiEnabled: false`.
- **An object re-saved after boot kept its boot copy**, so when its exposure was turned off `query_records` and `create_record` were served on it, and the create wrote a row.
- **A deleted object kept its copy**, so `list_objects` and `describe_object` still named it. Its data verbs were already refused by the engine.

The copy now follows the registry on the same signal every authoring door already emits (`onMetadataMutation`, which also reaches a cluster peer once its registry has converged):

- **A save refreshes the copy before the save returns**, through `registerInMemory` (synchronous, no persistence, no announce): the object's current `enable` is what the exposure gate reads. An object created after boot gets a copy.
- **A delete removes the copy**, once the stored row is gone and the registry no longer serves the name. If the object is created again while the removal is still running, the new copy is put back.
- **A code package's copy is never touched.** Only a copy of a runtime-authored object (the registry's owner row for the name is tenant-authored, or the copy already says so) follows the registry; the package copies the protocol restores baselines from stay exactly as the boot bridge made them.
- **A refresh that cannot land is logged at `error`**, naming the object, the consequence (readers of the metadata service keep the previous definition) and the way out.

Every other reader of `IMetadataService.getObject` and `listObjects` on such a kernel sees the same current definition. The runtime dispatcher's exposure gate (`refuseUnexposedDataAction`, which the HTTP MCP door's data verbs run through) is one: it allowed an object saved with `apiEnabled: false` after boot, and refuses it now. A project-scoped kernel (one built with an `environmentId`) does not run the boot bridge and is unchanged.

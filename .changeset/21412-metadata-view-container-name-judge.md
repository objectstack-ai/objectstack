---
'@objectstack/metadata': minor
---

One judge for a view container's own `name` at every door that files a container: the new `@objectstack/metadata/view-container-name` entry

Clause-②: yes

- New subpath `@objectstack/metadata/view-container-name`. It exports `viewContainerNameRefusal(container, sourceLabel, ownerId)`, the source registrars' entry, whose key is the object the container binds to (its own `object`, else `list.data.object` / `form.data.object`). It returns a `VALIDATION_ERROR` / 400 refusal for an aggregated view container whose own `name` is set and differs from that key, and `undefined` otherwise; a container with no `name`, and a standalone view record (`viewKind`), are not judged by it. The subpath also exports `savedItemNameRefusal(type, item, saveName, door)`, the runtime write doors' entry, which judges every metadata type against the name the row is written under, and the `ViewContainerNameRefusal` type both entries return.
- The artifact/HMR loader's container branch now refuses such a container through the judge, before it files anything. What it refuses and the envelope are unchanged (`VALIDATION_ERROR` / 400). The message is now the judge's, the words the ObjectQL boot loop and `os validate` print, where it was the generic `IMetadataService.register` contract's.

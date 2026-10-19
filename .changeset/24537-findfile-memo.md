---
'@objectstack/metadata': patch
---

fix(metadata): `FilesystemLoader` remembers which file a metadata name resolves to, so a repeated read stops probing the filesystem (#24537)

Clause-②: no

`FilesystemLoader` used to make one `fs.access` call per resolvable extension (five under `MetadataPlugin`'s format set) on every `load()`, `exists()` and `stat()`, for a name no file holds as well as for one a file holds. Every authenticated request paid this cost: the security catalog asks the metadata service for each held permission set the engine registry does not serve, and in an artifact-mode runtime no such file exists.

Each loader instance now remembers the answer for each `(type, name)`: the path, or no file. Only something that can change the answer retires it:

- a `save()` through the loader;
- a walk of the type's directory by the loader (`list()`, `loadMany()`, `loadManyKeyed()`), so a name `list()` reports is not answered `null` by `get()`;
- a read with `useCache: false`, which re-resolves from disk. The file watcher's re-read on an `added` or `changed` event is such a read;
- a remembered path that the next read finds deleted. That read resolves the name again from disk and logs no stat failure. This covers an `unlink` event, and a deletion that no event reports.

The memo holds at most 10,000 names and then starts over.

One change is not seen at once. Suppose a name has already been answered "no file", and then another process creates that file under the loader's root while no watcher runs (`watch: false`). The loader does not see the file until the next walk of that type, the next `save()` through the loader, or a restart. Content edits to a file that already resolves are still read on the next request. Nothing in the public API changes.

---
"@objectstack/metadata": patch
---

`RemoteLoader.list()` no longer reports a nameless remote body as a literal `undefined`.

The method declares `Promise<string[]>` and read the collection as `loadMany<{ name: string }>(type)` before mapping `items.map(i => i.name)`. That type argument is an **assertion** about bodies that arrived over HTTP, and nothing checked it: a body with no top-level `name` yielded `undefined`, which went into an array the signature declares as `string[]`. `MetadataManager.listNames()` unions loader `list()` output unfiltered, so the violation reached consumers — measured on this fixture, `listNames()` answered `[ 'account', undefined, 42 ]`.

The guard is `DatabaseLoader.list()`'s, one file away: the same cast-then-map spelling with `.filter(name => typeof name === 'string')` behind it. `RemoteLoader` was the only one of the four loaders in that directory with no guard at all — `MemoryLoader` answers with its store keys, and `FilesystemLoader` reports only names `findFile()` resolves. Dropping silently rather than throwing is the direction those siblings already carry: a name in the list that the door answers `null` for is the silent failure an author reads as their own typo, so the list is narrowed to agree with the door.

Nothing that was validly returned before stops being returned: the only entries that disappear are the ones whose type the signature already ruled out. A caller that previously received `[undefined]` now receives `[]`. `loadMany()` is deliberately untouched — it keys nothing, so a body carrying no `name` is still served there; this loader reads over HTTP and holds no store key, so `body.name` is the only identity it has and the family's "identity is the store key" rule cannot be satisfied for it.

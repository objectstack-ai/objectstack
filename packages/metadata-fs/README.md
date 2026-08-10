# @objectstack/metadata-fs

`FileSystemRepository` — Node-only implementation of the
`MetadataRepository` contract defined in `@objectstack/metadata-core`.

## Layout on disk

```
<root>/
  <type>/
    <name>.json          # canonical body of the item
  .objectstack/
    .log/
      main.jsonl         # append-only change log (one JSON object per line)
```

For example:

```
metadata/
  view/
    case_grid.json
    case_timeline.json
  object/
    case.json
  .objectstack/.log/main.jsonl
```

## Usage

```ts
import { FileSystemRepository } from '@objectstack/metadata-fs';

const repo = new FileSystemRepository({
  root: './metadata',
  org: 'system',
});
await repo.start();          // scan + open watcher — creates nothing on disk

const view = await repo.get({
  org: 'system',
  type: 'view', name: 'case_grid',
});

for await (const evt of repo.watch({})) {
  console.log('changed', evt.ref, evt.hash);
}
```

## Root creation is a write, not an attach

`start()` never creates `<root>`. Attaching a repository whose root does not
exist is legal: reads answer as if the repository were empty, and the root —
together with `<root>/.objectstack/.log/` — appears on the **first write**
(`put` / `delete`). This is what keeps a read-only boot, such as the dry run
`os migrate plan` performs on a project that has never been started, from
leaving a directory skeleton behind (#7000, the filesystem half of #6743).

One consequence worth knowing: when the root is absent at `start()`, the
chokidar watcher is armed by the first write instead, because chokidar cannot
watch a path that does not exist yet. A root brought into existence by a third
party while the process runs, without this repository ever writing, is
therefore not picked up until the next `start()`.

See ADR-0008 (incl. §0 amendment) and the `metadata-branch-removal` changeset.

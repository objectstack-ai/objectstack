---
"@objectstack/metadata-fs": patch
---

`FileSystemRepository` no longer creates its root directory when it is attached — only when it first writes.

`start()` used to `mkdir` both `<root>` and `<root>/.objectstack/.log` unconditionally, so merely attaching a repository was a write. Because `MetadataPlugin` attaches one at `<project>/.objectstack/metadata` during every boot, a command that never writes metadata still brought a directory skeleton into existence. The loudest case is `os migrate plan`, a declared dry run: on a project that had never been started it left

```
.objectstack/metadata/.objectstack/.log
```

behind, which also destroyed the one signal — does `.objectstack/` exist? — by which the next command can tell a fresh project from a started one. This is the filesystem half of the same property the database half already covers: a dry run leaves nothing behind.

Attaching and reading a repository whose root does not exist is now explicitly supported and answers as an empty repository (`get`, `getByHash`, `list`, `history`, `watch`). The root, the type directories and the JSONL change log all appear on the first `put` / `delete`, and nothing about the boot's read-only character changes: no metadata is written that was not written before.

One behavioural note for direct users of the package: when the root is absent at `start()`, the chokidar watcher is armed by the first write instead, because chokidar cannot watch a path that does not yet exist. A root brought into existence by a third party while the process runs — with this repository never writing — is therefore not picked up until the next `start()`.

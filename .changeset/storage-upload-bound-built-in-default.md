---
'@objectstack/service-storage': patch
---

fix(service-storage)!: every upload bound resolves by one precedence, and unset never means unlimited

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped and no stored row changes: `max_upload_mb` keeps its manifest key, type and declared default, and what moves is the bound a storage door enforces when no layer sets one, plus one optional constructor option (`maxUploadMb`) on the plugin, `mountStorageRoutes` and `registerStorageRoutes`. There is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** for a host whose storage doors had no upload bound because nothing set one. Each such host now enforces 100 MB per upload.

**The rule.** The three storage Limits keys (`presigned_ttl`, `session_ttl`, `max_upload_mb`) resolve by one precedence, highest first: a saved setting (an admin save or an env override), the host's option, the settings manifest's default, the built-in default. Unset never means unlimited.

- **Built-in default.** `max_upload_mb`'s built-in default is 100 MB (counted as MiB), the number the settings manifest declares. A drift pin holds the two equal.
- **Host option.** `maxUploadMb` on the `StorageServicePlugin` constructor, on `mountStorageRoutes` and on `registerStorageRoutes` is the host layer, exactly like `presignedTtl` and `sessionTtl`. It takes a positive number of MB, or `'unlimited'` for no bound. Any other value (`0`, a negative or non-finite number, a numeric string, any other string) refuses construction or the mount.
- **Failure paths.** A settings read that fails, and a saved value that is present but not a positive number, take the host option or else the built-in default, never no bound.
- **Coverage.** The bound applies wherever an upload is judged: the byte doors (the chunk `PUT`, the presigned local raw `PUT`, the upload-link `PUT` and its several-file form), the declared-size doors (presign, chunked start), and the server-side file verbs (`field-files`, `file-attachments` and the upload link's several-file spend).
- **Boot line.** Each host door says, once at boot or mount, the bound in force and the layer it came from: the plugin through its logger, `mountStorageRoutes` and `registerStorageRoutes` through the `logger` they are given. With an explicit `'unlimited'` the line is a `warn`, and it is said even when no logger was passed, on `console.warn`.

**Who moves.** Each of these moves from no upload bound to 100 MB:

- a DevPlugin-composed server;
- `--preset minimal` with storage;
- a `mountStorageRoutes` host over a bare adapter or over a plugin bound to no settings;
- an embedder that passes `bindToSettings: false`;
- a settings-bound host while its settings read fails;
- a host whose saved or env-sourced `max_upload_mb` is present but not a positive number (it was dropped, and nothing stood in its place).

Remedies:

- **A host that constructs the plugin** (`bindToSettings: false` embedders, `--preset minimal`, settings-fault hosts): one option, `new StorageServicePlugin({ maxUploadMb: 500 })` for another bound, or `maxUploadMb: 'unlimited'` to keep accepting uploads of any size (boot then says so at `warn`). A `mountStorageRoutes` or `registerStorageRoutes` host passes the same option for that mount's doors.
- **A DevPlugin-composed server**: DevPlugin constructs the storage plugin with no options, so turn its storage toggle off and mount the plugin yourself: `new DevPlugin({ services: { storage: false }, extraPlugins: [new StorageServicePlugin({ maxUploadMb: 500 })] })`, or list the `StorageServicePlugin` instance in the stack's own `plugins`, where an explicit instance wins.
- **A host with an invalid saved value**: correct the saved `max_upload_mb` (Setup's File Storage settings, or the env override) to a positive number. The saved layer cannot spell "no bound"; to accept any size, remove the saved value and pass the host option `maxUploadMb: 'unlimited'`.

**Unchanged.** A settings-bound host with nothing saved, which is the default `os serve`, already enforced the manifest's 100 MB and still does. A saved `max_upload_mb` still wins over every host option. The 18.5.0 note "with `max_upload_mb` unset a byte door states no bound and reads the whole body" no longer holds: with `max_upload_mb` unset a byte door states the host's bound or else the built-in 100 MB, and it states no bound only under an explicit host `'unlimited'`.

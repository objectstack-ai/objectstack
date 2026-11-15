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
- **Boot line.** One line at boot names the bound in force and the layer it came from. With an explicit `'unlimited'` it is a `warn`.

**Who moves.** Each of these moves from no upload bound to 100 MB:

- a DevPlugin-composed server;
- `--preset minimal` with storage;
- a `mountStorageRoutes` host over a bare adapter or over a plugin bound to no settings;
- an embedder that passes `bindToSettings: false`;
- a settings-bound host while its settings read fails.

The remedy for each is one host option: `new StorageServicePlugin({ maxUploadMb: 500 })` for another bound, or `maxUploadMb: 'unlimited'` to keep accepting uploads of any size (boot then says so at `warn`). Pass the same option to `mountStorageRoutes` for that mount's doors.

**Unchanged.** A settings-bound host with nothing saved, which is the default `os serve`, already enforced the manifest's 100 MB and still does. A saved `max_upload_mb` still wins over every host option. The "with `max_upload_mb` unset a byte door states no bound" note in this release's byte-door changeset is superseded: a byte door states no bound only under an explicit host `'unlimited'`.

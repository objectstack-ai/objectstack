---
'@objectstack/service-datasource': patch
---

The `sqlite-wasm` and `mongodb` arms of the shared datasource driver factory now tell you how to install the optional driver package they are missing (#7385)

All three of `sqlite-wasm`, `mongodb` and `turso` are built from OPTIONAL packages, so all three have to answer "the package is not here". After #7314 fixed the libSQL arm, the other two still answered with the fault and nothing else:

```text
sqlite-wasm driver requested but @objectstack/driver-sqlite-wasm is not installed (…).
mongodb driver requested but @objectstack/driver-mongodb is not installed (…).
```

No install command, no statement of what happens next, and not even the name of the datasource that failed — while the `turso` arm beside them stated all three. An admin who added a mongo datasource in Setup and one who added a libSQL datasource hit the same class of problem and got two different qualities of answer, decided by nothing but which driver they picked.

Both arms now answer through a shared builder, keeping the two discipline points #7384 landed under: the message NAMES THE DATASOURCE (several may be declared and only one of them is this engine), and it names exactly one fix with no escape hatch — no `OS_ALLOW_DRIVER_CONNECT_FAILURE` (it would only hide a package that does not exist) and no `OS_DATABASE_URL` / `--database` (they select the HOST's `default` datasource and can do nothing for the one that failed). The underlying import error is still interpolated in full, which is what keeps `isUnbuiltWorkspaceFailure` able to recognise a half-built checkout from these arms and re-route the remedy to `pnpm install && pnpm build`.

The consequence sentence is per-engine rather than copied. Mongo, like libSQL, is a server this process connects to, so a silent fallback would open a local database while the real server stayed untouched. `sqlite-wasm` has no remote to shadow, so it states its own truth instead: stepping down to the in-process memory driver would accept every write and drop it at shutdown, leaving the configured file empty, and stepping down to native `better-sqlite3` would need exactly the native addon a WASM datasource is chosen to avoid.

New exports, mirroring the libSQL pair, so a host that renders its own remedy reads one declaration instead of re-typing a command: `SQLITE_WASM_DRIVER_PACKAGE`, `SQLITE_WASM_DRIVER_INSTALL_COMMAND`, `missingSqliteWasmDriverMessage`, `MONGODB_DRIVER_PACKAGE`, `MONGODB_DRIVER_INSTALL_COMMAND`, `missingMongodbDriverMessage`.

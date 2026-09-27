---
'@objectstack/spec': minor
'@objectstack/driver-turso': minor
---

fix(spec)!: a turso datasource config the driver refuses, or ignores a key of, is refused where it is written

Clause-②: no (narrowing) — nothing is widened. No key is added, removed or renamed and no exported symbol moves. Combinations of `url`, `syncUrl`, `mode` and `timeoutMs` that the turso driver refuses when it is built, and one it builds and then ignores, are now refused at parse.

`TursoConfigSchema` (the `turso` / `libsql` `datasource.config` contract in `@objectstack/spec`, and the published mirror in `@objectstack/driver-turso`) parsed each key on its own. So it accepted configurations that `new TursoDriver()` refuses with `VALIDATION_ERROR` / 400: a datasource published clean and then failed at boot, or at a test connection. Measured on `main` before the change, both schemas accepting every row:

```
libsql:// (any scheme, any case) + syncUrl              -> constructor refuses
libsql:// + mode: 'replica' or mode: 'local'            -> constructor refuses
./data/app.db (a bare path), sqlite:, :MEMORY:          -> constructor refuses
:memory: or file::memory: + syncUrl                     -> constructor refuses
wss:// or ws:// + timeoutMs                             -> constructor refuses
libsql:// + mode: 'remote' + syncUrl (+ sync)           -> constructs; syncUrl ignored
```

On that last row the remote client is built without `syncUrl`, no sync interval starts, the driver's sync call rejects `SYNC_NOT_SUPPORTED`, and the driver still reports sync as enabled.

**BREAKING** accept-set narrowing on a published schema, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). Refused now, each as one `custom` issue on the key it names:

- **on `url`**, in a local or replica mode (a forced `mode: 'local'` / `'replica'`, or `syncUrl`, or a url that is not remote): a remote url (`libsql://`, `https://`, `http://`, `wss://`, `ws://`, in any letter case); a url that is none of a `file:` url, `:memory:` or a remote url, such as a bare path, another scheme, `:MEMORY:`, a remote scheme with no `//` or a blank url; and a replica on an in-memory url (`:memory:`, `file::memory:` in any case, with or without a query string);
- **on `timeoutMs`**: a window beside a `wss://` / `ws://` url in remote mode;
- **on `syncUrl`**: `syncUrl` under a forced `mode: 'remote'`. The constructor accepts this one, so it is refused at authoring only;
- **on `sync`**, in the `@objectstack/driver-turso` mirror only: `sync` with no `syncUrl`, in the words the spec contract has always used for it.

The rules mirror the constructor's own: a scheme matches in any letter case, `:memory:` matches exactly, and the url is read trimmed, as both datasource loaders hand it to the driver. A forced `mode: 'remote'` keeps its url unjudged, as the constructor does. Nothing the constructor accepts is refused, the `syncUrl`-under-`mode: 'remote'` row aside. The mirror declares no `mode` key and strips an authored one, so it judges every config in the mode its url and `syncUrl` select. A test in `@objectstack/driver-turso` holds the constructor and both schemas to one case table of 54 rows, with messages compared byte for byte.

The spec `url` describe named "a file path" among the accepted spellings, which is the one spelling the driver refuses. It now reads "a local file written as a file: URL (never a bare path)".

### Migration: FROM → TO

| You wrote | Write instead |
| --- | --- |
| `url: 'libsql://my-db.turso.io', syncUrl: 'libsql://my-db.turso.io'` | a remote database: `url: 'libsql://my-db.turso.io'` alone. An embedded replica: `url: 'file:./data/replica.db', syncUrl: 'libsql://my-db.turso.io'` |
| `url: 'libsql://my-db.turso.io', mode: 'replica'` (or `'local'`) | drop `mode`, or set `mode: 'remote'` |
| `url: './data/app.db'` | `url: 'file:./data/app.db'` |
| `url: ':memory:', syncUrl: …` | a replica on a file: `url: 'file:./data/replica.db'` beside `syncUrl`. An in-memory database: drop `syncUrl` and `sync` |
| `url: 'wss://my-db.turso.io', timeoutMs: 30000` | `url: 'libsql://my-db.turso.io', timeoutMs: 30000`, or drop `timeoutMs` |
| `url: 'libsql://my-db.turso.io', mode: 'remote', syncUrl: …` | drop `syncUrl` and `sync` |

Each refusal prints these ways out and names only a remote url's scheme, never the url, which may carry a token. Stored datasource rows are not re-parsed when they load, so a stored row keeps loading as before; creating, testing or editing its `config` through the datasource admin service, `defineStack` or `os validate` is refused at the key until it is rewritten. The constructor already refuses the first five rows at boot.

Blast radius, measured on this tree: no example, template, published skill or hand-written doc authors a refused combination. Four test fixtures spelled one and are rewritten in this change, each named in the PR: one in `@objectstack/spec`, two in `@objectstack/driver-turso` (one of them pinned a placeholder url as accepted), and the stored-row redaction fixture in `@objectstack/service-datasource`, now an embedded replica on a `file:` url. Loader fixtures in `@objectstack/runtime`, `@objectstack/cli` and `@objectstack/service-datasource` that spell a remote url beside `syncUrl` exercise only the config builder or a capturing constructor. They never parse this schema or build the real driver, and are unchanged. Whether any out-of-repo deployment declares such a config is NOT measured and is not claimed to be zero.

<!-- adr-0087: registered turso-config-transport-mismatch-refused -->

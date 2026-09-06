---
"@objectstack/driver-turso": minor
"@objectstack/spec": minor
---

feat(driver-turso)!: `timeout` bounds remote operations; `localPath` and `wasm` leave the published config schema (#16024, ADR-0049 enforce-or-remove)

<!-- adr-0087: registered driver-turso-config-local-path-wasm-retired -->

Three keys on this package's published Turso configuration were declared with a
describe promising behaviour that no code delivered — ADR-0049's
declared-but-unenforced shape, sitting beside `concurrency`, which was declared
the same way and IS forwarded. The maintainer ruled per key: forward `timeout`;
remove `localPath` and `wasm`. Not a rename for any of the three — an inert key
with a better name is what ADR-0049 exists to prevent.

**`TursoDriverConfig.timeout` now does what its docblock has always said.** It
never reached `@libsql/client`. It still does not reach that client's own
`Config.timeout`, and deliberately: measured against `@libsql/client@0.17.4`,
that option is the busy timeout for lock contention on local `file:` databases
("remote clients ignore it"), so forwarding to it would have left remote mode
exactly as inert as before. Instead:

- **Remote mode over HTTP** (`libsql://`, `https://`, `http://`): the driver
  hands the client a `fetch` that aborts every request once the window elapses,
  and the operation fails as `TIMEOUT` / 504 (the ADR-0112 envelope) instead of
  hanging on a stalled endpoint. `wss://` / `ws://` URLs ride the WebSocket
  transport, which exposes no such seam in this client version — they are not
  bounded, and the docblock says so.
- **Replica mode**: `sync()` — the one remote operation on that arm — rejects
  with the same envelope when it has not completed within the window. The native
  binding's sync is not cancelled, only no longer awaited.
- `0` or unset means no bound, as the published schema already documented.

A datasource authors this as `config.timeoutMs`; the datasource seam maps it
onto the driver's `timeout`, so a `timeoutMs` that used to be silently dropped
now bounds the connection it describes.

**BREAKING** — `TursoConfigSchema` refuses `localPath` and `wasm`. Neither was
read by any code: the replica arm names its local file via `url` (forwarding
`localPath` would have created a second way to say the same thing), and nothing
selects a WASM build of libSQL (forwarding `wasm` would have meant building
one). The shape is a plain `z.object`, so a bare deletion would have stripped
both keys in silence; they stay declared as `z.never()` tombstones instead —
`tsc` refuses them on anything typed `TursoConfig`, and a value reaching the
parse raises the prescription below rather than a generic unrecognised-key
error. The same treatment this package's `timeout` → `timeoutMs` rename took.

## Migration

| Wrote | Write instead |
| --- | --- |
| `localPath: './replica.db'` beside `url: 'file:./replica.db'` | delete `localPath` — `url` names the replica's local file, `syncUrl` the remote primary; a path that differed from `url` belongs in `url` |
| `wasm: true` | delete `wasm` — no WASM build was ever selected; a runtime that cannot load native bindings uses the remote arm (`libsql://` / `https://`), which needs none |

`@objectstack/spec`'s own turso contract never declared either key, so no stack
source or stored datasource row that passed the spec door can carry them; the
ADR-0087 ledger records the removal as the D3 entry
`driver-turso-config-local-path-wasm-retired` (no D2 conversion — there is no
lossless rewrite for a value that never did anything), which is the
`@objectstack/spec` `minor` here — the entry is a new member of the published migration
registry (`packages/spec/src/migrations/registry.ts`), an additive widening of that package's
surface, and the act sets the floor.

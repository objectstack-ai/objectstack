---
"@objectstack/driver-turso": minor
---

fix(driver-turso)!: `timeout` beside an UPPERCASE `WSS://` / `WS://` url in forced remote mode is refused at construction, closing the last corner of the same gap (ADR-0049 enforce-or-remove)

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing performed at the driver constructor: no key, spec symbol, Zod schema, object definition or stored representation is added, removed or renamed — `TursoDriverConfig.timeout`, `url` and `mode` keep their names and types, and `TursoConfigSchema` is untouched. What moves is which CONFIGURATIONS `new TursoDriver()` accepts — one predicate now compares the url's scheme case-insensitively, exactly as `@libsql/client` itself does before routing — so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The refusal is the one the lowercase spelling already produces, naming the key, the scheme it met and both ways out; which of the two an author wants is authoring intent no ledger line can decide. -->

The refusal that closed `timeout` beside a `wss://` / `ws://` url matched the two schemes **literally**, so one composition still constructed with a window that reaches nothing:

```ts
new TursoDriver({ url: 'WSS://db.example.turso.io', mode: 'remote', timeout: 30000 })
```

Reading `@libsql/client`'s routing switch alone says that cannot happen — the switch really does match the literal lowercase (`lib-esm/node.js`: `config.scheme === "wss" || config.scheme === "ws"`). But the switch never sees the url as the author spelled it. The node entry is `_createClient(expandConfig(config, true))`, and `expandConfig` has already lowercased the scheme by then — `@libsql/core@0.17.4`, `lib-esm/config.js`: `const originalUriScheme = uri.scheme.toLowerCase();`. Executed against that version: `expandConfig({ url: 'WSS://db.example.turso.io' }, true).scheme === 'wss'`, and `'Ws://127.0.0.1:8080'` → `'ws'`. So an uppercase `WSS://` url does reach the WebSocket client, which takes no `fetch` and no timeout option of its own — the driver constructed, connected, and ran unbounded.

**BREAKING** accept-set narrowing on a published driver option, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). **The constructor now refuses a configuration it accepted before**: a non-zero `timeout` beside an uppercase-or-mixed-case `wss://` / `ws://` `url` in remote mode throws at `new TursoDriver()` — ahead of the Knex base and of any client, so no half-built driver exists — with the ADR-0112 envelope `code: 'VALIDATION_ERROR'`, `status: 400`, and **the same message the lowercase spelling already produced**, echoing the scheme in the caller's own casing so an operator can grep their config for what they actually typed.

**The explicit `mode: 'remote'` is load-bearing.** Without it an uppercase url falls through `TursoDriver.detectMode` to `'local'` — behaviour that predates the refusal entirely and is **unchanged here**. Only the window predicate folds case; the mode detector is deliberately left case-sensitive, and the code says so at the predicate, because folding it there too would delete that fall-through: a mode-detection change on a published driver, which must be argued on its own rather than slipped in as a tidy-up.

**What stays accepted — the refusal is no wider than the gap**, pinned by controls:

- an uppercase url with **no** explicit `mode` still detects as `'local'`, with or without a `timeout`;
- the uppercase WebSocket url with no `timeout`, or with `timeout: 0` (the documented "no bound");
- `https://` / `HTTPS://` / `LIBSQL://` / `HTTP://` remote urls **with** a window — the HTTP arm is bounded, so every casing of every HTTP-side scheme keeps the key;
- the existing lowercase refusals, unchanged in code, message and envelope.

**What an affected author does.** Unchanged from the lowercase case, and the refusal text says it: keep the window and spell the url `libsql://` or `https://` (bounded — the client resolves `libsql://` to HTTPS), or drop the window and run the WebSocket remote unbounded, as it always did.

Blast radius, measured on this tree: no in-repo deployment, example, test or doc pairs an uppercase remote scheme with a window; the host boot path (`OS_DATABASE_URL`) forwards only `url` and `authToken`, and the datasource seam's `buildTursoDriverConfig` normalises no casing either — so the pair is reachable in principle from both and is not observed in this repository. Whether any out-of-repo deployment spells a Turso url with an uppercase scheme is NOT measured and is not claimed to be zero.

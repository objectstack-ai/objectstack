---
'@objectstack/spec': minor
'@objectstack/connector-rest': patch
'@objectstack/connector-openapi': patch
'@objectstack/connector-mcp': patch
'@objectstack/connector-slack': patch
'@objectstack/service-automation': patch
---

feat(spec)!: retire `connector.connectionTimeoutMs` — declared, bounded, defaulted, served back, and never applied as a deadline

**BREAKING** — `connector.connectionTimeoutMs` is removed. ADR-0049
enforce-or-remove; maintainer ruling 2026-09-22, letter A. It is the narrower
**second** decision this key was owed: the earlier ruling that made its nine
liveness siblings live (`retryConfig.*`, `requestTimeoutMs`) left this one dead
on a stated reason rather than by oversight, and `packages/spec/liveness/connector.json`
has been asking for this decision since.

The key was bounded (`min(1000).max(300000)`), defaulted (`30000`),
`.describe()`d, authorable on both carriers and served back by
`/meta/connector`. Every signal an authoring surface can give said it worked.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `connector.connectionTimeoutMs` (on `Connector` and on `DeclarativeConnectorEntry`, so `stack.connectors[]` and `PUT /meta/connector/:name`) | `requestTimeoutMs` — the deadline the platform keeps, applied as `resilientFetch`'s per-attempt timeout. For a connect-only bound, configure it at a connector provider or upstream gateway on a transport that can separate the phases. |
| `ConnectorProviderContext.connectionTimeoutMs` (handed to every `ConnectorProviderFactory`) | `ctx.requestTimeoutMs`, or the factory's own `providerConfig` where the provider owns the vocabulary. |

**The one-line fix: delete the key** — and, for a custom provider factory, stop
reading `ctx.connectionTimeoutMs`. `os migrate meta --from 17` lists the
mechanical edits for existing sources; apply them by hand.

⚠️ Runtime behaviour is **unchanged for every shipped provider**, because none
ever applied the value: a connector that authored `connectionTimeoutMs: 1000`
made exactly the same calls, with exactly the same deadlines, as one that did
not. What does change is observable and intended: the def served by
`GET /connectors` no longer echoes a connect deadline nobody keeps.

### ⭐ This is NOT the zero-mention retirement shape

Measured with `git grep -n connectionTimeoutMs SHA -- . ':!packages/spec'` at
`origin/main`: **thirteen** non-test source occurrences over seven files in five
packages — **six reads** (`openapi-connector.ts:242`, `openapi-provider.ts:193`,
`rest-connector.ts:134`, `rest-provider.ts:64`, `plugin.ts:307`,
`plugin.ts:1589`), **four type declarations**, and **three** surviving hardcoded
`30000` writes. Reading the retirement as "nothing referenced it" loses the
finding. Measured across all six reads, every one is a **pass-through**: the
value's only termini were the def `GET /connectors` echoes and the fingerprint
that decides whether to re-materialize. `connectorFetchOptions()` — the one
mapping from authored policy onto the platform's outbound `fetch` — was handed
`{ retryConfig, requestTimeoutMs }` only. Carrying a number is not honouring it,
and ADR-0049 forbids the parsed-unmarked-unenforced state whether the inert
value travels or sits still.

Nor was the `实现` arm available. A connector's outbound call is a WHATWG
`fetch`, whose only cancellation surface is ONE `AbortSignal` covering the whole
operation; nothing in that interface observes the connection phase. Bounding
"time until the response arrives" with this key would kill a slow-but-connected
upstream the author meant to allow with a large `requestTimeoutMs` — breaking
the very promise the key makes. (undici's `connectTimeout` needs a custom
dispatcher: Node-only, and a new subsystem underneath every connector, which the
ruling that made the siblings live forbids.)

### The retirement kit

- The **authorable key** is a `retiredKey()` tombstone on `ConnectorSchema`,
  registered as `integration/Connector:connectionTimeoutMs` and
  `integration/DeclarativeConnectorEntry:connectionTimeoutMs` in
  `RETIRED_KEYS_BY_MAJOR[18]`. The schema is not `.strict()`, so a bare deletion
  would strip an authored key in silence (ADR-0104): the tombstone is audible in
  both channels — `tsc` (input type `never`) and the parse, which raises the
  prescription itself. `DeclarativeConnectorEntrySchema` inherits it, so
  `stack.connectors[]` and the `/meta/connector` door refuse it too.
- **A D2 conversion, `connector-connection-timeout-ms-removed`** — one strip per
  `connectors[]` entry, a pure lossless delete. ⭐ The ruling left whether one was
  owed to be **measured** ("a D2 conversion only if a stored connector row can
  carry the key"). It can, and both legs were measured before the tombstone
  landed: `getMetadataTypeSchema('connector')` — what `PUT /meta/connector/:name`
  validates against — parsed a body carrying the key and its output **retained**
  the authored value, so the number reached `sys_metadata`; and
  `applyConversionsToStoredItem('connector', …)` is live for this type. Rows
  written on 17.x therefore replay clean.
- **A D3 semantic entry,
  `connector-provider-context-connection-timeout-ms-retired`**, for the withdrawn
  `ConnectorProviderContext` member. A provider factory is code: there is no
  authored source and no `sys_metadata` row for a conversion to rewrite, so the
  removal reaches a factory author as a `tsc` error and as that entry.
- **No def leaves.** The key was a bare `z.number()`, never a `ConfigSchema`
  shape, so `RETIRED_DEFS_BY_MAJOR[18]` gains nothing — and `api-surface/` and
  `json-schema.manifest/` are byte-identical, which is the correct reading for a
  key-only tombstone rather than a missed regeneration.
- `authorable-surface/integration.json` gains two `[RETIRED]` rows;
  `authorable-defaults/integration.json` loses the two `= 30000` rows.
- The liveness row **stays** `dead` with a `REMOVED` note, because `retiredKey()`
  keeps the key in the walked shape. Its previous note claimed "every occurrence
  outside `packages/spec` is a WRITE". That reading was **correct at the SHA the
  card cited and dated** (`0870fb5418` — exactly five non-spec source hits, all
  five `connectionTimeoutMs: 30000,`) and was superseded by `b929e0a662`, the PR
  the card itself flagged as pending. It is **stale, not false**, and the row now
  carries both readings with their trees rather than one undated claim.
- **An `acceptRetiredDefaultResidue` stage** (#12840), `{ connectionTimeoutMs: 30000 }`
  on both carriers. The key was `.optional().default(30000)`, so a 17.x parse
  materialized it into **every** connector — measured across two builds: the base
  build emits it for an entry that authored only `name`/`label`/`type`, and the
  tombstoned build refuses that exact object at `connectors.0.connectionTimeoutMs`.
  The D2 does **not** discharge this: `ObjectPermission:allowPurge` carries both,
  because `AutomationEngine.registerConnector` parses `ConnectorSchema` for a def
  a plugin builds **in code**, where no conversion runs. So the emitted `30000`
  is accepted-and-stripped while `15000` keeps the tombstone's refusal, and
  nothing is un-retired: `z.input` stays `never` and the `[RETIRED]` row stays.
- **No deprecation window** (maintainer 2026-08-27: 「项目在创业阶段，用户也很少，短期不考虑渐进」),
  and no staged retirement.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec`
is published, so this is breaking for consumers no download, dependent or source
telemetry was consulted for. The pinned sibling checkout **was** measured: zero
occurrences of the name at objectui `87af769e`, against a lit control on the same
command and scope, so no sibling fix or pin bump rides with this.

`Clause-②: yes (narrowing)` — a published authorable key is removed on two
carriers and a published interface member leaves `ConnectorProviderContext`, so
the accept set a consumer writes against narrows. Nothing is widened and nothing
is renamed. Contract-review tier.

<!-- adr-0087: registered connector-connection-timeout-ms-removed, connector-provider-context-connection-timeout-ms-retired -->

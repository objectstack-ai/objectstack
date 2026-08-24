---
'@objectstack/rest': patch
---

`GET /api/v1/discovery` reports the serving artifact's version instead of the
URL path segment the caller just typed

`registerDiscoveryEndpoints` called the producer and overwrote the answer one
line later:

```ts
const discovery = await protocol.getDiscovery();

// Override discovery information with actual server configuration
discovery.version = this.config.api.version;
```

`config.api.version` is the **API version identifier**, not an artifact
identity. `normalizeConfig()` defaults it to `'v1'`, `packages/spec`'s
`plugin-rest-api.zod.ts` describes it as "API version identifier", and the same
value builds the mount — `getApiBasePath()` returns
``api.apiPath ?? `${api.basePath}/${api.version}` `` → `/api/v1`. So on every
REST-served host, `GET /api/v1/discovery` answered `version: "v1"`: the segment
the caller had already typed to reach the endpoint, on every build of every
release, forever.

`DiscoverySchema` declares `version` under **System Identity**, grouped with
`name` and `environment` — the "what server is this" question. The #10993
ruling settled that reading and #11235/#11242 reaffirmed it. The override is
now gone and the producer's derived value reaches the wire.

**What changes on the wire.** `version` on this endpoint was `"v1"` and is now
the value `getDiscovery()` derives: `OS_RUNTIME_VERSION` when a deployment or
build pipeline stamps one, else the resolved `@objectstack/metadata-protocol`
package version, else `"unknown"`. That is the same stamp `/health` and the
runtime dispatcher's own `/discovery` already read, so the two discovery
producers now give one answer rather than two dialects of one field. Before
#11297 this override masked two producers that genuinely disagreed (`'1.0.0'`
vs `'1.0'`); after it, it was overwriting a value that already agreed.

**The API-version fact is not lost.** Every entry in the same document's
`routes` is prefixed with the mounted base path, which is built from
`api.version` — recoverable from the same response, in the field that means it.
No schema change, no new field: the accept set and the public surface are
unchanged, and `api.version` still does its real job of building the mount.

Pinned in `packages/rest/src/discovery-schema-conformance.test.ts`, which drives
the **real** producer through the **real** handler. The assertions pin
provenance, never a literal version string — a stamp injected by the test must
appear on the wire, and the served value must equal what the producer answers
when called directly, including on a server configured with a different
`api.version` (where `routes.data` is asserted to still carry that segment). A
pin spelling a literal would rot at the next release.

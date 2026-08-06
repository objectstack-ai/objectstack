---
"@objectstack/spec": minor
"@objectstack/runtime": minor
"@objectstack/metadata-protocol": minor
"@objectstack/client": patch
---

feat(spec,runtime,metadata-protocol,client)!: one closed capability vocabulary — every discovery producer emits every key (#5672)

`#4828` renamed the runtime dispatcher's top-level `features` map to the
canonical `capabilities`, which collapsed the *spelling* split between the two
discovery producers. It did not touch the deeper one: the two went on filling
**disjoint key sets**.

| producer | keys it filled |
|:---|:---|
| `getDiscovery()` — `@objectstack/metadata-protocol`, upstream of REST `/discovery` | `comments` `automation` `cron` `search` `export` `chunkedUpload` `transactionalBatch` |
| `getDiscoveryInfo()` — `@objectstack/runtime` dispatcher, `/.well-known/objectstack` | `search` `websockets` `files` `analytics` `ai` `notifications` `i18n` |

Only `search` overlapped. `DiscoverySchema.capabilities` was an open
`z.record`, so both shapes parsed clean and no gate could see the split — while
`packages/client`'s `capabilities` getter **asserted** the result was a
`WellKnownCapabilities`. Against a dispatcher-served host
`client.capabilities.transactionalBatch` was therefore statically `boolean` and
actually `undefined`, as were `comments`, `cron`, `export` and `chunkedUpload`.

Per the maintainer's 2026-08-06 ruling, the vocabulary is now closed and
mandatory.

**What a consumer sees.** Before: which capability flags exist depended on
which kind of host answered, and a flag you were typed to receive could simply
be missing. After: every discovery response carries **every** flag, always a
boolean. A capability the host does not deliver is `enabled: false` — never an
absent key — so a client can read a flag without knowing whether it reached a
dispatcher, the REST endpoint, or anything else. `client.capabilities` no longer
asserts its own return type: it enumerates the spec's key list, so the type is
true by construction, and it reads a key an older server omits as `false`
(fail-closed, matching the wire rule).

**`@objectstack/spec`.** `WellKnownCapabilitiesSchema` becomes the one
vocabulary and gains the six flags that were previously the dispatcher's alone
(`websockets`, `files`, `analytics`, `ai`, `notifications`, `i18n`) — all six
were already real answers on the wire, so this declares them rather than
inventing them. `DiscoverySchema.capabilities` changes from an optional open
record to a **required closed object** derived from that vocabulary, one entry
per key. New exports: `WELL_KNOWN_CAPABILITY_KEYS` (the key list, derived from
the schema so nothing can hand-list a fourth dialect) and
`CapabilityDescriptorSchema` / `CapabilityDescriptor` (the `enabled` +
optional `features` / `description` entry shape, previously inline).

Required, not optional, is the `scoping` precedent read the other way round:
`scoping` is optional because only one producer can honestly answer it, whereas
every producer can answer `capabilities` — and an optional block would leave a
consumer back at `undefined` for every flag.

**Producers.** Each answers all thirteen keys from its own facts, with the basis
recorded per key in the code. The dispatcher now measures `comments` off the
`sys_comment` object in the registry it already resolves for its `/data` domain,
and `automation` / `cron` / `export` / `chunkedUpload` off the same service
predicates that gate its route advertisements. Its one honest `false` is
`transactionalBatch`: the atomic cross-object `/batch` route is mounted by
`@objectstack/rest`, and this dispatcher has no batch branch at all, so claiming
the runtime's `transaction()` here would advertise an endpoint the host does not
serve. `getDiscovery()` answers the six new flags off the service registry it
already reads, gated on serveability so a self-declared stub does not advertise
a capability it cannot back.

**Gates.** The three `discovery-schema-conformance.test.ts` suites built by
`#5682` and extended to `routes` by `#5743` gain a fullness criterion — every
vocabulary key present, every `enabled` a real boolean, no key outside the
vocabulary — with the allowance derived from the schema rather than written out.

**Upgrading.** A producer or fixture that builds a `DiscoverySchema`-shaped
document must now include a complete `capabilities` block; build it from
`WELL_KNOWN_CAPABILITY_KEYS` rather than by hand. Consumers need no change:
they receive strictly more keys than before, and any flag they already read
keeps its meaning. The lenient wire wrapper `GetDiscoveryResponseSchema` still
allows the block to be absent, so a response from an older server still parses.

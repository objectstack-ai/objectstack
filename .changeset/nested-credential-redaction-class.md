---
'@objectstack/spec': minor
'@objectstack/service-datasource': patch
---

feat(spec): treat a nested datasource-config credential position identically to the top-level key it mirrors — derived at every depth, on both doors (#13405)

**BREAKING** accept-set narrowing, the nested closure of the #9040 family. A
credential under the very spelling the top level refuses and redacts — one
object level down (`options.auth.token`, `options.pool.password`, a
`tunnel.password` on a contract-less driver) — was accepted at publish and
served back by every datasource read door in cleartext with
`redactedConfigKeys: []`, because the read side's nested judgment was only the
hand-enumerated `passthroughSecretPaths` table and the write side had no nested
name judgment at all.

Both sides are now derived from ONE source instead of hand-maintained:

- The canonical credential spellings and former aliases moved to
  `driver/common.zod.ts` (`CREDENTIAL_KEY_SPELLINGS`) — the bottom of the
  driver-schema import graph — so the write door's passthrough walk and the
  read redactor consume the same list (#8300's no-second-copy posture applied
  to the list itself).
- **Read door** (`redactDatasourceConfig`, behind both consumers — the
  datasource-admin routes and the kernel per-type redaction hook): the
  credential-name judgment and the URL composite (userinfo + query params) now
  run at EVERY object depth, for every driver, contract-less included. Nested
  removals are reported as dotted paths in `redactedKeys`, plus a new
  `redactedPaths` field carrying exact segments. `passthroughSecretPaths`
  remains only as the residue it always should have been: CLIENT-MEASURED
  secret spellings (`proxyPassword`, `key`, `passphrase`, …) that mirror no
  top-level key.
- **Write door** (`credentialFreeMongoOptions`): a non-empty string under a
  credential-spelled key is refused at any object depth of the mongodb
  `options` passthrough, with a prescription that does not inherit the
  `auth.password`-only "wins over" reassurance. The measured `auth.password`
  refusal keeps its own message; nothing is double-reported.
- **Schema derivation walked at depth**: `refusedCredentialPaths` /
  `refusedCredentialPathsOfSchema` extend the `z.never()` derivation below the
  top level, so a driver contract that refuses a key inside a nested object
  shape is covered the day it lands (none exists today — pinned per driver).
- **Arrays are off the walk** on both doors — the same structural line
  `valueAtPath`/`withoutPath` already drew — so row-shaped data (memory's
  `initialData` seeds) keeps its own fields without a per-driver exclusion
  list.
- `restoreRedactedConfig` (service-datasource) is now DERIVED from the
  redactor instead of mirroring it rule by rule: it grafts stored material
  back wherever the patch is indistinguishable from what the read path served,
  so an untouched "Save" on an affected legacy row keeps its stored material
  for every current and future redaction source, and an author's edit always
  wins. The metadata write door's generic `carryForwardRedactedValues` already
  walks the dotted paths and needs no change.

Semantic migration entry
`datasource-config-options-nested-credential-spelling-refused` (protocol major
18) carries the authored-artifact upgrade: remove the nested key, or bind the
real secret through `external.credentialsRef` / the connection form.

<!-- adr-0087: registered datasource-config-options-nested-credential-spelling-refused -->

---
"@objectstack/cli": minor
"@objectstack/metadata-core": minor
---

<!-- adr-0087: not-required (no-migration-prescription) both renamed members are RUNTIME OUTPUT, not authored metadata: a CLI `--json` key emitted from an inline object literal, and a member of a TypeScript diagnostic object built at throw time. Neither has a Zod schema, a `packages/spec` declaration or a stored representation, so `objectstack migrate meta` has nothing to reach and a ledger entry would project into `spec-changes.json` and the upgrade guide as an instruction no metadata upgrader can act on. The prescription in this body addresses a SOURCE-CODE and stdout-reading consumer, whose delivery channel is the compiler and this changelog (ADR-0087 D8) -- the same disposition and the same argument as the `specVersionGap` to `protocolVersionGap` rename that shipped from this repo. -->

feat(cli,metadata-core)!: the protocol version is emitted under `protocolVersion`, never under a `runtime`-shaped name (#15585)

**BREAKING** — two published machine surfaces change a key name. There is **no alias
and no dual-key transition window**: one axis, one name.

| Surface | Was | Now |
|:--|:--|:--|
| `os migrate meta --json` payload | `runtime` | `protocolVersion` |
| `OS_PROTOCOL_INCOMPATIBLE` diagnostic (`ProtocolIncompatibleError.diagnostic`) | `runtimeVersion` | `protocolVersion` |
| `checkProtocolCompat()` / `assertProtocolCompat()` 2nd parameter | `runtimeVersion` | `protocolVersion` |

The **value** is unchanged on every one of them: it is `PROTOCOL_VERSION`, the protocol
major padded to a semver (`'17.0.0'`), exactly as before. Nothing else on either payload
moves — no other key is added, removed or reshaped, and both text faces are byte-identical.
The parameter rename is positional, so no call site changes.

## Why the name had to move

`PROTOCOL_VERSION` is the protocol major padded to a semver and never tracks the installed
`@objectstack/cli` or runtime package version. Printed or emitted under the word *runtime*
it read as one: on a 17.3.0 install `runtime: "17.0.0"` reads as an apparent downgrade or
a stale install, next to the real package versions of the same upgrade session.

The human line was repaired first and now reads
`Chain:  protocol 17 → 17 (this runtime implements protocol 17)`. The machine face is the
worse half and was left standing, because a key on a published payload is a contract
change: an agent scripting an upgrade has no prose to disambiguate at all, and the
diagnostic's own `message` — which *is* unambiguous — is the one part a machine consumer
does not parse.

## What a consumer should do

Read the new key. The old one is absent, so a consumer that does not move reads
`undefined` rather than a wrong value.

```diff
- const v = payload.runtime;                  // os migrate meta --json
+ const v = payload.protocolVersion;

- const v = err.diagnostic.runtimeVersion;    // OS_PROTOCOL_INCOMPATIBLE
+ const v = err.diagnostic.protocolVersion;
```

The diagnostic surfaces through every package that re-emits it — `@objectstack/runtime`
spreads it into `ArtifactReferenceError.detail`, `@objectstack/metadata-protocol` throws it
from the package install boundary, and `@objectstack/services-package` reads it during
hydration — so a consumer reading it from any of those reads the new name too.

`runtimeMajor` on the same diagnostic is deliberately **unchanged**: it is an integer
protocol major, not a semver in a version position, and it does not carry the ambiguity
this rename closes.

The breaking surface was measured before the rename and is closed inside this repository:
the only reader of the `--json` key was this repo's own e2e pin and the only reader of the
diagnostic member was `metadata-core`'s own unit test, both of which move in this same
change; the published `skills/objectstack-upgrade/SKILL.md` documents `--json` without ever
naming the field. **Zero external consumers were found.** Graded `minor` rather than
`major` for the launch window; the banner above carries the breaking-ness the level cannot.

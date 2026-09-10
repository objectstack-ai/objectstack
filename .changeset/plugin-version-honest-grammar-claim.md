---
"@objectstack/spec": patch
---

`PluginSchema.version` now describes the grammar it actually enforces instead of calling itself `"Semantic Version"`.

The key's regex accepts **every** SemVer 2.0.0-valid string and, additionally, eight strings SemVer 2.0.0 forbids:

| SemVer 2.0.0 rule | Strings this key accepts anyway |
|---|---|
| §2 — numeric identifiers MUST NOT include leading zeroes | `01.1.1`, `1.01.1`, `1.1.01` |
| §9 — prerelease identifiers MUST NOT be empty or carry leading zeroes | `1.0.0-0123`, `1.0.0-alpha..1`, `1.0.0-alpha..`, `1.0.0-.` |
| §10 — build-metadata identifiers MUST NOT be empty | `1.0.0+.` |

**No accepted value moved, in either direction.** The regex is byte-for-byte what it was; the `describe()` string is what changed. The leading-zero half is older than the recent widening — the original `/^\d+\.\d+\.\d+$/` admitted `01.1.1` too, because `\d+` always has — so tightening the key to the official SemVer regex would refuse plugin objects that load today, which the ruling on this key forbids. With the accept set frozen, the only side of the declared/enforced pair still free to move is the claim, and the bare `"Semantic Version"` was the false half: it named a standard this key does not implement.

The replacement states the shape an author can predict a verdict from — `major.minor.patch` with an optional `-prerelease` and an optional `+build` suffix — and disclaims the standard it exceeds rather than merely dropping the word. This follows `ManifestSchema.version`, which already spells `(major.minor.patch)` explicitly rather than leaning on "SemVer".

**What consumers see.** The `description` on `version` in the shipped `json-schema/` tree and on the generated `kernel/plugin` reference page. No `pattern`, no `type`, no accepted or rejected value changes, so a tool that validates against this schema behaves identically.

All eight forms are now pinned as **accepted** — in `packages/spec` (`plugin.test.ts`) and in `packages/core` (`plugin-loader.test.ts`, `plugin-contract-enforcement.test.ts`) — so the honesty is enforced rather than narrated, and a future edit that "corrects" the grammar to be standards-compliant fails those pins on purpose.

`@objectstack/core` is deliberately **not** listed above. Its `PluginLoader` predicate was renamed `isValidSemanticVersion` to `isSemverShapedVersion` in the same change, for the same reason, but the symbol is `private` and package-internal: measured against the built `dist/index.d.ts`, `import { isValidSemanticVersion } from '@objectstack/core'` is TS2305 (no exported member) and `loader.isValidSemanticVersion` is TS2341 (private), while a public member on the same class compiles. Nothing published moves.

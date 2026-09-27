---
'@objectstack/spec': minor
---

feat(spec)!: retire the plugin-security scan-result surface — zero consumers after the scanner retirement (#15932)

**BREAKING** — the plugin-security scan-result family is removed. ADR-0049
enforce-or-remove; maintainer ruling 2026-09-07 (director seat, decision batch
#65), adopted verbatim 「同意」.

This is the second half of the scanner retirement — issue 14919, a number since
deleted from the board, landed as PR #15930. That change retired `PluginSecurityScanner`,
the `@objectstack/core` class that shipped as a security control and returned
`status: "passed"` for every plugin it was ever handed. The **schemas** it fed
survived it — and that scanner's type-only import was their only importer of any
kind, so the family went from one type-only importer to **zero consumers** while
staying fully published: 27 authorable rows on `authorable-surface/kernel.json`,
six `api-surface` exports, two authorable defaults and two json-schema manifest
keys, with no `.parse` or `.safeParse` site against either schema anywhere. An
author could write any of it, be accepted, and get nothing. That is the
declared-not-enforced shape, one layer out from the class removed for the same
reason. "Declare an owner to enforce" was refused by name: it would rebuild the
scanner just retired.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `KernelSecurityScanResult`, `KernelSecurityScanResultParsed`, `KernelSecurityScanResultSchema` (exports) | nothing — delete the import. No replacement type exists. |
| `KernelSecurityVulnerability`, `KernelSecurityVulnerabilityParsed`, `KernelSecurityVulnerabilitySchema` (exports) | nothing — delete the import. No replacement type exists. |
| `PluginSecurityManifest.scanResults` | delete the key |
| `PluginSecurityManifest.vulnerabilities` | delete the key |
| `PluginQualityMetrics.securityScan` | delete the key |

**The one-line fix: delete the keys and every import of the two types.** Plugin
security scanning is not a platform capability and there is no replacement
schema. What the platform does still enforce is unchanged: `permissions` and
`sandbox` on the same `PluginSecurityManifest`, and artifact provenance through
`verifyPluginArtifactIntegrity` and the plugin signature verifier — which tell
you an artifact is the one its publisher signed, and never that it is safe. For
dependency vulnerabilities use the tools built for it against your own project
(`npm audit` / `pnpm audit`, Dependabot, the GitHub Advisory Database, OSV), and
treat an unaudited third-party plugin as untrusted code. A publisher who used
`scanResults` to advertise diligence keeps the surviving `securityContact` and
`vulnerabilityDisclosure` blocks, which are contact terms rather than a verdict.

⚠️ Runtime behaviour is deliberately **unchanged**. Nothing ever read any of
these keys, so deleting one removes no check that was running. A consumer that
gated on `securityScan.passed === true` was gating on nothing — the remediation
is to audit with a real tool, not to find a replacement key.

### The retirement kit

- The two **defs** leave the build whole — `RETIRED_DEFS_BY_MAJOR[18]`
  (`kernel/KernelSecurityScanResult`, `kernel/KernelSecurityVulnerability`) —
  because nothing parses them, so there is no author a tombstone could reach.
- The three **authorable keys** are `retiredKey()` tombstones registered in
  `RETIRED_KEYS_BY_MAJOR[18]`. Neither carrying shape is `.strict()`, so a bare
  deletion would strip an authored key in silence (ADR-0104): the tombstone is
  audible in both channels — `tsc` (input type `never`) and the parse, which
  raises the prescription itself.
- **No D2 conversion.** A plugin security manifest and a plugin registry entry
  are package artifacts a publisher ships, never stack collection members and
  never stored `sys_metadata` rows, so the chain has no seam that would see one
  — the disposition the sibling `kernel-plugin-security-durations-unit-in-key`
  entry already records for this same manifest. The D3 semantic entry
  `plugin-security-scan-result-surface-retired` carries the judgement.
- `PluginSecurityManifest.vulnerabilities` is a **forced consequence**, not one
  of the four names the ruling listed: it was the last authorable referent of
  `KernelSecurityVulnerability` and could not outlive the def.
- **No deprecation window** (maintainer 2026-08-27: 「项目在创业阶段，用户也很少，短期不考虑渐进」).

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec`
is published, so this is breaking for consumers no download, dependent or source
telemetry was consulted for — exactly as that retirement's own changeset says of its
three exports. That was an input to the ruling, not a reason to soften the removal.

⛔ **Untouched, and not checked:** the marketplace `'scanning'` status
(`marketplace.zod.ts`). The ruling made it conditional on a producer grep of
`objectstack-ai/cloud`, and that repository was not reachable from the session
that executed this card, so it stays exactly as it is and its absence from this
diff is not evidence about it.

⚠️ **The two members the ruling paired with it were ALREADY GONE** — measured on
this tree, not assumed. The incident `'malware'` type was a member of
`system/IncidentCategory`, and the whole incident-response family was retired by
#15513 (maintainer ruling 2026-09-05 — two days *before* the 2026-09-07 ruling
that made it conditional). `marketplace-admin.zod.ts` was deleted outright with
the cloud subpath (#16526). Both files return zero tree entries here, against a
lit control where `'scanning'` still returns a live declaration. So the
conditional question is **one** enum member wide, not three.

`Clause-②: yes (narrowing)` — a published surface is removed: six exports leave
the built `.d.ts` and three authorable keys stop being writable, so the accept
set a consumer writes against narrows. Nothing is widened and nothing is
renamed. Contract-review tier.

<!-- adr-0087: registered plugin-security-scan-result-surface-retired -->

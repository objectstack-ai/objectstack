---
"@objectstack/cli": patch
"@objectstack/core": patch
---

Five source comments in `@objectstack/cli` and `@objectstack/core` stop attributing unpack-time `manifest.integrity` re-verification to the cloud control plane and name the owner this repo has already ruled: the **future runtime loader** (ADR-0025 §3.5 steps 4–7). The enforce leg stays tracked on #11331.

`packages/spec`'s `manifest.zod.ts` was corrected to that owner in an earlier change, and these five sites were left behind — so the repo stated both things at once. A comment that names the wrong owner costs nobody a build, but it teaches a reader (and a reading AI) to expect a verification that no component performs and that ADR-0025's own status line records as unimplemented.

- `packages/cli/src/utils/osplugin.ts` — the `.osplugin` packaging docblock, and the `sriDigest` TSDoc.
- `packages/cli/src/commands/plugin/publish.ts` — the integrity-preflight comment.
- `packages/core/src/security/index.ts` — the `verifyIntegrity` export comment.
- `packages/core/src/security/plugin-artifact-integrity.ts` — the verifier's own module docblock, which had explained the module's byte-for-byte portability *by* the wrong owner. It now explains it by the leg itself: the module stays portable to whatever runs unpack-time re-verification.

**What does NOT change.** The other half of every one of these comments — the digest map is computed by `os plugin build` and self-checked by the `os plugin publish` preflight — is true and is kept verbatim. No accept set, export, signature or runtime behaviour moves; the diff is comment prose only.

**What moves for consumers, measured on the built output.** `@objectstack/cli` ships `dist/`, and the `sriDigest` TSDoc rides into `dist/utils/osplugin.d.ts`, so an editor's hover on `sriDigest` stops naming the control plane. `@objectstack/core`'s two sites do **not** reach its published bundle — a module docblock and a line comment above an `export {}` are both dropped from `dist/index.d.ts` — so nothing in that package's shipped bytes moves. It is declared here anyway because the pre-correction attribution is quoted in `packages/core/CHANGELOG.md`, a generated record that may not be hand-edited; a changeset naming the package is the only way the correction reaches that published record.

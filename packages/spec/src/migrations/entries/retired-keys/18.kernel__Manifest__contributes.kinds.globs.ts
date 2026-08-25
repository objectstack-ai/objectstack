// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11169 — ADR-0049 enforce-or-remove on `contributes.kinds[].globs`
// (maintainer ruling 2026-08-24, 「接受你的建议。」: remove via the full
// ceremony). The sub-field promised glob-driven file-type discovery the
// platform performs somewhere else: real artifact discovery globs
// `filePatterns` off the metadata type registry, and
// `metadata-plugin.zod.ts` states outright that `contributes.kinds` does not
// extend it. Measured (PR #11168, re-run with positive control at claim
// time): zero consumers — the only non-test occurrences of the path are the
// schema declaration and two type positions (`registerKind`'s parameter,
// `getAllKinds`' return), and nothing reads the value — so an authored
// `globs` was stored, served back through `GET /metadata/kind`, and never
// consulted. The `kind` bucket itself and its `id` are NOT touched: the
// bucket is live (engine → `registerKind`) and reachable via the generic
// `GET /metadata/:type` passthrough.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// Registered here but NOT in `src/conversions/registry.ts`, for the reason
// `kernel/Manifest:loading` gives: a package manifest is not a stack
// collection member, so a D2 conversion would be a transform with no seam
// that ever runs. The prescription reaches authors through the tombstone at
// `os plugin build` → `ManifestSchema.safeParse` and through the D3 semantic
// entry `plugin-manifest-kind-globs-retired`.
export const entry = 'kernel/Manifest:contributes.kinds.globs';

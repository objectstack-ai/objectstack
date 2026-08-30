// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11332 — ADR-0049 enforce-or-remove on the plugin manifest's three dead
// top-level containers (triage graded 2026-08-23; cloud leg measured clean
// 2026-08-29 on #12400 with positive controls). The census found ZERO reads
// of the `capabilities` container itself in objectstack, objectui and cloud,
// which settles all five keys beneath it (`implements`, `provides`,
// `requires`, `extensionPoints`, `extensions`) at once — a key cannot be read
// if the object holding it never is. Its describe() sold "interoperability
// and automatic discovery"; no discovery path consulted it, and real
// dependency resolution runs off top-level `manifest.dependencies`. ONE
// tombstoned key, because `capabilities` was the single carrier (the
// `kernel/Manifest:loading` shape); `PluginCapabilityManifestSchema` itself
// stays published — the plugin-registry surface still declares it — so
// nothing lands in `RETIRED_DEFS_BY_MAJOR`.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// Registered here but NOT in `src/conversions/registry.ts`, for the reason
// `kernel/Manifest:loading` gives: a package manifest is not a stack
// collection member (`PLURAL_TO_SINGULAR` has no `packages` / `plugins`
// entry — re-verified at claim; the map's `capabilities` entry is the
// unrelated ADR-0066 stack-level collection), so a D2 conversion would be a
// transform with no seam that ever runs. The prescription reaches authors
// through the tombstone at `os plugin build` → `ManifestSchema.safeParse`
// and through the D3 semantic entry
// `plugin-manifest-dead-containers-retired`.
export const entry = 'kernel/Manifest:capabilities';

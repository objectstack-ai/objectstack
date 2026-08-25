// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #10724 — ADR-0049 enforce-or-remove on the plugin manifest's `contributes`
// block (triage graded 2026-08-21; cloud leg measured clean 2026-08-24). One
// of NINE members tombstoned together: #10627 measured exactly ONE non-test
// read of `manifest.contributes` monorepo-wide (engine.ts, member `kinds`),
// with controls, re-verified across objectstack + objectui + cloud at claim
// time. `events` in particular was decorative twice over: its only in-repo
// author (plugin-hono-server) already subscribed to the same events
// imperatively in plugin code, so the declaration drove nothing even for the
// one package that wrote it.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// Registered here but NOT in `src/conversions/registry.ts`, for the reason
// `kernel/Manifest:loading` gives: a package manifest is not a stack
// collection member (`PLURAL_TO_SINGULAR` has no `packages` / `plugins`
// entry), so a D2 conversion would be a transform with no seam that ever
// runs. The prescription reaches authors through the tombstone at
// `os plugin build` → `ManifestSchema.safeParse` and through the D3 semantic
// entry `plugin-manifest-contributes-dead-members-retired`.
export const entry = 'kernel/Manifest:contributes.events';

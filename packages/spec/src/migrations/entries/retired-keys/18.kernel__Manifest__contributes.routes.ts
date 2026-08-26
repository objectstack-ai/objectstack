// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #10726 — ADR-0049 enforce-or-remove fork on `contributes.routes`, the ONE
// `contributes` member deliberately excluded from #10724's nine-member
// retirement because removing it needed a ruling, not a tombstone: the key
// was the only DECLARED channel for a real capability (serving a code-handler
// endpoint), and four published surfaces — a customer-published skill among
// them — taught it as working machinery. Maintainer ruled Option B 2026-08-22
// (「接受所有」 on the decision batch carrying the four-axis analysis): remove
// the key; author-facing materials redirect to the imperative `http.server`
// mount, the form that actually works. The ruling's cloud precondition was
// discharged 2026-08-24 (#10812: cloud @ 5b5925a, zero `manifest.contributes`
// reads, controls green), completing #10627's three-repo census at exactly
// one live read (engine.ts, member `kinds` — now the block's sole survivor).
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
// entry `plugin-manifest-contributes-routes-retired`.
export const entry = 'kernel/Manifest:contributes.routes';

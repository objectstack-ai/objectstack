// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11332 — ADR-0049 enforce-or-remove on the plugin manifest's three dead
// top-level containers; census and registration major recorded once in the
// sibling entry `kernel/Manifest:capabilities`, the why-no-D2-conversion
// reasoning in `kernel/Manifest:loading` (the precedent); the D3 semantic
// entry is `plugin-manifest-dead-containers-retired`.
//
// `extensions` was an untyped escape hatch — `z.record(z.string(),
// z.unknown())` — with zero readers, so whatever an author parked here was
// stored and never consulted. Because the value type is `unknown`, this key
// is where anything the platform does not yet model would get parked; its
// measured emptiness is therefore its own evidence — authors are not parking
// things here either, making an untyped catch-all with no users the cheapest
// removal in the family. The enforced extension channels are
// `contributes.kinds` (metadata kinds), `navigationContributions`
// (ADR-0029 D7), and plugin code itself (`init`/`start`).
export const entry = 'kernel/Manifest:extensions';

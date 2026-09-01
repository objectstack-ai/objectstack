// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13612 — ADR-0049 enforce-or-remove (maintainer ruling 2026-09-01, director
// batch C: retire; binding was weighed and not adopted). One of the six
// branded identifier schemas of `shared/branded-types.zod.ts`, removed whole
// with the module. The brand promised compile-time safety no consumer could
// obtain: no schema in either repo ever composed `ObjectNameSchema`, so
// nothing produced or accepted a branded value. The real object-name contract
// is the inline `z.string().regex(/^[a-z_][a-z0-9_]*$/)` at
// `data/object.zod.ts` — untouched by this retirement (the ruling keeps the
// five surfaces' real validators as the contract of record). No authored
// document ever embedded a branded value, so no tombstone and no D2
// conversion — this table plus the D3 semantic entry
// `branded-identifier-schemas-retired` are the declaration (the #8715
// route-3 shape).
export const entry = 'shared/ObjectName';

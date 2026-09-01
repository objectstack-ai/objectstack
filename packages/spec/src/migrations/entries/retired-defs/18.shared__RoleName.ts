// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13612 — ADR-0049 enforce-or-remove (maintainer ruling 2026-09-01, director
// batch C: retire; binding was weighed and not adopted). One of the six
// branded identifier schemas of `shared/branded-types.zod.ts`, removed whole
// with the module. No schema in either repo ever composed `RoleNameSchema`,
// so the promised brand safety was unobtainable. The real role/position-name
// contract is the bare `SnakeCaseIdentifierSchema` at
// `identity/position.zod.ts` — untouched by this retirement. No tombstone and
// no D2 conversion (no authored document ever embedded a branded value); this
// table plus the D3 semantic entry `branded-identifier-schemas-retired` are
// the declaration.
export const entry = 'shared/RoleName';

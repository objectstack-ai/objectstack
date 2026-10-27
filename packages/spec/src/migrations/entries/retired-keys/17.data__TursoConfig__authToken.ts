// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #7990 — the turso face of `data/PostgresConfig:password` (the credential key
// is `authToken`, a JWT, rather than a password — same inline-cleartext class,
// same ruling, same disposition). The standalone boot path is untouched:
// `OS_DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN` are resolved by the host and
// handed to the driver factory directly, never through the authoring schema.
// See the D3 semantic entry `datasource-config-inline-credential-refused`.
export const entry = 'data/TursoConfig:authToken';

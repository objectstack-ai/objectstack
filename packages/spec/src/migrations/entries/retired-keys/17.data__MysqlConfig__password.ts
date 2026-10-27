// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #7990 — sibling of `data/PostgresConfig:password`, same ruling, same
// disposition: tombstoned inline credential; the secret binder /
// `external.credentialsRef` is the mechanism. See that entry for the reasoning
// and the D3 semantic entry `datasource-config-inline-credential-refused` for
// the hand-migration prescription.
export const entry = 'data/MysqlConfig:password';

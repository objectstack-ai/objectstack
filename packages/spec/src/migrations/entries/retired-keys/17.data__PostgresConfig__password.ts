// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #7990 (maintainer-ruled Option A, 2026-08-12) — inline datasource credentials
// refused at publish. The key is tombstoned (`z.never()` with the refusal
// prescription), not deleted: `sys_metadata` serves rows through the ordinary
// data API, so an inline `config.password` was cleartext at rest. The secret
// belongs to the datasource secret binder (`sys_secret` +
// `external.credentialsRef`), which already wins over an inline value at
// connect time. No D2 conversion: a stored cleartext credential cannot be
// mechanically rewritten into an encrypted `sys_secret` row at load — see the
// D3 semantic entry `datasource-config-inline-credential-refused`.
export const entry = 'data/PostgresConfig:password';

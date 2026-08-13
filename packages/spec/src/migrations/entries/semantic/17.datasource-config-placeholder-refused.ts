// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'datasource-config-placeholder-refused',
  surface: 'connection-material string keys of the built-in driver configs — ' +
    'postgres/mysql/mongo `url`/`host`/`database`/`username`, postgres `schema`/' +
    '`applicationName`, mongo `authSource` and the `options` passthrough (judged deep), ' +
    'turso `url`/`syncUrl`/`encryptionKey`, sqlite/sqlite-wasm `filename` — values ' +
    'containing `${…}` placeholder syntax',
  replacement: 'the literal value. For secret material, the datasource secret binder: the ' +
    "Setup → Datasources connection form's secret field (encrypted into `sys_secret`, handle " +
    'stored at `external.credentialsRef`), or a direct `external.credentialsRef` reference. ' +
    'For environment-driven connections, the runtime environment itself: `OS_DATABASE_URL` ' +
    'and friends are translated into driver config by the boot hosts and never pass through ' +
    'the publish door',
  reason:
    'A `${…}` placeholder in authored datasource config is resolved by NOTHING — it is ' +
    'stored verbatim in `sys_metadata` and handed verbatim to the database client at connect ' +
    '(#7990 census, measured during #8078), so the connection fails, or connects somewhere ' +
    'unintended, with no error naming the unresolved placeholder — the masked-failure shape. ' +
    'The syntax looked supported: it parsed green, stored fine, and failed at a distance; two ' +
    'shipped refusal messages (#8078 inline credentials, #8082 URL userinfo) had to warn ' +
    '"do NOT substitute a placeholder" around the broken escape. Maintainer-ruled direction 2 ' +
    'on #8336 (2026-08-13): refuse the syntax loudly at publish; implementing real resolution ' +
    'was explicitly rejected — a new capability with an env-exfiltration security surface and ' +
    'zero measured pull for actual substitution. There is no mechanical rewrite: the ' +
    'placeholder names a value that exists only in the author\'s intended deployment ' +
    'environment, which a source-file transform cannot know — substituting anything would ' +
    'invent a connection target.',
  acceptanceCriteria:
    'Every datasource parses with no `${…}` span in any connection-material config value; ' +
    'environment-driven deployments carry their DSN in the runtime environment ' +
    '(`OS_DATABASE_URL` and friends) or bind secrets via `external.credentialsRef`, and ' +
    'still connect; no unresolved placeholder remains in any stored `sys_metadata` row or ' +
    'authored source.',
};

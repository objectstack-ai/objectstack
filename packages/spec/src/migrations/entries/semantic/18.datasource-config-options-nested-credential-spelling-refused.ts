// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'datasource-config-options-nested-credential-spelling-refused',
  surface: 'datasource.config.options.**: any credential-SPELLED key (`password`, `authToken`, ' +
    'or a former alias — `passwd`/`pwd`/`token`/`jwt`/`auth_token`/`authtoken`) holding a ' +
    'non-empty string at any object depth of the mongodb options passthrough',
  replacement: 'remove the nested key (no measured client behaviour reads any such position ' +
    'other than `auth.password`, which has its own refusal); if a real secret must reach the ' +
    'connection, bind it — the Setup → Datasources connection form\'s secret field (encrypted ' +
    'into `sys_secret`, handle stored at `external.credentialsRef`) or a direct ' +
    '`external.credentialsRef` reference',
  reason:
    'The nested-position closure of the `datasource-config-mongo-options-credential-refused` ' +
    'family: that entry refused the one MEASURED login position (`options.auth.password`) and ' +
    'left every other nested spelling of the same secret accepted — `options.auth.token`, ' +
    '`options.pool.password`, any credential-spelled key one object level down parsed green, ' +
    'persisted cleartext into `sys_metadata` (served back by the ordinary data API), and was ' +
    'served on the datasource read doors with `redactedConfigKeys: []` because the read-side ' +
    'nested judgment was a hand-enumerated path table. Publish now refuses a non-empty string ' +
    'under any credential SPELLING at any object depth of the passthrough — the same one ' +
    'spelling list the top level refuses and the read path redacts, so a nested position is ' +
    'treated identically to the top-level key it mirrors. Arrays are off the walk (row-shaped ' +
    'data is not config). The read path now also redacts these spellings at every depth, for ' +
    'every driver, and carries them forward on an untouched Save. There is no mechanical ' +
    'rewrite, for the same reason as the sibling credential entries: moving a value into ' +
    '`sys_secret` requires a running secret binder, which a source transform cannot do — and ' +
    'unlike `auth.password`, a nested spelling at an unmeasured position buys nothing at ' +
    'connect, so the usual outcome is deletion, which only the author can confirm.',
  acceptanceCriteria:
    'Every mongodb datasource parses with no non-empty credential-spelled string at any object ' +
    'depth of `config.options`; any real secret found there is re-bound through ' +
    '`external.credentialsRef` (or the connection form) and the datasource still connects; no ' +
    'nested credential remains in any stored `sys_metadata` row or authored source.',
};

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'driver-turso-config-local-path-wasm-retired',
  surface: '`@objectstack/driver-turso`\'s published `TursoConfigSchema` — the Spec / Studio mirror '
    + 'of the turso connection config a host may render configuration UI from — keys `localPath` '
    + 'and `wasm`',
  replacement: 'delete both keys. The embedded replica\'s local file is named by `url` '
    + '(`file:./replica.db`) with `syncUrl` pointing at the remote primary, which is what the driver '
    + 'has always read; nothing selects a WASM build of libSQL, and a runtime that cannot load native '
    + 'bindings uses the remote arm (`libsql://` / `https://`), which needs none',
  reason:
    'ADR-0049 enforce-or-remove, ruled per key on the card that measured them (#16024): both keys '
    + 'were declared on the package schema with a describe promising behaviour ("Local file path for '
    + 'embedded replica", "Use WASM build for edge/browser environments") and were read by no code '
    + '— the driver names the replica file via `url`, and no mechanism picks a WASM build. Forwarding '
    + '`localPath` would have created a second way to say what `url` says; forwarding `wasm` would '
    + 'have meant building a WASM selection that does not exist. Why a semantic entry and not a D2 '
    + 'conversion: `@objectstack/spec`\'s own turso contract (`data/TursoConfig`, strict) never '
    + 'declared either key, so no stack source or stored datasource row that passed the spec door can '
    + 'carry them, and a value that never did anything has no lossless rewrite — the key is deleted by '
    + 'hand. Both stay declared on the package schema as `z.never()` tombstones (the shape is a plain '
    + 'z.object, so a bare deletion would strip in silence) carrying this prescription. The third key '
    + 'the same card measured, `TursoDriverConfig.timeout`, was forwarded rather than removed and '
    + 'needs no entry. ADR-0049, ADR-0087.',
  acceptanceCriteria:
    'No `TursoConfigSchema.parse(…)` input spells `localPath` or `wasm`; authoring either fails to '
    + 'compile (input type `never`) and fails to parse with the prescription naming the key. A replica '
    + 'config that named its file only through `url` + `syncUrl` parses byte-identically to before, '
    + 'and every other declared key — `url`, `authToken`, `encryptionKey`, `concurrency`, `syncUrl`, '
    + '`sync`, `timeoutMs` — keeps its bound, default and optionality.',
};

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The protocol move itself (ruling record 7153441862, route A, item 2). Not a
// key retirement: `engines.protocol` stays live and its schema is unchanged;
// what moves is the major the handshake compares it with, so a range that
// admits only 18 is refused at the doors that run the handshake. No D2
// conversion: the range is the author's statement of which protocol the
// metadata was written against, and only the author can make it.
export const entry: SemanticMigration = {
  id: 'protocol-18-range-refused',
  surface:
    'manifest.engines.protocol (else engines.platform, else the legacy engine.objectstack) — a range '
    + 'that admits protocol 18 and not 19, such as \'^18\', on an app\'s manifest, on each package '
    + 'manifest of a multi-package app, or on a package installed through the package service or the '
    + 'marketplace',
  replacement:
    'Declare the protocol-19 range: `engines: { protocol: \'^19\' }`. `objectstack migrate meta --from 18 '
    + '--write` rewrites the declared range at the key the handshake reads. Move it together with the '
    + '`@objectstack/*` versions: an 18.x runtime refuses \'^19\'.',
  reason:
    'PROTOCOL_VERSION moved to 19.0.0, and the load-time handshake (ADR-0087 D1) compares only the major '
    + 'of a manifest\'s declared range with it. A range that admits 18 and not 19 is a major-version break, '
    + 'so the app plugin, the package service and the marketplace install refuse it with '
    + 'OS_PROTOCOL_INCOMPATIBLE before any of its metadata loads, naming the declared range, the runtime '
    + 'protocol and objectstack migrate meta --from 18. ⚠️ No D2 conversion: the range is the author\'s '
    + 'statement of the protocol the metadata was written against, so the runtime never rewrites it. ADR-0087.',
  acceptanceCriteria:
    'Grep every manifest the project declares (objectstack.config.ts and each package manifest) for an '
    + 'engines.protocol range that does not admit 19, and run objectstack migrate meta --from 18 --write, '
    + 'which rewrites each to \'^19\'. Then objectstack validate passes, the deployment boots without '
    + 'OS_PROTOCOL_INCOMPATIBLE, and every package installs; a manifest already declaring \'^19\' loads '
    + 'exactly as before.',
};

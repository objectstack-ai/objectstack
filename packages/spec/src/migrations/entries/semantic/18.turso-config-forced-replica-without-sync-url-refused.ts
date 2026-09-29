// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A forced embedded replica with no remote to replicate from, refused at both
// doors together: the datasource contract (on mode) and the turso driver's
// constructor, in one message. The driver used to build it as a replica that
// never synced and run it as a plain local database. A structured TODO, not a
// D2 conversion: whether the author meant a replica of some remote (and which
// one) or a plain local file is intent no artifact records.
export const entry: SemanticMigration = {
  id: 'turso-config-forced-replica-without-sync-url-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.TursoConfig (a turso / libsql datasource.config) and the TursoDriver constructor of '
    + '@objectstack/driver-turso — mode replica with no syncUrl (or an empty one) is now refused, on '
    + 'mode at authoring and at construction. The published TursoConfigSchema mirror of '
    + '@objectstack/driver-turso carries the same text for parity but declares no mode key and strips '
    + 'an authored one, so it cannot see a forced mode and still accepts the config as a local file',
  replacement:
    'the configuration the author meant. An embedded replica names the remote it replicates from: '
    + 'keep the file: url and set syncUrl to the libsql or https Turso endpoint, for example url '
    + 'file:./data/replica.db with syncUrl naming the remote. A plain local database drops mode: a '
    + 'file: url with no syncUrl and no mode is a local database',
  reason:
    'An embedded replica is a local file kept in sync with the remote named in syncUrl, so a replica '
    + 'is defined by its remote. The ruling of 2026-09-28 weighed refusing this shape against '
    + 'documenting a replica with no remote as a local mode, and refused it: with no remote there is '
    + 'no replica mode to document, only a declaration nothing honours. A '
    + 'forced mode replica with no syncUrl parsed clean at authoring, and the turso driver built it as '
    + 'a replica that never synced: no sync client was created, no sync interval started, the sync '
    + 'call did nothing and the sync-enabled check answered false, while every read and write went '
    + 'to the local file (measured on the built driver). A declared mode the runtime never runs is '
    + 'the declared-but-not-enforced shape ADR-0049 does not ship, so the datasource contract and the '
    + 'constructor now refuse it together, with one message, which names both ways out. The sibling '
    + 'refusals keep their order: a forced replica on a remote url, an in-memory url or a bare path '
    + 'meets its url refusal first, and one with sync meets the sync refusal first. Stored datasource '
    + 'rows are not re-parsed when they load, so a stored row in this shape now fails when its '
    + 'driver is built: the connection service records it as failed-degraded, a test connection '
    + 'answers ok false, and under ADR-0062 D5 the boot fails fast when objects bind to that '
    + 'datasource, unless OS_ALLOW_DRIVER_CONNECT_FAILURE is set. Measured on this tree at the change: '
    + 'no example, template, published skill or hand-written doc authors the shape, and no host '
    + 'default or environment variable sets mode. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Validate every stack and re-save every turso datasource: os validate or defineStack, and a '
    + 'save or test connection through the datasource admin service, report a forced replica with no '
    + 'syncUrl at config.mode with both ways out. Decide per datasource whether it is an embedded '
    + 'replica (set syncUrl) or a local file (drop mode). Done when every turso datasource parses, '
    + 'the driver builds from it, and every datasource that declares mode replica carries a syncUrl.',
};

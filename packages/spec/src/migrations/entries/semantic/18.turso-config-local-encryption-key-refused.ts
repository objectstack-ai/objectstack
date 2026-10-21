// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A declared encryption nothing applied, refused at both doors together: the
// datasource contract (on encryptionKey) and the turso driver's constructor, in
// one message per mode. The driver used to accept the key and write the local
// or replica file in plaintext. A structured TODO, not a D2 conversion: whether
// the author can live with an unencrypted file, wants disk or volume
// encryption, or wants a remote database is intent no artifact records.
export const entry: SemanticMigration = {
  id: 'turso-config-local-encryption-key-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.TursoConfig (a turso / libsql datasource.config), the published TursoConfigSchema mirror and '
    + 'the TursoDriver constructor of @objectstack/driver-turso — a non-empty encryptionKey beside a '
    + 'file: url or :memory: (a local or embedded-replica datasource, with or without syncUrl, and the '
    + 'same url under any forced mode, remote included) is now refused, on encryptionKey at authoring '
    + 'and at construction',
  replacement:
    'no key: drop encryptionKey. Nothing in the turso driver encrypts a local or replica file, so a '
    + 'file that must be encrypted at rest lives on an encrypted disk or volume, or the data moves to '
    + 'a remote Turso database, whose storage encryption is the server\'s to configure',
  reason:
    'encryptionKey was declared as an AES-256 key for the local database file, and nothing applied '
    + 'it. The turso driver runs every read and write of a local or replica file through better-sqlite3, '
    + 'which has no encryption codec: no codec compile option is set and PRAGMA key is a silent no-op '
    + '(measured on better-sqlite3 13.0.3, SQLite 3.53.4). Measured on the driver source with a test '
    + 'key: a local datasource constructed, connected and wrote its rows, and plain better-sqlite3 '
    + 'opened the file read-only with no key and read them; a replica handed the key to its sync '
    + 'client only, after the local engine had already written the file in plaintext, and a file that '
    + 'client encrypted is one the local engine cannot open. Honouring the key would mean replacing the '
    + 'engine that serves every read and write, so the ruling on this defect refused it instead: a declared '
    + 'protection the runtime does not apply is the declared-but-not-enforced shape ADR-0049 does not '
    + 'ship, and here it left operators believing their data was encrypted. The refusal comes last '
    + 'among the local-engine refusals, so a url, a lone sync or a forced mode that another refusal '
    + 'takes keeps that refusal. An empty encryptionKey is unset and is not refused. The key is judged '
    + 'by where the database lives, not by the mode: a file: url or :memory: under a forced remote '
    + 'mode is refused too, because the driver hands that url to the libSQL client it builds, which is '
    + 'handed no key, so the file was written in plaintext all the same. A remote url (libsql, https or '
    + 'ws) is not judged by this refusal. Stored datasource rows are not re-parsed when they load, so a '
    + 'stored row in this shape now fails when its driver is built: the '
    + 'connection service records it as failed-degraded, a test connection answers ok false, and '
    + 'under ADR-0062 D5 the boot fails fast when objects bind to that datasource. Measured on this '
    + 'tree at the change: no example, '
    + 'template, CLI scaffold or published skill authors the key, and no host default or environment '
    + 'variable sets it. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Validate every stack and re-save every turso datasource: os validate or defineStack, and a save '
    + 'or test connection through the datasource admin service, report encryptionKey on a local or '
    + 'replica datasource at config.encryptionKey. Drop the key from each, and where the file must be '
    + 'encrypted at rest, put it on an encrypted disk or volume or move the data to a remote Turso '
    + 'database. Done when every turso datasource parses, the driver builds from it, and no local or '
    + 'replica datasource carries an encryptionKey.',
};

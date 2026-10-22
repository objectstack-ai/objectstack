// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The second half of turso-config-local-encryption-key-refused: that entry
// refused the key where the local engine could not honour it, and left a remote
// url, where the driver parsed the key and dropped it. This one retires the key
// in every mode. The D2 conversion carries the bodies where removing it changes
// nothing; a key beside a local url stays the author's call, as it was.
export const entry: SemanticMigration = {
  id: 'turso-config-encryption-key-retired',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.TursoConfig.encryptionKey (a turso / libsql datasource.config), the published TursoConfigSchema '
    + 'mirror and the TursoDriver constructor of @objectstack/driver-turso — the key is removed: every '
    + 'value is refused, in every mode, at authoring and at construction',
  replacement:
    'no key: delete encryptionKey. A remote Turso database keeps its connection exactly as before, since '
    + 'the driver never handed it the key; a local or replica file that must be encrypted at rest lives '
    + 'on an encrypted disk or volume, or the data moves to a remote Turso database, whose storage '
    + 'encryption the server configures',
  reason:
    'ADR-0049 enforce-or-remove: a declared key the runtime honours nowhere is the removal case. '
    + 'encryptionKey promised an AES-256 key for the local database file. Beside a file: url or :memory: '
    + 'the local engine (better-sqlite3) has no encryption codec, so it was refused there already '
    + '(turso-config-local-encryption-key-refused). Beside a remote url the driver parsed it and built '
    + 'its libSQL client from url, authToken, concurrency and fetch only, so the key was dropped in '
    + 'silence; the libSQL remote client would itself refuse it as not supported. Refusing it there too '
    + 'and keeping it declared would leave a published slot whose only purpose is to be refused, and a key '
    + 'an AI author still writes, so it is retired instead: a retiredKey() tombstone on the spec contract, '
    + 'a z.never() tombstone on the driver mirror and a constructor refusal in every mode, one text at all '
    + 'three. The D2 conversion turso-config-encryption-key-removed strips it from stored rows, built '
    + 'artifacts and os migrate meta --from 17 output only where that changes nothing: an unset value, '
    + 'which every loader dropped, or a key beside a remote url, which the driver dropped. A non-empty key '
    + 'beside a local url is left: that operator believed the file encrypted, and whether to accept a '
    + 'plaintext file, move it to an encrypted volume or move the data to a remote database is intent no '
    + 'artifact records. Such a stored row keeps failing when its driver is built, as it has since the '
    + 'local refusal. A stored row that still holds a value is withheld on every read, as before. Measured '
    + 'on this tree at the change: no example, template, CLI scaffold, published skill, host default or '
    + 'environment variable authors the key. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Run os migrate meta --from 17 and apply its edits; then validate every stack and re-save every turso '
    + 'datasource: os validate or defineStack, and a save or test connection through the datasource admin '
    + 'service, report any encryptionKey left at config.encryptionKey. Delete each one, and where a local '
    + 'file must be encrypted at rest, put it on an encrypted disk or volume or move the data to a remote '
    + 'Turso database. Done when every turso datasource parses, the driver builds from it, and no turso '
    + 'datasource carries an encryptionKey.',
};

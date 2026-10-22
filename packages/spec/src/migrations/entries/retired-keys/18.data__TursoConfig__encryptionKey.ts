// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #25050 — `encryptionKey` was honoured in no mode: the local engine has no
// encryption codec (refused there since #25020), and on a remote url the driver
// parsed the key and never handed it to the libSQL client. ADR-0049
// enforce-or-remove; the D2 conversion `turso-config-encryption-key-removed`
// and the D3 semantic entry `turso-config-encryption-key-retired` carry it.
export const entry = 'data/TursoConfig:encryptionKey';

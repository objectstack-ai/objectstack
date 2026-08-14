// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8153 — the card's measurement, re-run on the fixed schema.
 *
 * The Studio wizard's `createDatasource` stores the secret in the secrets
 * store and writes `external: { credentialsRef }` onto the row without
 * consulting `schemaMode` (which defaults to `'managed'`). Until #8153 the
 * datasource schema refused ANY `external` block on a managed row, so the
 * measured happy path — POST a datasource with a password, get a 201 — left
 * every such row badged `_diagnostics.valid:false` in the Studio metadata
 * list, and `PUT /meta` answered 422 on the service's own output.
 *
 * Maintainer ruling (issue #8153, 2026-08-13): allow `external.credentialsRef`
 * — and only it — on managed; keep refusing every federation key. These tests
 * pin the diagnostics half of that: the exact persisted shape from the card
 * now reads `valid: true`, while a managed row carrying federation content
 * still reads `valid: false` at path `external`.
 */
import { describe, expect, it } from 'vitest';
import { computeMetadataDiagnostics } from './metadata-diagnostics.js';

/** The exact persisted shape measured in #8153 — no `schemaMode` key. */
const wizardRow = {
    name: 'good_pg',
    driver: 'postgres',
    config: { host: 'db.internal', database: 'mydb', username: 'app' },
    origin: 'runtime',
    external: { credentialsRef: 'sys_secret:bound' },
};

describe('#8153 computeMetadataDiagnostics — wizard-created managed datasource', () => {
    it('reads the exact shape createDatasource persists as valid', () => {
        const diag = computeMetadataDiagnostics('datasource', wizardRow);
        expect(diag).toEqual({ valid: true });
    });

    it('still badges a managed row carrying federation content invalid, at path `external`', () => {
        const diag = computeMetadataDiagnostics('datasource', {
            ...wizardRow,
            external: { credentialsRef: 'sys_secret:bound', allowWrites: true },
        });
        expect(diag?.valid).toBe(false);
        const issue = diag?.errors?.find((e) => e.path === 'external');
        expect(issue?.message).toContain('allowWrites');
    });
});

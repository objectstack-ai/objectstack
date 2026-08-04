// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `package-state-store` unit contract (#5047).
 *
 * This store is the ONLY durable record of which packages an operator has
 * disabled — the registry itself is in-memory and re-registers every package
 * as enabled on each boot. It had zero test coverage, which is why the
 * empty-env seed regression (see `app-plugin.disabled-seed.test.ts`) could
 * exist unnoticed: nothing asserted either half of the round trip.
 *
 * The invariants pinned here: the round trip, per-environment isolation, and
 * the two "never crash boot" degradations (missing file, corrupt file).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadDisabledPackageIds, setPackageDisabled } from './package-state-store.js';

let home: string;
const envSnapshot = { OS_HOME: process.env.OS_HOME, OS_ENVIRONMENT_ID: process.env.OS_ENVIRONMENT_ID };

/** Absolute path of the state file the store is expected to use. */
function stateFile(environmentId: string): string {
    return join(home, 'package-state', `${environmentId}.json`);
}

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'os-package-state-'));
    process.env.OS_HOME = home;
    delete process.env.OS_ENVIRONMENT_ID;
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = envSnapshot.OS_HOME;
    if (envSnapshot.OS_ENVIRONMENT_ID === undefined) delete process.env.OS_ENVIRONMENT_ID;
    else process.env.OS_ENVIRONMENT_ID = envSnapshot.OS_ENVIRONMENT_ID;
});

describe('package-state-store', () => {
    it('returns an empty set when no state file exists', () => {
        expect(loadDisabledPackageIds('env_local')).toEqual(new Set());
    });

    it('round-trips a disable through the file and back', () => {
        setPackageDisabled('env_local', 'com.acme.reporting', true);

        expect(loadDisabledPackageIds('env_local')).toEqual(new Set(['com.acme.reporting']));
        expect(JSON.parse(readFileSync(stateFile('env_local'), 'utf8'))).toEqual({
            disabled: ['com.acme.reporting'],
        });
    });

    it('re-enabling removes the id (and leaves the others alone)', () => {
        setPackageDisabled('env_local', 'com.acme.reporting', true);
        setPackageDisabled('env_local', 'com.acme.billing', true);

        setPackageDisabled('env_local', 'com.acme.reporting', false);

        expect(loadDisabledPackageIds('env_local')).toEqual(new Set(['com.acme.billing']));
    });

    it('accumulates disables across calls and persists them sorted', () => {
        setPackageDisabled('env_local', 'com.acme.zeta', true);
        setPackageDisabled('env_local', 'com.acme.alpha', true);

        expect(JSON.parse(readFileSync(stateFile('env_local'), 'utf8')).disabled).toEqual([
            'com.acme.alpha',
            'com.acme.zeta',
        ]);
    });

    it('disabling the same id twice is idempotent', () => {
        setPackageDisabled('env_local', 'com.acme.reporting', true);
        setPackageDisabled('env_local', 'com.acme.reporting', true);

        expect(JSON.parse(readFileSync(stateFile('env_local'), 'utf8')).disabled).toEqual([
            'com.acme.reporting',
        ]);
    });

    it('re-enabling something that was never disabled is a no-op, not a crash', () => {
        setPackageDisabled('env_local', 'com.acme.never', false);

        expect(loadDisabledPackageIds('env_local')).toEqual(new Set());
    });

    // The whole reason the file is keyed by environment: a disable in staging
    // must not hide the package in production (or in a sibling local env).
    it('isolates state per environment', () => {
        setPackageDisabled('env_staging', 'com.acme.reporting', true);

        expect(loadDisabledPackageIds('env_staging')).toEqual(new Set(['com.acme.reporting']));
        expect(loadDisabledPackageIds('env_production')).toEqual(new Set());
    });

    it('falls back to OS_ENVIRONMENT_ID, then to `default`, when no id is passed', () => {
        process.env.OS_ENVIRONMENT_ID = 'env_from_env_var';
        setPackageDisabled(undefined, 'com.acme.reporting', true);
        expect(loadDisabledPackageIds()).toEqual(new Set(['com.acme.reporting']));
        expect(readFileSync(stateFile('env_from_env_var'), 'utf8')).toContain('com.acme.reporting');

        delete process.env.OS_ENVIRONMENT_ID;
        expect(loadDisabledPackageIds()).toEqual(new Set());
        setPackageDisabled(undefined, 'com.acme.billing', true);
        expect(readFileSync(stateFile('default'), 'utf8')).toContain('com.acme.billing');
    });

    // An environment id reaches this store from config / env vars, so it is not
    // guaranteed path-safe. It must never escape the package-state directory.
    it('sanitizes environment ids into a single flat file name', () => {
        setPackageDisabled('../../etc/evil', 'com.acme.reporting', true);

        expect(loadDisabledPackageIds('../../etc/evil')).toEqual(new Set(['com.acme.reporting']));
        expect(readFileSync(stateFile('.._.._etc_evil'), 'utf8')).toContain('com.acme.reporting');
    });

    // Boot reads this file. A half-written or hand-edited file must degrade to
    // "nothing disabled" rather than throwing inside plugin init.
    it('treats a corrupt state file as empty instead of throwing', () => {
        mkdirSync(join(home, 'package-state'), { recursive: true });
        writeFileSync(stateFile('env_local'), '{ this is not json', 'utf8');

        expect(() => loadDisabledPackageIds('env_local')).not.toThrow();
        expect(loadDisabledPackageIds('env_local')).toEqual(new Set());
    });

    it('ignores a non-object payload and non-string entries', () => {
        mkdirSync(join(home, 'package-state'), { recursive: true });
        writeFileSync(stateFile('env_local'), '"just a string"', 'utf8');
        expect(loadDisabledPackageIds('env_local')).toEqual(new Set());

        writeFileSync(stateFile('env_local'), JSON.stringify({ disabled: ['ok', 42, null] }), 'utf8');
        expect(loadDisabledPackageIds('env_local')).toEqual(new Set(['ok']));
    });

    it('creates the package-state directory on first write', () => {
        expect(() => setPackageDisabled('env_local', 'com.acme.reporting', true)).not.toThrow();
        expect(readFileSync(stateFile('env_local'), 'utf8')).toContain('com.acme.reporting');
    });
});

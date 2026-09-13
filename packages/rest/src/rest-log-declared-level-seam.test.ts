// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#15484] The declared fault-log level seam on this package's console shim.
//
// The card this closes measured 2,095 indented `at ` stack-frame lines on one
// green `packages/rest` run — 36.7% of the captured output — and attributed
// 100% of them to `logError` handing whole `Error` objects to `console.error`,
// which Node formats with the full stack and the `[cause]` chain.
//
// The ruling on it (decision batch #49, item 2) bought a DECLARATION, not a
// quieter product: 「a declared level seam on `logError`, shipped default
// unchanged」. So the property this file exists to hold is the one that is
// easiest to lose by accident and impossible to notice afterwards:
//
//   ⛔ THE SHIPPED DEFAULT PRINTS THE WHOLE `Error`.
//
// That matters because at `logWithheldServerFault` the client is told nothing
// and the log is the operator's ONLY copy of the driver text — and that text
// lives on `error.cause`, so it is printed only because an `Error` OBJECT, not
// a string, reaches `console.error` (#5437 / #8136). A "quieten the logs"
// change that lowers the default, or formats the error down to its message,
// deletes from the LOG exactly what was deliberately withheld from the CLIENT,
// and every existing assertion about the WIRE answer stays green while it does.
//
// ⚠️ This file asserts on the fault log, so it DECLARES the level it depends on
// instead of inheriting it from `vitest.config.ts`. That is the pattern any
// future test asserting on this shim should copy: see the measured note in the
// root `env` block of that config for why the suite's own value is the shipped
// default and not a quieter one.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    logError,
    logWarn,
    restLogLevel,
    REST_LOG_LEVELS,
    REST_LOG_DEFAULT_LEVEL,
    type RestLogLevel,
} from './log.js';

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let saved: string | undefined;

/** Set the seam for one assertion; `undefined` means "as shipped — nothing declared". */
function at(level: string | undefined): void {
    if (level === undefined) delete process.env.OS_REST_LOG;
    else process.env.OS_REST_LOG = level;
}

beforeEach(() => {
    saved = process.env.OS_REST_LOG;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    if (saved === undefined) delete process.env.OS_REST_LOG;
    else process.env.OS_REST_LOG = saved;
    errorSpy.mockRestore();
    warnSpy.mockRestore();
});

describe('[#15484] the shipped default is unchanged — a reported fault prints the whole Error', () => {
    it('with NOTHING declared, logError hands console.error the identical argument list', () => {
        at(undefined);
        const cause = new Error('SQLITE_ERROR: no such table: sys_metadata');
        const boom = new Error('Failed to delete customization overlay', { cause });

        logError('[REST] Unhandled error:', boom);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const args = errorSpy.mock.calls[0];
        expect(args).toHaveLength(2);
        expect(args[0]).toBe('[REST] Unhandled error:');
        // Identity, not shape: Node prints the frames and the `[cause]` chain
        // only because the Error OBJECT itself is what arrives here.
        expect(args[1]).toBe(boom);
        expect((args[1] as Error).cause).toBe(cause);
    });

    it('an UNRECOGNISED value falls back to the default rather than silencing anything', () => {
        at('quiet');
        expect(restLogLevel()).toBe(REST_LOG_DEFAULT_LEVEL);
        logError('[REST] Unhandled error:', new Error('boom'));
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('an empty declaration is not a silencing declaration', () => {
        at('');
        expect(restLogLevel()).toBe(REST_LOG_DEFAULT_LEVEL);
        logError('[REST] Unhandled error:', new Error('boom'));
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('the declared default is loud enough for BOTH sites — the ⛔ that must not be lowered', () => {
        at(undefined);
        logError('e');
        logWarn('w');
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });
});

describe('[#15484] the level ladder — suppression is only ever what a harness declares', () => {
    it('silent stops both sites', () => {
        at('silent');
        logError('e', new Error('boom'));
        logWarn('w');
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('error keeps the fault and drops the warning', () => {
        at('error');
        logError('e', new Error('boom'));
        logWarn('w');
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it.each(['warn', 'info', 'debug'] as const)('%s keeps both sites, Error identity intact', (level) => {
        at(level);
        const boom = new Error('boom');
        logError('e', boom);
        logWarn('w');
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][1]).toBe(boom);
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('every declared level is honoured by restLogLevel', () => {
        for (const level of REST_LOG_LEVELS) {
            at(level);
            expect(restLogLevel()).toBe(level);
        }
    });

    it('the level is read per call, so a harness declaration made after import is observed', () => {
        at('silent');
        logError('e');
        expect(errorSpy).not.toHaveBeenCalled();
        at('info');
        logError('e');
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('an UPPERCASE declaration is honoured, not silently defaulted', () => {
        at('SILENT');
        expect(restLogLevel()).toBe('silent' satisfies RestLogLevel);
    });
});

describe('[#15484] one logging contract, two populations', () => {
    it('OS_REST_LOG accepts exactly the vocabulary OS_REGISTRY_LOG accepts', () => {
        // The ruling asked for 「one logging contract, not a second ad-hoc env
        // var」, so the two seams share one vocabulary. ⚠️ The EQUALITY is held
        // by `scripts/check-rest-log-declared.mjs`, which reads both arrays out
        // of their own sources, and NOT here: `@objectstack/objectql` does not
        // re-export `REGISTRY_LOG_LEVELS` from its package index, so importing
        // it here yields `undefined` and an assertion that cannot fail honestly.
        // What this pin holds is the literal vocabulary, so a level added or
        // renamed here has to be a deliberate edit in two places.
        expect([...REST_LOG_LEVELS].sort()).toEqual(['debug', 'error', 'info', 'silent', 'warn']);
    });

    it('the shipped default matches the engine seam it is modelled on', () => {
        expect(REST_LOG_DEFAULT_LEVEL).toBe('info');
    });
});

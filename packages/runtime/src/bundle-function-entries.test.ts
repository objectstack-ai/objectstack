// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `bundle.functions` collection keeps each entry's DECLARATION (#4396).
 *
 * The declaration matters at one consumer — a `script` node reporting what its
 * run did to the data — but the collector is the first place it can be lost,
 * and losing it here is indistinguishable from never having supported the
 * shape: the run then reports the writes as nothing.
 */

import { describe, it, expect } from 'vitest';
import { collectBundleFunctions, collectBundleFunctionEntries } from './app-plugin';

describe('collectBundleFunctionEntries (#4396)', () => {
    it('reads a bare handler as the pure default', () => {
        const scoreLead = () => ({ score: 1 });
        const entries = collectBundleFunctionEntries({ functions: { scoreLead } });
        expect(entries.scoreLead).toEqual({ handler: scoreLead, effect: 'pure' });
    });

    it('keeps a declared writer’s effect off the map form', () => {
        const syncBilling = () => ({ ok: true });
        const entries = collectBundleFunctionEntries({
            functions: { syncBilling: { handler: syncBilling, effect: 'writes' } },
        });
        expect(entries.syncBilling).toEqual({ handler: syncBilling, effect: 'writes' });
    });

    it('keeps it off the array form too', () => {
        const syncBilling = () => ({ ok: true });
        const entries = collectBundleFunctionEntries({
            functions: [{ name: 'syncBilling', handler: syncBilling, effect: 'writes' }],
        });
        expect(entries.syncBilling).toEqual({ handler: syncBilling, effect: 'writes' });
    });

    it('merges manifest.functions alongside bundle.functions', () => {
        const a = () => 1;
        const b = () => 2;
        const entries = collectBundleFunctionEntries({
            functions: { a },
            manifest: { functions: { b: { handler: b, effect: 'writes' } } },
        });
        expect(Object.keys(entries).sort()).toEqual(['a', 'b']);
        expect(entries.b.effect).toBe('writes');
    });

    it('drops entries with no callable, and flags an unreadable effect as a write', () => {
        const syncBilling = () => ({ ok: true });
        const entries = collectBundleFunctionEntries({
            functions: {
                broken: { effect: 'writes' },
                typo: { handler: syncBilling, effect: 'write' },
            },
        });
        expect(entries.broken).toBeUndefined();
        expect(entries.typo).toEqual({
            handler: syncBilling,
            effect: 'writes',
            unrecognizedEffect: 'write',
        });
    });
});

describe('collectBundleFunctions', () => {
    it('still answers with plain callables — hooks and jobs need nothing else', () => {
        const scoreLead = () => ({ score: 1 });
        const syncBilling = () => ({ ok: true });
        const functions = collectBundleFunctions({
            functions: { scoreLead, syncBilling: { handler: syncBilling, effect: 'writes' } },
        });
        expect(functions.scoreLead).toBe(scoreLead);
        // The declared form resolves to its handler rather than being dropped:
        // before #4396 a `{ handler, effect }` entry was silently skipped here,
        // which would have made a string-named hook unresolvable.
        expect(functions.syncBilling).toBe(syncBilling);
    });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * This package spells the standalone-action owner-key ladder ONCE (#14422).
 *
 * `ObjectQLPlugin` carried a private `actionObjectKey` that repeated
 * {@link standaloneActionOwnerKey}'s three rungs, and the only thing holding
 * the two equal was a sentence in each docblock. It had already drifted in the
 * one way a copy can drift without any test noticing: the plugin's terminal
 * rung returned the bare literal `'global'` while the canonical helper returns
 * `GLOBAL_ACTION_OBJECT_KEY`. Equal in value on the day it was measured, and
 * silently different the first time that constant moves.
 *
 * `@objectstack/runtime` carries the matching weld for its own copy
 * (`action-owner-key-single-source.test.ts` there). This one is scoped to this
 * package's source so it stays a package-local test input.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { GLOBAL_ACTION_OBJECT_KEY, standaloneActionOwnerKey } from './action-governance.js';

/** Rung 1 exactly as `action-governance.ts` writes it. */
const LADDER_RUNG_1 = "typeof action?.objectName === 'string' && action.objectName.length > 0";
/** Rung 2, likewise. */
const LADDER_RUNG_2 = "typeof action?.object === 'string' && action.object.length > 0";

/**
 * This package's `src` directory, located from the test file's own path via
 * vitest's runner state rather than `import.meta.url`: this package builds to
 * CommonJS, where `import.meta` is a TS1470 that would bill the TEST_DEBT
 * ledger for a config error saying nothing about this test.
 */
function srcDir(): string {
    const testPath = expect.getState().testPath;
    if (!testPath) {
        throw new Error('vitest did not report a testPath — the #14422 weld cannot locate this package.');
    }
    return dirname(testPath);
}

function nonTestSources(): Array<{ file: string; text: string }> {
    const dir = srcDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    if (files.length === 0) {
        throw new Error(`No sources found under ${dir} — the #14422 weld would pass vacuously. Fix this scan.`);
    }
    return files.map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
}

describe('standalone-action owner key — one spelling in @objectstack/objectql (#14422)', () => {
    it('writes each ladder rung in exactly one file, and that file is action-governance.ts', () => {
        const sources = nonTestSources();
        // Anti-vacuity: the scan must be able to SEE the canonical spelling.
        // A rung constant that matched nothing would make both counts zero and
        // the assertion below green for the wrong reason.
        const canonical = sources.find((s) => s.file === 'action-governance.ts');
        expect(canonical, 'action-governance.ts is missing from the scan').toBeDefined();
        expect(canonical!.text).toContain(LADDER_RUNG_1);
        expect(canonical!.text).toContain(LADDER_RUNG_2);

        for (const rung of [LADDER_RUNG_1, LADDER_RUNG_2]) {
            const carriers = sources.filter((s) => s.text.includes(rung)).map((s) => s.file);
            expect(carriers, `ladder rung re-inlined: ${rung}`).toEqual(['action-governance.ts']);
        }
    });

    it('leaves no private `actionObjectKey` behind on the plugin', () => {
        const plugin = nonTestSources().find((s) => s.file === 'plugin.ts');
        expect(plugin, 'plugin.ts is missing from the scan').toBeDefined();
        expect(plugin!.text).not.toContain('actionObjectKey');
        // Positive control for the negative above: the plugin does still derive
        // owner keys — it just does it through the canonical helper now.
        expect(plugin!.text).toContain('standaloneActionOwnerKey(');
    });

    it('terminates the ladder on the constant, never on a bare literal', () => {
        expect(standaloneActionOwnerKey({})).toBe(GLOBAL_ACTION_OBJECT_KEY);
        const canonical = nonTestSources().find((s) => s.file === 'action-governance.ts')!.text;
        const body = canonical.match(/export function standaloneActionOwnerKey\([^)]*\): string \{([\s\S]*?)\n\}/);
        if (!body) {
            throw new Error(
                'Could not locate `standaloneActionOwnerKey` in action-governance.ts. '
                + 'The #14422 weld cannot verify itself — fix this parse rather than deleting it.',
            );
        }
        expect(body[1]).toContain('return GLOBAL_ACTION_OBJECT_KEY;');
        expect(body[1]).not.toContain("'global'");
    });
});

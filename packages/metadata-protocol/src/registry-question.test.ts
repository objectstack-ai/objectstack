// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D2 and D6, amended] Every producer of a published `saveMetaItem`
 * or of `promoteDraftForPublish` states which registry question it asks
 * (`registry-question.ts`). The population is every call in a package's
 * `src/**` (tests excluded, comments blanked) whose argument is a request: a
 * literal `{ … }` or a request variable, not a forwarder's `...a` or a facet's
 * `protocolHost(this)`. A new call, a removed one or a moved one turns this
 * red until `REGISTRY_QUESTION_PRODUCERS` records it with its question, so a
 * new single-object door cannot inherit the body-only question (whose refusal
 * is only logged) by default.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import {
    AGAINST_REGISTRY_SAVE_FACES,
    PROMOTION_REGISTRY_QUESTION,
    REGISTRY_QUESTION_PRODUCERS,
    saveRegistryQuestion,
} from './registry-question.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', 'build', '.next']);

function sourcesUnder(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) sourcesUnder(join(dir, entry.name), out);
        } else if (/\.(ts|tsx|mts)$/.test(entry.name) && !/\.(test|spec)\.|\.d\.ts$/.test(entry.name)) {
            const rel = relative(ROOT, join(dir, entry.name)).split('\\').join('/');
            if (rel.includes('/src/')) out.push(rel);
        }
    }
    return out;
}

/** A call whose argument is a request: `{` or `identifier)`. */
const CALL = (callee: string) => new RegExp(`\\.${callee}\\(\\s*(?:\\{|[A-Za-z_$][\\w$]*\\s*\\))`, 'g');

function census(): Map<string, number> {
    const found = new Map<string, number>();
    for (const file of sourcesUnder(join(ROOT, 'packages'))) {
        const source = maskComments(readFileSync(join(ROOT, file), 'utf8'));
        for (const callee of ['saveMetaItem', 'promoteDraftForPublish'] as const) {
            const calls = source.match(CALL(callee))?.length ?? 0;
            if (calls > 0) found.set(`${file} :: ${callee}`, calls);
        }
    }
    return found;
}

describe('which doors ask the registry against its other objects (registry-question.ts)', () => {
    it('every request-carrying `saveMetaItem` and `promoteDraftForPublish` call in a package source is recorded with its question', () => {
        const found = census();
        const recorded = new Map(REGISTRY_QUESTION_PRODUCERS.map((p) => [`${p.file} :: ${p.callee}`, p.calls]));
        expect(
            [...found].sort(),
            'a producer was added, removed or moved: record it in REGISTRY_QUESTION_PRODUCERS with the registry question it asks',
        ).toEqual([...recorded].sort());
    });

    it('the two by-face save producers state the single-save faces, and the publish producers state their question', () => {
        const rest = readFileSync(join(ROOT, 'packages/rest/src/meta-item-write-routes.ts'), 'utf8');
        const dispatcher = readFileSync(join(ROOT, 'packages/runtime/src/domains/meta.ts'), 'utf8');
        expect(rest).toContain("writeFace: 'meta-envelope'");
        expect(dispatcher).toContain("writeFace: 'meta-dispatch'");
        expect([...AGAINST_REGISTRY_SAVE_FACES].sort()).toEqual(['meta-dispatch', 'meta-envelope']);
        const publish = maskComments(readFileSync(join(ROOT, 'packages/metadata-protocol/src/protocol-history-and-publish.ts'), 'utf8'));
        expect(publish.split("PROMOTION_REGISTRY_QUESTION['item-publish']").length - 1).toBe(1);
        expect(publish.split("PROMOTION_REGISTRY_QUESTION['package-publish']").length - 1).toBe(1);
        expect(PROMOTION_REGISTRY_QUESTION).toEqual({ 'item-publish': 'against-registry', 'package-publish': 'body-only' });
    });

    it('only a published save on a single-save face asks against the registry', () => {
        expect(saveRegistryQuestion({ mode: 'publish', writeFace: 'meta-envelope' })).toBe('against-registry');
        expect(saveRegistryQuestion({ mode: 'publish', writeFace: 'meta-dispatch' })).toBe('against-registry');
        expect(saveRegistryQuestion({ mode: 'draft', writeFace: 'meta-envelope' })).toBe('body-only');
        expect(saveRegistryQuestion({ writeFace: 'meta-envelope' })).toBe('body-only');
        expect(saveRegistryQuestion({ mode: 'publish', writeFace: 'package-duplicate' })).toBe('body-only');
        expect(saveRegistryQuestion({ mode: 'publish', writeFace: 'external-import' })).toBe('body-only');
        expect(saveRegistryQuestion({ mode: 'publish' })).toBe('body-only');
    });
});

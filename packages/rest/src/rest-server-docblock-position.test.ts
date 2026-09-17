// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * No TSDoc block in `rest-server.ts` may be immediately followed by another
 * TSDoc block. The earlier one would bind to nothing.
 *
 * ## What was wrong
 *
 * TSDoc binds a block to the declaration below it, and when two blocks are
 * stacked the NEARER one wins — so the earlier block documents no declaration
 * at all. This file carried three of them:
 *
 * - a paragraph describing `resolveProtocol`, parked above
 *   `resolveHostnameCached`'s own block;
 * - the exported `RestServer` class overview, with its `@example`, orphaned by
 *   the `RestEnvRegistry` interface block;
 * - the `registerSharingEndpoints` route table, orphaned by the analytics one.
 *
 * ## Why a pin, and why a STRUCTURAL one
 *
 * The stale sentence is the symptom; the position is the producer. The first
 * block above had already been corrected once, for a retired `/projects/...`
 * URL spelling that survived a rename sweep for roughly three weeks — because a
 * sweep reads the docblock OF the method it is changing, and a block bound to
 * nothing is unreachable from every declaration in the file. Correcting the
 * prose again would have left the position free to carry the next stale
 * sentence, so this pin asserts the SHAPE rather than any wording. Wording is
 * not pinned here on purpose: nothing parses these sentences, so a pin on them
 * would fail on an honest re-wrap.
 *
 * It is not cosmetic. All three blocks reached consumers: their text is emitted
 * into `dist/index.d.ts` and `dist/index.d.cts`, both of which ship inside the
 * `@objectstack/rest` tarball via `files: ["dist", ...]`.
 *
 * ## Scope, stated honestly
 *
 * - **One file.** The same shape was measured at 578 stacked pairs across 460
 *   files repo-wide, so a repo-wide assertion is a ratchet project and not this
 *   one. `packages/runtime/src/http-dispatcher.ts` alone holds 26, most of them
 *   a rich block orphaned by a one-line `Thin delegate` block, plus a field of
 *   docblocks whose methods were extracted away entirely. None of that is
 *   pinned here, and this pin's green says nothing about it.
 * - **Lexical, not a parser.** Block boundaries are found by scanning for the
 *   opening and closing block-comment delimiters as text, not by lexing
 *   TypeScript. A delimiter inside a string or regex literal reads as a real
 *   one. That direction fails
 *   LOUD (a spurious pair is reported and a human looks), which is the safe
 *   direction; the floor below covers the quiet one.
 * - **Only the stacked shape.** A block separated from the next by any code,
 *   a `//` line comment or a decorator is bound normally and is not read here.
 *
 * The floor is anti-vacuity: a scanner that silently stopped matching would
 * otherwise pass by finding nothing at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILE = 'rest-server.ts';
const SOURCE = readFileSync(new URL('./rest-server.ts', import.meta.url), 'utf8');
const LINES = SOURCE.split('\n');

/**
 * The file is large and every block in it is load-bearing documentation; if
 * this count ever collapses, the scan below stopped working rather than the
 * file getting tidier. Measured at 140 when this pin landed.
 */
const MIN_BLOCKS = 100;

interface Block {
    /** 1-based inclusive line numbers, as an editor reports them. */
    start: number;
    end: number;
    firstLine: string;
}

function collectBlocks(lines: string[]): Block[] {
    const blocks: Block[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trimStart().startsWith('/**')) continue;
        let j = i;
        // A one-line block closes on its own line; otherwise walk to the close.
        if (!lines[i].trimStart().slice(3).includes('*/')) {
            while (j < lines.length && !lines[j].includes('*/')) j++;
            if (j >= lines.length) throw new Error(`${FILE}: unterminated TSDoc block opened at line ${i + 1}`);
        }
        blocks.push({ start: i + 1, end: j + 1, firstLine: lines[i].trim() });
        i = j;
    }
    return blocks;
}

const BLOCKS = collectBlocks(LINES);

/** True when only blank lines separate `a`'s close from `b`'s open. */
function stacked(a: Block, b: Block): boolean {
    for (let n = a.end + 1; n < b.start; n++) {
        if (LINES[n - 1].trim() !== '') return false;
    }
    return b.start > a.end;
}

describe('rest-server.ts docblock position', () => {
    it(`finds at least ${MIN_BLOCKS} TSDoc blocks to judge (anti-vacuity floor)`, () => {
        expect(BLOCKS.length).toBeGreaterThanOrEqual(MIN_BLOCKS);
    });

    it('binds every TSDoc block to a declaration — none is stacked above another', () => {
        const orphans = BLOCKS.slice(0, -1)
            .map((block, index) => ({ block, next: BLOCKS[index + 1] }))
            .filter(({ block, next }) => stacked(block, next))
            .map(({ block, next }) =>
                `  L${block.start}-${block.end} is followed directly by the block at L${next.start}, ` +
                `so TSDoc binds that one and L${block.start} binds to nothing.\n` +
                `    first line: ${block.firstLine}`,
            );

        expect(
            orphans.length === 0
                ? ''
                : `${orphans.length} TSDoc block(s) in ${FILE} bind to no declaration:\n${orphans.join('\n')}\n\n` +
                  `Move the block onto the declaration it describes, merge it into that ` +
                  `declaration's existing block, or delete it if the declaration is gone. ` +
                  `A block bound to nothing is invisible to a rename sweep, which reads the ` +
                  `docblock OF the method it changes — and it still ships in dist/index.d.ts.`,
        ).toBe('');
    });
});

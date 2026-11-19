// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The object save path reaches `@objectstack/lint` only through
 * `@objectstack/lint/runtime`, never through the package ROOT (#4463;
 * `packages/lint/src/runtime.ts`). `destructive-still-shown-by.ts` needs three
 * judges only the root exports, so it loads the root lazily with a dynamic
 * `import()`, as `build-probes.ts` does.
 *
 * Pinned over the STATIC import closure of `protocol-save.ts`: every module it
 * reaches through a relative `import … from` / `export … from`, none of which
 * may import the lint root as a value. A type-only import is erased and allowed;
 * a dynamic `import('@objectstack/lint')` is the sanctioned shape.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

/** A static value import or re-export of the lint ROOT (not `/runtime`, not `import type`). */
const STATIC_LINT_ROOT = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"]@objectstack\/lint['"]/m;
/** Static relative imports and re-exports, the edges of the closure. */
const RELATIVE_EDGE = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/gm;

function closureOf(entry: string): string[] {
    const seen = new Set<string>();
    const queue = [resolve(SRC, entry)];
    while (queue.length > 0) {
        const file = queue.shift() as string;
        if (seen.has(file)) continue;
        seen.add(file);
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(RELATIVE_EDGE)) {
            const target = join(dirname(file), m[1].replace(/\.js$/, '.ts'));
            if (existsSync(target)) queue.push(target);
        }
    }
    return [...seen];
}

describe('the object save path does not statically import the lint root', () => {
    it('no module in protocol-save.ts\'s static closure imports @objectstack/lint as a value', () => {
        const closure = closureOf('protocol-save.ts');
        // Not vacuous: the walk reached the module that needs the judges.
        expect(closure).toContain(join(SRC, 'destructive-still-shown-by.ts'));
        const offenders = closure.filter((f) => STATIC_LINT_ROOT.test(readFileSync(f, 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('the still-shown-by module loads the judges through a dynamic import of the root', () => {
        const text = readFileSync(join(SRC, 'destructive-still-shown-by.ts'), 'utf8');
        expect(text).toMatch(/await import\(['"]@objectstack\/lint['"]\)/);
        // The detector itself bites on the shape it forbids.
        expect(STATIC_LINT_ROOT.test("import { validateFormLayout } from '@objectstack/lint';")).toBe(true);
        expect(STATIC_LINT_ROOT.test("import type { X } from '@objectstack/lint';")).toBe(false);
        expect(STATIC_LINT_ROOT.test("import { runRuntimeAuthoringRules } from '@objectstack/lint/runtime';")).toBe(false);
    });
});

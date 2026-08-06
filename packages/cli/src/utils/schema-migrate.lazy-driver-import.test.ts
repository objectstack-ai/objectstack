// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5726 — no CLI production module may STATICALLY value-import a driver.
 *
 * The cost of one such import is not paid by the command that needs the driver.
 * oclif's `findCommand` walks the command table and `import()`s every command
 * module on **every** CLI invocation, so a broken import chain anywhere in that
 * table is charged to whatever command you actually ran. `schema-migrate.ts` is
 * shared by nine commands (`meta:resync`, `migrate`, and seven `migrate:*`), and
 * its one static `import { isInPlaceSchemaWork } from '@objectstack/driver-sql'`
 * meant that an unbuilt `packages/drivers/driver-sql/dist` made `os dev` print
 * nine `MODULE_NOT_FOUND` blocks (eighteen — `dev` forks a child) naming nine
 * commands the operator never invoked, and made all nine vanish from the command
 * table: `os migrate plan` answered `Command migrate:plan not found.` The real
 * cause was `pnpm build`, which nothing in that output said.
 *
 * These are source-level assertions on purpose. The defect lives in the shape of
 * the import graph, which is decided at authoring time and is invisible to any
 * test that merely calls the functions — every behavioural test in this package
 * runs in a workspace where the driver happens to be built.
 *
 * Scanning `src` rather than `dist` is the same choice: `dist` is what oclif
 * loads, but building it inside a unit test would be far slower than the thing
 * it guards, and `tsc` does not move imports between the two forms — a static
 * value import in `src` is a static import in `dist`, and an `await import()`
 * stays dynamic.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `packages/cli/src` — this file lives in `src/utils/`. */
const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every production `.ts` under `packages/cli/src`, as `[relativePath, source]`. */
function productionSources(): Array<[string, string]> {
  return readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf8' })
    .filter((rel) => rel.endsWith('.ts') && !rel.endsWith('.d.ts'))
    .filter((rel) => !/\.(test|spec)\.ts$/.test(rel))
    .map((rel) => [rel, readFileSync(join(SRC_ROOT, rel), 'utf8')] as [string, string]);
}

/**
 * Static `import … from '<specifier>'` statements, with the leading `type`
 * keyword captured when present.
 *
 * `[^;]*?` cannot cross a statement terminator, so a multi-line import clause is
 * matched whole while two adjacent statements can never be spliced together.
 */
const STATIC_IMPORT = /^[ \t]*import[ \t]+(?:(type)[ \t]+)?([^;]*?)[ \t]*from[ \t]*['"]([^'"]+)['"]/gm;

/** Bare side-effect imports — `import '<specifier>';` — which also load the module. */
const SIDE_EFFECT_IMPORT = /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm;

const DRIVER_PACKAGE = /^@objectstack\/driver-/;

describe('#5726 — CLI command modules must not statically value-import a driver', () => {
  it('has no static value import of any @objectstack/driver-* package in production sources', () => {
    const offenders: string[] = [];

    for (const [rel, src] of productionSources()) {
      for (const m of src.matchAll(STATIC_IMPORT)) {
        const [, typeKeyword, clause, specifier] = m;
        if (!DRIVER_PACKAGE.test(specifier)) continue;
        // `import type { … } from` erases entirely — no runtime edge, no cost.
        if (typeKeyword) continue;
        // A clause of inline `type` specifiers still emits the module under
        // `verbatimModuleSyntax`. Flagged deliberately: the fix (hoisting the
        // keyword to `import type`) is trivial and always available, so there is
        // no reason to let the risky spelling through on a technicality.
        offenders.push(`${rel}: import ${clause.trim()} from '${specifier}'`);
      }
      for (const m of src.matchAll(SIDE_EFFECT_IMPORT)) {
        if (DRIVER_PACKAGE.test(m[1])) offenders.push(`${rel}: import '${m[1]}'`);
      }
    }

    expect(
      offenders,
      'A static value import of a driver package makes EVERY command that reaches this module ' +
      'fail oclif command discovery when the driver is not built, and prints one MODULE_NOT_FOUND ' +
      'block per such command in front of whatever the operator actually ran (#5726). ' +
      'Use `await import(\'@objectstack/driver-…\')` at the point of use, or `import type` when ' +
      'only the types are needed.',
    ).toEqual([]);
  });

  it('still reaches the driver for the in-place classifier, lazily — one definition, loaded later', () => {
    const src = readFileSync(join(SRC_ROOT, 'utils/schema-migrate.ts'), 'utf8');

    // The point of the fix is NOT "stop depending on driver-sql". The
    // additive/in-place split is a fact about `PendingSchemaWorkKind`, declared
    // beside that union in the driver; re-deriving it here would let the CLI
    // disagree with the driver the day a kind is added — by listing a row
    // rewrite under a heading that promises the work is never data-losing
    // (#3954). Pin that the dependency survives, in its dynamic form.
    expect(src).toMatch(/await import\((['"])@objectstack\/driver-sql\1\)/);
    expect(src).toContain('isInPlaceSchemaWork');
  });

  it('awaits every call of the now-async pending-work renderers', () => {
    // `renderPendingSchemaWork` returns `Promise<void>`, so a dropped `await` is
    // not a type error — it is output that races the process exit. (The repo
    // already carries an eslint rule for exactly this shape on `formatOutput`.)
    const CALL = /(\bawait\s+|\bfunction\s+|\.)?\b(renderPendingSchemaWork|summarizePendingSchemaWork)\s*\(/g;
    const unawaited: string[] = [];

    for (const [rel, src] of productionSources()) {
      for (const m of src.matchAll(CALL)) {
        const prefix = m[1] ?? '';
        if (/^function\s+$/.test(prefix)) continue; // the declaration itself
        if (/^await\s+$/.test(prefix)) continue;
        unawaited.push(`${rel}: ${m[0].trim()}`);
      }
    }

    expect(unawaited, 'These renderers became async in #5726 — await them.').toEqual([]);
  });
});

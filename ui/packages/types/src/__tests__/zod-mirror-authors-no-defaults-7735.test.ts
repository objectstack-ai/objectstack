// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The zod mirror VALIDATES; it does not AUTHOR (objectui#7735, director ruling,
 * decision batch #69, 2026-09-07 — maintainer reply 「其他同意」).
 *
 * A `.default(v)` on a mirror member is not documentation. `parse` SUBSTITUTES
 * `v` into the output when the key is absent, so one authored document took two
 * shapes depending on whether it had been through the validator, and the
 * renderers — which carry their own fallbacks and are what actually runs — were
 * overruled for any document that had:
 *
 *   | key                        | mirror wrote | the renderer applies              |
 *   |----------------------------|--------------|-----------------------------------|
 *   | `ContainerSchema.maxWidth` | `'lg'`       | `container.tsx`: `?? 'xl'`        |
 *   | `FlexSchema.align`         | `'center'`   | `flex.tsx`: `\|\| 'start'`        |
 *
 * `'center'` is a value NEITHER `flex` nor `stack` applies. `StackSchema`
 * already declared no defaults at all, so the file was not even self-consistent.
 *
 * The ruling settled the general question rather than the two rows: the
 * renderer's fallback is the SINGLE authoritative default, the JSDoc `@default`
 * DESCRIBES it, and the mirror carries no `.default()` anywhere. Option 甲
 * (move the two values to match the renderers) was refused — it leaves the rest
 * of the population unaudited and no gate behind it.
 *
 * ## The population, measured rather than quoted
 *
 * The ruling says "45 `.default()` sites across the seven `*.zod.ts` files".
 * Re-derived on `origin/main` `fc32921`: a text search for `.default(` matches
 * 45 times, but FOUR of those are prose inside docblocks — three in
 * `objectql.zod.ts`, one in `complex.zod.ts` — and those two files have no call
 * site at all. The real population was **41 call sites in 5 files**:
 *
 *   layout.zod.ts 22 · crud.zod.ts 11 · form.zod.ts 5 · views.zod.ts 2 · app.zod.ts 1
 *
 * That arithmetic is the reason `noAuthoredDefaults` below parses instead of
 * grepping. Worded literally as the ruling puts it — "no `.default(` under
 * `packages/types/src/zod/**`" — a text pin is RED on the day it lands, because
 * those four docblock mentions are legitimate prose that survives the change.
 * `discriminates` is the control that proves the difference is real and not a
 * regex that quietly matches nothing.
 *
 * ## Accept set: unchanged, and that is load-bearing
 *
 * `.default()` can carry optionality as well as a value — a member written
 * `.default(x)` with no `.optional()` is optional BECAUSE of the default, and
 * removing it naively makes the key REQUIRED. That would be a silent accept-set
 * narrowing on a published surface, which this ruling did not authorise.
 * Measured before the removal: all 41 sites were spelled
 * `<type>.optional().default(v).describe(…)`, so none of them was carrying
 * optionality. `acceptSetUnchanged` re-states that as a live assertion.
 *
 * ## What this did NOT reach — and no longer has to (objectui#8317)
 *
 * Removing all 41 did not make `safeValidateSchema` stop substituting. 57
 * `ZodDefault` nodes remained reachable from the published barrel afterwards,
 * every one inside a subschema imported by reference from `@objectstack/spec`,
 * and this file used to assert that residue as a floor: "real, recorded, and
 * NOT this repository's to remove."
 *
 * ⭐ Decision batch #90 (2026-09-08, director seat under the maintainer's
 * standing delegation, objectui#8317) overturned that last clause. Batch #69's
 * principle holds for EVERY key `safeValidateSchema` answers, not only the 41
 * this repository authored, so the 57 are stripped at this package's import
 * boundary with `.removeDefault()` — `zod/imported-defaults.ts`, pinned by
 * `imported-defaults-8317.test.ts`. ⛔ Option B (a 1546-site change on
 * `@objectstack/spec`'s release train) was not taken; A is reversible into it.
 * The residue block below now asserts ZERO, and says why that is a ratchet the
 * boundary can hold when the old floor could not.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as ZodFace from '../zod/index.zod.js';
import { AnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIRROR_DIR = join(HERE, '..', 'zod');
const mirrorFiles = readdirSync(MIRROR_DIR).filter((f) => f.endsWith('.zod.ts')).sort();

/* ── face 1: the source ──────────────────────────────────────────────────── */

/** Every `X.default(…)` CALL in a mirror file. Comments are not in the AST. */
function defaultCallSites(file: string): { file: string; line: number }[] {
  const text = readFileSync(join(MIRROR_DIR, file), 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: { file: string; line: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'default'
    ) {
      out.push({ file, line: sf.getLineAndCharacterOfPosition(node.expression.name.getStart(sf)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Raw `.default(` text matches — what a grep-shaped pin would have counted. */
function textMatches(file: string): number {
  return (readFileSync(join(MIRROR_DIR, file), 'utf8').match(/\.default\(/g) ?? []).length;
}

/* ── face 2: the built schema graph ──────────────────────────────────────── */

interface ZodDef {
  type: string;
  shape?: Record<string, unknown>;
  options?: unknown[];
  element?: unknown;
  items?: unknown[];
  rest?: unknown;
  valueType?: unknown;
  keyType?: unknown;
  left?: unknown;
  right?: unknown;
  in?: unknown;
  out?: unknown;
  innerType?: unknown;
  getter?: () => unknown;
}
const defOf = (node: unknown): ZodDef | null =>
  (node as { _zod?: { def?: ZodDef } } | null)?._zod?.def ?? null;

/**
 * Every schema node reachable from `roots`, with a visited set so the `z.lazy`
 * cycles this face is full of terminate. A `lazy` getter that throws is
 * RECORDED, not skipped — a walker that silently loses a subtree would make
 * every assertion below vacuously true.
 */
function walk(roots: unknown[]): { nodes: Set<unknown>; unreachable: string[] } {
  const nodes = new Set<unknown>();
  const unreachable: string[] = [];
  const seenLazy = new Set<unknown>();
  const push = (n: unknown, stack: unknown[]): void => {
    if (!n || !defOf(n) || nodes.has(n)) return;
    nodes.add(n);
    stack.push(n);
  };
  const stack: unknown[] = [];
  for (const r of roots) push(r, stack);
  while (stack.length) {
    const node = stack.pop()!;
    const def = defOf(node)!;
    if (def.type === 'lazy') {
      if (!seenLazy.has(node)) {
        seenLazy.add(node);
        try {
          push(def.getter!(), stack);
        } catch (err) {
          unreachable.push(`lazy getter threw: ${String(err)}`);
        }
      }
      continue;
    }
    if (def.shape) for (const v of Object.values(def.shape)) push(v, stack);
    if (def.options) for (const v of def.options) push(v, stack);
    if (def.items) for (const v of def.items) push(v, stack);
    for (const k of ['element', 'rest', 'valueType', 'keyType', 'left', 'right', 'in', 'out', 'innerType'] as const) {
      if (def[k]) push(def[k], stack);
    }
  }
  return { nodes, unreachable };
}

/** Every exported schema of the published `@object-ui/types/zod` barrel. */
const exportedSchemas = Object.entries(ZodFace)
  .filter(([, v]) => defOf(v) !== null)
  .map(([name, v]) => [name, v] as const);

describe('the zod mirror authors no defaults (objectui#7735)', () => {
  describe('positive controls — the instruments see something', () => {
    it('there are mirror files, and the barrel exports schemas to walk', () => {
      expect(mirrorFiles.length).toBeGreaterThan(10);
      expect(exportedSchemas.length).toBeGreaterThan(50);
      expect(defOf(AnyComponentSchema)).not.toBeNull();
    });

    it('the AST walker finds the calls it is meant to find', () => {
      // `.describe(…)` is the sibling call on the very chains `.default()` used
      // to sit in. If the walker could not see it, a green result below would
      // mean nothing.
      const describeCalls = mirrorFiles.flatMap((f) => {
        const text = readFileSync(join(MIRROR_DIR, f), 'utf8');
        const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const hits: number[] = [];
        const visit = (n: ts.Node): void => {
          if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'describe') {
            hits.push(1);
          }
          ts.forEachChild(n, visit);
        };
        visit(sf);
        return hits;
      });
      expect(describeCalls.length).toBeGreaterThan(100);
    });

    it('the graph walker reaches every arm of AnyComponentSchema, with nothing lost', () => {
      const { nodes, unreachable } = walk([AnyComponentSchema, ...exportedSchemas.map(([, v]) => v)]);
      expect(unreachable).toEqual([]);
      expect(nodes.size).toBeGreaterThan(500);
    });
  });

  describe('the rule', () => {
    it('no mirror file contains a `.default()` CALL SITE', () => {
      const sites = mirrorFiles.flatMap(defaultCallSites);
      expect(
        sites.map((s) => `${s.file}:${s.line}`),
        'the mirror must not author values into an author\'s document — the renderer fallback is the ' +
          'authoritative default (objectui#7735). Keep `.optional()`; drop `.default()`.',
      ).toEqual([]);
    });

    /**
     * The boundary of the ruling, stated as a live measurement rather than left
     * for the next reader to trip over.
     *
     * ⭐ ZERO since objectui#8317 (decision batch #90). `ZodDefault` nodes used
     * to be reachable from the published barrel — 57 of them at the head #8299
     * landed on, none authored here: every one arrived inside a subschema
     * imported from `@objectstack/spec` (`app`'s `active` / `isDefault` off
     * `SpecAppSchema.shape`, `object-view`'s
     * `navigation.{mode,preventNavigation,openNewTab,size}`, `list-view`'s
     * `sharing.type`, `kanban`'s `grouping.fields[].{order,collapsed}`,
     * `page`'s whole `interfaceConfig` subtree, and the dashboard chart
     * config). Batch #90 ruled that a validator does not write values into an
     * author's document on THOSE keys either, so they are stripped where the
     * spec enters this package (`../zod/imported-defaults.ts`).
     *
     * ⚠️ This is now a RATCHET at zero, and it can be one where the old
     * `> 0` floor could not. The floor was a count of another package's
     * contents and moved with every `@objectstack/spec` bump, which is why it
     * was written as an inequality. Zero does not move with a bump: a default
     * added upstream tomorrow arrives through the same boundary and is stripped
     * by the same walk. What this assertion catches is a NEW ENTRY POINT — an
     * `@objectstack/spec` import that skips `stripImportedDefaults`, or a
     * `.default()` written here — and both of those are exactly the regression
     * batch #69 and batch #90 rule out.
     */
    it('no `ZodDefault` is reachable from the published barrel at all', () => {
      const { nodes, unreachable } = walk([AnyComponentSchema, ...exportedSchemas.map(([, v]) => v)]);
      expect(unreachable).toEqual([]);
      const defaults = [...nodes].filter((n) => defOf(n)!.type === 'default');
      expect(mirrorFiles.flatMap(defaultCallSites)).toEqual([]);
      expect(
        defaults.length,
        'a `ZodDefault` is reachable from `@object-ui/types/zod` again. Either a `.default()` was ' +
          'written in a mirror file (objectui#7735) or an `@objectstack/spec` import bypassed ' +
          '`stripImportedDefaults` at the boundary (objectui#8317). Route it through the boundary; ' +
          '⛔ do not weaken this number.',
      ).toBe(0);
    });

    /**
     * The reproducer that defined "done" on objectui#8317, both directions.
     *
     * ⚠️ The second direction is the one that makes the first meaningful. A
     * mirror that had simply DROPPED these keys from its shape would satisfy
     * "the author gets back what they wrote" for the empty document and quietly
     * refuse — or silently pass through — the document that writes them. Only
     * the pair distinguishes "stopped substituting" from "stopped declaring".
     */
    it('a spec-derived subtree no longer substitutes — and still round-trips what the author DID write', () => {
      const authoredEmpty = { type: 'object-view', objectName: 'account', navigation: {} };
      const empty = safeValidateSchema(authoredEmpty);
      expect(empty.success).toBe(true);
      expect((empty as { success: true; data: typeof authoredEmpty }).data).toEqual(authoredEmpty);

      const authoredFull = {
        type: 'object-view',
        objectName: 'account',
        navigation: { mode: 'page', preventNavigation: false, openNewTab: false, size: 'auto' },
      };
      const full = safeValidateSchema(authoredFull);
      expect(full.success).toBe(true);
      expect((full as { success: true; data: typeof authoredFull }).data).toEqual(authoredFull);
    });
  });

  /**
   * The trap this card was dispatched with. A text search is not a call-site
   * search, and on THIS tree the two answers differ: the prose survives the
   * change and is legitimate. A pin that cannot tell them apart is red on the
   * day it lands, and the repair for that redness is to delete real prose.
   */
  describe('the pin discriminates prose from calls', () => {
    it('some mirror file still MENTIONS `.default(` in a docblock', () => {
      const mentions = mirrorFiles.map((f) => [f, textMatches(f)] as const).filter(([, n]) => n > 0);
      expect(mentions.length, 'if this ever reaches zero the control below is vacuous').toBeGreaterThan(0);
    });

    it('every surviving `.default(` match is prose, and the AST census ignores all of them', () => {
      for (const file of mirrorFiles) {
        const text = textMatches(file);
        const calls = defaultCallSites(file).length;
        expect(calls, `${file}`).toEqual(0);
        if (text > 0) {
          // The text pin the ruling's wording implies would report `text` here
          // and go red; the AST pin reports 0. That gap IS the control.
          expect(text).toBeGreaterThan(calls);
        }
      }
    });
  });

  /**
   * The accept set is the half a naive removal breaks. Each member below was
   * `.optional().default(v)`, so it stays optional on its own; a member that
   * had been optional only BECAUSE of the default would now be required, and
   * these minimal documents would go red.
   */
  describe('accept set unchanged — every de-defaulted key is still omissible', () => {
    const MINIMAL = [
      { type: 'text', content: 'x' },
      { type: 'icon', icon: 'check' },
      { type: 'separator' },
      { type: 'container' },
      { type: 'flex' },
      { type: 'grid' },
      { type: 'card' },
      { type: 'aspect-ratio' },
      { type: 'button' },
      { type: 'input' },
    ] as const;

    it.each(MINIMAL.map((doc) => [doc.type, doc] as const))(
      'a minimal `%s` still parses green',
      (_type, doc) => {
        const result = safeValidateSchema(doc);
        expect(result.success, JSON.stringify(result.success ? {} : result.error.issues)).toBe(true);
      },
    );
  });

  /**
   * The user-visible consequence, restated as behaviour. Before the change,
   * `parse` returned `maxWidth: 'lg'` / `align: 'center'` for these documents
   * and the renderers' own fallbacks never ran.
   */
  describe('parse output no longer carries keys the author did not write', () => {
    it.each([
      ['container', { type: 'container' }, ['maxWidth', 'centered']],
      ['flex', { type: 'flex' }, ['direction', 'justify', 'align', 'gap', 'wrap']],
      ['grid', { type: 'grid' }, ['columns', 'gap']],
      ['card', { type: 'card' }, ['variant', 'hoverable', 'clickable']],
    ] as const)('%s', (_label, doc, formerlySubstituted) => {
      const result = safeValidateSchema(doc);
      expect(result.success).toBe(true);
      const data = (result as { success: true; data: Record<string, unknown> }).data;
      expect(Object.keys(data).sort()).toEqual(Object.keys(doc).sort());
      for (const key of formerlySubstituted) expect(key in data).toBe(false);
    });

    it('`stack` — the sibling that never authored defaults — is unchanged', () => {
      const result = safeValidateSchema({ type: 'stack' });
      expect(result.success).toBe(true);
      expect(Object.keys((result as { success: true; data: object }).data)).toEqual(['type']);
    });
  });
});

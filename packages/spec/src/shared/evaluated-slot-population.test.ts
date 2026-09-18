// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15811 — the evaluated-slot rule reaches EVERY slot an engine evaluates.
 *
 * #15430 gave `EvaluatedExpressionSchema` to the flow-node ledger and #15807
 * gave `EvaluatedExpressionInputSchema` to `FlowEdgeSchema.condition`. Decision
 * batch #122 item 2 generalised the rule: every other declaring position that
 * an engine evaluates composes the evaluated sibling, while
 * `ExpressionSchema` / `ExpressionInputSchema` stay the persistence contract.
 *
 * Two halves, because either alone is a green that proves nothing.
 *
 *  - The POPULATION half is structural: no declaring position in
 *    `packages/spec/src` may still mount `ExpressionInputSchema`. It is scanned
 *    by IDENTITY (a negative lookaround on identifier characters), because the
 *    bare substring also fires inside `CronExpressionInputSchema`,
 *    `TemplateExpressionInputSchema` and `EvaluatedExpressionInputSchema` — the
 *    trap that made the card's first two population readings wrong. A lit
 *    control and a dark control bracket the scan.
 *  - The BEHAVIOURAL half parses the two refused shapes at each slot AS
 *    MOUNTED, and asserts the count of positions it reached is exactly the
 *    census figure — so a position that quietly stops being reachable is a red
 *    rather than a row that silently leaves the table.
 *
 * The control leg for the behavioural half is the persistence contract itself:
 * `ExpressionSchema` / `ExpressionInputSchema` / `PredicateInputSchema` still
 * ACCEPT both shapes. Without it a table of `false`s would not be a reading.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  EVALUATED_EXPRESSION_SOURCE_REQUIRED,
  ExpressionInputSchema,
  ExpressionSchema,
  PredicateInputSchema,
} from './expression.zod.js';
import { FieldSchema, InlineGridColumnSchema, SelectOptionSchema } from '../data/field.zod.js';
import { HookSchema } from '../data/hook.zod.js';
import { ObjectFieldGroupSchema, RowCrudActionOverrideSchema } from '../data/object.zod.js';
import {
  ConditionalValidationSchema,
  CrossFieldValidationSchema,
  ScriptValidationSchema,
} from '../data/validation.zod.js';
import { CriteriaSharingRuleSchema } from '../security/sharing.zod.js';
import { PluginPermissionSchema } from '../kernel/plugin-security-advanced.zod.js';
import { MultiVersionSupportSchema } from '../kernel/plugin-versioning.zod.js';
import { ActionParamSchema, ActionSchema } from '../ui/action.zod.js';
import { ObjectNavItemSchema } from '../ui/app.zod.js';
import { BulkActionDefSchema } from '../ui/bulk-action.zod.js';
import { PageTabsProps, RecordAlertProps } from '../ui/component.zod.js';
import { PageComponentSchema } from '../ui/page.zod.js';
import { FormFieldSchema, FormSectionSchema, ListViewSchema } from '../ui/view.zod.js';
import { SettingsManifestSchema, SpecifierSchema } from '../system/settings-manifest.zod.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_SRC = join(HERE, '..');

/** The two shapes an engine cannot run, in both spellings of each seam. */
const AST_ONLY = { dialect: 'cel', ast: { kind: 'const', value: 1 } } as const;
const BLANK_SOURCE = { dialect: 'cel', source: '   ' } as const;
const BLANK_STRING = '   ';

// ---------------------------------------------------------------------------
// Population — structural
// ---------------------------------------------------------------------------

/** A roster name as an IDENTIFIER: the lookarounds are the whole point. */
function identityOf(name: string): RegExp {
  return new RegExp(String.raw`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`);
}

/** Lines that carry a name but declare nothing — comments and JSDoc prose. */
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/**
 * Where `packages/spec/src` still mounts the PERSISTENCE schema on a code line.
 * The definition file and the barrel are where it legitimately lives, and the
 * migration registry quotes its name in prose; everything else would be a slot.
 */
function persistenceSchemaCodeLines(): string[] {
  const re = identityOf('ExpressionInputSchema');
  const hits: string[] = [];
  for (const file of sourceFiles(SPEC_SRC)) {
    const rel = relative(SPEC_SRC, file).split('\\').join('/');
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (COMMENT_LINE.test(line)) return;
      if (re.test(line)) hits.push(`${rel}:${i + 1}`);
    });
  }
  return hits;
}

describe('#15811 population — no declaring position still mounts the persistence schema', () => {
  const hits = persistenceSchemaCodeLines();

  it('LIT CONTROL — the scan does find the name where it legitimately lives', () => {
    // Without this leg an empty result would be indistinguishable from a scan
    // that matches nothing at all.
    expect(hits.filter((h) => h.startsWith('shared/expression.zod.ts:')).length).toBeGreaterThan(0);
    expect(hits.filter((h) => h.startsWith('index.ts:')).length).toBeGreaterThan(0);
  });

  it('DARK CONTROL — a name that is not in the tree is not found', () => {
    const dark = identityOf('ZzzNoSuchExpressionInputSchema');
    const found = sourceFiles(SPEC_SRC).filter((f) => dark.test(readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
  });

  it('identity, not substring — the Cron / Template / Evaluated siblings do not leak in', () => {
    const re = identityOf('ExpressionInputSchema');
    expect(re.test('CronExpressionInputSchema.optional()')).toBe(false);
    expect(re.test('TemplateExpressionInputSchema.optional()')).toBe(false);
    expect(re.test('EvaluatedExpressionInputSchema.optional()')).toBe(false);
    expect(re.test('  visible: ExpressionInputSchema.optional(),')).toBe(true);
  });

  it('every remaining code hit is the definition, its type, its alias, or the barrel', () => {
    const allowedFiles = new Set(['shared/expression.zod.ts', 'index.ts']);
    const stray = hits.filter((h) => {
      const file = h.slice(0, h.lastIndexOf(':'));
      // `migrations/**` quotes the name inside migration PROSE strings, which
      // are data the upgrade guide renders, not declarations.
      return !allowedFiles.has(file) && !file.startsWith('migrations/');
    });
    expect(stray).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Population — behavioural, at the slot as mounted
// ---------------------------------------------------------------------------

/**
 * Reach the schema a key is actually typed with, through whatever wrappers the
 * declaring file put in the way (`lazy`, `pipe`, `optional`, `array`,
 * `superRefine`). Throws rather than returning undefined: a position this can
 * no longer reach is a finding, and the count assertion below depends on it.
 */
function unwrap(schema: unknown): Record<string, unknown> {
  let node: any = schema;
  for (let i = 0; i < 12; i++) {
    if (node?.shape && Object.keys(node.shape).length > 0) return node.shape;
    const def = node?._def ?? node?.def;
    if (!def) break;
    const next = def.getter?.() ?? def.in ?? def.innerType ?? def.schema ?? def.element;
    if (!next || next === node) break;
    node = next;
  }
  if (node?.shape) return node.shape;
  throw new Error('unwrap: could not reach an object shape');
}

function slot(schema: unknown, ...path: string[]): z.ZodType {
  let node: any = schema;
  for (const key of path) {
    const shape = unwrap(node);
    node = shape[key];
    if (!node) throw new Error(`slot: no key \`${key}\` — have ${Object.keys(shape).join(', ')}`);
  }
  return node as z.ZodType;
}

/** An array key's ELEMENT schema, through the same wrappers. */
function element(schema: unknown, ...path: string[]): z.ZodType {
  let node: any = slot(schema, ...path);
  for (let i = 0; i < 8; i++) {
    const def = node?._def ?? node?.def;
    if (def?.type === 'array' || def?.element) return (def.element ?? def.type) as z.ZodType;
    const next = def?.getter?.() ?? def?.in ?? def?.innerType ?? def?.schema;
    if (!next || next === node) break;
    node = next;
  }
  throw new Error('element: not an array schema');
}

/**
 * The 34 declaring positions, keyed the way the ADR-0058 D7 conformance ledger
 * keys them (`file:Schema.field`). Re-derived by identity on this tree, ⛔ not
 * inherited from the card: 32 declaring source lines, two of which are
 * file-local alias consts mounting two slots each.
 *
 * [#18118] It was 36 over 34 lines. Two union members left with the CEL arms
 * they mounted — `system/metrics.zod.ts:ServiceLevelIndicatorSchema.successCriteria`
 * and `system/tracing.zod.ts:TraceSamplingConfigSchema.condition` — retired
 * under ADR-0049 enforce-or-remove because nothing evaluated either. They are
 * named here rather than silently absent: a position that leaves this table
 * with no record is the #17630 failure in another costume.
 */
const POSITIONS: ReadonlyArray<readonly [string, () => z.ZodType]> = [
  ['data/field.zod.ts:FieldSchema.expression', () => slot(FieldSchema, 'expression')],
  ['data/field.zod.ts:FieldSchema.visibleWhen', () => slot(FieldSchema, 'visibleWhen')],
  ['data/field.zod.ts:FieldSchema.readonlyWhen', () => slot(FieldSchema, 'readonlyWhen')],
  ['data/field.zod.ts:FieldSchema.requiredWhen', () => slot(FieldSchema, 'requiredWhen')],
  ['data/field.zod.ts:SelectOptionSchema.visibleWhen', () => slot(SelectOptionSchema, 'visibleWhen')],
  ['data/field.zod.ts:InlineGridColumnSchema.readonlyWhen', () => slot(InlineGridColumnSchema, 'readonlyWhen')],
  ['data/field.zod.ts:InlineGridColumnSchema.requiredWhen', () => slot(InlineGridColumnSchema, 'requiredWhen')],
  ['data/hook.zod.ts:HookSchema.condition', () => slot(HookSchema, 'condition')],
  ['data/validation.zod.ts:ScriptValidationSchema.condition', () => slot(ScriptValidationSchema, 'condition')],
  ['data/validation.zod.ts:CrossFieldValidationSchema.condition', () => slot(CrossFieldValidationSchema, 'condition')],
  ['data/validation.zod.ts:ConditionalValidationSchema.when', () => slot(ConditionalValidationSchema, 'when')],
  ['data/object.zod.ts:ObjectFieldGroupSchema.visibleWhen', () => slot(ObjectFieldGroupSchema, 'visibleWhen')],
  ['data/object.zod.ts:RowCrudActionOverrideSchema.visibleWhen', () => slot(RowCrudActionOverrideSchema, 'visibleWhen')],
  ['data/object.zod.ts:RowCrudActionOverrideSchema.disabledWhen', () => slot(RowCrudActionOverrideSchema, 'disabledWhen')],
  ['security/sharing.zod.ts:CriteriaSharingRuleSchema.condition', () => slot(CriteriaSharingRuleSchema, 'condition')],
  ['kernel/plugin-security-advanced.zod.ts:PluginPermissionSchema.condition', () => slot(PluginPermissionSchema, 'filter', 'condition')],
  ['kernel/plugin-versioning.zod.ts:MultiVersionSupportSchema.condition', () => slot(element(MultiVersionSupportSchema, 'routing'), 'condition')],
  ['ui/action.zod.ts:ActionParamSchema.visibleWhen', () => slot(element(ActionParamSchema, 'options'), 'visibleWhen')],
  ['ui/action.zod.ts:ActionParamSchema.visible', () => slot(ActionParamSchema, 'visible')],
  // The two the file-local alias `ActionConditionInputSchema` mounts.
  ['ui/action.zod.ts:actionObject.visible', () => slot(ActionSchema, 'visible')],
  ['ui/action.zod.ts:actionObject.disabled', () => slot(ActionSchema, 'disabled')],
  ['ui/app.zod.ts:BaseNavItemSchema.visible', () => slot(ObjectNavItemSchema, 'visible')],
  ['ui/bulk-action.zod.ts:BulkActionDefSchema.visible', () => slot(BulkActionDefSchema, 'visible')],
  ['ui/component.zod.ts:PageTabsProps.visibleWhen', () => slot(element(PageTabsProps, 'items'), 'visibleWhen')],
  ['ui/component.zod.ts:RecordAlertProps.visible', () => slot(RecordAlertProps, 'visible')],
  ['ui/page.zod.ts:PageComponentSchema.visibleWhen', () => slot(PageComponentSchema, 'visibleWhen')],
  ['ui/page.zod.ts:PageComponentSchema.visibility', () => slot(PageComponentSchema, 'visibility')],
  ['ui/view.zod.ts:ListViewShapeSchema.condition', () => slot(element(ListViewSchema, 'conditionalFormatting'), 'condition')],
  ['ui/view.zod.ts:FormFieldBaseSchema.visibleWhen', () => slot(FormFieldSchema, 'visibleWhen')],
  ['ui/view.zod.ts:FormFieldBaseSchema.visibleOn', () => slot(FormFieldSchema, 'visibleOn')],
  ['ui/view.zod.ts:FormSectionSchema.visibleWhen', () => slot(FormSectionSchema, 'visibleWhen')],
  ['ui/view.zod.ts:FormSectionSchema.visibleOn', () => slot(FormSectionSchema, 'visibleOn')],
  // The two the file-local alias `SettingsVisibilityInputSchema` mounts.
  ['system/settings-manifest.zod.ts:SpecifierSchema.visible', () => slot(SpecifierSchema, 'visible')],
  ['system/settings-manifest.zod.ts:SettingsManifestSchema.visible', () => slot(SettingsManifestSchema, 'visible')],
];

describe('#15811 — every evaluated slot refuses the two shapes no engine can run', () => {
  it('reaches exactly the 34 declaring positions the census enumerated', () => {
    // A position that stops being reachable must red here rather than fall out
    // of the table: that silent drop is the #17630 failure in another costume.
    expect(POSITIONS.length).toBe(34);
    for (const [key, get] of POSITIONS) {
      expect(() => get(), `unreachable: ${key}`).not.toThrow();
    }
  });

  it.each(POSITIONS.map(([key, get]) => [key, get] as const))(
    '%s refuses an `ast`-only envelope, a blank `source` and a blank bare string',
    (_key, get) => {
      const s = get();
      expect(s.safeParse(AST_ONLY).success).toBe(false);
      expect(s.safeParse(BLANK_SOURCE).success).toBe(false);
      expect(s.safeParse(BLANK_STRING).success).toBe(false);
    },
  );

  // All THREE refused spellings, not just one. The sentence reaching an author
  // is what makes the refusal actionable, and the three spellings surface it by
  // three different routes — an aborted union's error map, a surviving arm's
  // `custom` refine at `source`, the string arm's own refine — so a pin on one
  // of them says nothing about the other two. #15811's own tracing slot is the
  // proof: it carried the sentence for `AST_ONLY` while answering a bare
  // `Invalid input` for `BLANK_SOURCE`.
  const REFUSED_SPELLINGS = [
    ['an `ast`-only envelope', AST_ONLY],
    ['a blank `source`', BLANK_SOURCE],
    ['a blank bare string', BLANK_STRING],
  ] as const;

  it.each(
    POSITIONS.flatMap(([key, get]) => REFUSED_SPELLINGS.map(
      ([label, value]) => [`${key} — ${label}`, get, value] as const,
    )),
  )('%s refuses with the ONE published sentence', (_key, get, value) => {
    const r = get().safeParse(value);
    expect(r.success).toBe(false);
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages).toContain(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
  });

  it('CONTROL — the persistence contract is NOT narrowed and still accepts both shapes', () => {
    // This is what makes the 34 `false`s above a reading. Ruling item 2:
    // `ExpressionSchema` / `ExpressionInputSchema` keep `source` OR `ast`.
    for (const schema of [ExpressionSchema, ExpressionInputSchema, PredicateInputSchema]) {
      expect(schema.safeParse(AST_ONLY).success).toBe(true);
      expect(schema.safeParse(BLANK_SOURCE).success).toBe(true);
    }
  });

  it('CONTROL — a healthy predicate still parses at every one of the 34 positions', () => {
    // The narrowing removes accepted shapes and adds none. The settings-manifest
    // pair speaks its own closed non-CEL grammar (#7169), so it gets the
    // predicate that grammar accepts; every other slot gets CEL.
    const SETTINGS = new Set([
      'system/settings-manifest.zod.ts:SpecifierSchema.visible',
      'system/settings-manifest.zod.ts:SettingsManifestSchema.visible',
    ]);
    for (const [key, get] of POSITIONS) {
      const good = SETTINGS.has(key) ? "data.mode === 'advanced'" : 'record.amount > 1';
      const r = get().safeParse({ dialect: 'cel', source: good });
      expect(r.success, `${key} refused a healthy predicate`).toBe(true);
    }
  });
});

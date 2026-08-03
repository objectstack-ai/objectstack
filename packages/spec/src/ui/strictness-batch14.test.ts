// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4001 批 14 — the ui/ wave's second slice.
 *
 * Eleven strip sites measured, **nine closed and two reclassified**. This file
 * carries both halves, because they are one verdict per schema and the ledger's
 * row is per FILE: `sharing.zod.ts` alone splits, with one live door and one
 * shape nothing parses.
 *
 * Three kinds of assertion live here:
 *
 * 1. **Closure** — each newly-strict shape rejects an undeclared key and the
 *    rejection is USEFUL (names the surface, echoes the key, prescribes).
 * 2. **No-door pins** — for `NotificationActionSchema` / `EmbedConfigSchema`,
 *    an assertion that goes RED the moment either gains a carrier key, which is
 *    the event that would make this batch's "do not tighten" verdict wrong.
 * 3. **Prescription integrity** — every alias target this batch added is a key
 *    the schema really accepts (ledger finding 12: *never suggest a key the
 *    schema cannot accept*), checked by parsing the prescribed key, not by
 *    reading the table.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { z } from 'zod';

import { ActionParamSchema, ActionSchema as ActionSchemaForAudit } from './action.zod';
import { NotificationActionSchema } from './notification.zod';
import { SharingConfigSchema, EmbedConfigSchema } from './sharing.zod';
import { ReportSortSchema, JoinedReportBlockSchema, ReportSchema as ReportSchemaForAudit } from './report.zod';
import {
  DatasetDimensionSchema,
  DatasetMeasureSchema,
  DatasetSchema as DatasetSchemaForAudit,
} from './dataset.zod';
import { DashboardWidgetSchema } from './dashboard.zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_SRC = path.resolve(HERE, '..');

/** Every unknown-key message produced by parsing `payload` against `schema`. */
function rejectionFor(schema: z.ZodTypeAny, payload: unknown): string {
  const r = schema.safeParse(payload);
  if (r.success) return '';
  return r.error.issues.map((i) => i.message).join('\n');
}

// ---------------------------------------------------------------------------
// 1. Closure — the nine sites this batch tightened
// ---------------------------------------------------------------------------

describe('批 14 — closed shapes reject undeclared keys', () => {
  const widgetBase = {
    id: 'w1',
    dataset: 'sales',
    values: ['revenue'],
  };

  const cases: Array<[string, z.ZodTypeAny, Record<string, unknown>, string]> = [
    [
      'ui/action ActionParamSchema.options[]',
      ActionParamSchema,
      { name: 'p', options: [{ label: 'A', value: 'a', colour: 'red' }] },
      'this action param option',
    ],
    [
      'ui/sharing SharingConfigSchema',
      SharingConfigSchema,
      { enabled: true, anonymous: true },
      'this sharing config',
    ],
    [
      'ui/report ReportSortSchema',
      ReportSortSchema,
      { by: 'revenue', dir: 'desc' },
      'this report order key',
    ],
    [
      'ui/report JoinedReportBlockSchema',
      JoinedReportBlockSchema,
      { name: 'block_a', dataset: 'sales', values: ['revenue'], groupings: ['region'] },
      'this joined report block',
    ],
    [
      'ui/dataset DatasetDimensionSchema',
      DatasetDimensionSchema,
      { name: 'region', field: 'account.region', granularity: 'month' },
      'this dataset dimension',
    ],
    [
      'ui/dataset DatasetMeasureSchema',
      DatasetMeasureSchema,
      { name: 'revenue', aggregate: 'sum', field: 'amount', aggregation: 'sum' },
      'this dataset measure',
    ],
    [
      'ui/dataset DatasetMeasureSchema.derived',
      DatasetMeasureSchema,
      { name: 'rate', derived: { op: 'ratio', of: ['a', 'b'], operands: ['a'] } },
      'this derived-measure spec',
    ],
    [
      'ui/dashboard DashboardWidgetSchema.layout',
      DashboardWidgetSchema,
      { ...widgetBase, layout: { x: 0, y: 0, w: 3, h: 4, minW: 2 } },
      'this widget layout box',
    ],
  ];

  it.each(cases)('%s rejects an undeclared key and names its surface', (_name, schema, payload, surface) => {
    const message = rejectionFor(schema, payload);
    expect(message).toContain('Unrecognized key(s) on');
    expect(message).toContain(surface);
  });

  it('each rejection echoes the offending key back verbatim', () => {
    expect(rejectionFor(SharingConfigSchema, { anonymous: true })).toContain('`anonymous`');
    expect(rejectionFor(ReportSortSchema, { by: 'x', dir: 'desc' })).toContain('`dir`');
    expect(
      rejectionFor(DatasetMeasureSchema, { name: 'm', aggregate: 'sum', field: 'f', aggregation: 'sum' }),
    ).toContain('`aggregation`');
  });
});

// ---------------------------------------------------------------------------
// The curated prescriptions — the entries the batch justified individually
// ---------------------------------------------------------------------------

describe('批 14 — curated prescriptions', () => {
  it('sharing: the camelCase near-misses reach their canonical key', () => {
    // Each of these is out of the edit-distance fallback's reach, because the
    // fallback lower-cases the input but not the candidates (#4990).
    for (const [written, canonical] of [
      ['anonymous', 'allowAnonymous'],
      ['allowGuest', 'allowAnonymous'],
      ['url', 'publicLink'],
      ['slug', 'publicLink'],
      ['domains', 'allowedDomains'],
      ['expires', 'expiresAt'],
      ['isPublic', 'enabled'],
    ] as const) {
      expect(rejectionFor(SharingConfigSchema, { [written]: true })).toContain(
        `\`${written}\` → \`${canonical}\``,
      );
    }
  });

  it('dataset measure: a Cube metric `type` is aimed at `aggregate`, not read as a datatype', () => {
    // The dangerous overlap: on a Cube metric `type` IS the aggregation, and on
    // a dataset DIMENSION `type` is the datatype. Before this batch, writing
    // `type: 'sum'` on a measure parsed clean and computed something else.
    const message = rejectionFor(DatasetMeasureSchema, { name: 'revenue', field: 'amount', type: 'sum' });
    expect(message).toContain('`type` → `aggregate`');
  });

  it('dataset: `sql` gets a prescription, never a rename', () => {
    // Aliasing `sql` to `field` would hand `SUM(amount)` to a slot that takes a
    // field PATH — ledger finding 7's shape. It must arrive as guidance.
    for (const schema of [DatasetDimensionSchema, DatasetMeasureSchema]) {
      const message = rejectionFor(schema, { name: 'x', field: 'f', aggregate: 'sum', sql: 'SUM(amount)' });
      expect(message).toContain('takes no raw SQL');
      expect(message).not.toContain('`sql` → ');
    }
  });

  it('dashboard: RGL constraint keys are prescribed, not renamed onto a position key', () => {
    const message = rejectionFor(DashboardWidgetSchema, {
      id: 'w1', dataset: 'd', values: ['v'],
      layout: { x: 0, y: 0, w: 3, h: 4, minW: 2, static: true },
    });
    expect(message).toContain('React-Grid-Layout');
    expect(message).not.toContain('`minW` → ');
    expect(message).not.toContain('`static` → ');
  });

  /**
   * `compareTo` is a UNION, and that changes what a rejection is worth — a fact
   * this batch measured rather than assumed, after writing the assertion the
   * obvious way and watching it go red on `'Invalid input'`.
   *
   * Zod collapses a failed union into ONE top-level `invalid_union` issue whose
   * message is the bare `'Invalid input'`; the arm errors — including the
   * curated unknown-key prescription — live in `issue.errors`, one array per
   * arm. And `zodIssuesToFields` (`rest/src/rest-server.ts`) maps only
   * top-level issues, so nothing carries them onto the wire.
   *
   * The closure is still worth having and still does #4001's job: the widget
   * now FAILS at `compareTo` instead of silently discarding half the object.
   * But the prescription is currently reachable only by walking sub-errors, so
   * these two assertions are deliberately split — one for what an author sees
   * today, one for the text that is there to be surfaced once the transport is
   * fixed (filed separately). Asserting only the second would have been a green
   * test over a message no consumer prints.
   */
  function unionSubMessages(schema: z.ZodTypeAny, payload: unknown): string {
    const r = schema.safeParse(payload);
    if (r.success) return '';
    const out: string[] = [];
    for (const issue of r.error.issues) {
      const arms = (issue as { errors?: Array<Array<{ message: string }>> }).errors;
      for (const arm of arms ?? []) for (const sub of arm) out.push(sub.message);
    }
    return out.join('\n');
  }

  it('dashboard compareTo: an undeclared key now FAILS the widget (what an author sees today)', () => {
    const r = DashboardWidgetSchema.safeParse({
      id: 'w1', dataset: 'sales', values: ['revenue'],
      compareTo: { offset: '7d', granularity: 'month' },
    });
    expect(r.success).toBe(false);
    const union = r.success ? undefined : r.error.issues.find((i) => i.code === 'invalid_union');
    expect(union).toBeDefined();
    expect(union!.path).toEqual(['compareTo']);
    // Pinning the CURRENT top-level text, so the day the transport starts
    // surfacing arm errors this test says so instead of quietly improving.
    expect(union!.message).toBe('Invalid input');
  });

  it('dashboard compareTo: the curated prescription exists in the arm errors', () => {
    expect(unionSubMessages(DashboardWidgetSchema, {
      id: 'w1', dataset: 'sales', values: ['revenue'],
      compareTo: { offset: '7d', granularity: 'month' },
    })).toContain('this comparison window');

    expect(unionSubMessages(DashboardWidgetSchema, {
      id: 'w1', dataset: 'sales', values: ['revenue'],
      compareTo: { type: 'previousPeriod' },
    })).toContain("compareTo: 'previousPeriod'");
  });

  it('action option: guidance separates keys that exist one layer down from keys that exist nowhere', () => {
    const declaredOneLayerDown = rejectionFor(ActionParamSchema, {
      name: 'p', options: [{ label: 'A', value: 'a', color: 'red' }],
    });
    expect(declaredOneLayerDown).toContain('SelectOptionSchema');

    const nowhere = rejectionFor(ActionParamSchema, {
      name: 'p', options: [{ label: 'A', value: 'a', icon: 'x' }],
    });
    // `icon` is NOT on SelectOptionSchema — claiming it were is the false
    // prescription class (ledger finding 18).
    expect(nowhere).toContain('no option shape in the spec declares `icon`');
    expect(nowhere).not.toContain('is a per-option key of a FIELD');
  });

  it('guidance emits one bullet per offending key, not one shared sentence repeated', () => {
    const message = rejectionFor(ActionParamSchema, {
      name: 'p', options: [{ label: 'A', value: 'a', icon: 'x', disabled: true }],
    });
    expect(message).toContain('`icon`');
    expect(message).toContain('`disabled`');
  });
});

// ---------------------------------------------------------------------------
// 3. Prescription integrity — every alias target must actually be accepted
// ---------------------------------------------------------------------------

/**
 * The `aliases` table of every `strictObject(` call in one of this batch's six
 * files, read from the SOURCE by AST, keyed by the call's `surface` string.
 *
 * Reading the source is what makes this a real check. The first version of this
 * suite hand-listed the prescribed keys beside the assertion — a second copy of
 * the truth — and it stayed GREEN under a deliberate sabotage that repointed a
 * live alias at a key the schema rejects. That is the failure the ledger keeps
 * recording in different instruments (finding 9, finding 19): a measurement
 * reporting completeness it does not have. `strictObject` exists precisely to
 * collapse two copies into one; a test over it must not reintroduce them.
 */
function aliasTablesBySurface(file: string): Map<string, Record<string, string>> {
  const source = ts.createSourceFile(
    file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
  );
  const out = new Map<string, Record<string, string>>();
  const literal = (n: ts.Node): string | null =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null;
  const prop = (o: ts.ObjectLiteralExpression, name: string): ts.Expression | null => {
    for (const p of o.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name) return p.initializer;
    }
    return null;
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'strictObject'
      && node.arguments.length === 2
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const opts = node.arguments[0];
      const surfaceNode = prop(opts, 'surface');
      const surface = surfaceNode ? literal(surfaceNode) : null;
      if (surface) {
        const table: Record<string, string> = {};
        const aliases = prop(opts, 'aliases');
        if (aliases && ts.isObjectLiteralExpression(aliases)) {
          for (const p of aliases.properties) {
            if (!ts.isPropertyAssignment(p)) continue;
            const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
            const target = literal(p.initializer);
            if (key && target) table[key] = target;
          }
        }
        out.set(surface, table);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Unwrap lazy / optional / default / array / effects down to a plain object's `.shape`. */
function shapeOf(schema: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 12 || schema == null) return null;
  const direct = (schema as { shape?: Record<string, unknown> }).shape;
  if (direct && typeof direct === 'object') return direct;
  const def = (schema as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
  if (!def) return null;
  for (const key of ['innerType', 'element', 'in', 'out', 'schema', 'type'] as const) {
    const inner = def[key];
    if (inner && typeof inner === 'object') {
      const found = shapeOf(inner, depth + 1);
      if (found) return found;
    }
  }
  if (typeof (def as { getter?: unknown }).getter === 'function') {
    return shapeOf((def as { getter: () => unknown }).getter(), depth + 1);
  }
  return null;
}

/**
 * The object arm of a union — the only arm an unknown-key error can come from.
 *
 * Unwraps the wrappers first: on the widget, `compareTo` is
 * `ZodOptional(ZodUnion([...]))`, so reading `def.options` off the schema handed
 * in finds nothing. The first draft did exactly that and the suite went red on
 * *"could not resolve the shape behind this comparison window"* rather than
 * quietly skipping the surface — the walker's hard-failure guard doing its job
 * (ledger finding 9: a walker going quiet is precisely when it stops covering
 * something).
 */
function unionObjectArm(schema: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 12 || schema == null) return null;
  const def = (schema as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
  if (!def) return null;
  const options = (def as { options?: unknown[] }).options;
  if (Array.isArray(options)) {
    for (const arm of options) {
      const shape = shapeOf(arm);
      if (shape) return shape;
    }
    return null;
  }
  for (const key of ['innerType', 'in', 'out', 'schema'] as const) {
    const inner = def[key];
    if (inner && typeof inner === 'object') {
      const found = unionObjectArm(inner, depth + 1);
      if (found) return found;
    }
  }
  if (typeof (def as { getter?: unknown }).getter === 'function') {
    return unionObjectArm((def as { getter: () => unknown }).getter(), depth + 1);
  }
  return null;
}

describe('批 14 — no prescription points at a key the schema rejects', () => {
  /**
   * `surface` string → the DECLARED keys of the shape that surface names,
   * resolved at RUNTIME rather than from the source object literal.
   *
   * Runtime, specifically, because a shape can spread (`...MetadataProtectionFields`)
   * and a source-literal reader cannot see through that — it has to suppress the
   * check for every spreading schema, which is most of the interesting ones.
   * `.shape` sees the spread keys.
   */
  const declaredKeys = (): Map<string, Set<string>> => {
    const widget = shapeOf(DashboardWidgetSchema)!;
    const measure = shapeOf(DatasetMeasureSchema)!;
    const entries: Array<[string, Record<string, unknown> | null]> = [
      ['this action param option', shapeOf(shapeOf(ActionParamSchema)!.options)],
      ['this sharing config', shapeOf(SharingConfigSchema)],
      ['this report order key', shapeOf(ReportSortSchema)],
      ['this joined report block', shapeOf(JoinedReportBlockSchema)],
      ['this dataset dimension', shapeOf(DatasetDimensionSchema)],
      ['this dataset measure', measure],
      ['this derived-measure spec', shapeOf(measure.derived)],
      ['this comparison window', unionObjectArm(widget.compareTo)],
      ['this widget layout box', shapeOf(widget.layout)],
    ];
    return new Map(entries.map(([surface, shape]) => {
      expect(shape, `could not resolve the shape behind "${surface}"`).toBeTruthy();
      return [surface, new Set(Object.keys(shape!))];
    }));
  };

  /**
   * Pre-existing defects in tables this batch did NOT write, each already filed.
   * Listed rather than skipped so the instrument stays complete over these six
   * files: the day one is fixed, its entry here fails and gets deleted.
   */
  const KNOWN_DEFECTS: ReadonlyArray<readonly [string, string, string]> = [
    // [surface, alias key, issue]
    ['this report', 'columns', '#5013'],
    ['this report', 'chart', '#5013'],
    ['this report', 'filter', '#5013'],
    ['this dataset', 'measures', '#5013'],
    ['this dataset', 'filter', '#5013'],
    ['this action', 'body', '#5013'],
  ];

  const BATCH14_SURFACES = [
    'this action param option', 'this sharing config', 'this report order key',
    'this joined report block', 'this dataset dimension', 'this dataset measure',
    'this derived-measure spec', 'this comparison window', 'this widget layout box',
  ] as const;

  const FILES = [
    'ui/action.zod.ts', 'ui/sharing.zod.ts', 'ui/report.zod.ts',
    'ui/dataset.zod.ts', 'ui/dashboard.zod.ts',
  ];

  it('the AST reader really finds this batch\'s tables (self-test before the verdict)', () => {
    const found = new Set<string>();
    for (const f of FILES) for (const s of aliasTablesBySurface(path.join(SPEC_SRC, f)).keys()) found.add(s);
    for (const surface of BATCH14_SURFACES) {
      expect(found, `AST reader lost the table for "${surface}"`).toContain(surface);
    }
    // And it reads real content, not empty tables.
    const sharing = aliasTablesBySurface(path.join(SPEC_SRC, 'ui/sharing.zod.ts'));
    expect(sharing.get('this sharing config')!.anonymous).toBe('allowAnonymous');
  });

  it('every alias TARGET this batch added is a key the schema really declares', () => {
    const declared = declaredKeys();
    const failures: string[] = [];
    for (const f of FILES) {
      for (const [surface, table] of aliasTablesBySurface(path.join(SPEC_SRC, f))) {
        const keys = declared.get(surface);
        if (!keys) continue; // not a 批 14 surface — covered by the next test
        for (const [written, target] of Object.entries(table)) {
          if (!keys.has(target)) failures.push(`${surface}: \`${written}\` -> \`${target}\` (not declared)`);
          if (keys.has(written)) failures.push(`${surface}: \`${written}\` is itself declared (dead entry)`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('the pre-existing defects in these files are exactly the ones already filed', () => {
    // A reverse pin, the ADR-0010 debt-list idiom: this list cannot outlive its
    // debt. Fix one upstream and this test names it and fails.
    const seen: string[] = [];
    for (const f of FILES) {
      for (const [surface, table] of aliasTablesBySurface(path.join(SPEC_SRC, f))) {
        if ((BATCH14_SURFACES as readonly string[]).includes(surface)) continue;
        const shape = surface === 'this report' ? shapeOf(ReportSchemaForAudit)
          : surface === 'this dataset' ? shapeOf(DatasetSchemaForAudit)
          : surface === 'this action' ? shapeOf(ActionSchemaForAudit)
          : null;
        if (!shape) continue;
        const keys = new Set(Object.keys(shape));
        for (const [written, target] of Object.entries(table)) {
          if (keys.has(written) || !keys.has(target)) seen.push(`${surface}|${written}`);
        }
      }
    }
    expect(seen.sort()).toEqual(
      KNOWN_DEFECTS.map(([s, k]) => `${s}|${k}`).sort(),
    );
  });

  it('the action param option shape accepts exactly the pair it prescribes', () => {
    const r = ActionParamSchema.safeParse({ name: 'p', options: [{ label: 'A', value: 'a' }] });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. No-door pins — RED the day either shape gains a carrier key
// ---------------------------------------------------------------------------

/**
 * Every `.ts` module under `packages/spec/src`, excluding tests.
 */
function specModules(dir = SPEC_SRC, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) specModules(p, out);
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) out.push(p);
  }
  return out;
}

/**
 * Modules that import the module at `targetRel` (spec-src-relative, no
 * extension), as a sorted list of spec-src-relative paths.
 *
 * Two properties this needs, and the first draft had neither — both found by
 * running the pin before believing it:
 *
 * - **All three import forms.** A matcher that knows only `import … from '…'`
 *   misses the barrel's `export * from '…'` and a bare side-effect `import '…'`,
 *   and would land as a partly-hollow green. (批 13 hit the identical gap.)
 * - **Specifier RESOLUTION, not substring matching.** This repo has TWO
 *   `sharing.zod` modules — `ui/sharing.zod` and `security/sharing.zod` — so a
 *   substring test credits `stack.zod.ts` and `security/index.ts` with
 *   importing the UI one. Every specifier is therefore resolved against its
 *   importer's own directory before comparing.
 */
function importersOf(targetRel: string): string[] {
  const target = path.resolve(SPEC_SRC, targetRel);
  const SPECIFIER =
    /(?:^|\n)\s*(?:import\s[\s\S]*?from\s*|export\s[\s\S]*?from\s*|import\s*)['"]([^'"]+)['"]/g;
  const out: string[] = [];
  for (const file of specModules()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(SPECIFIER)) {
      if (!specifier.startsWith('.')) continue;
      if (path.resolve(path.dirname(file), specifier) !== target) continue;
      out.push(path.relative(SPEC_SRC, file).split(path.sep).join('/'));
      break;
    }
  }
  return out.sort();
}

describe('批 14 — the two no-door shapes stay unclosed, and say so', () => {
  it('the importer pin sees all three import forms and does not confuse same-named modules', () => {
    // Self-test first: an assertion about "who imports X" is worthless if the
    // matcher only knows one spelling. `ui/i18n.zod` is imported with
    // `import … from` by several ui modules AND re-exported by the barrel with
    // `export * from`.
    const i18n = importersOf('ui/i18n.zod');
    expect(i18n).toContain('ui/index.ts');            // export * from
    expect(i18n).toContain('ui/notification.zod.ts'); // import … from
    expect(i18n.length).toBeGreaterThan(2);

    // And the discriminating case: two `sharing.zod` modules exist. Resolution,
    // not substring matching, is what keeps them apart.
    expect(importersOf('security/sharing.zod')).toContain('stack.zod.ts');
    expect(importersOf('ui/sharing.zod')).not.toContain('stack.zod.ts');
  });

  it('ui/notification.zod has exactly one importer — the barrel. Nothing can carry NotificationAction', () => {
    expect(importersOf('ui/notification.zod')).toEqual(['ui/index.ts']);
  });

  it('ui/sharing.zod is imported by the barrel and view.zod — which carries SharingConfig, NOT EmbedConfig', () => {
    expect(importersOf('ui/sharing.zod')).toEqual(['ui/index.ts', 'ui/view.zod.ts']);
    // The carrier is specific, and that asymmetry IS the reclassification: the
    // form view names `SharingConfigSchema`, and no module anywhere names
    // `EmbedConfigSchema`. Pin the symbol, not the file.
    const namesEmbed = specModules()
      .filter((f) => !f.endsWith('sharing.zod.ts'))
      .filter((f) => /\bEmbedConfigSchema\b/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SPEC_SRC, f).split(path.sep).join('/'));
    expect(namesEmbed).toEqual([]);
    expect(fs.readFileSync(path.join(SPEC_SRC, 'ui/view.zod.ts'), 'utf8'))
      .toContain('SharingConfigSchema');
  });

  it('both stay strip — a precisely-validated dead slot is the more convincing lie (#4583)', () => {
    // Closing either would spend a v17 breaking change on a shape nothing
    // parses. If someone closes one, this fails and points at the ledger row.
    expect(NotificationActionSchema.safeParse({ label: 'Undo', action: 'undo', bogus: 1 }).success)
      .toBe(true);
    expect(EmbedConfigSchema.safeParse({ enabled: true, bogus: 1 }).success).toBe(true);
  });

  it('their prose records the verdict where the next reader will look', () => {
    const notification = fs.readFileSync(path.join(SPEC_SRC, 'ui/notification.zod.ts'), 'utf8');
    const sharing = fs.readFileSync(path.join(SPEC_SRC, 'ui/sharing.zod.ts'), 'utf8');
    for (const source of [notification, sharing]) {
      expect(source).toContain('NO AUTHORING DOOR');
      expect(source).toContain('#4001 批 14');
    }
  });
});

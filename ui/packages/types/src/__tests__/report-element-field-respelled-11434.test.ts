/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A report element's `properties.field` is refused by name on the zod face;
 * its binding is the element's declared `dataBinding` (objectui#11434).
 *
 * ## The ruling this pins
 *
 * `ReportDesigner` drew a field element from the UNDECLARED bag key
 * `properties.field`, and wrote that key itself when a field element was
 * added, while `ReportDesignerElement.dataBinding` — the declared member for
 * the same fact — was drawn by nothing. The seat ruled that the renderer moves
 * onto `dataBinding` and stops reading `properties.field`: a declared member
 * beats an undeclared bag key. The designer was the key's producer, so saved
 * documents can carry it; it is refused by name, with the migration, rather
 * than left to be dropped in silence.
 *
 * `properties` stays an open bag otherwise: a text element keeps its `text`.
 * That is why the refusal is a check on a RECORD, and why it is the zod face's
 * alone: the strict authoring face closes every object it reaches but keeps a
 * record open, and the TypeScript face cannot refuse one key of an open bag
 * without parting from that record. The type rows below pin the two faces
 * still equal, so a later "fix" that narrows one face alone reddens here.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` rows are TYPE-level (`tsc -p tsconfig.test.json`, the
 * third leg of this package's `type-check`). The `safeValidateSchema` /
 * `StrictAnyComponentSchema` rows are RUNTIME and vitest reads them. A green
 * run of either one alone says nothing about the other.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { ReportDesignerElementSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';
import type { ReportDesignerElement } from '../designer';

/* ── Type-level pins: the `tsc` channel ────────────────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type ShapeOf<M> = M extends { shape: infer S } ? S : never;

type TsProperties = ReportDesignerElement['properties'];
type ZodProperties = z.input<ShapeOf<typeof ReportDesignerElementSchema>['properties']>;

/** The bag stays an open record on both faces, equal to each other; the binding is a declared member. */
export type assertionBagAndBinding = [
  Expect<Equal<TsProperties, Record<string, unknown>>>,
  Expect<Equal<TsProperties, ZodProperties>>,
  Expect<Equal<ReportDesignerElement['dataBinding'], string | undefined>>,
];

/* ── The runtime half ─────────────────────────────────────────────────────── */

const POSITION = { x: 0, y: 0, width: 100, height: 20 };
const report = (element: Record<string, unknown>) => ({
  type: 'report-designer',
  reportName: 'Pipeline',
  objectName: 'opportunity',
  sections: [{ type: 'detail', height: 100, elements: [{ id: 'e', type: 'field', position: POSITION, properties: {}, ...element }] }],
});
const PATH = 'sections.0.elements.0.properties.field';

describe('the zod face refuses `properties.field` by name, with the migration (objectui#11434)', () => {
  it('is refused on the rendering face, at its own path', () => {
    const result = safeValidateSchema(report({ properties: { field: 'amount' } }));
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === PATH);
    expect(issue, JSON.stringify(result.error.issues)).toBeDefined();
    if (!issue) return;
    expect(issue.code).toBe('custom');
    expect(issue.message).toContain('objectui#11434');
    expect(issue.message).toContain('`dataBinding`');
    expect(issue.message).toContain('Migration:');
  });

  it('is refused on the strict authoring face, at its own path', () => {
    const result = StrictAnyComponentSchema.safeParse(report({ properties: { field: 'amount' } }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain(PATH);
  });

  it('accepts the binding as `dataBinding`, and any other bag key, on both faces — the control', () => {
    for (const doc of [report({ dataBinding: 'amount' }), report({ type: 'text', properties: { text: 'Total' } })]) {
      const loose = safeValidateSchema(doc);
      expect(loose.success, JSON.stringify(loose.success ? null : loose.error.issues)).toBe(true);
      const strict = StrictAnyComponentSchema.safeParse(doc);
      expect(strict.success, JSON.stringify(strict.success ? null : strict.error.issues)).toBe(true);
    }
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8761 — five catalog entries whose whole subject is "a label stacked
 * above its control" authored their `flex` root as `direction: "column"`.
 *
 * `column` is the CSS spelling, and it is not in the vocabulary either face
 * declares: `FlexSchema.direction` is `row | col | row-reverse | col-reverse`,
 * and the `flex` renderer maps only `col` / `col-reverse` to a column class.
 * So the same key was wrong twice over, and the two faces agreed about it:
 *
 *   - the validator refused every one of the five (`invalid_value` at
 *     `direction`, the ONLY issue on each document);
 *   - the renderer added no direction class at all, so each root kept the
 *     flexbox default and drew the label BESIDE its control — on the four
 *     component docs pages that embed these entries (label, date-picker,
 *     input-otp, radio-group), whose Code tab also taught the refused value.
 *
 * The repair is the fixtures, not the vocabulary (triage ruling on the card:
 * the accept set is not widened to admit `column`). `catalog-gallery-render`
 * could not see any of this: `flex` is registered, so the entries rendered —
 * just wrongly — and nothing compared the picture with the fixture's intent.
 *
 * ## What each block pins, and why both halves are needed
 *
 * The parse block asks for a FULL `safeValidateSchema` green, not the absence
 * of one issue code: the defect was a refused VALUE on a declared key, and a
 * value rule is judged by the whole parse. The render block reads the class
 * the renderer actually emitted: a fixture can parse and still not draw a
 * column (`row` is a legal value too), and the column is what these entries
 * exist to show.
 *
 * ⛔ Scope: these five entries only — every `"direction": "column"` the tree
 * carried when the card was worked. This is deliberately not a catalog-wide
 * walker, and it pins nothing about how the renderer treats an UNDECLARED
 * direction value; that question is outside this card.
 *
 * Since objectui#11276 (the maintainer's ruling A on objectui#11300) an
 * authored `flex` takes `direction` in its `properties` bag, so the key these
 * pins read is `properties.direction`; `SchemaRenderer` hoists it onto the node
 * before the renderer reads it, which the render block below still proves.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
// Module scope, not a hook: registering the renderers is an unbounded module
// load (AGENTS.md, test discipline — flaky tests: find the race).
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { safeValidateSchema } from '@object-ui/types/zod';
import { getExample } from '../src/index.js';

const IDS = [
  'components-form-label/form-label',
  'components-form-label/password-label',
  'components-form-date-picker/form-field',
  'components-form-input-otp/verification-form',
  'components-form-radio-group/form-field',
] as const;

/** Every issue as `path: message`, so a red run says what broke. */
function issues(schema: unknown): string[] {
  const result = safeValidateSchema(schema);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('objectui#8761 — the five stacked-label entries author the declared column value', () => {
  it.each(IDS)('%s validates under safeValidateSchema', (id) => {
    expect(issues(getExample(id).schema)).toEqual([]);
  });

  it.each(IDS)('%s is a `flex` root that authors `direction: "col"` in its bag', (id) => {
    // Names the key that moved, so a later sweep that deleted `direction`
    // outright (which would still parse, and draw a row) cannot pass here.
    const schema = getExample(id).schema as { type?: unknown; direction?: unknown; properties?: { direction?: unknown } };
    expect(schema.type).toBe('flex');
    expect(schema.properties?.direction).toBe('col');
    expect(schema).not.toHaveProperty('direction');
  });

  it.each(IDS)('%s renders its `flex` root as a column', (id) => {
    const { container } = render(
      <SchemaRenderer schema={toRenderableSchema(getExample(id).schema as never) as never} />,
    );
    const root = container.querySelector('[data-obj-type="flex"]');
    expect(root, 'no flex element rendered: nothing below would be a reading').not.toBeNull();
    const classes = (root as Element).className.toString().split(/\s+/);
    expect(classes).toContain('flex-col');
    expect(classes).not.toContain('flex-row');
  });

  it('the refused spelling is still refused, on `direction`', () => {
    // Counter-probe for the parse block: the same document shape with the CSS
    // spelling must fail, and fail for this key — otherwise a green above would
    // not be evidence that the value was checked at all.
    const result = safeValidateSchema({ type: 'flex', properties: { direction: 'column' } });
    expect(result.success).toBe(false);
    const found = result.success ? [] : result.error.issues.map((i) => [i.code, i.path.join('.')]);
    expect(found).toEqual([['invalid_value', 'properties.direction']]);
    // …and the declared spelling passes the same probe.
    expect(safeValidateSchema({ type: 'flex', properties: { direction: 'col' } }).success).toBe(true);
  });
});

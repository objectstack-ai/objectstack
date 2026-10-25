/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The raw-HTML `html` NODE TYPE is retired, and a document naming it is refused
 * BY NAME, with its remedy (objectui#13449).
 *
 * Its renderer wrote the authored `html` string into the page through
 * `dangerouslySetInnerHTML` with no sanitiser, and `@objectstack/spec` declares
 * no `html` component. The renderer, `HtmlSchema` and its member-by-member arm
 * went; the literal was declared on a face, so the retirement keeps a
 * `retiredNodeType()` arm in `DataDisplaySchema` — the shape objectui#8802
 * ruled for the bare `kanban` key (maintainer ruling 2026-09-09), followed by
 * `cloud-plan-status-retired-12954.test.ts`, whose suites this file follows.
 *
 * ## ⚠️ The mechanism, which is NOT the passthrough rule
 *
 * `AnyComponentSchema` is a DISCRIMINATED union: an unclaimed literal matches no
 * arm, so deleting the arm would already refuse — with the union's remedy-free
 * `Invalid input`. The refusal arm claims the literal and answers with a
 * `custom` issue at `type` naming what to author instead. Suite 1 measures that
 * refusal; suite 3 measures that an unknown literal still gets the generic
 * path, which is the control that separates the two.
 *
 * ## ⛔ The layer this retirement does NOT touch
 *
 * `html` is ALSO a field type (`HtmlFieldMetadata`): a form or record field
 * whose value renders through the sanitised fields path. Suite 4 pins that a
 * form declaring an `html` field still validates, because the remedy this
 * retirement names IS that field.
 */

import { describe, it, expect } from 'vitest';
import { safeValidateSchema } from '../zod/index.zod';
import type { DataDisplaySchema } from '../data-display';
import type { ComponentType } from '../registry';
import type { HtmlFieldMetadata } from '../field-types';

/* -------------------------------------------------------------------------- */
/* Compile-time pins — read by tsc -p tsconfig.test.json, not by vitest.       */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;

// The TypeScript half of the retirement: no union member and no registry row
// for the literal, so `tsc` refuses it at the authoring site.
type _DataDisplayHasNoHtmlArm = Assert<Equal<IsNever<Extract<DataDisplaySchema, { type: 'html' }>>, true>>;
type _ComponentTypeHasNoHtml = Assert<Equal<'html' extends ComponentType ? true : false, false>>;
// Non-vacuity on the same instruments: a surviving sibling IS selectable.
type _DataDisplayKeepsKbd = Assert<Equal<IsNever<Extract<DataDisplaySchema, { type: 'kbd' }>>, false>>;
type _ComponentTypeKeepsStatistic = Assert<Equal<'statistic' extends ComponentType ? true : false, true>>;
// The FIELD layer is a different declaration and stays.
type _HtmlFieldStays = Assert<Equal<HtmlFieldMetadata['type'], 'html'>>;

/* -------------------------------------------------------------------------- */
/* Runtime — through `safeValidateSchema`, the tolerant node union.           */
/* -------------------------------------------------------------------------- */

interface IssueLike {
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
  readonly code?: string;
  readonly errors?: readonly (readonly IssueLike[])[];
}

/** Flatten zod's nested union issues into `{ path, message, code }` rows. */
function flattenIssues(issues: readonly IssueLike[]): Array<{ path: string; message: string; code: string }> {
  return issues.flatMap((issue) => [
    { path: (issue.path ?? []).join('.'), message: issue.message ?? '', code: issue.code ?? '' },
    ...(issue.errors ?? []).flatMap((nested) => flattenIssues(nested)),
  ]);
}

function refusals(schema: unknown) {
  const result = safeValidateSchema(schema);
  return result.success ? [] : flattenIssues(result.error.issues as unknown as IssueLike[]);
}

/** The node that used to validate under the retired arm, spelled unchanged. */
const RETIRED_NODE = { type: 'html', html: '<p>This is <strong>HTML</strong> content</p>' } as const;

describe('suite 1 — a `type: "html"` node is REFUSED, by name (objectui#13449)', () => {
  it('refuses the document with one `custom` issue at `type`', () => {
    const found = refusals(RETIRED_NODE);
    expect(found.filter((f) => f.code === 'custom' && f.path === 'type')).toHaveLength(1);
  });

  it('the refusal names the retired type and the two replacements', () => {
    // ⭐ The whole reason the arm survives as a refusal instead of being
    // deleted. Suite 3 is its control.
    const [issue] = refusals(RETIRED_NODE).filter((f) => f.code === 'custom' && f.path === 'type');
    expect(issue?.message).toContain('`html` is a RETIRED node type');
    expect(issue?.message).toContain('`richtext`');
    expect(issue?.message).toContain("`kind: 'html'`");
  });

  it('refuses a bare node too, whatever else it carries', () => {
    expect(refusals({ type: 'html' }).filter((f) => f.code === 'custom' && f.path === 'type')).toHaveLength(1);
  });
});

describe('suite 2 — the refusal is not a validator that turned strict', () => {
  it('a surviving data-display node on the same call is still accepted', () => {
    // Firing control: without it every assertion in suite 1 would also pass
    // under a `safeValidateSchema` that had started refusing everything.
    expect(refusals({ type: 'kbd', keys: ['Ctrl', 'K'] })).toEqual([]);
  });
});

describe('suite 3 — control: an unknown literal takes the GENERIC path', () => {
  it('a name no arm claims is refused without the retirement text', () => {
    // ⭐ The separator. If this document ALSO carried the guidance, suite 1
    // would be measuring the union's boilerplate rather than this arm.
    const found = refusals({ type: 'no-such-node-13449', html: '<p>x</p>' });
    const text = found.map((r) => r.message).join('\n');
    expect(text).not.toEqual('');
    expect(found.some((f) => f.code === 'custom')).toBe(false);
    expect(text).not.toContain('RETIRED');
  });
});

describe('suite 4 — the `html` FIELD type is a different layer and is untouched', () => {
  it('a form declaring an `html` field still validates', () => {
    // The catalog's own `fields-rich-text/html-editor` document, spelled
    // unchanged: the remedy suite 1 names has to keep working.
    const form = {
      type: 'form',
      showSubmit: false,
      showCancel: false,
      fields: [{ name: 'description', label: 'Description', type: 'html', placeholder: 'Enter HTML content...', rows: 8 }],
    };
    expect(refusals(form)).toEqual([]);
  });
});

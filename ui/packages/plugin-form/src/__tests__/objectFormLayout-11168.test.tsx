/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11168 slice 3 — `object-form.layout` is `vertical | horizontal` on
 * every face, and objectui#7759 group C with it.
 *
 * `@objectstack/spec` 17.5.0 retired `inline` and `grid` from the form layout
 * enum (objectstack#20221). The authored `object-form` arm reads its props
 * through the spec row by reference, so it already refused both. Three objectui
 * faces still published them: the `object-form` registration, the
 * `ObjectFormSchema` mirror (TS and zod), and the `form` node's `FormSchema`
 * zod mirror (`grid`). The designer offered both too. Measured through the real
 * `SchemaRenderer` before the change, both rendered byte-identical to
 * `vertical`: every layout folded them to `vertical`, and the `form` renderer
 * reads only `layout === 'horizontal'`. So narrowing loses nothing that
 * rendered, and the folds are retired with the values.
 *
 * The compile-time rows are checked by `tsc -p tsconfig.test.json`.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { safeValidateSchema, ObjectFormSchema as ObjectFormMirror, FormSchema as FormMirror } from '@object-ui/types/zod';
import type { ObjectFormSchema, FormSchema } from '@object-ui/types';
import type { ObjectFormProps } from '@objectstack/spec/ui';
// Registers the `form` renderer the object-form draws through, and
// `object-form` itself, at module scope.
import '@object-ui/components';
import '../index';

registerAllFields();
afterEach(cleanup);

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The TS face IS the spec row's enum, so a spec release that moves it moves this type. */
export type _ObjectFormLayoutIsTheRowsEnum = Expect<Equal<ObjectFormSchema['layout'], ObjectFormProps['layout']>>;
export type _FormLayoutIsTwoValues = Expect<Equal<FormSchema['layout'], 'vertical' | 'horizontal' | undefined>>;
// @ts-expect-error — `grid` is retired on the object-form's TS face.
const _retiredGrid: ObjectFormSchema['layout'] = 'grid';
// @ts-expect-error — and so is `inline`.
const _retiredInline: ObjectFormSchema['layout'] = 'inline';

const RETIRED = ['inline', 'grid'] as const;
const LIVE = ['vertical', 'horizontal'] as const;

/** `{ code, path }` of what a parse refused, so a row names WHICH key was refused and HOW. */
const refusal = (result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[] }> } }) =>
  result.success ? [] : result.error!.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.') }));

describe('`object-form.layout` publishes the spec row\'s two values (objectui#11168, objectui#7759 group C)', () => {
  it('the registration declares exactly `vertical` and `horizontal`', () => {
    const layout = (ComponentRegistry.getConfig('object-form', 'plugin-form')?.inputs ?? []).find(
      (input) => input.name === 'layout',
    );
    expect(layout?.enum).toEqual(['vertical', 'horizontal']);
  });

  it.each(RETIRED)('`safeValidateSchema` refuses `layout: "%s"` on an authored object-form', (layout) => {
    // The acceptance row: the authored arm reads the spec row by reference.
    expect(refusal(safeValidateSchema({ type: 'object-form', properties: { objectName: 'contact', layout } }) as never)).toEqual([
      { code: 'invalid_value', path: 'properties.layout' },
    ]);
  });

  it.each(LIVE)('LIT CONTROL: `safeValidateSchema` accepts `layout: "%s"`', (layout) => {
    expect(safeValidateSchema({ type: 'object-form', properties: { objectName: 'contact', layout } }).success).toBe(true);
  });

  it.each(RETIRED)('the `ObjectFormSchema` mirror refuses `%s` at `layout`, and accepts both live values', (layout) => {
    const node = { type: 'object-form', objectName: 'contact', mode: 'create' };
    expect(refusal(ObjectFormMirror.safeParse({ ...node, layout }) as never)).toEqual([
      { code: 'invalid_value', path: 'layout' },
    ]);
    for (const live of LIVE) expect(ObjectFormMirror.safeParse({ ...node, layout: live }).success).toBe(true);
  });

  it('the `form` node\'s `FormSchema` mirror refuses `grid` — its declaration and registration never had it', () => {
    const node = { type: 'form', fields: [] };
    expect(refusal(FormMirror.safeParse({ ...node, layout: 'grid' }) as never)).toEqual([
      { code: 'invalid_value', path: 'layout' },
    ]);
    for (const live of LIVE) expect(FormMirror.safeParse({ ...node, layout: live }).success).toBe(true);
    expect(ComponentRegistry.getConfig('form')?.inputs?.find((input) => input.name === 'layout')?.enum).toEqual(LIVE);
  });

  it('the compile-time rows are real values', () => {
    expect([_retiredGrid, _retiredInline]).toEqual(['grid', 'inline']);
  });
});

describe('with the folds retired, the key still decides label placement (objectui#11168)', () => {
  const OBJECT = { name: 'contact', fields: { name: { type: 'text', label: 'Name' } } };

  /** The rendered form, ids normalised, once its field label is on screen. */
  async function rendered(layout: string | undefined): Promise<string> {
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(OBJECT),
      find: vi.fn(async () => ({ data: [] })),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    render(
      <SchemaRendererProvider dataSource={ds as never}>
        <SchemaRenderer
          schema={{ type: 'object-form', properties: { objectName: 'contact', mode: 'create', ...(layout ? { layout } : {}) } } as never}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(screen.getAllByText('Name').length).toBeGreaterThan(0));
    const html = document.body.innerHTML
      .replace(/(id|for|aria-[a-z]+|name)="[^"]*"/g, '$1=""')
      .replace(/«[^»]*»|_r_[0-9a-z]+_|:r[0-9a-z]+:/g, '');
    cleanup();
    return html;
  }

  it('an absent `layout` draws exactly what `vertical` draws, and `horizontal` draws something else', async () => {
    const vertical = await rendered('vertical');
    expect(await rendered(undefined)).toBe(vertical);
    // LIT CONTROL: the comparison can tell layouts apart.
    expect(await rendered('horizontal')).not.toBe(vertical);
  });
});

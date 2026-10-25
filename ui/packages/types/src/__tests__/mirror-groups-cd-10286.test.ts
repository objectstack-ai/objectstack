/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10286 — the decidable subset of objectui#7759's groups C and D: three
 * pairs where the zod mirror and the TypeScript declaration disagreed about a key,
 * each settled by the objectui#7759 ruling (where the spec declares a key both
 * faces follow the spec; for an objectui-own key the read site is the truth).
 *
 *  - `FilterField.operators` — both faces now state the spec's canonical filter
 *    vocabulary (`VIEW_FILTER_OPERATORS`). The TS face takes the spec's type by
 *    reference; the mirror spells the list out, so the runtime comparison below is
 *    what reddens if the two lists ever part.
 *  - `ContainerSchema.maxWidth` — not in the spec. The `container` renderer maps
 *    `false` to `max-w-none` and `true` to no class at all, so the mirror narrowed
 *    its `z.boolean()` arm to the `false` the declaration already stated.
 *  - `HeaderBarSchema.variant` — not in the spec, and the `header-bar` renderer
 *    reads no `variant`, so both faces retire it.
 *  - `FormSchema.mode` — the spec declares no `form` node (its create / edit /
 *    view is the `object-form` block's), and nothing reads the key on a `form`
 *    node, so both faces retire it (objectui#7759 ruling D1-(ii)). The live mode
 *    is `ObjectFormSchema.mode`, which this file shows is untouched.
 *
 * `BaseSchema` is `.passthrough()`: an UNDECLARED key parses green unexamined. So
 * every refusal here has a lit control on the same schema and document — an
 * unknown key that must stay green — which is what shows the refusal is the
 * declared key's own verdict and not a strict object refusing everything.
 */

import { describe, it, expect } from 'vitest';
import { VIEW_FILTER_OPERATORS } from '@objectstack/spec/ui';
import { FilterBuilderSchema, FilterFieldSchema } from '../zod/complex.zod.js';
import { ContainerSchema } from '../zod/layout.zod.js';
import { HeaderBarSchema } from '../zod/navigation.zod.js';
import { FormSchema } from '../zod/form.zod.js';
import { ObjectFormSchema } from '../zod/objectql.zod.js';
import type { FilterField } from '../complex.js';
import type { ContainerSchema as ContainerSchemaType } from '../layout.js';
import type { HeaderBarSchema as HeaderBarSchemaType } from '../navigation.js';
import type { FormSchema as FormSchemaType } from '../form.js';
import type { ObjectFormSchema as ObjectFormSchemaType } from '../objectql.js';

/** A control key no surface in this package declares. */
const UNKNOWN_KEY = 'zzzNotAKeyAnySurfaceDeclares10286';

/** The issue paths of a failed parse, joined, so a refusal can be told apart from a stray one. */
function refusedPaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((i) => i.path.map(String).join('.'));
}

describe('FilterField.operators states the spec vocabulary on both faces (objectui#10286)', () => {
  const field = (operators: unknown) => ({ value: 'status', label: 'Status', operators });

  it('the mirror accepts exactly the spec list — no member missing, none extra', () => {
    for (const op of VIEW_FILTER_OPERATORS) {
      expect(FilterFieldSchema.safeParse(field([op])).success, `spec operator \`${op}\` refused`).toBe(true);
    }
    // The element enum's own options, compared as a SET with the spec's array: a
    // member the spec gains, or one this mirror keeps after the spec drops it,
    // reddens here.
    const element = FilterFieldSchema.shape.operators.unwrap().element;
    expect([...element.options].sort()).toEqual([...VIEW_FILTER_OPERATORS].sort());
  });

  it('the two spellings each face used to refuse are both accepted now', () => {
    // The declaration carried `is_empty` / `is_not_empty`; the mirror refused them.
    expect(FilterFieldSchema.safeParse(field(['is_empty', 'is_not_empty'])).success).toBe(true);
    // The mirror carried `is_null` / `is_not_null`; the declaration refused them.
    const typed: FilterField = { value: 'status', label: 'Status', operators: ['is_null', 'is_not_null'] };
    expect(FilterFieldSchema.safeParse(typed).success).toBe(true);
  });

  it('a spelling outside the spec vocabulary is still refused, at the element', () => {
    // `isEmpty` is the builder dropdown's camelCase id: an ALIAS in the spec's
    // fold table, not a member of the canonical list this key declares.
    const result = FilterFieldSchema.safeParse(field(['isEmpty']));
    expect(refusedPaths(result)).toEqual(['operators.0']);
  });

  it('the vocabulary reaches `FilterBuilderSchema.fields` through the element', () => {
    const node = { type: 'filter-builder', fields: [field(['icontains', 'between'])] };
    expect(FilterBuilderSchema.safeParse(node).success).toBe(true);
    expect(refusedPaths(FilterBuilderSchema.safeParse({ ...node, fields: [field(['isEmpty'])] })))
      .toEqual(['fields.0.operators.0']);
  });

  it('the TS face takes the same set (compile-time: refused by `tsc` when it does not)', () => {
    const ok: FilterField = { value: 'a', label: 'A', operators: ['icontains', 'before', 'after', 'between'] };
    // @ts-expect-error — the builder's camelCase id is not a canonical spec operator.
    const bad: FilterField = { value: 'a', label: 'A', operators: ['isEmpty'] };
    expect([ok, bad].length).toBe(2);
  });
});

describe('ContainerSchema.maxWidth admits `false` and not `true` (objectui#10286)', () => {
  const node = (maxWidth: unknown) => ({ type: 'container', maxWidth });

  it('`true` is refused by the declared key, `false` and a size word parse', () => {
    expect(refusedPaths(ContainerSchema.safeParse(node(true)))).toEqual(['maxWidth']);
    expect(ContainerSchema.safeParse(node(false)).success).toBe(true);
    expect(ContainerSchema.safeParse(node('xl')).success).toBe(true);
  });

  it('lit control: an undeclared key on the same document stays green', () => {
    expect(ContainerSchema.safeParse({ ...node(false), [UNKNOWN_KEY]: true }).success).toBe(true);
  });

  it('the declaration refuses `true` too (compile-time)', () => {
    // @ts-expect-error — `maxWidth` declares the false literal alone.
    const bad: ContainerSchemaType = { type: 'container', maxWidth: true };
    const ok: ContainerSchemaType = { type: 'container', maxWidth: false };
    expect([ok, bad].length).toBe(2);
  });
});

describe('HeaderBarSchema.variant is retired on both faces (objectui#10286)', () => {
  const NODE = { type: 'header-bar' as const, crumbs: [{ label: 'Home' }] };

  it('every spelling either face used to offer is refused BY NAME', () => {
    for (const variant of ['default', 'bordered', 'floating', 'transparent']) {
      const result = HeaderBarSchema.safeParse({ ...NODE, variant });
      expect(refusedPaths(result), `variant \`${variant}\``).toEqual(['variant']);
    }
  });

  it('the refusal says why, and names what the renderer reads instead', () => {
    const result = HeaderBarSchema.safeParse({ ...NODE, variant: 'floating' });
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues[0].message;
    expect(message.startsWith('REFUSED (objectui#10286, ADR-0049)')).toBe(true);
    for (const key of ['actions', 'crumbs', 'rightContent', 'search']) expect(message).toContain(`\`${key}\``);
  });

  it('lit control: the same document without `variant`, and with an undeclared key, parses', () => {
    expect(HeaderBarSchema.safeParse(NODE).success).toBe(true);
    expect(HeaderBarSchema.safeParse({ ...NODE, [UNKNOWN_KEY]: 'x' }).success).toBe(true);
  });

  it('the declaration refuses it too (compile-time)', () => {
    // @ts-expect-error — `variant` is `never` on the TS face.
    const bad: HeaderBarSchemaType = { type: 'header-bar', variant: 'floating' };
    expect(bad.type).toBe('header-bar');
  });
});

describe('FormSchema.mode is retired on both faces (objectui#10286, objectui#7759 D1-(ii))', () => {
  const NODE = { type: 'form' as const, fields: [{ name: 'title', label: 'Title', type: 'text' }] };

  it('every spelling either face used to offer is refused BY NAME', () => {
    for (const mode of ['edit', 'read', 'disabled', 'create', 'view']) {
      const result = FormSchema.safeParse({ ...NODE, mode });
      expect(refusedPaths(result), `mode \`${mode}\``).toEqual(['mode']);
    }
  });

  it('the refusal points the author at `object-form`, where the mode is live', () => {
    const result = FormSchema.safeParse({ ...NODE, mode: 'edit' });
    const message = result.success ? '' : result.error.issues[0].message;
    expect(message.startsWith('REFUSED (objectui#10286, ADR-0049')).toBe(true);
    expect(message).toContain('`object-form`');
    expect(message).toContain('`disabled`');
  });

  it('lit control: the same document without `mode`, and with an undeclared key, parses', () => {
    expect(FormSchema.safeParse(NODE).success).toBe(true);
    expect(FormSchema.safeParse({ ...NODE, [UNKNOWN_KEY]: 'x' }).success).toBe(true);
  });

  it('the object-form mode the refusal names is untouched and still parses', () => {
    for (const mode of ['create', 'edit', 'view']) {
      const doc = { type: 'object-form', objectName: 'probe', mode };
      expect(ObjectFormSchema.safeParse(doc).success, `object-form mode \`${mode}\``).toBe(true);
    }
  });

  it('the declaration refuses it too, and object-form keeps it (compile-time)', () => {
    // @ts-expect-error — `mode` is `never` on the `form` node's TS face.
    const bad: FormSchemaType = { type: 'form', mode: 'read' };
    const live: Pick<ObjectFormSchemaType, 'mode'> = { mode: 'edit' };
    expect([bad.type, live.mode]).toEqual(['form', 'edit']);
  });
});

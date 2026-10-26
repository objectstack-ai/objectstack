/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * End-to-end: a `{ type: 'select', multiple: true }` field in a real object form
 * is NAMED by its visible label (objectui#3986).
 *
 * Everything below is real — the real `ObjectForm` (the producer that emits the
 * widget id), the real `mapFieldTypeToFormType`, the real form renderer in
 * `@object-ui/components`, the real registry, and the real widgets from
 * `@object-ui/fields`. Only the data source is stubbed. That is deliberate: the
 * bug lived in the SEAM between four independently-correct pieces, so a unit test
 * on any one of them stays green through it. Measured on the tree that already
 * had #3975's fix live, one field per row:
 *
 * ```
 * type: 'multiselect'                   → byRoleGroupNamed=1  role=group   ← #3975
 * type: 'select', multiple: true        → for=…-form-item resolves to div
 *                                         byRoleGroupNamed=0  byLabelText=0  ← #3986
 * ```
 *
 * The mechanism: the producer keyed the widget id on the type string only, so it
 * emitted `field:select`; `SelectField` then delegated to `MultiSelectField` on
 * `config.multiple`. The component that rendered was the chip picker, but the
 * label-association declaration the renderer consulted was the one registered
 * under `select` — which must stay undeclared, because a single-value select's
 * trigger is labelable and stripping its `for` would break a working field
 * (pinned in `form-group-label-association.test.ts`: "a BUILTIN type ignores a
 * registry declaration under the same name"). So the host emitted a `for` at the
 * chip row's wrapper `div`, where `<label for>` is inert —
 * `HTMLLabelElement.control` is `null`: a visible label, and no accessible name.
 *
 * `registerAllFields` registers each widget as a `React.lazy`, so the assertions
 * sit behind a dynamic-import boundary — warmed at MODULE SCOPE, never in a
 * `beforeAll` (AGENTS.md 测试纪律, objectui#3010). The `@object-ui/fields` barrel
 * import below IS the warm-up: it statically re-exports `./widgets/SelectField`
 * and `./widgets/MultiSelectField`, the very specifiers the lazy loaders use, so
 * `React.lazy` resolves off the ESM cache instead of racing RTL's 1000ms budget
 * against a cold Vite transform.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields, mapFieldTypeToFormType } from '@object-ui/fields';
import type { ObjectFormSchema } from '@object-ui/types';
import { ObjectForm } from '../ObjectForm';
import { normalizeSectionField } from '../sectionFields';

registerAllFields();

const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
];

/**
 * One object, three option fields — the subject, the already-fixed sibling, and
 * the guard direction — so a change that "fixes" the first by breaking the third
 * cannot pass.
 */
const objectSchema = {
  name: 'crm_account',
  label: 'Account',
  fields: {
    // The subject: spec-legal `multiple` on a `select` (#3986).
    regions: { type: 'select', multiple: true, label: 'Regions', options: OPTIONS },
    // The sibling that #3975 already fixed — a positive control for the whole
    // group-labelling chain, on a DIFFERENT type.
    tags: { type: 'multiselect', label: 'Tags', options: OPTIONS },
    // The guard: a single-value select, whose `for`→trigger association works
    // today and must survive untouched.
    stage: { type: 'select', label: 'Stage', options: OPTIONS },
  },
};

function makeDataSource(schema: object = objectSchema) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(schema),
    findOne: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
  } as any;
}

function renderObjectForm(fields?: string[]) {
  return render(
    <ObjectForm
      schema={
        {
          type: 'object-form',
          objectName: objectSchema.name,
          mode: 'create',
          ...(fields ? { fields } : {}),
        } as ObjectFormSchema
      }
      dataSource={makeDataSource()}
    />,
  );
}

/** HTML's labelable elements — the only ones a `<label for>` can address. */
const LABELABLE = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);

/**
 * Every `<label for=…>` in the document, with what it resolves to and whether that
 * target can legally be labelled. This issue's shape is `resolves: true` +
 * `labelable: false` — the association that looks fine in the markup and names
 * nothing in the accessibility tree.
 */
function labelTargets(): Array<{ text: string; forId: string; resolves: boolean; labelable: boolean }> {
  return Array.from(document.querySelectorAll('label'))
    .map((el) => {
      const forId = el.getAttribute('for') ?? '';
      const target = forId ? document.getElementById(forId) : null;
      return {
        text: (el.textContent ?? '').trim(),
        forId,
        resolves: !!target,
        labelable: !!target && LABELABLE.has(target.tagName.toLowerCase()),
      };
    })
    .filter((l) => l.forId !== '');
}

/** The host label of `name`'s form item (not a widget's own sub-label). */
const hostLabelOf = (name: string): HTMLLabelElement => {
  const el = document.querySelector(`[data-field="${name}"] > label`);
  if (!el) throw new Error(`no host label rendered for field "${name}"`);
  return el as HTMLLabelElement;
};

describe('ObjectForm: select + multiple is labelled as a group (objectui#3986)', () => {
  it('the visible label is the accessible name of the chip group', async () => {
    renderObjectForm(['regions']);

    // The assertion that was 0 before this fix and is 1 after — the issue's
    // `byRoleGroupNamed` column, on the object-form path.
    await waitFor(() => {
      expect(screen.getAllByRole('group', { name: 'Regions' })).toHaveLength(1);
    });
    // The same association read from the other side. Queried as `getAllBy…`
    // deliberately: `getAllByLabelText` de-duplicates into a Set, so a length
    // assertion states "exactly one element is named this", which a `getBy…`
    // would only state accidentally.
    expect(screen.getAllByLabelText('Regions')).toEqual(screen.getAllByRole('group', { name: 'Regions' }));
  });

  it('the host label drops its `for` and publishes an id the widget points back at', async () => {
    renderObjectForm(['regions']);

    await screen.findByRole('group', { name: 'Regions' });

    const label = hostLabelOf('regions');
    // A `for` left in place beside the `aria-labelledby` would give one label two
    // association channels, and the `for` one is the inert half.
    expect(label).not.toHaveAttribute('for');
    expect(label.id).not.toBe('');
    // The IDREF is not dangling — `aria-labelledby` naming a missing id fails
    // SILENTLY, which is indistinguishable from success in the markup.
    const group = screen.getByRole('group', { name: 'Regions' });
    expect(group).toHaveAttribute('aria-labelledby', label.id);
    expect(document.getElementById(label.id)).toBe(label);
  });

  it('renders the SAME shape as the `multiselect` type it now shares an id with', async () => {
    // #3975 fixed `multiselect`; this issue is the residual path to the same
    // widget. Both must now be indistinguishable from the host's point of view —
    // that equality is the whole point of deciding the widget at the producer.
    renderObjectForm(['regions', 'tags']);

    await waitFor(() => {
      expect(screen.getAllByRole('group', { name: 'Regions' })).toHaveLength(1);
    });
    expect(screen.getAllByRole('group', { name: 'Tags' })).toHaveLength(1);
    for (const name of ['regions', 'tags']) {
      expect(hostLabelOf(name)).not.toHaveAttribute('for');
      expect(hostLabelOf(name).id).not.toBe('');
    }
  });

  it('leaves a single-value select `for`-labelled to its trigger button', async () => {
    // The guard direction, and the reason `select` could not simply be declared
    // `labelling: 'group'`: this association ALREADY works, on a labelable
    // element, and taking it away would trade one broken field for another.
    renderObjectForm(['stage']);

    const trigger = await waitFor(() => {
      const el = document.querySelector('[data-field="stage"] [role="combobox"]');
      if (!el) throw new Error('no select trigger rendered for "stage"');
      return el;
    });

    const label = hostLabelOf('stage');
    expect(label).toHaveAttribute('for', trigger.getAttribute('id'));
    expect(label.id).toBe('');
    expect(screen.getAllByLabelText('Stage')).toEqual([trigger]);
    expect(trigger.tagName).toBe('BUTTON');
    expect(screen.queryAllByRole('group', { name: 'Stage' })).toHaveLength(0);
  });

  it('all three in ONE form: no label is left with an inert or dangling `for`', async () => {
    // The class-wide invariant this issue is an instance of. It can only be
    // stated once the group labels stop emitting `for` at all: EVERY remaining
    // `for` (the widgets' own sub-labels) must resolve to a real labelable
    // control.
    renderObjectForm();

    await waitFor(() => {
      expect(screen.getAllByRole('group', { name: 'Regions' })).toHaveLength(1);
    });
    expect(screen.getAllByRole('group', { name: 'Tags' })).toHaveLength(1);

    const broken = labelTargets().filter((l) => !l.resolves || !l.labelable);
    expect(broken).toEqual([]);
  });
});

/**
 * The producer decision itself, at the normalizer the sectioned form variants
 * share (`sectionFields`). Both halves of the (type, `multiple`) pair are
 * overridable at the VIEW level, and either one alone moves the widget — so the
 * id is decided once, from the merged pair, not from `fd.type` in isolation.
 */
describe('normalizeSectionField decides the widget from the effective pair (objectui#3986)', () => {
  const ctx = {
    objectSchema,
    objectName: objectSchema.name,
    fieldLabel: (_obj: string, _name: string, fallback: string) => fallback || _name,
  };

  it('a string shorthand for a multi select resolves to the multi widget', () => {
    expect(normalizeSectionField('regions', ctx).type).toBe('field:multiselect');
  });

  it('a spec field def naming a multi select resolves to the multi widget', () => {
    expect(normalizeSectionField({ field: 'regions' }, ctx).type).toBe('field:multiselect');
  });

  it('a view that restates only `multiple: true` moves the widget too', () => {
    // The second door onto the same defect: `multiple` is a spec FormField key,
    // so a view can turn a single-value object field into a multi one without
    // restating `type`. Resolving the id from `fd.type` before `multiple` had
    // been merged would have left this on the single-value widget.
    expect(normalizeSectionField({ field: 'stage', multiple: true }, ctx).type).toBe('field:multiselect');
  });

  it('a view that restates only `multiple: false` moves it BACK', () => {
    // The inverse, which the same single computation buys: an object-level multi
    // field narrowed by the view must land on the single-value widget, whose
    // label association is the `for` one.
    const f = normalizeSectionField({ field: 'regions', multiple: false }, ctx);
    expect(f.type).toBe('field:select');
    expect(f.multiple).toBe(false);
  });

  it('a view restating both keys agrees with the mapper', () => {
    expect(normalizeSectionField({ field: 'stage', type: 'select', multiple: true }, ctx).type).toBe(
      mapFieldTypeToFormType('select', { multiple: true }),
    );
  });

  it('a single-value select is untouched', () => {
    expect(normalizeSectionField({ field: 'stage' }, ctx).type).toBe('field:select');
    expect(normalizeSectionField('stage', ctx).type).toBe('field:select');
  });

  it('a spec field naming nothing in the object schema keeps its fallback type', () => {
    // `fromObjectSchema`'s `input` fallback, unchanged: with no type on either
    // side there is nothing to decide, and `multiple` alone must not conjure a
    // widget id.
    const f = normalizeSectionField({ field: 'ghost', multiple: true }, ctx);
    expect(f.type).toBe('input');
    expect(f.multiple).toBe(true);
  });
});

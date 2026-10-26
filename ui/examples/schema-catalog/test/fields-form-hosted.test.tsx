/**
 * The `fields-*` catalog examples are FORM-HOSTED (objectui#3910, ruling B of
 * objectui#3798).
 *
 * These examples are the docs site's field demos and a few-shot retrieval source
 * for AI authors, so what they show is what gets copied. They used to be bare
 * field nodes (`{ type: 'currency', label: 'Amount' }`), which rendered as a
 * labelled input ONLY because the docs site registered a demo-only adapter
 * (`registerFields()` → `createFieldRenderer`) that synthesized the label and a
 * local `useState`/`onChange`. No application does that: on the live path a bare
 * field node has no host for label or value. The docs were a wrong authority for
 * exactly the audience least able to check them — so the examples moved to form
 * hosting, where the real form renderer owns label and state, and the adapter was
 * deleted.
 *
 * Three different facts get pinned here:
 *
 *  1. SHAPE — every `fields-*` example is rooted at a `form` with a non-empty
 *     `fields` array. A bare field node reappearing is the regression.
 *  2. NO DEAD `value` — no root field entry carries its own `value`. This is not
 *     style: the form renderer spreads react-hook-form's state AFTER the schema
 *     props (`form.tsx` `renderFieldComponent(... ...fieldProps, ...formField)`),
 *     so a field-level `value` is silently overwritten by the form's
 *     `defaultValues` (measured: field-level → `input.value === ""`, form-level →
 *     the value). An example carrying one would demonstrate nothing while looking
 *     like it seeds a value, so seeded values live in `defaultValues`.
 *     Scoped to `fields-*` deliberately — whether the same rule should bind every
 *     category is a separate question, not this card's.
 *  3. RENDER — driven through the real `SchemaRenderer` + the real form renderer,
 *     every example produces a `form` element and its field's label text. This is
 *     what the demo adapter was faking; it is now true without one.
 *
 * Module-scope import of `@object-ui/fields`, not `beforeAll` (AGENTS.md
 * §测试纪律): the widgets sit behind `React.lazy` inside that package, and the
 * entry's `export * from './widgets/…'` block evaluates every widget module, so
 * paying it at import time keeps the lazy factories out of every test timeout
 * budget.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import '@object-ui/components';
import '@object-ui/fields';
import { SchemaRenderer } from '@object-ui/react';
import { allExamples } from '../src/index.js';

interface FieldEntry {
  name?: unknown;
  label?: unknown;
  type?: unknown;
  value?: unknown;
}
interface FormNode {
  type?: unknown;
  fields?: FieldEntry[];
  defaultValues?: Record<string, unknown>;
}

const fieldExamples = allExamples()
  .filter((e) => e.meta.category.startsWith('fields-'))
  .map((e) => [e.id, e.schema as FormNode] as const);

describe('fields-* catalog examples are form-hosted (objectui#3910)', () => {
  it('covers every fields-* category (guard is not vacuous)', () => {
    const categories = new Set(
      allExamples()
        .filter((e) => e.meta.category.startsWith('fields-'))
        .map((e) => e.meta.category),
    );
    // 26 categories, one per `content/docs/fields/*.mdx` page.
    expect(categories.size).toBe(26);
    expect(fieldExamples.length).toBeGreaterThanOrEqual(76);
  });

  it.each(fieldExamples)('%s is rooted at a form hosting its fields', (_id, schema) => {
    expect(schema.type).toBe('form');
    expect(Array.isArray(schema.fields)).toBe(true);
    expect(schema.fields!.length).toBeGreaterThan(0);
    for (const field of schema.fields!) {
      expect(typeof field.name).toBe('string');
      expect(typeof field.type).toBe('string');
    }
  });

  it.each(fieldExamples)('%s keeps seeded values in form defaultValues', (_id, schema) => {
    for (const field of schema.fields!) {
      // `Object.hasOwn`: an authored `value: false` / `0` / `''` is still a
      // dead key, and a truthiness check would wave those three through.
      expect(
        Object.hasOwn(field, 'value'),
        `field \`${String(field.name)}\` carries a root-level \`value\`, which the ` +
          'form renderer overwrites with its own state — move it to the form’s ' +
          '`defaultValues`',
      ).toBe(false);
    }
    // Whatever `defaultValues` seeds must address a field this form actually
    // hosts, or the seed is dead for the mirror-image reason.
    const names = new Set(schema.fields!.map((f) => f.name));
    for (const key of Object.keys(schema.defaultValues ?? {})) {
      expect(names.has(key), `defaultValues key \`${key}\` matches no field`).toBe(true);
    }
  });

  it.each(fieldExamples)('%s renders a real form with its labels', async (_id, schema) => {
    const { container } = render(<SchemaRenderer schema={schema as never} />);

    // `waitFor`, not a synchronous query: each widget type is a `React.lazy`
    // boundary, so the FIRST example of a given type suspends and the whole form
    // subtree — the `<form>` element included — is absent from the DOM until the
    // chunk resolves. Asserting synchronously made exactly one example per
    // category red (the alphabetically first) while the rest passed off the warm
    // lazy cache: AGENTS.md §测试纪律, load-order race rather than a real absence.
    await waitFor(() => expect(container.querySelector('form')).toBeTruthy());
    const form = container.querySelector('form') as HTMLElement;

    for (const field of schema.fields!) {
      if (typeof field.label !== 'string' || field.label.length === 0) continue;
      // Scope to the field's own FormItem (`data-field`, the renderer's stable
      // metadata-derived locator, ADR-0054 C4) so the label is pinned to the
      // field it belongs to rather than to "somewhere in the form".
      const item = form.querySelector(`[data-field="${String(field.name)}"]`);
      expect(item, `form should host a FormItem for \`${String(field.name)}\``).toBeTruthy();
      // `getAllByText`, not `getByText`: a widget may legitimately render its own
      // `sr-only` label in addition to the form's visible one (the boolean switch
      // does). What is pinned here is that the label text reaches the field's
      // chrome — not how many nodes carry it.
      expect(
        within(item as HTMLElement).getAllByText(field.label).length,
        `label \`${field.label}\` should be rendered in its field's chrome`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('form hosting actually seeds the demonstrated values (objectui#3910)', () => {
  /**
   * The read-only/default examples exist to SHOW a value. Under the old bare-node
   * shape the demo adapter read `schema.value`; under form hosting the form reads
   * `defaultValues`. These three are the ones whose whole point is the value, so
   * they get asserted directly rather than trusted to the shape rules above.
   */
  const seeded: ReadonlyArray<readonly [string, string, string]> = [
    ['fields-text/read-only-field', 'Read-Only', 'This value cannot be changed'],
    ['fields-auto-number/invoice-number-format', 'Invoice ID', 'INV-1234'],
    ['fields-summary/count-of-related-records', 'Total Orders', '42'],
  ];

  it.each(seeded)('%s shows its seeded value', async (id, label, expected) => {
    const entry = allExamples().find((e) => e.id === id);
    expect(entry, `${id} is missing from the catalog`).toBeTruthy();
    const { container } = render(<SchemaRenderer schema={entry!.schema as never} />);
    // Same lazy boundary as above — wait for the widget chunk, then assert.
    await waitFor(() => expect(container.querySelector('form')).toBeTruthy());
    const form = container.querySelector('form') as HTMLElement;
    await within(form).findByText(label);
    expect(form.textContent).toContain(expected);
  });
});

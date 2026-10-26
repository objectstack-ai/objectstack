/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A hand-authored `{ type: 'select', multiple: true }` renders the multi-value
 * WIDGET, not the built-in single-value select — objectui#11116.
 *
 * `select` is a `BUILTIN_FIELD_TYPES` member, so the bare spelling used to take
 * the built-in branch (`BuiltinSelectControl`), which reads `multiple` nowhere:
 * the markup was the same single-value combobox with and without the key. The
 * object-bound path was never affected, because `@object-ui/fields`'
 * `mapFieldTypeToFormType` maps `select` + `multiple` to `field:multiselect`
 * before the type reaches this renderer. The fix routes the hand-authored
 * spelling to that SAME registry id where `resolvedType` is computed.
 *
 * What this file pins, and what it leaves to the catalog pin:
 *
 *  - ROUTING, both ways: `multiple` truthy renders whatever is registered as
 *    `field:multiselect`; absent or `false` keeps the built-in combobox, byte
 *    for byte the control it was.
 *  - The MIRRORS see the routed id too. The label association is decided from
 *    the resolved type (`resolveFieldLabelling`), so a routed field whose widget
 *    declares `labelling: 'group'` must get the IDREF shape. Routing inside
 *    `renderFieldComponent` alone would render a group while the label still
 *    pointed a `for` at it — the case this assertion exists to catch.
 *  - NOT REGISTERED: without `@object-ui/fields` the routed field renders what
 *    an authored `field:multiselect` renders in the same host, and never the
 *    single-value combobox that silently drops the declared arity.
 *
 * `@object-ui/components` tests never load `@object-ui/fields`, so a probe
 * stands in for the widget here. The real `MultiSelectField`, its chip markup
 * and the ARRAY it submits are pinned through the real `SchemaRenderer` in
 * `examples/schema-catalog/test/fields-select-multiple-11116.test.tsx`.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

const OPTIONS = [
  { label: 'Frontend', value: 'frontend' },
  { label: 'Backend', value: 'backend' },
];

/**
 * Stands in for `MultiSelectField`: renders a group that answers a host
 * `aria-labelledby`, one toggle per option, and emits an ARRAY — the value
 * shape the real widget produces.
 */
type MultiProbeProps = {
  name?: string;
  value?: unknown;
  onChange?: (next: string[]) => void;
  field?: { options?: Array<{ label: string; value: string }> };
  id?: string;
  'aria-labelledby'?: string;
};

function MultiProbe({ name, value, onChange, field, id, 'aria-labelledby': labelledBy }: MultiProbeProps) {
  const selected: string[] = Array.isArray(value) ? value : [];
  const opts = field?.options ?? [];
  return (
    <div
      data-testid={`multi-probe-${name}`}
      role={labelledBy ? 'group' : undefined}
      aria-labelledby={labelledBy}
      id={id}
    >
      {opts.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={selected.includes(o.value)}
          onClick={() =>
            onChange?.(
              selected.includes(o.value)
                ? selected.filter((v) => v !== o.value)
                : [...selected, o.value],
            )
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function renderForm(
  fields: Array<Record<string, unknown>>,
  onSubmit?: (data: Record<string, unknown>) => void,
) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: !!onSubmit,
        showCancel: false,
        onSubmit,
        fields,
      }}
    />,
  );
}

function item(container: HTMLElement, name: string): HTMLElement {
  const el = container.querySelector(`[data-field="${name}"]`);
  if (!el) throw new Error(`no FormItem rendered for "${name}"`);
  return el as HTMLElement;
}

// Runs FIRST, before the probe is registered: the registry is per-file under
// the `dom` project's `isolate: true`, so nothing is under `field:multiselect`
// yet — the precondition is asserted, not assumed.
describe('select + multiple with no field:multiselect registered (objectui#11116)', () => {
  it('renders what an authored field:multiselect renders, not the single-value combobox', () => {
    expect(ComponentRegistry.get('field:multiselect')).toBeUndefined();

    const { container } = renderForm([
      { name: 'routed', label: 'Routed', type: 'select', multiple: true, options: OPTIONS },
      { name: 'authored', label: 'Authored', type: 'field:multiselect', options: OPTIONS },
    ]);

    const routed = item(container, 'routed');
    const authored = item(container, 'authored');
    // The arity is not silently dropped: no single-value control renders.
    expect(routed.querySelector('[role="combobox"]')).toBeNull();
    // Same answer as the object-bound spelling in the same host: the
    // `default` branch's control, whichever element and type that is.
    const routedControl = routed.querySelector('input, button, select, textarea');
    const authoredControl = authored.querySelector('input, button, select, textarea');
    expect(routedControl).not.toBeNull();
    expect(routedControl!.tagName).toBe(authoredControl!.tagName);
    expect(routedControl!.getAttribute('type')).toBe(authoredControl!.getAttribute('type'));
  });
});

describe('select + multiple routes to the field:multiselect widget (objectui#11116)', () => {
  beforeAll(() => {
    ComponentRegistry.register('multiselect', MultiProbe, { namespace: 'field', labelling: 'group' });
  });

  it('renders the registered multi-value widget instead of the built-in combobox', () => {
    const { container } = renderForm([
      { name: 'tags', label: 'Tags', type: 'select', multiple: true, options: OPTIONS },
    ]);
    const tags = item(container, 'tags');
    expect(tags.querySelector('[data-testid="multi-probe-tags"]')).not.toBeNull();
    expect(tags.querySelector('[role="combobox"]')).toBeNull();
  });

  it('associates the label the way the routed widget declares (group, by IDREF)', () => {
    const { container } = renderForm([
      { name: 'tags', label: 'Tags', type: 'select', multiple: true, options: OPTIONS },
    ]);
    const tags = item(container, 'tags');
    const label = tags.querySelector('label')!;
    const group = tags.querySelector('[data-testid="multi-probe-tags"]')!;
    expect(label.hasAttribute('for')).toBe(false);
    expect(label.id).not.toBe('');
    expect(group.getAttribute('aria-labelledby')).toBe(label.id);
    expect(group.getAttribute('role')).toBe('group');
  });

  it('submits the array the widget emits', async () => {
    const onSubmit = vi.fn();
    const { container } = renderForm(
      [{ name: 'tags', label: 'Tags', type: 'select', multiple: true, options: OPTIONS }],
      onSubmit,
    );
    const tags = item(container, 'tags');
    const [frontend, backend] = Array.from(tags.querySelectorAll('button[aria-pressed]'));
    fireEvent.click(frontend);
    fireEvent.click(backend);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({ tags: ['frontend', 'backend'] });
  });

  it.each([
    ['absent', {}],
    ['false', { multiple: false }],
  ])('keeps the built-in single-value select when multiple is %s', (_label, extra) => {
    const { container } = renderForm([
      { name: 'status', label: 'Status', type: 'select', options: OPTIONS, ...extra },
    ]);
    const status = item(container, 'status');
    expect(status.querySelector('[data-testid="multi-probe-status"]')).toBeNull();
    const trigger = status.querySelector('[role="combobox"]');
    expect(trigger).not.toBeNull();
    // The single-control label association, unchanged: a `for` naming the
    // trigger, no published label id.
    const label = status.querySelector('label')!;
    expect(label.getAttribute('for')).toBe(trigger!.id);
    expect(label.id).toBe('');
  });
});

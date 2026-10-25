/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A READONLY registered field widget's replacement display is named by the
 * field's visible label and described by its visible help text — the HOST half,
 * and under objectui#4788 the only half (maintainer ruling of 2026-08-16,
 * option E of the measured option set).
 *
 * ## The defect
 *
 * A widget's readonly branch renders a replacement display — a `mailto:` anchor,
 * a formatted span, a chip row — and returns BEFORE its `toDomProps` spread, so
 * every prop the host handed down is dropped. Measured on `origin/main` at
 * `1ef236e18` with a real form + bare registration, `description` set, one field
 * per row:
 *
 * ```
 *                readonly                                    editable
 * text     for=DANGLING hostIdEl=NONE consumers=0   for=RESOLVES-LABELABLE hostIdEl=input  consumers=1
 * boolean  for=DANGLING hostIdEl=NONE consumers=0   for=RESOLVES-LABELABLE hostIdEl=switch consumers=1
 * email    for=DANGLING hostIdEl=NONE consumers=0   for=RESOLVES-LABELABLE hostIdEl=input  consumers=1
 * formula  for=DANGLING hostIdEl=NONE consumers=0   for=DANGLING           hostIdEl=NONE   consumers=0
 * …(33 registered non-group-labelled types, every readonly row identical)
 * ```
 *
 * `hostIdEl=NONE` is the load-bearing reading, and it is a step worse than the
 * objectui#3990 family: the `…-form-item` id was on NO element in the document,
 * so the visible label's `for` DANGLED and the readonly surface had no
 * accessible name at all.
 *
 * ## Why the host and not the widgets
 *
 * The measurement also disproved the obvious widget-side fix. An
 * `aria-labelledby` on a role-less `span` / `div` names NOTHING (`generic`
 * prohibits an author name) — yet `toHaveAccessibleName()` in jsdom answers PASS
 * for that markup. A per-widget fix would therefore have shipped 26 inert
 * surfaces with green tests certifying them. Landing it once in the host removes
 * the "remember to spread" entry point entirely, for the current widgets and any
 * future third-party one alike.
 *
 * That is exactly why the assertions below are written against DOM OWNERSHIP —
 * every IDREF is resolved with `getElementById` and the resolved node is checked
 * to be the right element inside the right form item — instead of resting on
 * `toHaveAccessibleName`, which cannot tell a real association from an inert one.
 *
 * The probes here render replacement displays that spread NOTHING, mirroring the
 * real widgets (`@object-ui/components` tests never load `@object-ui/fields`; the
 * real-widget sweep lives in `packages/fields/src/__tests__/`). A probe that
 * spread its leftover props would go green whether or not the host wrapped it.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

/**
 * The anchor face: `email` / `phone` / `url` return a link and spread nothing.
 * Its own accessible name comes from its content, and must keep doing so.
 */
function AnchorProbe(props: any) {
  const { value, readonly } = props;
  if (readonly) {
    return <a href={`mailto:${value}`}>{String(value ?? '')}</a>;
  }
  return <input data-testid="anchor-input" value={(value as string) ?? ''} onChange={() => {}} {...domOnly(props)} />;
}

/** The plain-text face: 26 of the 33 measured types return a `span` / `div`. */
function TextProbe(props: any) {
  const { value, readonly } = props;
  if (readonly) {
    return <span>{String(value ?? '')}</span>;
  }
  return <input data-testid="text-input" value={(value as string) ?? ''} onChange={() => {}} {...domOnly(props)} />;
}

/**
 * The display-only face (D group: `formula` / `summary` / `auto_number` /
 * `vector`) — no editable branch at all, so `readonly` is not even read.
 */
function DisplayOnlyProbe(props: any) {
  return <span>{String(props.value ?? '')}</span>;
}

/** Group-labelled widget: consumes the host keys ITSELF (objectui#3990/#4005). */
function GroupProbe(props: any) {
  const { value, readonly } = props;
  const hosted = {
    id: props.id,
    'aria-labelledby': props['aria-labelledby'],
    'aria-describedby': props['aria-describedby'],
    role: props['aria-labelledby'] ? ('group' as const) : undefined,
  };
  if (readonly) return <div {...hosted}>{String(value ?? '')}</div>;
  return <div {...hosted}><input data-testid="group-input" value={(value as string) ?? ''} onChange={() => {}} /></div>;
}

/** A plain SDUI component reached through the bare-name fallback, not `field:`. */
function BareNameProbe(props: any) {
  return <span data-testid="bare-name">{String(props.value ?? props.schema?.name ?? '')}</span>;
}

/** Only the keys an `<input>` may legally carry, so the editable probes are honest. */
function domOnly(props: any) {
  return {
    id: props.id,
    'aria-describedby': props['aria-describedby'],
    'aria-invalid': props['aria-invalid'],
    'aria-required': props['aria-required'],
    'aria-labelledby': props['aria-labelledby'],
  };
}

beforeAll(() => {
  ComponentRegistry.register('anchorprobe', AnchorProbe, { namespace: 'field' });
  ComponentRegistry.register('textprobe', TextProbe, { namespace: 'field' });
  ComponentRegistry.register('displayonlyprobe', DisplayOnlyProbe, { namespace: 'field' });
  // The same face WITH the objectui#4857 declaration — the production shape of
  // the display-only four (`formula` / `summary` / `auto_number` / `vector`).
  ComponentRegistry.register('displaydeclaredprobe', DisplayOnlyProbe, {
    namespace: 'field',
    labelling: 'display',
  });
  ComponentRegistry.register('groupprobe', GroupProbe, { namespace: 'field', labelling: 'group' });
  // NOT in the `field` namespace — the bare-name fallback, whose contract is
  // `schema`, not `FieldWidgetComponentProps`.
  ComponentRegistry.register('barenameprobe', BareNameProbe);
}, 30000);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(fields: any[], defaultValues: Record<string, unknown> = {}, showSubmit = false) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit,
        submitLabel: 'Create',
        showCancel: false,
        defaultValues,
        fields,
      }}
    />,
  );
}

const item = (name: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (!el) throw new Error(`no form item rendered for field "${name}"`);
  return el;
};

const hostLabel = (name: string): HTMLLabelElement => {
  const el = item(name).querySelector('label');
  if (!el) throw new Error(`no label rendered for field "${name}"`);
  return el as HTMLLabelElement;
};

/** The wrapper the host emits for a readonly registered widget, or null. */
const group = (name: string): HTMLElement | null =>
  item(name).querySelector<HTMLElement>('[data-slot="readonly-field-group"]');

/** Resolve one IDREF against the document — the whole point of these tests. */
const byId = (id: string | null | undefined): HTMLElement | null =>
  id ? document.getElementById(id) : null;

const idrefs = (el: Element, attr: string): string[] =>
  (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean);

const FIELD = (type: string, extra: Record<string, unknown> = {}) => ({
  name: `f_${type}`,
  label: `Label ${type}`,
  type,
  description: 'Some help',
  ...extra,
});

describe('readonly registered widget: the host names and describes the replacement display (objectui#4788)', () => {
  it.each(['anchorprobe', 'textprobe', 'displayonlyprobe'])(
    '%s: every IDREF the group carries resolves to the right node in the same form item',
    (type) => {
      const name = `f_${type}`;
      renderForm([FIELD(type, { readonly: true })], { [name]: 'user@example.com' });

      const g = group(name);
      // 0 before this change: no element in the document carried the host id.
      expect(g).not.toBeNull();
      expect(g).toHaveAttribute('role', 'group');

      // The group IS the element the host handed its control id to — the
      // `hostIdEl=NONE` reading turning into `hostIdEl=div[group]`.
      const hostId = g!.getAttribute('id');
      expect(hostId).toMatch(/-form-item$/);
      expect(byId(hostId)).toBe(g);

      // Ownership, not just a passing name: the label IDREF resolves to THE
      // visible label of THIS field, and the self-reference to the group itself.
      const labelled = idrefs(g!, 'aria-labelledby');
      expect(labelled).toHaveLength(2);
      const labelNode = byId(labelled[0]);
      expect(labelNode).toBe(hostLabel(name));
      expect(item(name).contains(labelNode!)).toBe(true);
      expect(byId(labelled[1])).toBe(g);

      // The description IDREF resolves to THE `<FormDescription>` of this field
      // — `consumers=0` turning into `consumers=1`.
      const described = idrefs(g!, 'aria-describedby');
      const descNode = byId(described[0]);
      expect(descNode).not.toBeNull();
      expect(descNode).toHaveTextContent('Some help');
      expect(descNode!.id).toMatch(/-form-item-description$/);
      expect(item(name).contains(descNode!)).toBe(true);

      // The widget's own output sits INSIDE the group, so entering the group is
      // what reads the value — the containment half of "the label names THIS".
      expect(g!.textContent).toContain('user@example.com');
    },
  );

  it('the host label publishes an id and drops its `for` (single naming channel, objectui#3978)', () => {
    renderForm([FIELD('textprobe', { readonly: true })], { f_textprobe: 'Hello' });

    const label = hostLabel('f_textprobe');
    // Before: `for="…-form-item"` pointing at an id NOTHING carried.
    expect(label).not.toHaveAttribute('for');
    expect(label.id).not.toBe('');
    // And exactly one channel: the id it published is the one the group reads.
    expect(idrefs(group('f_textprobe')!, 'aria-labelledby')[0]).toBe(label.id);
  });

  it('the value stays in the accessible name (composite `labelId hostId`)', () => {
    renderForm([FIELD('anchorprobe', { readonly: true })], { f_anchorprobe: 'user@example.com' });

    // `group` is not a name-from-content role, so without the self-reference the
    // address — the only thing on screen — would be absent from the name.
    expect(group('f_anchorprobe')).toHaveAccessibleName('Label anchorprobe user@example.com');
    // The anchor keeps its OWN name, from its own content: it is read as itself
    // inside the group, and the field name is not duplicated onto it.
    expect(screen.getByRole('link')).toHaveAccessibleName('user@example.com');
  });

  it('the widget is NOT handed the label IDREF as well (one fact, one author)', () => {
    renderForm([FIELD('textprobe', { readonly: true })], { f_textprobe: 'Hello' });

    // The wrapper is the named surface. A widget that spread a second
    // `aria-labelledby` would give one label two consumers.
    const inner = group('f_textprobe')!.querySelector('span');
    expect(inner).not.toBeNull();
    expect(inner).not.toHaveAttribute('aria-labelledby');
    expect(inner).not.toHaveAttribute('id');
  });
});

describe('the control-channel boundary is NOT crossed (objectui#3291 / #3318 / #4005)', () => {
  it('a valid readonly field carries no `aria-invalid` and no `aria-required`', () => {
    renderForm([FIELD('textprobe', { readonly: true, required: true })], { f_textprobe: 'Hello' });

    const g = group('f_textprobe')!;
    // `<FormControl>`'s Slot injects `aria-invalid` into whatever it wraps. A
    // readonly display cannot be edited and so cannot be made invalid by the
    // person reading it; the wrapper consumes the key and emits nothing.
    expect(g).not.toHaveAttribute('aria-invalid');
    expect(g).not.toHaveAttribute('aria-required');
  });

  it('an INVALID field still carries no `aria-invalid`, and keeps the message in `aria-describedby`', async () => {
    renderForm(
      [
        FIELD('textprobe', { readonly: true, required: true }),
        // A second, editable field to make the submit reach validation with a
        // real error on the readonly one.
        { name: 'f_edit', label: 'Editable', type: 'textprobe' },
      ],
      {},
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      const g = group('f_textprobe')!;
      const described = idrefs(g, 'aria-describedby');
      // The Slot appends the message id once the field is in error; the
      // DESCRIPTION channel is legitimate for a group, the STATE channel is not.
      expect(described.some((id) => id.endsWith('-form-item-message'))).toBe(true);
      expect(g).not.toHaveAttribute('aria-invalid');
    });
  });
});

describe('nothing else changed shape (the paths this issue does not touch)', () => {
  it('an EDITABLE registered widget keeps its `for`, its id, and no group', () => {
    renderForm([FIELD('textprobe')], { f_textprobe: 'Hello' });

    expect(group('f_textprobe')).toBeNull();
    const label = hostLabel('f_textprobe');
    expect(label).not.toHaveAttribute('id');
    const target = byId(label.getAttribute('for'));
    expect(target).toBe(screen.getByTestId('text-input'));
    expect(idrefs(target!, 'aria-describedby')[0]).toMatch(/-form-item-description$/);
  });

  it('a READONLY builtin type is untouched — it renders a real control that takes the id', () => {
    // `BUILTIN_FIELD_TYPES` never consults the registry, and its readonly
    // rendering keeps a labelable element, so its `for` already resolved.
    renderForm([FIELD('input', { readonly: true })], { f_input: 'Hello' });

    expect(group('f_input')).toBeNull();
    const label = hostLabel('f_input');
    expect(label).toHaveAttribute('for');
    expect(byId(label.getAttribute('for'))!.tagName.toLowerCase()).toBe('input');
  });

  it('a READONLY group-labelled widget keeps consuming the host keys itself (no second group)', () => {
    renderForm([FIELD('groupprobe', { readonly: true })], { f_groupprobe: 'Hello' });

    // objectui#3990 / #4005 put the id, the name and the description on the
    // WIDGET's surface. Wrapping it here would nest a second identically-named
    // group and strip the id off the surface those PRs put it on.
    expect(group('f_groupprobe')).toBeNull();
    const named = screen.getByRole('group', { name: 'Label groupprobe' });
    expect(named.getAttribute('id')).toMatch(/-form-item$/);
    expect(idrefs(named, 'aria-describedby')[0]).toMatch(/-form-item-description$/);
  });

  it('a READONLY field with NO label emits no group (nothing would name it)', () => {
    renderForm([{ name: 'f_nolabel', type: 'textprobe', readonly: true, description: 'Some help' }], {
      f_nolabel: 'Hello',
    });

    // A `role="group"` nothing names is the inert pair this issue exists to
    // avoid, so the label-less path stays byte-identical.
    expect(group('f_nolabel')).toBeNull();
    expect(document.querySelector('[role="group"]')).toBeNull();
  });

  it('a bare-name SDUI component is not a field widget and gets no group', () => {
    renderForm([FIELD('barenameprobe', { readonly: true })], { f_barenameprobe: 'Hello' });

    // #4788's assertion, unchanged: the wrapper is scoped to registered FIELD
    // widgets, and this type is not one.
    expect(group('f_barenameprobe')).toBeNull();

    // The SECOND half of this test used to be `getByTestId('bare-name')` — it
    // asserted that a form field REACHED the bare-name component, which was
    // true only because of the cross-namespace fallback objectui#5254's ruling
    // removed. A form field's type now resolves a `field:` widget or nothing,
    // so this type takes the builtin `default` input branch instead. The probe
    // is still registered (bare, no namespace) and still resolvable as an SDUI
    // NODE — it is simply no longer reachable as a FIELD.
    expect(ComponentRegistry.get('barenameprobe')).toBeTruthy(); // counter-probe
    expect(screen.queryByTestId('bare-name')).toBeNull();
    expect(item('f_barenameprobe').querySelector('input')).toBeTruthy();
  });
});

describe('a `labelling: "display"` declaration extends the wrapper to the EDITABLE state (objectui#4857)', () => {
  it('EDITABLE display-declared widget: wrapped, named, described — the #4788 shape without `readonly`', () => {
    renderForm([FIELD('displaydeclaredprobe')], { f_displaydeclaredprobe: 'computed' });

    const g = group('f_displaydeclaredprobe');
    expect(g).not.toBeNull();
    expect(g).toHaveAttribute('role', 'group');
    expect(byId(g!.getAttribute('id'))).toBe(g);

    const label = hostLabel('f_displaydeclaredprobe');
    expect(label).not.toHaveAttribute('for');
    const labelled = idrefs(g!, 'aria-labelledby');
    expect(byId(labelled[0])).toBe(label);
    expect(byId(labelled[1])).toBe(g);
    expect(byId(idrefs(g!, 'aria-describedby')[0])).toHaveTextContent('Some help');
    expect(g).not.toHaveAttribute('aria-invalid');
  });

  it('EDITABLE + `disabled`: the wrapper still applies — the real object-form path for computed fields', () => {
    // ObjectForm maps `formula` / `summary` / `auto_number` to `disabled: true`,
    // never `readonly: true` (a deliberate distinction the #4857 ruling kept —
    // option 1, re-mapping it, was rejected). The gate reads the DECLARATION,
    // so the disabled path is covered without touching that mapping.
    renderForm([FIELD('displaydeclaredprobe', { disabled: true })], {
      f_displaydeclaredprobe: 'computed',
    });

    const g = group('f_displaydeclaredprobe');
    expect(g).not.toBeNull();
    expect(g).toHaveAccessibleName('Label displaydeclaredprobe computed');
  });

  it('READONLY display-declared widget: both arms true, still exactly ONE wrapper', () => {
    renderForm([FIELD('displaydeclaredprobe', { readonly: true })], {
      f_displaydeclaredprobe: 'computed',
    });

    expect(
      item('f_displaydeclaredprobe').querySelectorAll('[data-slot="readonly-field-group"]'),
    ).toHaveLength(1);
    expect(item('f_displaydeclaredprobe').querySelectorAll('[role="group"]')).toHaveLength(1);
  });

  it('an UNDECLARED display-only widget stays on the single-control path while editable', () => {
    // The fallback the declaration exists to replace: without `labelling:
    // "display"` the host cannot know the widget renders no control, so the
    // editable state keeps the (dangling) `for`. Pinned so the registry-level
    // "registered ⇒ declared" gate in `@object-ui/fields` is what carries the
    // guarantee, not a host-side guess.
    renderForm([FIELD('displayonlyprobe')], { f_displayonlyprobe: 'computed' });

    expect(group('f_displayonlyprobe')).toBeNull();
    expect(hostLabel('f_displayonlyprobe')).toHaveAttribute('for');
  });

  it('a display declaration does NOT wrap a label-less field (nothing would name it)', () => {
    renderForm(
      [{ name: 'f_nolabel_display', type: 'displaydeclaredprobe', description: 'Some help' }],
      { f_nolabel_display: 'computed' },
    );

    expect(group('f_nolabel_display')).toBeNull();
    expect(document.querySelector('[role="group"]')).toBeNull();
  });
});

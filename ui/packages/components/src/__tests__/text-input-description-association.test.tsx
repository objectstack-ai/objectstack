/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:text_input` — the authored `description` is the field's accessible
 * DESCRIPTION, not an unassociated paragraph beside it (objectui#5735).
 *
 * ## What these tests pin, and what they deliberately do NOT
 *
 * The defect was never "the paragraph has no id". It was that the paragraph and
 * the input had no programmatic RELATIONSHIP: a screen reader moving to the
 * field announced the label and the value and never the helper text. So every
 * case below asserts the relationship end to end — read the control's
 * `aria-describedby`, look each id up in the document, and compare the resolved
 * element's text — via the `describedElements` helper. Two assertions that
 * checked the attributes separately ("the p has an id", "the input has an
 * aria-describedby") both pass on a build where the two point at DIFFERENT
 * things, which is the build this file has to be able to fail on.
 *
 * ## What the instrument can and cannot discriminate
 *
 * `toHaveAccessibleDescription` runs `dom-accessibility-api` over happy-dom. It
 * can prove the description is COMPUTED — that the reference resolves and the
 * resolved text is what an AT would be handed. It cannot prove any screen
 * reader SPEAKS it: description text is announced after the accessible name and
 * is gated by AT verbosity settings (NVDA's "Report object descriptions",
 * VoiceOver hint verbosity), and nothing in this repo can measure that. This is
 * why the renderer's own `description` prose keeps the "prefer `label` for
 * instructions a user must not miss" advice after the wiring landed — the
 * advice now rests on announcement order and verbosity, which is cited, rather
 * than on the text being unreachable, which was measured and is now false.
 *
 * Second limit, worth stating because it is the one that could mislead: CSS
 * generated content does not exist in happy-dom, so NO name or description
 * computed here can be evidence about it, either way. While the `required`
 * asterisk was an `::after` utility on the `Label`, every computation here was
 * blind to it, and Chromium appended it to the required input's name — "Title*"
 * for a label "Title" (objectui#10368). It is now a real `aria-hidden` element,
 * and the required case below pins it by MARKUP (no generated-content utility
 * in the label, an `aria-hidden` `*` element) — never by a happy-dom name.
 * The other cases author no `required`, so the asterisk never touched their
 * names.
 *
 * ## Why the renderer is driven through the registry, not `SchemaRenderer`
 *
 * Same reason `text-input-i18n-label-arms.test.tsx` next door states:
 * `SchemaRenderer` injects its own props around a renderer, so a case driven
 * through it can be green for a reason that is not the renderer's. The last
 * case re-runs the primary relationship through `SchemaRenderer` on purpose —
 * that is the path an authored page actually takes, and it is worth one
 * assertion that the wrapper does not strip the wiring.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// Registers `element:text_input` at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

afterEach(cleanup);

const HELP = 'Lowercase letters and dashes only.';

/**
 * The relationship, resolved the way assistive tech resolves it: read
 * `aria-describedby`, split it, and look every id up in the document.
 *
 * A dangling id THROWS rather than being skipped. That is the point — an
 * `aria-describedby` naming an element that does not exist is worse than no
 * attribute, and a helper that quietly dropped the miss would let exactly that
 * build pass.
 */
function describedElements(control: Element): HTMLElement[] {
  const ref = control.getAttribute('aria-describedby');
  if (ref == null) return [];
  return ref
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => {
      const el = document.getElementById(id);
      if (!el) {
        throw new Error(`aria-describedby names "${id}", but no element in the document has that id`);
      }
      return el;
    });
}

function renderInput(properties: Record<string, unknown>, schemaExtra: Record<string, unknown> = {}) {
  const C = ComponentRegistry.get('element:text_input') as React.ComponentType<any>;
  if (!C) throw new Error('element:text_input is not registered');
  return render(<C schema={{ type: 'element:text_input', id: 'ws_input', properties, ...schemaExtra }} />);
}

describe('element:text_input — description is the field\'s accessible description (objectui#5735)', () => {
  it('resolves the input aria-describedby to the paragraph carrying the resolved description', () => {
    renderInput({ label: 'Workspace', description: HELP });

    const input = screen.getByRole('textbox');
    const described = describedElements(input);

    // ONE description carrier, and it is the rendered paragraph — asserted as a
    // resolution, not as two independent attributes.
    expect(described).toHaveLength(1);
    expect(described[0].tagName).toBe('P');
    expect(described[0].textContent).toBe(HELP);
    expect(described[0]).toBe(screen.getByText(HELP));

    // And the computed description an AT would be handed.
    expect(input).toHaveAccessibleDescription(HELP);
  });

  it('emits NO aria-describedby when no description is authored', () => {
    renderInput({ label: 'Workspace' });

    const input = screen.getByRole('textbox');
    // The control that keeps the fix honest: a renderer that ALWAYS emitted an
    // `aria-describedby` would satisfy every other case in this file while
    // publishing a dangling reference on every description-less field.
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(describedElements(input)).toHaveLength(0);
    expect(input).toHaveAccessibleDescription('');
    expect(document.querySelector('p')).toBeNull();
  });

  it('emits no aria-describedby for a description that resolves to an empty string', () => {
    // The paragraph is dropped by the same `{description && …}` truthiness the
    // id is minted under, so the two cannot drift apart into an attribute
    // pointing at a paragraph that was never rendered.
    renderInput({ label: 'Workspace', description: '' });

    const input = screen.getByRole('textbox');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(document.querySelector('p')).toBeNull();
  });

  it('keeps the label association working — it shares the id most likely to break', () => {
    renderInput({ label: 'Workspace', description: HELP });

    const input = screen.getByRole('textbox');
    expect(screen.getByLabelText('Workspace')).toBe(input);
    expect(input).toHaveAccessibleName('Workspace');
    // Name and description are separate channels: the helper text must not have
    // leaked into the name.
    expect(input).toHaveAccessibleDescription(HELP);
    expect(document.querySelector('label')).toHaveAttribute('for', 'ws_input');
    expect(input).toHaveAttribute('id', 'ws_input');
  });

  it('associates the description even when the node carries NO id — while the label degrades exactly as before', () => {
    // The deliberate half of the fix. `htmlFor` needs an id on the INPUT, which
    // only the author can supply, so the label wiring can only hold when they
    // did — unchanged here. `aria-describedby` needs an id on the PARAGRAPH,
    // which the renderer mints, so the description association never depended
    // on the author at all.
    const C = ComponentRegistry.get('element:text_input') as React.ComponentType<any>;
    render(<C schema={{ type: 'element:text_input', properties: { label: 'Workspace', description: HELP } }} />);

    const input = screen.getByRole('textbox');

    // Pre-existing behaviour, pinned so a later "fix" cannot change it silently.
    expect(input).not.toHaveAttribute('id');
    expect(document.querySelector('label')).not.toHaveAttribute('for');
    expect(input).toHaveAccessibleName('');

    // …and the description is associated anyway.
    const described = describedElements(input);
    expect(described).toHaveLength(1);
    expect(described[0].textContent).toBe(HELP);
    expect(input).toHaveAccessibleDescription(HELP);
  });

  it('gives each input its OWN paragraph even when two nodes share an authored id', () => {
    // The case that discriminates the chosen mechanism from the obvious
    // alternative. Deriving the paragraph id from `schema.id` would publish two
    // paragraphs with the same id here, and BOTH fields would resolve to
    // whichever came first in the document — the wrong helper text announced on
    // one of them, which is worse than none. A per-instance `React.useId()`
    // cannot collide. This pins the property, not an endorsement of duplicate
    // authored ids.
    const C = ComponentRegistry.get('element:text_input') as React.ComponentType<any>;
    render(
      <>
        <C schema={{ type: 'element:text_input', id: 'dup', properties: { label: 'First', description: 'First help.' } }} />
        <C schema={{ type: 'element:text_input', id: 'dup', properties: { label: 'Second', description: 'Second help.' } }} />
      </>,
    );

    const [first, second] = screen.getAllByRole('textbox');
    expect(first.getAttribute('aria-describedby')).not.toBe(second.getAttribute('aria-describedby'));
    expect(describedElements(first)[0].textContent).toBe('First help.');
    expect(describedElements(second)[0].textContent).toBe('Second help.');
    expect(first).toHaveAccessibleDescription('First help.');
    expect(second).toHaveAccessibleDescription('Second help.');
  });

  it('describes the field from the description, not from the placeholder', () => {
    renderInput({ label: 'Workspace', placeholder: 'acme', description: HELP });

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'acme');
    expect(input).toHaveAccessibleDescription(HELP);
    expect(describedElements(input)[0].textContent).toBe(HELP);
  });

  it('associates the RESOLVED locale value, not the raw map', () => {
    // `description` accepts an inline per-locale map (objectui#5717). What must
    // reach `aria-describedby` is the value `pickLocalized` resolved for the
    // active language — a build that associated the paragraph but rendered the
    // map, or resolved the map but associated something else, is red here.
    const C = ComponentRegistry.get('element:text_input') as React.ComponentType<any>;
    render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <C
          schema={{
            type: 'element:text_input',
            id: 'ws_input',
            properties: { label: 'Workspace', description: { en: 'Owner', 'zh-CN': '负责人' } },
          }}
        />
      </I18nProvider>,
    );

    const input = screen.getByRole('textbox');
    expect(describedElements(input)[0].textContent).toBe('负责人');
    expect(input).toHaveAccessibleDescription('负责人');
  });

  it('keeps a required label\'s asterisk out of both channels, pinned by markup (objectui#10368)', () => {
    // The verdict is the MARKUP, not a happy-dom name (see the header's second
    // limit): happy-dom computes no CSS generated content, so a name read here
    // stayed green while Chromium put the asterisk into the input's name.
    renderInput({ label: 'Workspace', description: HELP, required: true });

    const input = screen.getByRole('textbox');
    const label = document.querySelector('label[for="ws_input"]') as HTMLLabelElement;
    expect(label).not.toBeNull();

    // 1. Nothing in the associated label draws generated content.
    const generated = [label, ...Array.from(label.querySelectorAll('*'))]
      .flatMap((el) => Array.from(el.classList))
      .filter((c) => /(^|:)content-[[(]/.test(c));
    expect(generated).toEqual([]);

    // 2. The visible `*` is one real element, hidden from assistive tech.
    const markers = label.querySelectorAll('[data-required-marker]');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveAttribute('aria-hidden', 'true');
    expect(markers[0].textContent).toBe('*');

    // 3. The description association is untouched by the marker: still the
    //    one paragraph, and the marker lives in the label, not in it.
    const described = describedElements(input);
    expect(described).toHaveLength(1);
    expect(described[0].textContent).toBe(HELP);
    expect(described[0].contains(markers[0])).toBe(false);

    // The required STATE is the native attribute, as before.
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('required');
  });

  it('survives the real render path through SchemaRenderer', () => {
    render(
      <SchemaRenderer
        schema={{ type: 'element:text_input', id: 'ws_input', properties: { label: 'Workspace', description: HELP } }}
      />,
    );

    const input = screen.getByRole('textbox');
    expect(describedElements(input)[0].textContent).toBe(HELP);
    expect(input).toHaveAccessibleDescription(HELP);
  });
});

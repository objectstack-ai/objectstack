/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:text_input` — `label` / `placeholder` / `description` resolve the
 * inline locale map their declaration now advertises (objectui#5717).
 *
 * ## Why this file exists when the renderer was never the broken half
 *
 * #5717 is a DECLARATION fix: the three `ComponentMeta` arms said `'string'`
 * while `text-input.tsx` had resolved all three through `pickLocalized` since it
 * was written, so the manifest gate reported `type-mismatch` on a write the
 * screen rendered correctly. Nothing in the renderer changed, and nothing here
 * was red before the fix.
 *
 * That is precisely what makes this file load-bearing rather than ceremonial.
 * `ComponentInput.type` permits an arm on two conditions — the contract accepts
 * the shape AND the renderer resolves it — and after #5717 the second condition
 * is what the declaration rests on while NOTHING pinned it for these three keys.
 * `inline-locale-label-read-sites.test.tsx` next door covers `schema.label`
 * (the BaseSchema key) on three other renderers; these are
 * `schema.properties.*` on this one, a different read path in a different file.
 * Delete the `pickLocalized` calls today and every #5717 assertion stays green:
 * the declared arms still match the contract, the gate still emits nothing, and
 * the map reaches the screen as a React child — which is the failure mode
 * `inline-locale-label-read-sites.test.tsx` measured as a THROW, not a
 * mis-render. This file is what turns that red, so the arms cannot outlive the
 * behaviour that justifies them.
 *
 * ## Why the second locale is load-bearing, not decoration
 *
 * A case that only ever asserted the ENGLISH string would pass against any
 * resolver that just reached for `.en` — including one that ignores the active
 * language entirely. The `zh-CN` cases are what separate real locale resolution
 * from an `.en` pick, which is the property `pickLocalized` has and the reason
 * the descriptions promise it.
 *
 * The renderer is invoked DIRECTLY through the registry rather than through
 * `SchemaRenderer`, for the reason `inline-locale-label-read-sites.test.tsx`
 * states: `SchemaRenderer` injects its own props around a renderer, so a test
 * driven through it can be green in both directions.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
// Registers `element:text_input` at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

/** The inline locale map an author writes; `zh-CN` exists so a switch is observable. */
const INLINE_MAP = { en: 'Owner', 'zh-CN': '负责人' } as const;

function renderInput(properties: Record<string, unknown>, language = 'en') {
  const C = ComponentRegistry.get('element:text_input') as React.ComponentType<any>;
  if (!C) throw new Error('element:text_input is not registered');
  return render(
    <I18nProvider
      persistLanguage={false}
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
    >
      {/* `C` is the component the registry ALREADY holds — `ComponentRegistry.get`
          returns a stable reference, not one created during this render — so the
          static-components concern does not apply. Stated as prose rather than as
          the `eslint-disable-next-line` its sibling
          `record-picker-empty-text-i18n.test.tsx` carries: that directive is
          reported UNUSED by this repo's own config (the rule never fires here),
          and an inert suppression outlives the reason anyone wrote it. */}
      <C schema={{ type: 'element:text_input', id: 'ws_input', properties }} />
    </I18nProvider>,
  );
}

/** The `<p>` the renderer puts `description` in, below the field. */
const descriptionNode = (container: HTMLElement) =>
  container.querySelector('p.text-muted-foreground');

describe('element:text_input — the I18nLabel trio resolves at the read site (objectui#5717)', () => {
  it('renders all three destinations at all (reachability before absence)', () => {
    // Without this, every "the text is X" assertion below would be satisfied
    // just as well by a renderer that rendered none of the three — each is
    // omitted entirely when its key is absent, so absence is silent here.
    const { container } = renderInput({
      label: 'Workspace',
      placeholder: 'acme',
      description: 'Used to name your workspace.',
    });
    expect(screen.getByTestId('text-input')).toBeInTheDocument();
    expect(container.querySelector('label')?.textContent).toBe('Workspace');
    expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('acme');
    expect(descriptionNode(container)?.textContent).toBe('Used to name your workspace.');
  });

  it('resolves the map to the active language on all three keys at once', () => {
    // The authored node the card reported, and the case that separates real
    // resolution from an `.en` pick.
    const { container } = renderInput(
      { label: INLINE_MAP, placeholder: INLINE_MAP, description: INLINE_MAP },
      'zh-CN',
    );
    expect(container.querySelector('label')?.textContent).toBe('负责人');
    expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('负责人');
    expect(descriptionNode(container)?.textContent).toBe('负责人');
  });

  it('resolves the SAME maps differently for a different language', () => {
    const { container } = renderInput(
      { label: INLINE_MAP, placeholder: INLINE_MAP, description: INLINE_MAP },
      'en',
    );
    expect(container.querySelector('label')?.textContent).toBe('Owner');
    expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('Owner');
    expect(descriptionNode(container)?.textContent).toBe('Owner');
  });

  it('keeps the three keys in their own destinations', () => {
    // Distinct values per key, because the three-identical-maps case above
    // cannot tell "each key reached its own destination" from "one value was
    // rendered three times". This is also the evidence behind declaring the
    // object arm on `description` alongside the two label-ish keys: the
    // destinations genuinely differ — a `<label>` above, a native attribute
    // inside, a `<p>` below — and the read path is identical for all three.
    const { container } = renderInput(
      {
        label: { en: 'L', 'zh-CN': '标签' },
        placeholder: { en: 'P', 'zh-CN': '提示' },
        description: { en: 'D', 'zh-CN': '说明' },
      },
      'zh-CN',
    );
    expect(container.querySelector('label')?.textContent).toBe('标签');
    expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('提示');
    expect(descriptionNode(container)?.textContent).toBe('说明');
  });

  it('falls back from a region tag to the base language the author wrote', () => {
    // Author wrote `zh`; viewer is `zh-CN`. Pins a limb past "exact match", so
    // a resolver that only ever hit the exact key could not satisfy this file.
    const { container } = renderInput({ label: { en: 'Owner', zh: '负责人' } }, 'zh-CN');
    expect(container.querySelector('label')?.textContent).toBe('负责人');
  });

  it('passes plain strings through unchanged, in any language', () => {
    // CONTROL, same keys and same read sites as the probes: capable of failing —
    // a resolution that mangled the string arm turns this red, and the string
    // arm is the half that must not move.
    const { container } = renderInput(
      { label: 'Workspace', placeholder: 'acme', description: 'Used to name it.' },
      'zh-CN',
    );
    expect(container.querySelector('label')?.textContent).toBe('Workspace');
    expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('acme');
    expect(descriptionNode(container)?.textContent).toBe('Used to name it.');
  });

  it('omits label and description entirely when a map resolves to nothing', () => {
    // The renderer guards all three reads with a truthiness test, and
    // `pickLocalized` spells a total miss as `''`. Pinned because the
    // descriptions published in #5717 promise exactly this — "OMITTED entirely
    // when the key is absent or resolves to an empty string" — and because an
    // author debugging a vanished label needs the behaviour to be stable.
    const { container } = renderInput({ label: {}, placeholder: {}, description: {} }, 'zh-CN');
    expect(screen.getByTestId('text-input')).toBeInTheDocument();
    expect(container.querySelector('label')).toBeNull();
    expect(descriptionNode(container)).toBeNull();
    // `placeholder` is an ATTRIBUTE, so its miss is spelled by absence of the
    // attribute rather than by an empty one (`placeholder || undefined`).
    expect(container.querySelector('input')?.hasAttribute('placeholder')).toBe(false);
  });

  it('never renders a raw map into the DOM on any of the three keys', () => {
    // The failure this whole file guards against, asserted as its own case
    // rather than inferred: a read site that stopped resolving would put the
    // object in a React child position — measured elsewhere in this package as a
    // THROW, "Objects are not valid as a React child" — or stringify it into an
    // attribute as `[object Object]`. Either way the arms declared in #5717
    // would be advertising a shape that never reaches the screen.
    const { container } = renderInput(
      { label: INLINE_MAP, placeholder: INLINE_MAP, description: INLINE_MAP },
      'zh-CN',
    );
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.querySelector('input')?.getAttribute('placeholder')).not.toBe(
      '[object Object]',
    );
  });
});

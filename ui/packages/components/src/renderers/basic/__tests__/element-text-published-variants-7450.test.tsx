/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:text` speaks the published `variant` vocabulary (objectui#7450,
 * ruling B of 2026-09-07, the objectui half of the two-release landing routed
 * on 2026-09-09).
 *
 * ## What was measured before this file
 *
 * On `@objectstack/spec` 17.5.0, `ElementTextPropsSchema.variant` accepts the
 * nine values `ui:text` publishes plus the two pre-convergence spellings
 * `heading` / `subheading`. Against that contract `element:text` declared and
 * rendered only four: `h1`, `h4`-`h6` and `overline` rendered a `<p>` carrying
 * the `body` class (`h2` / `h3` the same), and the html tier refused all seven
 * with `invalid-enum`, which fails the whole page. The renderer swallowed what
 * the contract accepts, and the html tier refused it.
 *
 * ## What each block pins
 *
 *  - the nine render the way `ui:text` renders them: the same heading element
 *    for `h1`-`h6`, the same class for all nine, and a paragraph (not
 *    `ui:text`'s inline `<span>`) for `body` / `caption` / `overline`;
 *  - the two pre-convergence spellings, retired by the spec in 17.7.0, are
 *    refused at every objectui gate (objectui#11717);
 *  - absence still means `body` here, beside a `ui:text` control that still
 *    does not synthesise it (objectui#6942);
 *  - every objectui authoring gate accepts exactly the installed contract's set
 *    for this key: the registry `inputs` enum, the html tier compiled from it,
 *    and `safeValidateSchema` (the tolerant face).
 *
 * ## Derived, never restated
 *
 * The nine come from the `@object-ui/types` Zod mirror (`TextSchema`), the
 * accept set from `@objectstack/spec`'s `ElementTextPropsSchema`. The one
 * restated fact is which two spellings are the pre-convergence pair, now
 * named as the retired pair: the spec release that retires them
 * (objectstack#17109's mechanism) landed in 17.7.0, the first test went red as
 * it promised, and the follow-up it named is done (objectui#11717).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { compile, manifestFromConfigs } from '@object-ui/sdui-parser';
import { shapeEnumOptions } from '@object-ui/test-support';
import { TextSchema, safeValidateSchema } from '@object-ui/types/zod';
import { ElementTextPropsSchema } from '@objectstack/spec/ui';
// Module scope, not a hook: the cold transform is billed to the import phase,
// which has no test/hook timeout (AGENTS.md, objectui#3010).
import '../../../renderers';

const PUBLISHED = shapeEnumOptions(TextSchema, 'variant');
const CONTRACT = shapeEnumOptions(ElementTextPropsSchema, 'variant');
const PRE_CONVERGENCE = CONTRACT.filter((value) => !PUBLISHED.includes(value));
const HEADINGS = PUBLISHED.filter((value) => /^h[1-6]$/.test(value));
const PARAGRAPHS = PUBLISHED.filter((value) => !HEADINGS.includes(value));

const CONTENT = 'Quick links';

/** One rendered node through the real `SchemaRenderer` and registry. */
function renderNode(schema: Record<string, unknown>) {
  const { container, unmount } = render(<SchemaRenderer schema={schema as never} />);
  const element = container.firstElementChild as HTMLElement | null;
  const out = {
    tag: element?.tagName.toLowerCase(),
    classes: new Set((element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)),
    html: container.innerHTML,
    elementCount: container.children.length,
    text: container.textContent,
  };
  unmount();
  return out;
}

const elementText = (variant?: string) =>
  renderNode({ type: 'element:text', properties: { content: CONTENT, ...(variant ? { variant } : {}) } });
const uiText = (variant?: string) =>
  renderNode({ type: 'ui:text', content: CONTENT, ...(variant ? { variant } : {}) });

/** `element:text` always paints an alignment class; `ui:text` only when one is authored. */
const withoutAlign = (classes: Set<string>) =>
  [...classes].filter((cls) => !/^text-(left|center|right|justify)$/.test(cls)).sort();

/** The html tier's manifest, built the way `page.tsx` builds it: from every known type's `inputs`. */
function htmlTierManifest() {
  const configs = ComponentRegistry.getKnownTypes().map((type) => {
    const meta = ComponentRegistry.getMeta(type);
    return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
  });
  return manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0]);
}

function declaredVariantEnum(type: string): unknown[] {
  const input = ComponentRegistry.getMeta(type)?.inputs?.find((entry) => entry.name === 'variant');
  return (input?.enum ?? []).map((entry) =>
    typeof entry === 'object' && entry !== null ? (entry as { value: unknown }).value : entry,
  );
}

describe('objectui#7450 — the two vocabularies, read where they live', () => {
  it('the mirror publishes nine values and the installed contract accepts them plus the pre-convergence pair', () => {
    // Anti-vacuity: every table below iterates these arrays.
    expect(PUBLISHED).toHaveLength(9);
    expect(HEADINGS).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
    expect(PARAGRAPHS).toEqual(['body', 'caption', 'overline']);
    expect(CONTRACT).toEqual(expect.arrayContaining(PUBLISHED));
    // The spec release that retires the pair landed in 17.7.0 (objectui#11717):
    // they left the registry `inputs` enum and `VARIANT_CLASS` / `VARIANT_TAG`
    // in `elements.tsx`, and this expectation moved to `[]`, as it instructed.
    expect(PRE_CONVERGENCE).toEqual([]);
  });
});

describe('objectui#7450 — the nine render the way ui:text renders them', () => {
  it.each(HEADINGS)('%s renders the heading element it names, as ui:text does', (variant) => {
    const element = elementText(variant);
    expect(element.elementCount).toBe(1);
    expect(element.tag).toBe(variant);
    expect(element.tag).toBe(uiText(variant).tag);
    expect(element.text).toBe(CONTENT);
  });

  it.each(PARAGRAPHS)('%s renders a paragraph, the block element element:text has always used', (variant) => {
    expect(elementText(variant).tag).toBe('p');
    // The control that makes the line above a choice rather than an accident:
    // ui:text renders the same value inline.
    expect(uiText(variant).tag).toBe('span');
  });

  it.each(PUBLISHED)('%s carries exactly the class ui:text gives it', (variant) => {
    const ours = withoutAlign(elementText(variant).classes);
    expect(ours.length).toBeGreaterThan(0);
    expect(ours).toEqual(withoutAlign(uiText(variant).classes));
  });

  it('the nine are nine distinct renderings, so no value is swallowed into another', () => {
    const rendered = PUBLISHED.map((variant) => elementText(variant).html);
    expect(new Set(rendered).size).toBe(PUBLISHED.length);
  });
});

const RETIRED_PAIR = ['heading', 'subheading'] as const;

describe('objectui#11717 — the retired pair is refused at every objectui gate, as the contract refuses it', () => {
  it.each(RETIRED_PAIR)('the installed contract refuses %s on element:text', (variant) => {
    expect(ElementTextPropsSchema.safeParse({ content: CONTENT, variant }).success).toBe(false);
    expect(declaredVariantEnum('element:text')).not.toContain(variant);
  });

  it.each(RETIRED_PAIR)('the html tier refuses %s with invalid-enum', (variant) => {
    const { diagnostics } = compile(`<element:text content="${CONTENT}" variant="${variant}" />`, htmlTierManifest());
    expect(diagnostics.filter((d) => d.severity === 'error').map((d) => d.code)).toEqual(['invalid-enum']);
  });

  it.each(RETIRED_PAIR)('safeValidateSchema (the tolerant face) refuses %s on element:text', (variant) => {
    expect(safeValidateSchema({ type: 'element:text', properties: { content: CONTENT, variant } }).success).toBe(false);
  });

  it.each(RETIRED_PAIR)('a stored %s renders as body, the read site\'s answer for a value outside the contract', (variant) => {
    expect(elementText(variant).html).toBe(elementText('body').html);
  });
});

describe('objectui#7450 — absence is body on element:text, and only there', () => {
  it('an absent variant renders exactly what an authored body renders', () => {
    const absent = elementText();
    expect(absent.tag).toBe('p');
    expect(absent.html).toBe(elementText('body').html);
  });

  it('CONTROL — ui:text still does not synthesise body (objectui#6942)', () => {
    const absent = uiText();
    expect(absent.elementCount).toBe(0);
    expect(absent.text).toBe(CONTENT);
    expect(absent.html).not.toBe(uiText('body').html);
  });
});

describe('objectui#7450 — every objectui gate accepts exactly the installed contract', () => {
  it('the registry inputs enum is the contract accept set, member for member', () => {
    const declared = declaredVariantEnum('element:text');
    expect([...declared].sort()).toEqual([...CONTRACT].sort());
  });

  it('it leads with the nine, in the order ui:text declares them', () => {
    expect(declaredVariantEnum('element:text').slice(0, PUBLISHED.length)).toEqual(
      declaredVariantEnum('ui:text'),
    );
  });

  it.each(CONTRACT)('the html tier compiles variant %s', (variant) => {
    const { diagnostics } = compile(`<element:text content="${CONTENT}" variant="${variant}" />`, htmlTierManifest());
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('CONTROL — the html tier still refuses a value outside the contract', () => {
    const { diagnostics } = compile(`<element:text content="${CONTENT}" variant="title" />`, htmlTierManifest());
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('invalid-enum');
  });

  it.each(CONTRACT)('safeValidateSchema (the tolerant face) accepts variant %s on element:text', (variant) => {
    const result = safeValidateSchema({ type: 'element:text', properties: { content: CONTENT, variant } });
    expect(result.success).toBe(true);
  });

  it('CONTROL — safeValidateSchema refuses a value outside the contract', () => {
    const result = safeValidateSchema({ type: 'element:text', properties: { content: CONTENT, variant: 'title' } });
    expect(result.success).toBe(false);
  });
});

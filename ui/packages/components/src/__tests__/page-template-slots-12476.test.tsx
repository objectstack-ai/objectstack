/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A slotted template draws only the regions it places (objectui#12476,
 * maintainer ruling A on objectstack#23610).
 *
 * `@objectstack/spec` 18 declares each template's slots (`PAGE_TEMPLATE_SLOTS`)
 * and refuses, at `os validate` and at save, a region its template does not
 * place, and the retired `full-width` template. The page renderer used to stack
 * such a region under `main` at full width. It no longer draws it anywhere and
 * says so on the page instead; it never moves it into another slot. The
 * `dashboard` template keeps its open grid. A `kind: 'full'` page that names no
 * template is judged as `default` since objectui#12902
 * (`page-template-less-12902.test.tsx`); only a page of another kind keeps the
 * stacking, pinned below.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Module scope, not a hook: registers PageRenderer and `statistic`
// (AGENTS.md §测试纪律).
import '../renderers';

function tile(id: string) {
  return { type: 'statistic', id, label: id, value: 1 };
}

function region(name: string) {
  return { name, components: [tile(`in-${name}`)] };
}

function renderPage(schema: unknown) {
  return render(
    <ActionProvider>
      <SchemaRenderer schema={schema as never} />
    </ActionProvider>,
  );
}

/** The region element and its 12-column block grid (objectui#12624). */
function expectDrawnOnGrid(container: HTMLElement, name: string) {
  const el = container.querySelector(`[data-region="${name}"]`);
  expect(el, `region ${name}`).not.toBeNull();
  expect(el!.classList.contains('grid-cols-12')).toBe(true);
  expect(container.textContent).toContain(`in-${name}`);
}

function refusals(container: HTMLElement, kind: string) {
  return Array.from(container.querySelectorAll(`[data-page-refusal="${kind}"]`));
}

afterEach(() => cleanup());

/** Each slotted template, its slots, and a name it does not place. */
const SLOTTED: Array<[template: string, slots: string[], unplaced: string[]]> = [
  ['default', ['header', 'sidebar', 'main', 'aside', 'footer'], ['left_sidebar', 'content']],
  ['header-sidebar-main', ['header', 'sidebar', 'main'], ['aside', 'footer', 'right_sidebar']],
  ['three-column', ['header', 'sidebar', 'main', 'aside', 'footer'], ['left_sidebar', 'right_sidebar']],
];

describe('a slotted template does not stack a region it does not place (objectui#12476)', () => {
  it.each(SLOTTED)('%s: an unplaced region is drawn nowhere, and the page refuses it by name', (template, slots, unplaced) => {
    const { container } = renderPage({
      type: 'page',
      template,
      regions: [region('main'), ...unplaced.map(region)],
    });
    for (const name of unplaced) {
      expect(container.querySelector(`[data-region="${name}"]`), name).toBeNull();
      expect(container.textContent).not.toContain(`in-${name}`);
    }
    const [refusal, ...more] = refusals(container, 'unplaced-region');
    expect(more).toHaveLength(0);
    expect(refusal).toBeDefined();
    const items = Array.from(refusal.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(items).toHaveLength(unplaced.length);
    unplaced.forEach((name, i) => {
      expect(items[i]).toContain(`'${name}'`);
      expect(items[i]).toContain(`'${template}' places only ${slots.join(', ')}`);
    });
    // The page still draws what the template places.
    expectDrawnOnGrid(container, 'main');
  });

  it('default: a page with no placed region draws only the refusal', () => {
    const { container } = renderPage({
      type: 'page',
      template: 'default',
      regions: [region('kpis'), region('charts')],
    });
    expect(container.querySelector('[data-region]')).toBeNull();
    expect(refusals(container, 'unplaced-region')).toHaveLength(1);
    expect(refusals(container, 'unplaced-region')[0].querySelectorAll('li')).toHaveLength(2);
  });
});

describe('CONTROLS — what each template places still draws as before', () => {
  it.each(SLOTTED)('%s: every placed slot draws on its block grid, with no refusal', (template, slots) => {
    const { container } = renderPage({ type: 'page', template, regions: slots.map(region) });
    for (const name of slots) expectDrawnOnGrid(container, name);
    expect(container.querySelector('[data-page-refusal]')).toBeNull();
  });

  it('region names place case-insensitively, as the spec matches them', () => {
    const { container } = renderPage({
      type: 'page',
      template: 'three-column',
      regions: [region('Main'), region('ASIDE')],
    });
    expectDrawnOnGrid(container, 'Main');
    expectDrawnOnGrid(container, 'ASIDE');
    expect(container.querySelector('[data-page-refusal]')).toBeNull();
  });

  it('dashboard keeps its open grid: every non-header, non-footer region is a grid cell', () => {
    const { container } = renderPage({
      type: 'page',
      template: 'dashboard',
      regions: [region('header'), region('kpis'), region('charts'), region('main'), region('footer')],
    });
    const cells = container.querySelector('[data-template="dashboard"] .md\\:grid-cols-2')!;
    expect(cells).not.toBeNull();
    expect(Array.from(cells.children).map((c) => c.getAttribute('data-region'))).toEqual(['kpis', 'charts', 'main']);
    for (const name of ['header', 'kpis', 'charts', 'main', 'footer']) expectDrawnOnGrid(container, name);
    expect(container.querySelector('[data-page-refusal]')).toBeNull();
  });

  it.each(['record', 'home', 'app', 'utility'])(
    'a %s page of a kind the placement check does not judge still stacks an unnamed-slot region under main',
    (pageType) => {
      const { container } = renderPage({
        type: 'page',
        pageType,
        kind: 'slotted',
        regions: [region('main'), region('region_2')],
      });
      expectDrawnOnGrid(container, 'main');
      expectDrawnOnGrid(container, 'region_2');
      expect(container.querySelector('[data-page-refusal]')).toBeNull();
    },
  );
});

describe("the retired `full-width` template no longer resolves (objectui#12476)", () => {
  it.each(['full-width', 'two-column', 'constructor'])(
    '`template: %s` draws a refusal, not the page-type layout',
    (template) => {
      const { container } = renderPage({
        type: 'page',
        pageType: 'home',
        template,
        regions: [region('main')],
      });
      expect(container.querySelector('[data-region]')).toBeNull();
      expect(container.querySelector('[data-page-layout]')).toBeNull();
      const [refusal] = refusals(container, 'unregistered-template');
      expect(refusal).toBeDefined();
      expect(refusal.textContent).toContain(`'${template}'`);
    },
  );
});

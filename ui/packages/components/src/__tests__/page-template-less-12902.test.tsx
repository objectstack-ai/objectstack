/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A `kind: 'full'` page that names no template is judged as `default`
 * (objectui#12902).
 *
 * The spec's `checkPageRegionPlacement` reads `page.template ?? 'default'` and
 * refuses, at `os validate` and at save, a region that template does not place.
 * objectui#12476 made a slotted template refuse such a region on screen; the
 * `pageType` layouts, which a page that names no template takes, kept stacking
 * it under `main`. They now refuse it through the same `UnplacedRegionsRefusal`,
 * and every assertion below is tied to the spec's own check on the same page.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { checkPageRegionPlacement } from '@objectstack/spec/ui';
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

/** The region names the spec's own placement check refuses on this page. */
function specRefuses(page: { kind?: string; template?: string; regions: Array<{ name: string }> }): string[] {
  const refused: string[] = [];
  checkPageRegionPlacement(page as never, {
    addIssue: (issue: { path?: Array<string | number> }) => {
      const index = issue.path?.[1];
      if (typeof index === 'number') refused.push(page.regions[index].name);
    },
  } as never);
  return refused;
}

function refusalItems(container: HTMLElement): string[] {
  const refusals = Array.from(container.querySelectorAll('[data-page-refusal="unplaced-region"]'));
  expect(refusals.length).toBeLessThanOrEqual(1);
  return refusals.flatMap((r) => Array.from(r.querySelectorAll('li')).map((li) => li.textContent ?? ''));
}

afterEach(() => cleanup());

const PAGE_TYPES = ['record', 'home', 'app', 'utility'] as const;

describe('a template-less full page refuses a region `default` does not place (objectui#12902)', () => {
  it.each(PAGE_TYPES)('%s: region_2 is drawn nowhere and refused by name; main still draws', (pageType) => {
    const page = { type: 'page', pageType, regions: [region('main'), region('region_2')] };
    expect(specRefuses(page)).toEqual(['region_2']);

    const { container } = renderPage(page);
    expect(container.querySelector('[data-region="main"]')).not.toBeNull();
    expect(container.textContent).toContain('in-main');
    expect(container.querySelector('[data-region="region_2"]')).toBeNull();
    expect(container.textContent).not.toContain('in-region_2');
    const items = refusalItems(container);
    expect(items).toHaveLength(1);
    expect(items[0]).toContain("'region_2'");
  });

  it('an explicit `kind: full` is judged the same as an omitted kind', () => {
    const page = { type: 'page', pageType: 'home', kind: 'full', regions: [region('main'), region('region_2')] };
    expect(specRefuses(page)).toEqual(['region_2']);
    const { container } = renderPage(page);
    expect(container.querySelector('[data-region="region_2"]')).toBeNull();
    expect(refusalItems(container)).toHaveLength(1);
  });

  it('a page whose every region is unplaced draws only the refusal, one item per region', () => {
    const page = { type: 'page', pageType: 'app', regions: [region('region_1'), region('content')] };
    expect(specRefuses(page)).toEqual(['region_1', 'content']);
    const { container } = renderPage(page);
    expect(container.querySelector('[data-region]')).toBeNull();
    expect(refusalItems(container)).toHaveLength(2);
  });
});

describe('CONTROLS — a template-less page with placed regions renders as before', () => {
  it.each(PAGE_TYPES)('%s: main and aside draw, with no refusal', (pageType) => {
    const page = { type: 'page', pageType, regions: [region('main'), region('aside')] };
    expect(specRefuses(page)).toEqual([]);
    const { container } = renderPage(page);
    for (const name of ['main', 'aside']) {
      expect(container.querySelector(`[data-region="${name}"]`), name).not.toBeNull();
      expect(container.textContent).toContain(`in-${name}`);
    }
    expect(container.querySelector('[data-page-refusal]')).toBeNull();
  });

  it('every slot of `default` draws on a template-less page, with no refusal', () => {
    const page = {
      type: 'page',
      pageType: 'home',
      regions: ['header', 'sidebar', 'main', 'aside', 'footer'].map(region),
    };
    expect(specRefuses(page)).toEqual([]);
    const { container } = renderPage(page);
    for (const name of ['header', 'sidebar', 'main', 'aside', 'footer']) {
      expect(container.querySelector(`[data-region="${name}"]`), name).not.toBeNull();
    }
    expect(container.querySelector('[data-page-refusal]')).toBeNull();
  });
});

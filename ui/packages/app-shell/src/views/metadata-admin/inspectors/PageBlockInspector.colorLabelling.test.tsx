// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4010, the sibling call site — the PROPERTIES panel's `color` field.
 *
 * Audited alongside `DashboardWidgetInspector`'s `widget-color`, and only HALF
 * the same shape. Measured on `origin/main` before the change:
 *
 * ```
 *                                    label[for]        radiogroup accName
 * DashboardWidgetInspector  widget-color   → nothing         ''      ← dangling
 * PageBlockInspector        colorVariant   (no `for` at all) ''      ← anonymous
 * ```
 *
 * So nothing dangled here: this label never claimed an association, it simply
 * sat above the swatches as unowned text while the group went unnamed. The
 * defect's second half — an anonymous `role="radiogroup"` — was identical, and
 * is closed the same way: the label publishes an id, the group answers
 * `aria-labelledby`. That is the WAI-ARIA group pattern (objectui#3961/#3990),
 * not a `for`, because a group is not a labelable element.
 *
 * ## Why the id is minted per instance
 *
 * `renderField` runs in a LOOP (it recurses into `array` items with a
 * `keyPrefix`), so an id derived from the field name or its key repeats the
 * moment two rows carry the same property — and a duplicated id resolves
 * silently to the FIRST group, which is why the second describe renders two
 * panels and pins that each group answers to its own label. It is also why the
 * field is its own component: hooks cannot be called from `renderField`, which
 * is a function run in a loop rather than a component.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';

/**
 * A stable stub client — `PageBlockInspector` reaches `useObjectFields` /
 * `useObjectOptions` on mount, and a fresh object per call would re-fire their
 * effects forever (the reasoning in `PageBlockInspector.i18n.test.tsx`).
 */
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { PageBlockInspector } from './PageBlockInspector';

afterEach(cleanup);

const BLOCK_PATH = 'regions[0].components[0]';

/** A record page whose one block carries the curated `colorVariant` field. */
function metricDraft(): Record<string, unknown> {
  return PageSchema.parse({
    name: 'contact_record',
    label: 'Contact',
    type: 'record',
    object: 'contact',
    template: 'default',
    regions: [
      { name: 'main', components: [{ type: 'object-metric', id: 'b1', properties: { colorVariant: 'blue' } }] },
    ],
  }) as unknown as Record<string, unknown>;
}

function renderInspector(locale: 'en-US' | 'zh-CN' = 'en-US') {
  return render(
    <PageBlockInspector
      type="page"
      name="contact_record"
      draft={metricDraft()}
      selection={{ kind: 'block', id: BLOCK_PATH }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      readOnly={false}
      locale={locale as never}
    />,
  );
}

describe('PageBlockInspector — the color swatch group is named (objectui#4010)', () => {
  it('names the group with the visible label, resolved to that label NODE', () => {
    renderInspector();

    const group = screen.getByRole('radiogroup');
    const idref = group.getAttribute('aria-labelledby');
    // Truthy first: pre-fix both sides read `null` and a bare `toBe` would pass.
    expect(idref).toBeTruthy();

    const target = document.getElementById(idref!);
    expect(target).not.toBeNull();
    expect(target).toBe(screen.getByText('Color'));
    expect(target!.tagName).toBe('LABEL');
    // Exactly one element answers the id.
    expect(document.querySelectorAll(`[id="${idref}"]`)).toHaveLength(1);
    expect(group).toHaveAccessibleName('Color');
  });

  it('introduces no `for` aimed at the group', () => {
    // The failure mode this fix deliberately did NOT adopt: giving the container
    // an id so a `<label for>` resolves would satisfy a link-checker while
    // naming nothing, because `role="radiogroup"` is not labelable.
    renderInspector();
    const group = screen.getByRole('radiogroup');
    expect(group).not.toHaveAttribute('id');
    expect(group).not.toHaveAttribute('aria-label');
    // And no label anywhere in this panel points at an id nothing carries.
    const dangling = Array.from(document.querySelectorAll('label[for]')).filter(
      (l) => !document.getElementById(l.getAttribute('for')!),
    );
    expect(dangling).toEqual([]);
  });

  it('announces the translated label under zh-CN', () => {
    renderInspector('zh-CN');
    const group = screen.getByRole('radiogroup');
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)).toBe(screen.getByText('颜色'));
    expect(group).toHaveAccessibleName('颜色');
  });
});

describe('PageBlockInspector — two color fields do not share one label id', () => {
  it('gives each mounted group its OWN label, inside its own panel', () => {
    // A constant id — the field name, or `renderField`'s `keyPrefix`ed key —
    // would bind both groups to the FIRST label and still pass every assertion
    // in the describe above. `React.useId()` cannot be authored into a
    // collision; this is what proves the id is minted per instance.
    const { container: first } = renderInspector();
    const { container: second } = renderInspector();

    const groups = screen.getAllByRole('radiogroup');
    expect(groups).toHaveLength(2);

    const idrefs = groups.map((g) => g.getAttribute('aria-labelledby'));
    expect(idrefs.every(Boolean)).toBe(true);
    expect(new Set(idrefs).size).toBe(2);

    // Container ownership: each IDREF resolves to the label in ITS OWN panel,
    // not merely to some element carrying the same text (the #4788/#4824
    // reachability criterion — an accessible-name assertion alone is blind to
    // an IDREF that resolves into the wrong container).
    for (const [i, root] of [first, second].entries()) {
      const target = document.getElementById(idrefs[i]!)!;
      expect(target).toBe(within(root as HTMLElement).getByText('Color'));
      expect(root.contains(target)).toBe(true);
      expect(groups[i]).toHaveAccessibleName('Color');
    }
  });
});

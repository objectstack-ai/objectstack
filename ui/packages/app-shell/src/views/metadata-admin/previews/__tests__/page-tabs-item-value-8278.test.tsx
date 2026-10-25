// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8278 — the designer's `page:tabs` item control writes the key the
 * spec declares and the tabs renderer actually reads.
 *
 * ## What was broken
 *
 * `BLOCK_CONFIG['page:tabs']` named its identifier item control `key`;
 * `PageBlockInspector.renderField`'s array branch writes an item key VERBATIM
 * (`next[i] = { ...itemObj, [n]: v }`), so an author who filled that box got
 * `properties.items[i].key`. Three faces disagreed with that spelling:
 *
 *   - `ComponentPropsMap['page:tabs']` is strict and refuses `key` BY NAME at
 *     `items.0` (`unrecognized_keys`) — measured below, not asserted from prose;
 *   - `PageTabsRenderer` (`renderers/layout/containers.tsx`) builds
 *     `itemsWithValue` from `it.value` and reads `it.key` nowhere, so an item
 *     without `value` falls back to the index-derived `tab-${idx}`;
 *   - `PageTabsProps.items[].value` is a real, declared schema member, which
 *     `block-config.test.ts`'s `page:accordion` suite already states in prose.
 *
 * The consequence is the failure objectui#2257 exists to prevent: a tab strip
 * built in Studio carries no stable per-tab value, so `?tab=` addresses tabs by
 * INDEX and silently points at a different tab once the item list changes. The
 * author supplied a stable identifier; it landed under a key nothing reads.
 *
 * ## Why this file measures the round trip rather than the table
 *
 * A pin that grepped `BLOCK_CONFIG` for the string `value` would pass on a
 * table whose control name no renderer honours — the exact defect being fixed,
 * one rename later. So neither end is hard-coded: the key comes out of
 * `BLOCK_CONFIG` itself and the item is assembled the way `PageBlockInspector`
 * assembles it, then that item is put to BOTH judges — the spec's parser and
 * the registered renderer's DOM. A future rename on either face turns this red
 * instead of quietly re-opening the defect.
 *
 * The spec-face half also carries the ledger measurement that
 * `block-config-schema-parity-8216.test.ts` used to hold: this key was a LEDGER
 * row in objectui#8216's parity gate, and that row was deleted in this change
 * because the violation it recorded is resolved.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not a hook: the package's barrel registers the renderers as a
// side effect and the cost belongs to the import phase (AGENTS.md §测试纪律,
// object-ui/no-dynamic-import-in-test-hook).
import '@object-ui/components';
import { BLOCK_CONFIG, type BlockPropField } from '../block-config';

const BLOCK = 'page:tabs';

/** The `items` array field, read out of the designer table itself. */
function itemsField(): Extract<BlockPropField, { kind: 'array' }> {
  const f = (BLOCK_CONFIG[BLOCK] ?? []).find((x) => x.name === 'items');
  if (!f || f.kind !== 'array') throw new Error(`${BLOCK} has no \`items\` array field`);
  return f;
}

/** The item-object keys a designer build writes — the producer's own answer. */
const DESIGNER_ITEM_KEYS = itemsField().itemFields.map((f) => f.name);

/**
 * Build one item exactly as `PageBlockInspector.renderField`'s array branch
 * does — `next[i] = { ...itemObj, [n]: v }`, one commit per control, in table
 * order. Assembling it rather than writing a literal is what makes every row
 * below measure the PRODUCER instead of this file's opinion of it.
 */
function authorItem(values: readonly string[]): Record<string, unknown> {
  let item: Record<string, unknown> = {};
  DESIGNER_ITEM_KEYS.forEach((name, i) => {
    item = { ...item, [name]: values[i] };
  });
  return item;
}

/**
 * `children` is REQUIRED by `PageTabsProps.items[]` and is NOT one of these two
 * controls' business — a tab's contents come from the canvas's nested sub-block
 * editor, addressed as `…components[0].properties.items[0].children[0]`. It is
 * supplied here as the rest of the document supplies it, so the parse verdicts
 * below are about the two keys these controls DO write.
 */
const withChildren = (item: Record<string, unknown>) => ({ ...item, children: [] });

const tabsProps = ComponentPropsMap[BLOCK] as { safeParse: (v: unknown) => any };
const refusedKeys = (r: any): string[] =>
  r.success ? [] : r.error.issues.flatMap((i: any) => i.keys ?? []);

/**
 * `PageTabsRenderer` reads `schema.items` / `schema.defaultTab` at the TOP
 * level; `SchemaRenderer` hoists `properties.*` onto the schema before it gets
 * there (the renderer's own comment on the `alwaysShowStrip` dual read says so).
 * Rendering the registered component directly skips that hoist, so the flat
 * form is what a real page delivers either way.
 */
function renderTabs(items: unknown[], extra: Record<string, unknown> = {}) {
  const Component = ComponentRegistry.get(BLOCK);
  if (!Component) throw new Error(`Component "${BLOCK}" is not registered`);
  return render(<Component schema={{ type: BLOCK, items, ...extra }} />);
}

afterEach(cleanup);

describe('page:tabs — the designer item control writes a key the SPEC accepts (objectui#8278)', () => {
  it('CONTROL — the parser CAN refuse an item key by name, so an accept below means something', () => {
    // Without this row, "the authored item parses clean" could be true of a
    // schema that had quietly become passthrough and would read identically.
    const refused = tabsProps.safeParse({ items: [withChildren({ zzzNotAKey: 1, label: 'A' })] });
    expect(refused.success).toBe(false);
    expect(refusedKeys(refused)).toContain('zzzNotAKey');
  });

  it('CONTROL — the RETIRED spelling `key` is still refused, at `items.0`, by name', () => {
    // The defect's own measurement, kept so the rename cannot be read as "the
    // spec relaxed". `key` is refused today exactly as it was before.
    const refused = tabsProps.safeParse({ items: [withChildren({ key: 'overview', label: 'Overview' })] });
    expect(refused.success).toBe(false);
    expect(refusedKeys(refused)).toContain('key');
    expect(
      refused.error.issues.some(
        (i: any) => i.code === 'unrecognized_keys' && i.path.join('.') === 'items.0',
      ),
    ).toBe(true);
  });

  it('CONTROL — an item carrying no identifier at all parses clean', () => {
    // So the refusal above is about the KEY, not about the item shape.
    expect(tabsProps.safeParse({ items: [withChildren({ label: 'Overview' })] }).success).toBe(true);
  });

  it('the item an author builds through the designer table is ACCEPTED by the spec', () => {
    const parsed = tabsProps.safeParse({ items: [withChildren(authorItem(['overview', 'Overview']))] });
    expect(refusedKeys(parsed), 'a designer-authored tab item is refused by name').toEqual([]);
    expect(parsed.success).toBe(true);
  });
});

describe('page:tabs — the authored identifier reaches the RENDERER as the tab value (objectui#8278)', () => {
  const authored = () => [
    withChildren(authorItem(['overview', 'Overview'])),
    withChildren(authorItem(['history', 'History'])),
  ];

  it('CONTROL — the harness renders a tab strip at all', () => {
    // Without this row every assertion below could fail for a broken harness
    // (renderer unregistered, DOM not mounted) and read as the key defect.
    const { getAllByRole, queryByText } = renderTabs(authored());
    expect(getAllByRole('tab')).toHaveLength(2);
    expect(queryByText('Overview')).toBeTruthy();
    expect(queryByText('History')).toBeTruthy();
  });

  it('CONTROL — an item WITHOUT the identifier really does fall back to `tab-IDX`', () => {
    // The defect's signature, and what makes the row below a measurement: if
    // the fallback did not exist, honouring an authored value would be
    // indistinguishable from honouring nothing.
    const onTabChange = vi.fn();
    const { getAllByRole } = renderTabs(
      [withChildren({ label: 'Overview' }), withChildren({ label: 'History' })],
      { onTabChange },
    );
    fireEvent.mouseDown(getAllByRole('tab')[1], { button: 0 });
    expect(onTabChange).toHaveBeenCalledWith('tab-1');
  });

  it('reports the AUTHORED value on tab change — not the index-derived one', () => {
    const onTabChange = vi.fn();
    const { getAllByRole } = renderTabs(authored(), { onTabChange });
    fireEvent.mouseDown(getAllByRole('tab')[1], { button: 0 });
    expect(onTabChange).toHaveBeenCalledWith('history');
    expect(onTabChange).not.toHaveBeenCalledWith('tab-1');
  });

  it('is URL-ADDRESSABLE by the authored value — the objectui#2257 consequence', () => {
    // `?tab=` restores the active tab through `defaultTab`. This is the whole
    // reason the key has to be one the renderer reads: an index value silently
    // points at a different tab once the item list changes.
    const { getAllByRole } = renderTabs(authored(), { defaultTab: 'history' });
    const selected = getAllByRole('tab').filter((el) => el.getAttribute('data-state') === 'active');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('History');
  });

  it('CONTROL — `defaultTab` naming the RETIRED spelling selects nothing, so the row above is live', () => {
    // A document saved by a released build carries `items[].key`; addressing a
    // tab by that value has never worked and still does not. Without this row,
    // the assertion above could pass merely because the first tab is the
    // default whatever `defaultTab` says.
    const { getAllByRole } = renderTabs(authored(), { defaultTab: 'no-such-tab' });
    const selected = getAllByRole('tab').filter((el) => el.getAttribute('data-state') === 'active');
    expect(selected[0].textContent).toContain('Overview');
  });
});

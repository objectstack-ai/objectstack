// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { RecordLineItemsProps } from '@objectstack/spec/ui';

import * as pages from '../src/ui/pages/index.js';
import { ProjectDetailPage } from '../src/ui/pages/index.js';
import { Task } from '../src/data/objects/task.object.js';

/**
 * Dogfood gate for the project page's Tasks grid (objectstack#21142).
 *
 * The `record:line_items` block on this page keyed all five of its columns
 * `field`. objectui's line-items grid binds a column by `name` — the spelling
 * objectui#3951 settled, with no tolerant alias — so every cell rendered
 * empty, and nothing said so: the type had no `ComponentPropsMap` row, so the
 * component-props gate skipped its props as unregistered.
 *
 * The assertions pin both halves:
 *  - the five columns are keyed `name`, each naming a field of the child
 *    object the grid lists, and the block parses against the spec's row;
 *  - no `record:line_items` column anywhere in the showcase carries `field`.
 */

type AnyComponent = {
  type?: unknown;
  properties?: Record<string, unknown>;
  [k: string]: unknown;
};

/** Every component on a page — regions and slots alike, tab panels and children included. */
function allComponents(page: Record<string, unknown>): AnyComponent[] {
  const out: AnyComponent[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const component = node as AnyComponent;
    out.push(component);
    const props = component.properties;
    if (!props) return;
    for (const item of Array.isArray(props.items) ? props.items : []) {
      const children = (item as { children?: unknown })?.children;
      for (const child of Array.isArray(children) ? children : []) visit(child);
    }
    for (const child of Array.isArray(props.children) ? props.children : []) visit(child);
  };
  for (const region of (page.regions as { components?: unknown[] }[] | undefined) ?? []) {
    for (const c of region.components ?? []) visit(c);
  }
  for (const slot of Object.values((page.slots as Record<string, unknown>) ?? {})) {
    for (const c of Array.isArray(slot) ? slot : [slot]) visit(c);
  }
  return out;
}

const lineItemBlocks = (page: Record<string, unknown>): AnyComponent[] =>
  allComponents(page).filter((c) => c.type === 'record:line_items');

const columnsOf = (block: AnyComponent): Record<string, unknown>[] =>
  (Array.isArray(block.properties?.columns) ? block.properties!.columns : []) as Record<string, unknown>[];

/** Every page the showcase exports. */
const allPages = (Object.values(pages) as unknown[]).filter(
  (p) =>
    !!p && typeof p === 'object' && !Array.isArray(p) && typeof (p as { name?: unknown }).name === 'string',
) as Record<string, unknown>[];

describe('Project detail — the Tasks grid binds its columns by `name` (#21142)', () => {
  const [block, ...rest] = lineItemBlocks(ProjectDetailPage as unknown as Record<string, unknown>);

  it('carries one line-items block whose five columns are keyed `name`', () => {
    expect(block, 'the project detail page must carry its Tasks grid').toBeTruthy();
    expect(rest).toHaveLength(0);
    const columns = columnsOf(block);
    expect(columns.map((c) => c.name)).toEqual(['title', 'status', 'priority', 'estimate_hours', 'due_date']);
    for (const column of columns) expect(column).not.toHaveProperty('field');
  });

  it('names a field of the child object in every column, and in the summed column', () => {
    const props = block.properties!;
    expect(props.childObject).toBe(Task.name);
    const childFields = new Set(Object.keys(Task.fields ?? {}));
    for (const column of columnsOf(block)) {
      expect(childFields.has(column.name as string), `column '${String(column.name)}' must name a showcase_task field`).toBe(true);
    }
    expect(childFields.has(props.relationshipField as string)).toBe(true);
    expect(columnsOf(block).map((c) => c.name)).toContain(props.amountField);
  });

  it('parses against the spec\'s `record:line_items` row with its keys intact', () => {
    const result = RecordLineItemsProps.safeParse(block.properties);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data).toEqual(block.properties);
  });

  it('leaves no `field`-keyed line-items column anywhere in the showcase', () => {
    for (const page of allPages) {
      for (const lineItems of lineItemBlocks(page)) {
        for (const column of columnsOf(lineItems)) {
          expect(column, `page "${String(page.name)}" must key its line-items columns by \`name\``).not.toHaveProperty('field');
          expect(typeof column.name).toBe('string');
        }
      }
    }
  });
});

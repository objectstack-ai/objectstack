// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { PageHeaderProps, RecordRelatedListProps } from '@objectstack/spec/ui';

import stack from '../objectstack.config.js';
import { Task } from '../src/data/objects/task.object.js';

/**
 * Fixture gate: the showcase hosts the three record action locations for
 * `showcase_task` (objectstack#22030).
 *
 * `records-forms.action-location-matrix` reads actions at `record_header`,
 * `record_more` and `record_related` on `showcase_task`. A location needs a
 * surface on a page the console actually renders, and the showcase had none:
 *
 *  - Task Detail is `kind: 'full'`. Such a page renders exactly the nodes it
 *    declares, and it declared no `page:header`, so there was no title bar for
 *    `record_header` actions and no ⋯ overflow for `record_more` ones.
 *  - Project Detail overrides the `tabs` slot with a `record:line_items` grid.
 *    That slot is a full replacement, so the synthesized Tasks related list
 *    went with it, and `record_related` actions render only on the rows of a
 *    related list inside a parent record.
 *
 * The assertions pin each host on the page the console picks for the object,
 * and hold the authored lists equal to the declarations they copy, so a new
 * action or a changed FK cannot leave a host silently stale.
 */

type AnyComponent = {
  type?: unknown;
  properties?: Record<string, unknown>;
  [k: string]: unknown;
};
type AnyPage = Record<string, unknown> & { name?: unknown; type?: unknown; object?: unknown };
type AnyAction = { name?: unknown; type?: unknown; objectName?: unknown; locations?: unknown };

/** Every component on a page — regions and slots alike, tab panels and children included. */
function allComponents(page: AnyPage): AnyComponent[] {
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

const pages = (stack.pages ?? []) as AnyPage[];

/**
 * The record page the console renders for an object: the FIRST `type: 'record'`
 * page bound to it, in declaration order (objectui `usePageAssignment`). A
 * second page for the same object would never be reached, so the hosts must sit
 * on this one.
 */
const recordPageFor = (object: string): AnyPage | undefined =>
  pages.find((p) => p.type === 'record' && p.object === object);

const taskActions = ((stack.actions ?? []) as AnyAction[]).filter((a) => a.objectName === Task.name);
const locationsOf = (a: AnyAction): string[] =>
  Array.isArray(a.locations) ? (a.locations as string[]) : [];
const declares = (location: string) => (a: AnyAction): boolean => locationsOf(a).includes(location);
const actionNamed = (name: string): AnyAction | undefined => taskActions.find((a) => a.name === name);

describe('showcase_task record action locations have a stock host (#22030)', () => {
  const taskPage = recordPageFor(Task.name);
  const projectPage = recordPageFor('showcase_project');

  it('the console picks Task Detail for a task and Project Detail for a project', () => {
    expect(taskPage?.name).toBe('showcase_task_detail');
    expect(projectPage?.name).toBe('showcase_project_detail');
  });

  describe('record_header / record_more — the Task Detail title bar', () => {
    const headers = taskPage ? allComponents(taskPage).filter((c) => c.type === 'page:header') : [];
    const ids = (headers[0]?.properties?.actions ?? []) as unknown[];

    it('composes exactly one page:header, first in the page', () => {
      expect(headers).toHaveLength(1);
      const firstRegion = (taskPage?.regions as { components?: unknown[] }[] | undefined)?.[0];
      expect(firstRegion?.components?.[0]).toBe(headers[0]);
    });

    it('parses against the spec\'s `page:header` row, with its action ids intact', () => {
      const result = PageHeaderProps.safeParse(headers[0]?.properties);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      expect(result.data?.actions).toEqual(ids);
    });

    it('lists the task\'s whole record_header / record_more set — what the synthesized header carries', () => {
      expect(ids.every((id) => typeof id === 'string')).toBe(true);
      expect(new Set(ids).size, 'no id is listed twice').toBe(ids.length);
      const headerSet = taskActions
        .filter((a) => declares('record_header')(a) || declares('record_more')(a))
        .map((a) => a.name as string);
      expect([...ids].sort()).toEqual([...headerSet].sort());
    });

    it('hosts at least one action at each location, and a url and an api action under the ⋯ overflow', () => {
      const listed = ids.map((id) => actionNamed(id as string)).filter((a): a is AnyAction => !!a);
      expect(listed).toHaveLength(ids.length);
      expect(listed.filter(declares('record_header')).length).toBeGreaterThan(0);
      // The overflow takes every action declaring record_more WITHOUT
      // record_header, whatever the inline budget.
      const overflowOnly = listed.filter((a) => declares('record_more')(a) && !declares('record_header')(a));
      expect(overflowOnly.map((a) => a.type)).toEqual(expect.arrayContaining(['url', 'api']));
    });
  });

  describe('record_related — the Tasks related list on a project', () => {
    const relatedLists = projectPage
      ? allComponents(projectPage).filter(
          (c) => c.type === 'record:related_list' && c.properties?.objectName === Task.name,
        )
      : [];
    const props = relatedLists[0]?.properties ?? {};
    const fk = (Task.fields as Record<string, Record<string, unknown>>)[props.relationshipField as string];

    it('carries one Tasks related list, bound through the task\'s master-detail FK to the project', () => {
      expect(relatedLists).toHaveLength(1);
      expect(props.relationshipField).toBe('project');
      expect(fk?.type).toBe('master_detail');
      expect(fk?.reference).toBe('showcase_project');
    });

    it('authors no `actions`, so its rows carry the host\'s list_item + record_related actions', () => {
      expect(relatedLists).toHaveLength(1);
      expect(props).not.toHaveProperty('actions');
      expect(taskActions.filter(declares('record_related')).length).toBeGreaterThan(0);
    });

    it('repeats the FK\'s relatedListTitle / relatedListColumns verbatim', () => {
      // Both sides must exist: two absent values would compare equal.
      expect(typeof fk?.relatedListTitle).toBe('string');
      expect(Array.isArray(fk?.relatedListColumns)).toBe(true);
      expect(props.title).toBe(fk?.relatedListTitle);
      expect(props.columns).toEqual(fk?.relatedListColumns);
    });

    it('parses against the spec\'s `record:related_list` row', () => {
      const result = RecordRelatedListProps.safeParse(props);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });
  });
});

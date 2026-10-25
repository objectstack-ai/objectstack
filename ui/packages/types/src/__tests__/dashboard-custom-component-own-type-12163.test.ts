/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12163 (ruling C, comment 6121298298) — a dashboard widget's legacy
 * `component` envelope takes a `metric-card` node and nothing else, and says so.
 *
 * ## The defect this closes
 *
 * The slot's second arm was passthrough `BaseSchema`. The strict authoring face
 * closed it to the base keys, so a `custom` widget's `{ type: 'text', content }`
 * node was refused for `content` as an unrecognized key — the strict face told an
 * author to empty a node (the objectui#5250 defect) — while the tolerant face kept
 * any node at all.
 *
 * ## What the ruling put in its place
 *
 * The slot takes the one component node objectstack#8593 admits. Every other node
 * is refused BY NAME: one `custom` issue at the slot's own path, naming the node it
 * refuses, from the slot's refusal arm alone (no `invalid_union`, nothing from the
 * component arm). The TypeScript twin narrows to the same accept set. objectui#11709's
 * routing step is unchanged, so a `metric-card` is still judged by its arm alone.
 *
 * Each refusal pin reads the zod issue `code`, its path and the node it names
 * (AGENTS.md: assert the subject, not the prose), never a bare `success === false`.
 */

import { describe, it, expect } from 'vitest';
import type { DashboardWidgetSchema, DashboardWidgetSlotComponentSchema } from '../complex.js';
import { AnyComponentSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';

interface Issue {
  code: string;
  path: PropertyKey[];
  message: string;
  keys?: string[];
  errors?: Issue[][];
}

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;

interface Parser { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }

/** Every issue in the tree, union arms included, with its path rebased onto its union's node. */
const flatIssues = (schema: Parser, doc: unknown): Issue[] => {
  const result = schema.safeParse(doc);
  if (result.success) return [];
  const out: Issue[] = [];
  const walk = (issues: Issue[], prefix: PropertyKey[]) => {
    for (const issue of issues) {
      const path = [...prefix, ...issue.path];
      out.push({ ...issue, path });
      for (const arm of issue.errors ?? []) walk(arm, path);
    }
  };
  walk(result.error!.issues as Issue[], []);
  return out;
};

const at = (issues: Issue[], path: string) => issues.filter((issue) => issue.path.map(String).join('.') === path);

const FACES = [['strict', StrictAnyComponentSchema], ['tolerant', AnyComponentSchema]] as const;

const custom = (component: unknown) => ({ type: 'dashboard', widgets: [{ id: 'w', type: 'custom', component }] });

describe('objectui#12163 — the envelope refuses every node but a `metric-card`, by name, on both faces', () => {
  it.each([
    ['text', { type: 'text', content: 'hi' }, 'content'],
    ['statistic', { type: 'statistic', label: 'Revenue', value: 42 }, 'value'],
    ['text, with an unknown key', { type: 'text', content: 'hi', zzz: 1 }, 'content'],
    ['chart', { type: 'chart', chartType: 'bar' }, 'chartType'],
  ])('`%s`: one `custom` issue at the slot names the node; the node\'s own key is not reported', (_name, component, own) => {
    const type = (component as { type: string }).type;
    for (const [face, schema] of FACES) {
      const issues = flatIssues(schema, custom(component));
      const slot = at(issues, 'widgets.0.component');
      expect(slot.map((issue) => issue.code), face).toEqual(['custom']);
      expect(slot[0].message, face).toContain(`\`${type}\` node`);
      // The refusal arm is the slot's whole answer: nothing below the slot, no union at it.
      expect(issues.filter((issue) => issue.path.map(String).join('.').startsWith('widgets.0.component.')), face).toEqual([]);
      expect(issues.some((issue) => issue.code === 'unrecognized_keys' && (issue.keys ?? []).includes(own)), face).toBe(false);
    }
  });

  it.each([
    ['a string', 'hi', 'a string value'],
    ['a number', 5, 'a number value'],
    ['a node with no `type`', { content: 'hi' }, 'a node with no `type`'],
  ])('%s in the slot is refused by name too', (_name, component, named) => {
    for (const [face, schema] of FACES) {
      const slot = at(flatIssues(schema, custom(component)), 'widgets.0.component');
      expect(slot.map((issue) => issue.code), face).toEqual(['custom']);
      expect(slot[0].message, face).toContain(named);
    }
  });

  it('a typeless legacy envelope (`{ id, component }`) answers the same way', () => {
    const doc = { type: 'dashboard', widgets: [{ id: 'w', component: { type: 'card', title: 'Playbook' } }] };
    for (const [face, schema] of FACES) {
      const slot = at(flatIssues(schema, doc), 'widgets.0.component');
      expect(slot.map((issue) => issue.code), face).toEqual(['custom']);
      expect(slot[0].message, face).toContain('`card` node');
    }
  });

  it('CONTROL (objectui#11709) — a `metric-card` is judged by its arm alone: a refused key is refused at that key, `layout` parses', () => {
    for (const [face, schema] of FACES) {
      const labelled = flatIssues(schema, custom({ type: 'metric-card', value: '1', label: 'Revenue' }));
      expect(at(labelled, 'widgets.0.component.label').map((issue) => issue.code), face).toEqual(['invalid_type']);
      expect(at(labelled, 'widgets.0.component').filter((issue) => issue.code === 'custom'), face).toEqual([]);
      expect(schema.safeParse(custom({ type: 'metric-card', value: '1', layout: { x: 0, y: 0, w: 2, h: 2 } })).success, face).toBe(true);
      expect(schema.safeParse(custom({ type: 'metric-card', title: 'Revenue', value: '$1' })).success, face).toBe(true);
    }
    const unknown = flatIssues(StrictAnyComponentSchema, custom({ type: 'metric-card', value: '1', zzz: 1 }));
    expect(at(unknown, 'widgets.0.component').find((issue) => issue.code === 'unrecognized_keys')?.keys).toEqual(['zzz']);
  });

  it('the TypeScript twin carries the same accept set: `metric-card` only', () => {
    const slot: Equal< NonNullable< DashboardWidgetSchema['component'] >, DashboardWidgetSlotComponentSchema > = true;
    expect(slot).toBe(true);
    const ok: DashboardWidgetSchema = { id: 'w', component: { type: 'metric-card', value: '1' } };
    // @ts-expect-error — TS2322: the slot takes a `metric-card` node only (objectui#12163).
    const text: DashboardWidgetSchema = { id: 'w', type: 'custom', component: { type: 'text', content: 'hi' } };
    expect([ok.id, text.id]).toEqual(['w', 'w']);
  });
});

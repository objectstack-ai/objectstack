/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27504 — the served packaged-action activation, consumer side.
 *
 * The object reads serve `disabledActions` beside the document; the data layer
 * stamps the named entries, and the action gates stop offering them. These
 * pins hold the stamp's two promises (it survives a spread, it never reaches
 * JSON) and the engine's gate.
 */

import { describe, it, expect } from 'vitest';
import {
  ACTION_SWITCHED_OFF_KEY,
  isActionSwitchedOff,
  markSwitchedOffActions,
  markSwitchedOffActionsByObject,
} from '../action-activation';
import { ActionEngine } from '../../actions/ActionEngine';

const task = () => ({
  name: 'showcase_task',
  actions: [
    { name: 'showcase_mark_done', label: 'Mark Done', locations: ['record_header'] },
    { name: 'showcase_log_time', label: 'Log Time', locations: ['record_header'] },
  ],
});

describe('markSwitchedOffActions (objectstack#27504)', () => {
  it('stamps exactly the served names', () => {
    const schema = markSwitchedOffActions(task(), ['showcase_mark_done']);
    expect(isActionSwitchedOff(schema.actions[0])).toBe(true);
    expect(isActionSwitchedOff(schema.actions[1])).toBe(false);
  });

  it('stamps nothing when no list was served — an older backend hides nothing', () => {
    for (const served of [undefined, null, {}, 'showcase_mark_done', []]) {
      const schema = markSwitchedOffActions(task(), served);
      expect(schema.actions.some(isActionSwitchedOff)).toBe(false);
    }
  });

  it('survives a spread (a localized or promoted action) and never reaches JSON', () => {
    const schema = markSwitchedOffActions(task(), ['showcase_mark_done']);
    const localized = { ...schema.actions[0], label: '标记为完成' };
    expect(isActionSwitchedOff(localized)).toBe(true);
    expect(Object.keys(schema.actions[0])).not.toContain(String(ACTION_SWITCHED_OFF_KEY));
    expect(JSON.parse(JSON.stringify(schema))).toEqual(task());
  });

  it('the list form stamps each object from its own entry', () => {
    const project = { name: 'showcase_project', actions: [{ name: 'showcase_mark_done' }] };
    const objects = [task(), project];
    markSwitchedOffActionsByObject(objects, { showcase_task: ['showcase_mark_done'] });
    expect(isActionSwitchedOff(objects[0].actions[0])).toBe(true);
    expect(isActionSwitchedOff(project.actions[0])).toBe(false);
  });
});

describe('ActionEngine — a switched-off action is not offered (objectstack#27504)', () => {
  it('leaves it out of its location and of the bulk set', () => {
    const schema = markSwitchedOffActions(task(), ['showcase_mark_done']);
    const engine = new ActionEngine({ user: { id: 'u1' } } as any);
    for (const action of schema.actions) {
      engine.registerAction(action as any, { locations: ['record_section'], bulkEnabled: true });
    }
    expect(engine.getActionsForLocation('record_section').map((a) => a.name)).toEqual(['showcase_log_time']);
    expect(engine.getBulkActions().map((a) => a.name)).toEqual(['showcase_log_time']);
  });
});

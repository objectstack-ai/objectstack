// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11786 — which bodies Studio's autosave HOLDS instead of sending.
 *
 * The card: switching a field to Picklist, picking Lookup, or adding a Notify
 * step showed a red refusal before the author could fill it in. Those are
 * incomplete-but-normal states. The pillars now hold such a body unsent and
 * name what it needs; errors stay for what the author finished.
 *
 * These pins read the two predicates. Each asks the judge that would refuse the
 * body, so every "held" case below is paired with the judge's own verdict on
 * the same body (the door refuses it, or the spec's flow parse does), and every
 * "not held" case with a body that judge lets through: the hold is never
 * stricter than the contract. The pillars that act on them are pinned in
 * `DataPillar.heldIncomplete-11786.test.tsx` and
 * `AutomationsPillar.heldIncomplete-11786.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { assertObjectMetadataWritable } from '@object-ui/data-objectstack';
import { FlowSchema } from '@objectstack/spec/automation';
import { flowHeldEdit, objectHeldEdit } from './metadataError';
import { tFormat } from '../metadata-admin/i18n';

/** Does the object write guard (the door) refuse `body`? */
function doorRefuses(body: Record<string, unknown>): boolean {
  try {
    assertObjectMetadataWritable('object', body, 'pin');
    return false;
  } catch {
    return true;
  }
}

/** The issue paths the spec's flow parse refuses `flow` at, as the server reports them. */
function flowParseRefusals(flow: Record<string, unknown>): string[] {
  const result = FlowSchema.safeParse(flow);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

const task = (fields: unknown) => ({ name: 'showcase_task', label: 'Task', fields });

describe('the Data pillar holds what the write guard refuses (objectui#11786)', () => {
  it('a field switched to Picklist with no options: held, naming the field by its label', () => {
    const body = task([
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'field_2', label: 'Status', type: 'select' },
    ]);
    expect(doorRefuses(body)).toBe(true);
    expect(objectHeldEdit(body, 'en')).toEqual({
      clause: tFormat('engine.studio.held.needsOptions', 'en', { field: 'Status' }),
      target: { kind: 'field', id: 'field_2' },
    });
  });

  it('a field switched to Lookup with no target: held, naming what it needs', () => {
    const body = task({ owner: { label: 'Owner', type: 'lookup' } });
    expect(doorRefuses(body)).toBe(true);
    expect(objectHeldEdit(body, 'en')).toEqual({
      clause: tFormat('engine.studio.held.needsTarget', 'en', { field: 'Owner' }),
      target: { kind: 'field', id: 'owner' },
    });
  });

  it('the first field the guard refuses is the one named, in the guard\'s order', () => {
    const body = task({
      ok: { label: 'Ok', type: 'select', options: [{ value: 'a', label: 'A' }] },
      account: { label: 'Account', type: 'master_detail', reference: '   ' },
      kind: { label: 'Kind', type: 'radio', options: [] },
    });
    expect(objectHeldEdit(body, 'en')?.target).toEqual({ kind: 'field', id: 'account' });
  });

  it('zh: the clause reads in the designer locale', () => {
    const body = task({ status: { label: 'Status', type: 'select' } });
    expect(objectHeldEdit(body, 'zh-CN')?.clause).toBe(
      tFormat('engine.studio.held.needsOptions', 'zh-CN', { field: 'Status' }),
    );
  });

  // CONTROLS: bodies the door lets through are sent.
  it('an option, or a shared picklist, or a target: not held', () => {
    for (const body of [
      task({ status: { label: 'Status', type: 'select', options: [{ value: 'open', label: 'Open' }] } }),
      task({ status: { label: 'Status', type: 'select', picklist: 'task_status' } }),
      task({ owner: { label: 'Owner', type: 'lookup', reference: 'sys_user' } }),
      task({ title: { label: 'Title', type: 'text' } }),
      { name: 'showcase_task', label: 'Task' },
    ]) {
      expect(doorRefuses(body)).toBe(false);
      expect(objectHeldEdit(body, 'en')).toBeNull();
    }
  });

  it('a refused field the editor cannot select (an unnamed array entry) is not held: its refusal shows', () => {
    const body = task([{ label: 'Status', type: 'select' }]);
    expect(doorRefuses(body)).toBe(true);
    expect(objectHeldEdit(body, 'en')).toBeNull();
  });
});

/** The draft Studio sends after "New automation" and one Notify added on its edge. */
function flowWithNotify(config: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    name: 'notify_probe',
    label: 'Notify probe',
    type: 'autolaunched',
    status: 'obsolete',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'end', type: 'end', label: 'End' },
      { id: 'notify_1', type: 'notify', label: 'Notify', ...(config ? { config } : {}) },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'notify_1' },
      { id: 'edge', source: 'notify_1', target: 'end' },
    ],
  };
}

describe('the Automations pillar holds a step the spec refuses for a missing input (objectui#11786)', () => {
  it('a fresh Notify (the canvas seed) is held for its Title, the one key the flow parse refuses', () => {
    const flow = flowWithNotify({ channels: ['inbox'], recipients: [] });
    // The 422 a fresh Notify draws, measured on the installed spec: one issue,
    // at its title. An empty recipient list is not refused.
    expect(flowParseRefusals(flow)).toEqual(['nodes.2.config.title']);
    expect(flowHeldEdit(flow, 'en')).toEqual({
      clause: tFormat('engine.studio.held.needsInput', 'en', { input: 'Title', step: 'Notify' }),
      target: { kind: 'node', id: 'notify_1' },
    });
  });

  it('a step with no label is named by its id', () => {
    const flow = flowWithNotify({ channels: ['inbox'], recipients: [] });
    (flow.nodes as Array<Record<string, unknown>>)[2].label = '  ';
    expect(flowHeldEdit(flow, 'en')?.clause).toBe(
      tFormat('engine.studio.held.needsInput', 'en', { input: 'Title', step: 'notify_1' }),
    );
  });

  it('a missing recipient key is held too, by the same judge', () => {
    const flow = flowWithNotify({ title: 'Approved' });
    expect(flowParseRefusals(flow)).toEqual(['nodes.2.config.recipients']);
    expect(flowHeldEdit(flow, 'en')?.clause).toBe(
      tFormat('engine.studio.held.needsInput', 'en', { input: 'Recipients', step: 'Notify' }),
    );
  });

  // CONTROLS: what the flow parse accepts is sent.
  it('a filled Notify, or a template in its place: not held', () => {
    for (const config of [
      { channels: ['inbox'], recipients: [], title: 'Approved' },
      { channels: ['inbox'], recipients: [], template: 'approval_done' },
    ]) {
      const flow = flowWithNotify(config);
      expect(flowParseRefusals(flow)).toEqual([]);
      expect(flowHeldEdit(flow, 'en')).toBeNull();
    }
  });

  it('a BLANK Title: the flow parse refuses it since `@objectstack/spec` 18, and it is held like a missing one (objectui#12343)', () => {
    // Through 17.x a blank title was a value: accepted, and sent. 18 refuses a
    // blank Notify title at the title (objectui#12030 pinned it sent, PENDING).
    // A title the author emptied is held like an absent one, as objectui#11951
    // ruled for a widget's emptied binding. Blank is the spec's own notion
    // (`trim()` empty): `''`, and the spaces a cleared-then-retyped control
    // leaves (the inspector deletes a `''` it is handed, so spaces are the
    // reachable case).
    for (const title of ['', '   ', '\t']) {
      const flow = flowWithNotify({ channels: ['inbox'], recipients: ['owner'], title });
      expect(flowParseRefusals(flow)).toEqual(['nodes.2.config.title']);
      expect(flowHeldEdit(flow, 'en')).toEqual({
        clause: tFormat('engine.studio.held.needsInput', 'en', { input: 'Title', step: 'Notify' }),
        target: { kind: 'node', id: 'notify_1' },
      });
    }
  });

  it('zh: a BLANK Title is held, named by the inspector\'s zh label (objectui#12343)', () => {
    const flow = flowWithNotify({ channels: ['inbox'], recipients: ['owner'], title: ' ' });
    expect(flowParseRefusals(flow)).toEqual(['nodes.2.config.title']);
    expect(flowHeldEdit(flow, 'zh-CN')).toEqual({
      clause: tFormat('engine.studio.held.needsInput', 'zh-CN', { input: '标题', step: 'Notify' }),
      target: { kind: 'node', id: 'notify_1' },
    });
  });

  // CONTROLS (objectui#12343): the hold is no stricter than the flow parse.
  it('a filled Title, a `{{ }}` template Title, or a template in its place: not held', () => {
    for (const config of [
      { channels: ['inbox'], recipients: ['owner'], title: 'Approved' },
      { channels: ['inbox'], recipients: ['owner'], title: '{{ record.name }} approved' },
      { channels: ['inbox'], recipients: ['owner'], template: 'approval_done' },
    ]) {
      const flow = flowWithNotify(config);
      expect(flowParseRefusals(flow)).toEqual([]);
      expect(flowHeldEdit(flow, 'en')).toBeNull();
    }
  });

  it('a Title the parse refuses for what it holds, not for being blank text, is not held: its refusal shows', () => {
    // `null` (written through Advanced JSON) is refused at the title as a value
    // of the wrong kind; it is not a blank the inspector offers to fill.
    const flow = flowWithNotify({ channels: ['inbox'], recipients: ['owner'], title: null });
    expect(flowParseRefusals(flow)).toEqual(['nodes.2.config.title']);
    expect(flowHeldEdit(flow, 'en')).toBeNull();
  });

  it('a BLANK Title on a step whose contract does not refuse it (a Screen): not held', () => {
    const flow = flowWithNotify(undefined);
    flow.nodes = [
      ...(flow.nodes as unknown[]).slice(0, 2),
      { id: 'screen_1', type: 'screen', label: 'Screen', config: { title: ' ', fields: [] } },
    ];
    flow.edges = [
      { id: 'e1', source: 'start', target: 'screen_1' },
      { id: 'edge', source: 'screen_1', target: 'end' },
    ];
    expect(flowParseRefusals(flow)).toEqual([]);
    expect(flowHeldEdit(flow, 'en')).toBeNull();
  });

  it('a flow with no nodes, or only Start and End: not held', () => {
    expect(flowHeldEdit({ name: 'x' }, 'en')).toBeNull();
    const flow = flowWithNotify(undefined);
    flow.nodes = (flow.nodes as unknown[]).slice(0, 2);
    flow.edges = [{ id: 'e1', source: 'start', target: 'end' }];
    expect(flowHeldEdit(flow, 'en')).toBeNull();
  });

  it('zh: the input is named by the inspector\'s zh label', () => {
    const flow = flowWithNotify({ channels: ['inbox'], recipients: [] });
    // The inspector's zh label for Notify's Title (`FLOW_FIELD_ZH`).
    expect(flowHeldEdit(flow, 'zh-CN')?.clause).toBe(
      tFormat('engine.studio.held.needsInput', 'zh-CN', { input: '标题', step: 'Notify' }),
    );
  });
});

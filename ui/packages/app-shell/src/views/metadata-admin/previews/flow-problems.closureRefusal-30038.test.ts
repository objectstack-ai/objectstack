// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30038 (ruling A) — the publish refusal of a flow bound to an
 * object outside its package's closure reads, on the Problems list, in the
 * Console's language. The sentence is chosen by the served entry's rule id
 * (`code`) and its item-relative `path`, and names the object the flow on
 * screen holds at that path; the wire shape does not move.
 *
 * Pinned: the three positions of the two rule ids render the studio copy
 * (zh-CN in Chinese, en in English); an unmatched code, an unmatched position,
 * a missing value and a warning keep the server's sentence as sent; and the
 * served verdict's `code` survives `verdictPreviewEntries`, the step that
 * flattens a draft's `_diagnostics` for the canvas.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { buildFlowProblems, type ServerDiagnostic } from './flow-problems';
import { verdictPreviewEntries } from '../draftVerdict';
import type { FlowDesignerNode } from './flow-canvas-layout';

beforeAll(async () => {
  await loadStudioCatalogue('zh');
});

/** The sentence the publish gate writes (`@objectstack/lint` validate-flow-trigger-readiness). */
const SERVED =
  "triggers on object 'crm_custom_eval_1104', which is outside the closure of package 'com.example.crm.custom' " +
  "(its own objects, the objects of the packages its manifest declares in `dependencies`, and platform objects), " +
  'so the package may not bind a flow to it.';

const nodes = [
  {
    id: 'start',
    type: 'start',
    label: 'Start',
    config: {
      triggerType: 'record-after-update',
      objectName: 'crm_custom_eval_1104',
      timeRelative: { object: 'crm_scan_target' },
    },
  },
  { id: 'end', type: 'end', label: 'End' },
] as unknown as FlowDesignerNode[];
const edges = [{ id: 'e1', source: 'start', target: 'end' }];
const variables = [{ name: 'deal_id', type: 'text', isInput: true, objectName: 'crm_deal_x' }];

function serverMessages(serverDiagnostics: ServerDiagnostic[], locale: string): string[] {
  return buildFlowProblems({ nodes, edges, serverDiagnostics, variables, locale })
    .filter((p) => p.source === 'server')
    .map((p) => p.message);
}

const trigger: ServerDiagnostic = {
  path: 'nodes.0.config.objectName',
  message: SERVED,
  code: 'flow-trigger-unknown-object',
};

describe('flow Problems — the closure refusal in the Console\'s language (objectstack#30038)', () => {
  it('zh-CN: the trigger object refusal renders in Chinese and names the object on screen', () => {
    const [message] = serverMessages([trigger], 'zh-CN');
    expect(message).toMatch(/[一-鿿]/);
    expect(message).toContain('“crm_custom_eval_1104”');
    expect(message).not.toContain('closure');
  });

  it('en: the same entry renders the studio English sentence, not the packaging one', () => {
    const [message] = serverMessages([trigger], 'en');
    expect(message).toContain('"crm_custom_eval_1104"');
    expect(message).not.toBe(SERVED);
    expect(message).not.toContain('closure');
  });

  it('the time-relative scan object and the start input are the rule ids\' other two positions', () => {
    const [scan, input] = serverMessages(
      [
        { path: 'nodes.0.config.timeRelative.object', message: SERVED, code: 'flow-trigger-unknown-object' },
        { path: 'variables.0.objectName', message: SERVED, code: 'flow-input-unknown-object' },
      ],
      'zh-CN',
    );
    expect(scan).toContain('“crm_scan_target”');
    expect(scan).toMatch(/[一-鿿]/);
    expect(input).toContain('“crm_deal_x”');
    expect(input).toContain('“deal_id”');
    expect(input).toMatch(/[一-鿿]/);
  });

  it('an unknown code passes the server\'s sentence through', () => {
    expect(serverMessages([{ ...trigger, code: 'some-other-rule' }], 'zh-CN')).toEqual([SERVED]);
    expect(serverMessages([{ path: trigger.path, message: SERVED }], 'zh-CN')).toEqual([SERVED]);
  });

  it('a known code at a position it does not word, or with no name at the path, passes through', () => {
    expect(serverMessages([{ ...trigger, path: 'nodes.0.config.condition' }], 'zh-CN')).toEqual([SERVED]);
    expect(serverMessages([{ ...trigger, path: 'nodes.1.config.objectName' }], 'zh-CN')).toEqual([SERVED]);
    expect(serverMessages([{ ...trigger, code: 'flow-input-unknown-object' }], 'zh-CN')).toEqual([SERVED]);
  });

  it('a warning under the same rule id (the no-closure advisory) is not reworded', () => {
    expect(serverMessages([{ ...trigger, severity: 'warning' }], 'zh-CN')).toEqual([SERVED]);
  });

  it('the draft verdict\'s `code` survives the flattening the canvas reads', () => {
    const entries = verdictPreviewEntries({ valid: false, errors: [{ ...trigger, path: 'nodes.0.config.objectName' }] });
    expect(entries).toEqual([
      { path: 'nodes.0.config.objectName', message: SERVED, severity: 'error', code: 'flow-trigger-unknown-object' },
    ]);
    const [message] = serverMessages(entries, 'zh-CN');
    expect(message).toContain('“crm_custom_eval_1104”');
    expect(message).toMatch(/[一-鿿]/);
  });
});

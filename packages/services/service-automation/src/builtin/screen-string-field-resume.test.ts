// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A screen asks for a string and the node after it writes it (#31491).
 *
 * The reproduction: the showcase reassign wizard (`screen` → `update_record`).
 * A resume that sent an object for its `text` field passed the screen-input
 * door, the resume consumed the suspension (#13937's shape-4 order), and the
 * record write refused the object — the run ended `failed`, and a corrected
 * resume answered `RUN_NOT_FOUND`. A number was stored as text instead.
 *
 * Ruling A+ (maintainer, 2026-11-08): `text`, `textarea`, `email`, `url` and
 * `phone` are string value domains at the door. Pinned here, at the engine,
 * for each kind:
 *  - an object and a number are refused `INVALID_SCREEN_INPUT` before anything
 *    is written, and the pause survives;
 *  - a corrected resume then completes the run and writes the string;
 *  - a missing value is refused as `required`, as before, and the pause survives.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
}

/** A data engine that records every insert's object and fields. */
function fakeData() {
  const inserts: Array<{ obj: string; fields: Record<string, unknown> }> = [];
  const data: any = {
    async insert(obj: string, fields: Record<string, unknown>) {
      inserts.push({ obj, fields });
      return { id: `${obj}_1` };
    },
  };
  return { data, inserts };
}

const CEL = (source: string) => ({ dialect: 'cel', source });

/** start → screen (one required field of `type`) → create_record (writes it) → end. */
function askFlow(type: string) {
  return {
    name: 'ask_string',
    label: 'Ask a string',
    type: 'screen',
    status: 'active',
    runAs: 'system',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'ask', type: 'screen', label: 'Ask',
        config: { fields: [{ name: 'answer', label: 'Answer', type, required: true }] },
      },
      {
        id: 'write', type: 'create_record', label: 'Write',
        config: { objectName: 'reply', fields: { answer: CEL('answer') } },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'ask' },
      { id: 'e2', source: 'ask', target: 'write' },
      { id: 'e3', source: 'write', target: 'end' },
    ],
  };
}

function makeEngine(type: string) {
  const { data, inserts } = fakeData();
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, { logger: silentLogger(), getService: (n: string) => (n === 'data' ? data : undefined) } as any);
  engine.registerFlow('ask_string', askFlow(type) as any);
  return { engine, inserts };
}

describe('a screen string field refuses a non-string before the pause is consumed (#31491, ruling A+)', () => {
  for (const type of ['text', 'textarea', 'email', 'url', 'phone']) {
    it(`\`${type}\`: an object and a number are refused, the pause survives, and a corrected resume completes`, async () => {
      const { engine, inserts } = makeEngine(type);
      const started = await engine.execute('ask_string', {} as any);
      expect(started.status).toBe('paused');
      const runId = started.runId!;

      for (const bad of [{ x: 1 }, 42]) {
        const refused = await engine.resume(runId, { variables: { answer: bad } });
        expect(refused.success, JSON.stringify(bad)).toBe(false);
        expect(refused.code).toBe('INVALID_SCREEN_INPUT');
        expect(refused.error).toContain('Screen field "answer" must be a string');
        expect(inserts).toEqual([]);
        expect(await engine.hasSuspendedRun(runId)).toBe(true);
      }

      const resumed = await engine.resume(runId, { variables: { answer: 'alice' } });
      expect(resumed.success, resumed.error).toBe(true);
      expect(inserts).toEqual([{ obj: 'reply', fields: { answer: 'alice' } }]);
      expect(await engine.hasSuspendedRun(runId)).toBe(false);
    });
  }

  it('a missing value is refused as `required`, as before, and the pause survives', async () => {
    const { engine, inserts } = makeEngine('text');
    const { runId } = await engine.execute('ask_string', {} as any);
    const refused = await engine.resume(runId!, { variables: {} });
    expect(refused.code).toBe('INVALID_SCREEN_INPUT');
    expect(refused.error).toContain('Screen field "answer" is required');
    expect(inserts).toEqual([]);
    expect(await engine.hasSuspendedRun(runId!)).toBe(true);
  });
});

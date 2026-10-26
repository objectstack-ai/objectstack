// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A flat screen collects a file, and the node after it writes the file's id
 * into a record (#25801).
 *
 * The shape the card asks for: a wizard that asks everything first and writes
 * at the end. The screen declares a `type: 'file'` field, the console uploads
 * through the file service (a `sys_file` no record owns yet) and resumes with
 * the file's id, and a `create_record` after the screen writes that id into
 * the record's `file` field — the write that claims the file (ADR-0104 D3; the
 * claim itself is `service-storage`'s and is proven end to end in the dogfood
 * suite's `flow-screen-file-intake` file).
 *
 * Pinned here, at the engine:
 *  - the paused screen carries `type: 'file'` on the wire, so a client knows to
 *    render the upload widget;
 *  - a resume that is not a file id is refused with `INVALID_SCREEN_INPUT`
 *    before anything is written, and the pause survives for a corrected resume;
 *  - a resume with the id reaches the write with the id, unchanged.
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
const FILE_ID = 'V1StGXR8_Z5jdHi6B-myT';

/** start → screen (title, file) → create_record (writes both) → end. */
function intakeFlow() {
  return {
    name: 'contract_intake',
    label: 'Contract intake',
    type: 'screen',
    status: 'active',
    runAs: 'system',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'ask', type: 'screen', label: 'First version',
        config: {
          fields: [
            { name: 'title', label: 'Title', type: 'text', required: true },
            { name: 'contract_file', label: 'Contract', type: 'file', required: true },
          ],
        },
      },
      {
        id: 'write', type: 'create_record', label: 'Create version',
        config: { objectName: 'contract_version', fields: { title: CEL('title'), file: CEL('contract_file') } },
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

function makeEngine() {
  const { data, inserts } = fakeData();
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, { logger: silentLogger(), getService: (n: string) => (n === 'data' ? data : undefined) } as any);
  engine.registerFlow('contract_intake', intakeFlow() as any);
  return { engine, inserts };
}

describe('a flat screen collects a file before the record that owns it exists (#25801)', () => {
  it('pauses with the field typed `file` on the wire', async () => {
    const { engine, inserts } = makeEngine();
    const started = await engine.execute('contract_intake', {} as any);
    expect(started.status).toBe('paused');
    const field = started.screen?.fields.find((f) => f.name === 'contract_file');
    expect(field).toMatchObject({ name: 'contract_file', type: 'file', required: true });
    // Nothing is written before the last screen is answered.
    expect(inserts).toEqual([]);
  });

  it('refuses a resume that is not a file id, writes nothing, and keeps the pause', async () => {
    const { engine, inserts } = makeEngine();
    const { runId } = await engine.execute('contract_intake', {} as any);

    const refused = await engine.resume(runId!, {
      variables: { title: 'NDA', contract_file: 'https://cdn.example.com/nda.pdf' },
    });
    expect(refused.success).toBe(false);
    expect(refused.code).toBe('INVALID_SCREEN_INPUT');
    expect(refused.error).toContain('Screen field "contract_file" must be the id of an uploaded file');
    expect(inserts).toEqual([]);

    // The refusal consumed nothing: the corrected submission still lands.
    const resumed = await engine.resume(runId!, { variables: { title: 'NDA', contract_file: FILE_ID } });
    expect(resumed.success, resumed.error).toBe(true);
    expect(inserts).toEqual([{ obj: 'contract_version', fields: { title: 'NDA', file: FILE_ID } }]);
  });

  it('hands the next node the file id unchanged', async () => {
    const { engine, inserts } = makeEngine();
    const { runId } = await engine.execute('contract_intake', {} as any);
    const resumed = await engine.resume(runId!, { variables: { title: 'MSA', contract_file: FILE_ID } });
    expect(resumed.success, resumed.error).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.fields.file).toBe(FILE_ID);
  });
});

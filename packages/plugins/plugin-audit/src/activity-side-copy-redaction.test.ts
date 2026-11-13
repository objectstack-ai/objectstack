// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32442] `ACTIVITY_SIDE_COPY_COLUMNS`: the listed parent columns are not
 * served in an activity row's `metadata.old` / `metadata.new`, for any reader;
 * every other key is narrowed as before, and other objects are untouched.
 */

import { describe, it, expect } from 'vitest';
import { redactActivityRows, ACTIVITY_SIDE_COPY_COLUMNS } from './activity-field-redaction.js';

const SNAPSHOT = JSON.stringify({ name: 'INV-1', cost_code: 'SYNTH-SIDE-COPY-41' });
const reader = { userId: 'u_reader', positions: [], permissions: [] };

const row = (object: string, metadata: unknown) => ({ id: 'act_1', object_name: object, record_id: 'r1', metadata });
const allServed = (fields: string[]) => ({
  getReadableFields: async () => fields,
  getQueryableFields: async () => fields,
});

describe('[#32442] activity rows do not serve the listed parent columns', () => {
  it('names exactly the request snapshot column', () => {
    expect([...ACTIVITY_SIDE_COPY_COLUMNS.entries()]).toEqual([['sys_approval_request', ['payload_json']]]);
  });

  it('drops payload_json from both sides for a reader served every request field, keeping the rest', async () => {
    const r = row('sys_approval_request', JSON.stringify({
      old: { status: 'pending', payload_json: SNAPSHOT },
      new: { status: 'approved', payload_json: SNAPSHOT },
    }));
    await redactActivityRows([r], allServed(['status', 'payload_json']), reader);
    const served = JSON.parse(r.metadata as string);
    expect(served.old).toEqual({ status: 'pending' });
    expect(served.new).toEqual({ status: 'approved' });
    expect(JSON.stringify(r)).not.toContain('SYNTH-SIDE-COPY-41');
  });

  it('drops it for a reader the security service answers no narrowing for, and from parsed metadata', async () => {
    const asText = row('sys_approval_request', JSON.stringify({ old: null, new: { status: 'pending', payload_json: SNAPSHOT } }));
    const asObject = row('sys_approval_request', { old: null, new: { status: 'pending', payload_json: SNAPSHOT } });
    await redactActivityRows([asText, asObject], undefined, reader);
    expect(JSON.stringify(asText)).not.toContain('SYNTH-SIDE-COPY-41');
    expect(JSON.stringify(asObject)).not.toContain('SYNTH-SIDE-COPY-41');
    expect(JSON.parse(asText.metadata as string).new).toEqual({ status: 'pending' });
  });

  it('leaves a same-named column on another object to the parent\'s served fields', async () => {
    const r = row('crm_note', JSON.stringify({ old: null, new: { payload_json: 'kept' } }));
    await redactActivityRows([r], allServed(['payload_json']), reader);
    expect(JSON.parse(r.metadata as string).new).toEqual({ payload_json: 'kept' });
  });

  it('reads an object_name that is an inherited property name as unlisted, without throwing', async () => {
    const r = row('constructor', JSON.stringify({ old: null, new: { payload_json: 'kept' } }));
    await redactActivityRows([r], allServed(['payload_json']), reader);
    expect(JSON.parse(r.metadata as string).new).toEqual({ payload_json: 'kept' });
  });
});

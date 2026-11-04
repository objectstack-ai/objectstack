// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `detectRecordWrite` — cloud#3565.
 *
 * The chat proposes ONE record (`create_record` / `update_record`) as a HITL
 * pending action in the user's name and answers the approval envelope plus
 * the record the card draws. The card's buttons act on the pending id, so an
 * envelope without one, or without a field to confirm, is not a card.
 *
 * Wrapper coverage is not optional (the replay-envelope lesson): persisted
 * tool outputs arrive as `{ type:'text', value:'<json-string>' }`, so a
 * detector that only reads the bare object goes blind exactly on reload.
 */

import { describe, it, expect } from 'vitest';
import { detectRecordWrite, detectSampleDataCleanup, uiMessagesToChatMessages } from '../mapMessages';

const CREATE = {
  success: true,
  status: 'pending_approval',
  pendingActionId: 'pa_7',
  recordWrite: {
    operation: 'create',
    objectName: 'crm_lead',
    objectLabel: '线索',
    label: '张伟 · 某某制造',
    fields: [
      { name: 'name', label: '姓名', type: 'text', value: '张伟' },
      { name: 'company', label: '公司', type: 'text', value: '某某制造' },
      { name: 'source', label: '来源', type: 'select', value: 'wechat' },
    ],
    dropped: [{ field: 'owner', reason: 'not_editable', detail: '负责人 is not editable for you' }],
    fieldSecurity: 'write_projection',
  },
  message: 'Queued as pa_7; NOTHING is written until the user confirms it on the card above.',
};

const UPDATE = {
  success: true,
  status: 'pending_approval',
  pendingActionId: 'pa_8',
  recordWrite: {
    operation: 'update',
    objectName: 'crm_lead',
    objectLabel: '线索',
    recordId: 'lead_zhangwei',
    label: '张伟',
    reason: '改电话和状态',
    fields: [
      { name: 'phone', label: '电话', type: 'text', value: '13900001111', current: '13812345678' },
      { name: 'status', label: '状态', type: 'select', value: 'contacted', current: 'new' },
    ],
    dropped: [],
    fieldSecurity: 'record_projection',
  },
};

describe('detectRecordWrite', () => {
  it('lifts a create card (the live SSE shape), labels and drops included', () => {
    expect(detectRecordWrite(CREATE)).toEqual({
      operation: 'create',
      objectName: 'crm_lead',
      objectLabel: '线索',
      label: '张伟 · 某某制造',
      fields: [
        { name: 'name', label: '姓名', type: 'text', value: '张伟' },
        { name: 'company', label: '公司', type: 'text', value: '某某制造' },
        { name: 'source', label: '来源', type: 'select', value: 'wechat' },
      ],
      dropped: [{ field: 'owner', reason: 'not_editable', detail: '负责人 is not editable for you' }],
    });
  });

  it('lifts an update card with each field as stored beside the proposed value', () => {
    const out = detectRecordWrite(UPDATE);
    expect(out?.operation).toBe('update');
    expect(out?.recordId).toBe('lead_zhangwei');
    expect(out?.reason).toBe('改电话和状态');
    expect(out?.fields).toEqual([
      { name: 'phone', label: '电话', type: 'text', value: '13900001111', current: '13812345678' },
      { name: 'status', label: '状态', type: 'select', value: 'contacted', current: 'new' },
    ]);
  });

  it('lifts the persisted wrapper — { type:"text", value:"<json>" } — and a JSON string', () => {
    expect(detectRecordWrite({ type: 'text', value: JSON.stringify(CREATE) })?.label).toBe('张伟 · 某某制造');
    expect(detectRecordWrite(JSON.stringify(UPDATE))?.recordId).toBe('lead_zhangwei');
  });

  it('is not a card without the pending id the buttons act on', () => {
    const { pendingActionId: _omit, ...noId } = CREATE;
    expect(detectRecordWrite(noId)).toBeUndefined();
    expect(detectRecordWrite({ ...CREATE, status: 'record_draft' })).toBeUndefined();
  });

  it('is not a card without a field to confirm, and an update needs its record', () => {
    expect(detectRecordWrite({ ...CREATE, recordWrite: { ...CREATE.recordWrite, fields: [] } })).toBeUndefined();
    const { recordId: _omit, ...noRecord } = UPDATE.recordWrite;
    expect(detectRecordWrite({ ...UPDATE, recordWrite: noRecord })).toBeUndefined();
  });

  it('keeps a plain pending approval (an action tool) off the record card', () => {
    expect(
      detectRecordWrite({ status: 'pending_approval', pendingActionId: 'pa_1', toolName: 'action_delete_task' }),
    ).toBeUndefined();
  });

  it('falls back to API names where the object says nothing', () => {
    const out = detectRecordWrite({
      status: 'pending_approval',
      pendingActionId: 'pa_2',
      recordWrite: { operation: 'create', objectName: 'x', fields: [{ name: 'f', value: 1 }] },
    });
    expect(out).toEqual({
      operation: 'create',
      objectName: 'x',
      objectLabel: 'x',
      fields: [{ name: 'f', label: 'f', type: 'text', value: 1 }],
      dropped: [],
    });
  });
});

describe('detectSampleDataCleanup — 「清理示例数据」 lists tables and counts', () => {
  const CLEANUP = {
    status: 'pending_approval',
    pendingActionId: 'pa_9',
    sampleDataCleanup: {
      tables: [
        { objectName: 'crm_account', label: '客户', count: 12 },
        { objectName: 'crm_lead', label: '线索', count: 30 },
      ],
      total: 42,
      absent: 0,
    },
  };

  it('lifts the tables, the total and the absent count, from the bare and the wrapped shape', () => {
    expect(detectSampleDataCleanup(CLEANUP)).toEqual(CLEANUP.sampleDataCleanup);
    expect(detectSampleDataCleanup({ type: 'text', value: JSON.stringify(CLEANUP) })?.total).toBe(42);
  });

  it('is not a card without the pending id or without a table', () => {
    const { pendingActionId: _omit, ...noId } = CLEANUP;
    expect(detectSampleDataCleanup(noId)).toBeUndefined();
    expect(detectSampleDataCleanup({ ...CLEANUP, sampleDataCleanup: { tables: [], total: 0, absent: 0 } })).toBeUndefined();
    expect(detectSampleDataCleanup(CREATE)).toBeUndefined();
  });

  it('is lifted by the mapper beside the pending id, and is not a record-write card', () => {
    const [message] = uiMessagesToChatMessages([
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-remove_sample_data',
            toolCallId: 'c2',
            state: 'output-available',
            output: { type: 'text', value: JSON.stringify(CLEANUP) },
          },
        ],
      },
    ]);
    const tool = message.toolInvocations?.[0];
    expect(tool?.state).toBe('approval-requested');
    expect(tool?.pendingActionId).toBe('pa_9');
    expect(tool?.sampleDataCleanup?.tables).toHaveLength(2);
    expect(tool?.recordWrite).toBeUndefined();
  });
});

describe('the live mapper lifts the card beside the approval it rides on', () => {
  it('a create_record result maps to approval-requested with the id and the card', () => {
    const [message] = uiMessagesToChatMessages([
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-create_record',
            toolCallId: 'c1',
            state: 'output-available',
            input: { objectName: 'crm_lead', values: { name: '张伟' } },
            output: { type: 'text', value: JSON.stringify(CREATE) },
          },
          { type: 'text', text: '请在上方卡片确认。' },
        ],
      },
    ]);
    const tool = message.toolInvocations?.[0];
    expect(tool?.toolName).toBe('create_record');
    expect(tool?.state).toBe('approval-requested');
    expect(tool?.pendingActionId).toBe('pa_7');
    expect(tool?.recordWrite?.fields.map((f) => f.name)).toEqual(['name', 'company', 'source']);
    // Not the sibling cards: a write proposal is neither a hand-off nor a draft.
    expect(tool?.recordHandoff).toBeUndefined();
    expect(tool?.draftReview).toBeUndefined();
  });
});

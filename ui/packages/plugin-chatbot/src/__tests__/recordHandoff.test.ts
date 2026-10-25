// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `detectRecordHandoff` — cloud#1658.
 *
 * The server half of this hand-off shipped first and was HALF-ALIVE: the ask
 * agent emitted `status:'record_handoff'` with a real recordId, the reply said
 * "点击上方链接打开", and there was no link — the console had a detector for
 * `build_handoff` and none for this. These tests pin the client half.
 *
 * Wrapper coverage is not optional (the replay-envelope lesson): persisted
 * tool outputs arrive as `{ type:'text', value:'<json-string>' }`, so a
 * detector that only reads the bare object goes blind exactly on reload.
 */

import { describe, it, expect } from 'vitest';
import { detectRecordHandoff } from '../mapMessages';

const PAYLOAD = {
  success: true,
  status: 'record_handoff',
  handoff: 'record',
  objectName: 'hdke_book',
  recordId: '-GQDwdky1HlN_k52',
  label: '沉默的大多数',
  reason: '把阅读状态改为已读',
};

describe('detectRecordHandoff', () => {
  it('lifts the bare envelope (the live SSE shape)', () => {
    expect(detectRecordHandoff(PAYLOAD)).toEqual({
      objectName: 'hdke_book',
      recordId: '-GQDwdky1HlN_k52',
      label: '沉默的大多数',
      reason: '把阅读状态改为已读',
    });
  });

  it('lifts the persisted wrapper — { type:"text", value:"<json>" }', () => {
    const wrapped = { type: 'text', value: JSON.stringify(PAYLOAD) };
    expect(detectRecordHandoff(wrapped)?.recordId).toBe('-GQDwdky1HlN_k52');
  });

  it('lifts a JSON string (the raw handler return)', () => {
    expect(detectRecordHandoff(JSON.stringify(PAYLOAD))?.objectName).toBe('hdke_book');
  });

  it('keeps optional fields off when absent', () => {
    const out = detectRecordHandoff({ status: 'record_handoff', objectName: 'a', recordId: 'r1' });
    expect(out).toEqual({ objectName: 'a', recordId: 'r1' });
  });

  it('drops a hand-off missing either id — a card pointing nowhere must not render', () => {
    expect(detectRecordHandoff({ status: 'record_handoff', objectName: 'a' })).toBeUndefined();
    expect(detectRecordHandoff({ status: 'record_handoff', recordId: 'r1' })).toBeUndefined();
    expect(detectRecordHandoff({ status: 'record_handoff', objectName: ' ', recordId: 'r1' })).toBeUndefined();
  });

  it('ignores every other status — build_handoff stays the Builder card', () => {
    expect(detectRecordHandoff({ status: 'build_handoff', prompt: 'x' })).toBeUndefined();
    expect(detectRecordHandoff({ status: 'published' })).toBeUndefined();
    expect(detectRecordHandoff(undefined)).toBeUndefined();
  });
});

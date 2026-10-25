// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #772 — a granular metadata edit that RETURNED a confirm-before-change
// preview (status:'changes_proposed') must read as AWAITING the user, not
// "Completed": the change only commits when they approve on the next turn.

import { describe, it, expect } from 'vitest';
import { getToolState, isProposalResult } from './ChatbotEnhanced';

describe('isProposalResult', () => {
  it('detects the confirm-gate preview envelopes (object or JSON string)', () => {
    expect(isProposalResult({ status: 'changes_proposed', changes: [] })).toBe(true);
    expect(isProposalResult({ status: 'blueprint_proposed', blueprint: {} })).toBe(true);
    expect(isProposalResult({ status: 'awaiting_confirmation' })).toBe(true);
    expect(isProposalResult('{"status":"changes_proposed"}')).toBe(true);
  });

  // #787 finding B / #2362: the REAL tool.result is the Vercel AI SDK tool
  // output shell `{ type:'text', value:'<json>' }`, not a bare object/string.
  // isProposalResult must peel that shell (via parseResultEnvelope) or the
  // collapsed header reads "Completed" instead of "Awaiting Approval".
  it('peels the Vercel {type,value} tool-output envelope', () => {
    expect(
      isProposalResult({ type: 'text', value: '{"status":"changes_proposed","changes":[]}' }),
    ).toBe(true);
    expect(
      isProposalResult({ type: 'text', value: '{"status":"blueprint_proposed","blueprint":{}}' }),
    ).toBe(true);
    // A wrapped, genuinely-applied result stays "Completed".
    expect(isProposalResult({ type: 'text', value: '{"status":"drafted","drafted":["x"]}' })).toBe(
      false,
    );
  });

  it('is false for applied / other results and junk', () => {
    expect(isProposalResult({ status: 'drafted', drafted: ['x'] })).toBe(false);
    expect(isProposalResult({ ok: true })).toBe(false);
    expect(isProposalResult('not json')).toBe(false);
    expect(isProposalResult(undefined)).toBe(false);
    expect(isProposalResult(null)).toBe(false);
  });
});

describe('getToolState — proposed preview reads as awaiting', () => {
  it('a returned changes_proposed tool → awaiting (not completed)', () => {
    expect(
      getToolState({
        toolCallId: 't1',
        toolName: 'apply_edit',
        result: { status: 'changes_proposed', changes: [{ verb: 'add_field' }] },
      }),
    ).toBe('awaiting');
  });

  it('a returned blueprint_proposed tool → awaiting', () => {
    expect(
      getToolState({
        toolCallId: 't2',
        toolName: 'propose_blueprint',
        result: { status: 'blueprint_proposed', blueprint: {} },
      }),
    ).toBe('awaiting');
  });

  it('a returned changes_proposed WRAPPED in the Vercel {type,value} shell → awaiting', () => {
    // The exact shape headerState/renderToolDetail receive at runtime (#787 B).
    expect(
      getToolState({
        toolCallId: 't2b',
        toolName: 'apply_edit',
        result: { type: 'text', value: '{"status":"changes_proposed","changes":[{"verb":"add_field"}]}' },
      }),
    ).toBe('awaiting');
  });

  it('a genuinely applied (drafted) tool → completed', () => {
    expect(
      getToolState({
        toolCallId: 't3',
        toolName: 'apply_blueprint',
        result: { status: 'drafted', drafted: ['customer'] },
      }),
    ).toBe('completed');
  });

  it('an errored tool → failed; a running one → running', () => {
    expect(getToolState({ toolCallId: 't4', toolName: 'x', errorText: 'boom' })).toBe('failed');
    expect(getToolState({ toolCallId: 't5', toolName: 'x' })).toBe('running');
  });

  it('an explicit approval-requested state → awaiting', () => {
    expect(
      getToolState({ toolCallId: 't6', toolName: 'x', state: 'approval-requested', result: undefined }),
    ).toBe('awaiting');
  });
});

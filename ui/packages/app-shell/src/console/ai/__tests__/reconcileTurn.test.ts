import { describe, it, expect } from 'vitest';
import { isReconcilableCompletedTurn } from '../reconcileTurn';

const text = (t: string) => ({ type: 'text', text: t });
const toolCall = { type: 'tool-create_object', toolCallId: 'x' };

describe('isReconcilableCompletedTurn (ADR-0013 D2)', () => {
  it('true when the thread ends on an assistant text reply', () => {
    expect(isReconcilableCompletedTurn([
      { role: 'user', parts: [text('build a CRM')] },
      { role: 'assistant', parts: [toolCall, text('Done — your CRM is ready.')] },
    ])).toBe(true);
  });

  it('false when the last assistant turn only emitted tool calls (no final text)', () => {
    expect(isReconcilableCompletedTurn([
      { role: 'user', parts: [text('build a CRM')] },
      { role: 'assistant', parts: [toolCall] },
    ])).toBe(false);
  });

  it('false when the thread ends on a tool result (turn still mid-flight)', () => {
    expect(isReconcilableCompletedTurn([
      { role: 'user', parts: [text('build a CRM')] },
      { role: 'assistant', parts: [toolCall] },
      { role: 'tool', parts: [{ type: 'tool-result' }] },
    ])).toBe(false);
  });

  it('false for an assistant reply that is only whitespace', () => {
    expect(isReconcilableCompletedTurn([
      { role: 'user', parts: [text('hi')] },
      { role: 'assistant', parts: [text('   ')] },
    ])).toBe(false);
  });

  it('false for empty / missing history', () => {
    expect(isReconcilableCompletedTurn([])).toBe(false);
    expect(isReconcilableCompletedTurn(undefined)).toBe(false);
  });

  it('false when the last message is the user (no reply yet)', () => {
    expect(isReconcilableCompletedTurn([
      { role: 'user', parts: [text('hi')] },
    ])).toBe(false);
  });
});

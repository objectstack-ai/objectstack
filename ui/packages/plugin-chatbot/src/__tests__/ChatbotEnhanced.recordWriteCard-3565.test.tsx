/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * cloud#3565 — the record-write card: ONE record the chat proposes, drawn as
 * it will be written (old → new on an update), with the three buttons the
 * ruling names — 确认 / 打开完整表单 / 取消 — in place of the generic HITL
 * Approve / Deny strip and the raw payload. Fed through the real mapper so the
 * detector chain runs exactly as it does in the console.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatbotEnhanced, type ToolDecisionState } from '../ChatbotEnhanced';
import { uiMessagesToChatMessages } from '../mapMessages';

const CREATE = {
  status: 'pending_approval',
  pendingActionId: 'pa_7',
  recordWrite: {
    operation: 'create',
    objectName: 'crm_lead',
    objectLabel: '线索',
    label: '张伟 · 某某制造',
    fields: [
      { name: 'name', label: '姓名', type: 'text', value: '张伟' },
      { name: 'tags', label: '标签', type: 'multiselect', value: ['打印机', '网络'] },
    ],
    dropped: [{ field: 'owner', reason: 'not_editable' }],
  },
};

const UPDATE = {
  status: 'pending_approval',
  pendingActionId: 'pa_8',
  recordWrite: {
    operation: 'update',
    objectName: 'crm_lead',
    objectLabel: '线索',
    recordId: 'lead_zhangwei',
    label: '张伟',
    reason: '改电话',
    fields: [{ name: 'phone', label: '电话', type: 'text', value: '13900001111', current: '13812345678' }],
    dropped: [],
  },
};

function transcript(result: unknown, toolName = 'create_record') {
  return uiMessagesToChatMessages([
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: `tool-${toolName}`,
          toolCallId: 'c1',
          state: 'output-available',
          input: { objectName: 'crm_lead', values: { name: '张伟' } },
          output: { type: 'text', value: JSON.stringify(result) },
        },
      ],
    },
  ]);
}

const LABELS = {
  recordWriteCreateTitle: (o: string) => `新建${o}`,
  recordWriteUpdateTitle: (o: string) => `修改${o}`,
  recordWriteConfirmLabel: '确认',
  recordWriteOpenFormLabel: '打开完整表单',
  recordWriteCancelLabel: '取消',
  recordWriteCancelReason: '已在卡片上取消',
  recordWriteOpenFormReason: '改为打开完整表单',
  recordWriteDroppedLabel: '未包含',
  recordWriteWrittenLabel: '已写入',
  recordWriteCancelledLabel: '已取消',
  toolApproveLabel: 'Approve and execute',
  toolDenyLabel: 'Reject',
};

describe('ChatbotEnhanced — the record-write card (cloud#3565)', () => {
  it('draws the record and the three buttons, and hides the generic approve/deny strip and the payload', () => {
    const onToolApprove = vi.fn();
    const onOpenRecordForm = vi.fn();
    render(
      <ChatbotEnhanced
        messages={transcript(CREATE)}
        onSendMessage={vi.fn()}
        onToolApprove={onToolApprove}
        onOpenRecordForm={onOpenRecordForm}
        {...LABELS}
      />,
    );
    const card = screen.getByTestId('record-write');
    expect(card).toHaveAttribute('data-operation', 'create');
    expect(card).toHaveTextContent('新建线索');
    expect(card).toHaveTextContent('张伟 · 某某制造');
    expect(screen.getByTestId('record-write-field-name')).toHaveTextContent('张伟');
    // A list value reads as a list, not as JSON.
    expect(screen.getByTestId('record-write-field-tags')).toHaveTextContent('打印机, 网络');
    expect(screen.getByTestId('record-write-dropped')).toHaveTextContent('未包含: owner (not editable)');

    expect(screen.getByTestId('record-write-confirm')).toHaveTextContent('确认');
    expect(screen.getByTestId('record-write-open-form')).toHaveTextContent('打开完整表单');
    expect(screen.getByTestId('record-write-cancel')).toHaveTextContent('取消');
    // Not the generic HITL strip — one set of buttons, the ruling's.
    expect(screen.queryByText('Approve and execute')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject')).not.toBeInTheDocument();
    // The raw pending envelope is developer detail; the card already says it all.
    expect(card.closest('[data-testid]')?.textContent ?? '').not.toContain('pending_approval');
  });

  it('确认 approves the pending action; 取消 rejects it with the cancel reason', () => {
    const onToolApprove = vi.fn();
    render(
      <ChatbotEnhanced
        messages={transcript(CREATE)}
        onSendMessage={vi.fn()}
        onToolApprove={onToolApprove}
        onOpenRecordForm={vi.fn()}
        {...LABELS}
      />,
    );
    fireEvent.click(screen.getByTestId('record-write-confirm'));
    expect(onToolApprove).toHaveBeenLastCalledWith('c1', true);
    fireEvent.click(screen.getByTestId('record-write-cancel'));
    expect(onToolApprove).toHaveBeenLastCalledWith('c1', false, '已在卡片上取消');
  });

  it('打开完整表单 cancels the pending write FIRST, then hands the host the card', () => {
    const calls: string[] = [];
    const onToolApprove = vi.fn(() => calls.push('reject'));
    const onOpenRecordForm = vi.fn(() => calls.push('open'));
    render(
      <ChatbotEnhanced
        messages={transcript(CREATE)}
        onSendMessage={vi.fn()}
        onToolApprove={onToolApprove}
        onOpenRecordForm={onOpenRecordForm}
        {...LABELS}
      />,
    );
    fireEvent.click(screen.getByTestId('record-write-open-form'));
    expect(onToolApprove).toHaveBeenCalledWith('c1', false, '改为打开完整表单');
    expect(onOpenRecordForm).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'create', objectName: 'crm_lead', label: '张伟 · 某某制造' }),
    );
    // A record saved in the form must never be written a second time from the card.
    expect(calls).toEqual(['reject', 'open']);
  });

  it('the open-form button is disabled where the host has no form to open', () => {
    render(
      <ChatbotEnhanced messages={transcript(CREATE)} onSendMessage={vi.fn()} onToolApprove={vi.fn()} {...LABELS} />,
    );
    expect(screen.getByTestId('record-write-open-form')).toBeDisabled();
    expect(screen.getByTestId('record-write-confirm')).toBeEnabled();
  });

  it('an update reads old → new per field', () => {
    render(
      <ChatbotEnhanced
        messages={transcript(UPDATE, 'update_record')}
        onSendMessage={vi.fn()}
        onToolApprove={vi.fn()}
        {...LABELS}
      />,
    );
    const card = screen.getByTestId('record-write');
    expect(card).toHaveAttribute('data-operation', 'update');
    expect(card).toHaveTextContent('修改线索');
    expect(card).toHaveTextContent('改电话');
    const phone = screen.getByTestId('record-write-field-phone');
    expect(phone).toHaveTextContent('13812345678');
    expect(phone).toHaveTextContent('→');
    expect(phone).toHaveTextContent('13900001111');
    expect(phone.querySelector('.line-through')).toHaveTextContent('13812345678');
  });

  it('after 确认 the card says written and links the record; after 取消 it says cancelled', () => {
    const onOpenRecord = vi.fn();
    const written: Record<string, ToolDecisionState> = {
      c1: {
        state: 'success',
        decision: 'approved',
        message: 'Approved — action executed.',
        result: { status: 'written', objectName: 'crm_lead', recordId: 'new_1', label: '张伟' },
      },
    };
    const { unmount } = render(
      <ChatbotEnhanced
        messages={transcript(CREATE)}
        onSendMessage={vi.fn()}
        onToolApprove={vi.fn()}
        onOpenRecord={onOpenRecord}
        toolDecisions={written}
        {...LABELS}
      />,
    );
    const decision = screen.getByTestId('record-write-decision');
    expect(decision).toHaveTextContent('已写入');
    // Not the hook's English line.
    expect(decision).not.toHaveTextContent('Approved');
    expect(screen.queryByTestId('record-write-confirm')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('record-write-open-written'));
    expect(onOpenRecord).toHaveBeenCalledWith({ objectName: 'crm_lead', recordId: 'new_1', label: '张伟' });
    unmount();

    render(
      <ChatbotEnhanced
        messages={transcript(CREATE)}
        onSendMessage={vi.fn()}
        onToolApprove={vi.fn()}
        toolDecisions={{ c1: { state: 'success', decision: 'rejected', message: 'Rejected.' } }}
        {...LABELS}
      />,
    );
    expect(screen.getByTestId('record-write-decision')).toHaveTextContent('已取消');
    expect(screen.queryByTestId('record-write-open-written')).not.toBeInTheDocument();
  });

  it('「清理示例数据」 lists the tables and counts and keeps the generic Approve / Deny decision', () => {
    const onToolApprove = vi.fn();
    render(
      <ChatbotEnhanced
        messages={transcript(
          {
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
          },
          'remove_sample_data',
        )}
        onSendMessage={vi.fn()}
        onToolApprove={onToolApprove}
        sampleDataCleanupTitleLabel="清理示例数据"
        {...LABELS}
      />,
    );
    const card = screen.getByTestId('sample-data-cleanup');
    expect(card).toHaveTextContent('清理示例数据');
    const rows = screen.getByTestId('sample-data-cleanup-tables').querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('客户');
    expect(rows[0]).toHaveTextContent('12');
    expect(rows[1]).toHaveTextContent('线索');
    expect(rows[1]).toHaveTextContent('30');
    // The decision is the generic strip; the raw payload stays hidden.
    fireEvent.click(screen.getByText('Approve and execute'));
    expect(onToolApprove).toHaveBeenCalledWith('c1', true);
    expect(screen.getByText('Reject')).toBeInTheDocument();
    expect(screen.queryByTestId('record-write')).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('pending_approval');
  });

  it('a refused write shows the server\'s reason on the card', () => {
    render(
      <ChatbotEnhanced
        messages={transcript(CREATE)}
        onSendMessage={vi.fn()}
        onToolApprove={vi.fn()}
        toolDecisions={{
          c1: { state: 'error', decision: 'approved', message: 'Not written: since the card was shown, these fields can no longer be set as proposed — status (not editable).' },
        }}
        {...LABELS}
      />,
    );
    const decision = screen.getByTestId('record-write-decision');
    expect(decision).toHaveAttribute('data-state', 'error');
    expect(decision).toHaveTextContent('status (not editable)');
  });
});

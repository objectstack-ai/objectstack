import { describe, it, expect } from 'vitest';
import { __testables } from './ImportWizard';
import type { ImportJobStatus } from '@object-ui/types';

const { isImportJobActive, isImportJobUndoable } = __testables;

describe('isImportJobActive', () => {
  it('is true only while a job is still in flight', () => {
    expect(isImportJobActive('pending')).toBe(true);
    expect(isImportJobActive('running')).toBe(true);
  });

  it('is false for every terminal status', () => {
    const terminal: ImportJobStatus[] = ['succeeded', 'failed', 'cancelled'];
    for (const s of terminal) expect(isImportJobActive(s)).toBe(false);
  });
});

describe('isImportJobUndoable', () => {
  const base = { status: 'succeeded' as ImportJobStatus, undoable: true, revertedAt: undefined };

  it('shows Undo for a terminal, undoable, not-yet-reverted job', () => {
    expect(isImportJobUndoable(base, true)).toBe(true);
  });

  it('hides Undo when the adapter cannot undo', () => {
    expect(isImportJobUndoable(base, false)).toBe(false);
  });

  it('hides Undo when the job did not capture an undo log', () => {
    expect(isImportJobUndoable({ ...base, undoable: false }, true)).toBe(false);
  });

  it('hides Undo once the job has been reverted', () => {
    expect(isImportJobUndoable({ ...base, revertedAt: '2026-07-01T00:00:00Z' }, true)).toBe(false);
  });

  it('hides Undo while the job is still active', () => {
    expect(isImportJobUndoable({ ...base, status: 'running' }, true)).toBe(false);
    expect(isImportJobUndoable({ ...base, status: 'pending' }, true)).toBe(false);
  });
});

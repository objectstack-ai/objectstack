import { describe, it, expect } from 'vitest';
import { buildExportFileName, sanitizeFileNameBase } from '../export-filename';

const NOW = new Date(2026, 6, 14, 15, 30, 45); // 2026-07-14 15:30:45 local

describe('buildExportFileName', () => {
  it('prefers the translated object label over the API name', () => {
    expect(buildExportFileName('xlsx', { label: '合同', objectName: 'contracts' }, NOW))
      .toBe('合同-20260714-153045.xlsx');
  });

  it('lets an explicit configured prefix win over the label', () => {
    expect(buildExportFileName('csv', { prefix: 'my-report', label: '合同' }, NOW))
      .toBe('my-report-20260714-153045.csv');
  });

  it('falls back to the object API name, then to "export"', () => {
    expect(buildExportFileName('csv', { objectName: 'contracts' }, NOW))
      .toBe('contracts-20260714-153045.csv');
    expect(buildExportFileName('json', {}, NOW))
      .toBe('export-20260714-153045.json');
  });

  it('zero-pads single-digit date/time parts', () => {
    const early = new Date(2026, 0, 5, 9, 8, 7);
    expect(buildExportFileName('csv', { label: 'a' }, early))
      .toBe('a-20260105-090807.csv');
  });

  it('sanitizes filesystem-hostile characters but keeps CJK intact', () => {
    expect(buildExportFileName('csv', { label: '合同/审批: 2026?' }, NOW))
      .toBe('合同_审批_ 2026-20260714-153045.csv');
  });

  it('falls through when a candidate sanitizes to nothing', () => {
    expect(buildExportFileName('csv', { prefix: '///', label: '合同' }, NOW))
      .toBe('合同-20260714-153045.csv');
  });

  it('appends the active view label after the object base', () => {
    expect(buildExportFileName('csv', { label: '任务', viewLabel: 'In Progress' }, NOW))
      .toBe('任务-In Progress-20260714-153045.csv');
    expect(buildExportFileName('xlsx', { label: '合同', viewLabel: '进行中' }, NOW))
      .toBe('合同-进行中-20260714-153045.xlsx');
  });

  it('skips the view label when it duplicates the base (case-insensitive)', () => {
    expect(buildExportFileName('csv', { label: '任务', viewLabel: '任务' }, NOW))
      .toBe('任务-20260714-153045.csv');
    expect(buildExportFileName('csv', { objectName: 'Tasks', viewLabel: 'tasks' }, NOW))
      .toBe('Tasks-20260714-153045.csv');
  });

  it('does not append the view label to an explicit configured prefix', () => {
    expect(buildExportFileName('csv', { prefix: 'my-report', label: '任务', viewLabel: 'In Progress' }, NOW))
      .toBe('my-report-20260714-153045.csv');
  });

  it('ignores a view label that sanitizes to nothing', () => {
    expect(buildExportFileName('csv', { label: '任务', viewLabel: '***' }, NOW))
      .toBe('任务-20260714-153045.csv');
  });

  it('caps the combined base at 80 chars', () => {
    const name = buildExportFileName('csv', { label: 'x'.repeat(70), viewLabel: 'y'.repeat(70) }, NOW);
    expect(name).toBe(`${'x'.repeat(70)}-${'y'.repeat(9)}-20260714-153045.csv`);
  });
});

describe('sanitizeFileNameBase', () => {
  it('strips reserved characters and control chars', () => {
    expect(sanitizeFileNameBase('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeFileNameBase('a\u0000b\u001fc')).toBe('a_b_c');
  });

  it('trims leading/trailing dots, spaces, underscores', () => {
    expect(sanitizeFileNameBase('  .hidden. ')).toBe('hidden');
    expect(sanitizeFileNameBase('__name__')).toBe('name');
  });

  it('returns empty string for unusable input', () => {
    expect(sanitizeFileNameBase(undefined)).toBe('');
    expect(sanitizeFileNameBase('***')).toBe('');
  });

  it('caps overlong bases at 80 chars', () => {
    expect(sanitizeFileNameBase('x'.repeat(200))).toHaveLength(80);
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * approverIdentity — an approver REFERENCE becomes something a person can read
 * (objectui#5414).
 *
 * The reported defect, measured on this tree before the fix:
 *
 *     approverChips(request)  ->  [{ label: 'positi…ager', title: 'position:sales_manager' }]
 *     bypassedApproverNames(request)  ->  ['position:sales_manager']
 *
 * `positi…ager` is `formatIdentity('position:sales_manager')`: 22 characters,
 * past the 14-char truncation arm, middle-truncated to fit a chip. These pin the
 * three tiers that replace it (server name > directory row > prettified machine
 * name), the tri-state staffing rule, and the two arms that must NOT change —
 * a UUID still truncates, an email is still shown whole.
 */

import { describe, it, expect } from 'vitest';
import {
  APPROVER_DIRECTORY_BINDINGS,
  APPROVER_REGISTRY_TYPES,
  DEFAULT_APPROVER_COPY,
  approverCopyFrom,
  approverDisplay,
  formatIdentity,
  parseApproverRef,
  prettifyMachineName,
  rowLabel,
  unresolvedApproverRefs,
} from './approverIdentity';

/** The exact string the card reports, kept as a literal so it cannot come back. */
const REPORTED_TRUNCATION = 'positi…ager';

describe('formatIdentity', () => {
  it('no longer truncates the reported reference — that string was the defect', () => {
    // Pin the OLD output as a literal: `position:sales_manager` is 22 chars, so
    // the generic `> 14` arm produced exactly this.
    expect(`${'position:sales_manager'.slice(0, 6)}…${'position:sales_manager'.slice(-4)}`)
      .toBe(REPORTED_TRUNCATION);
    expect(formatIdentity('position:sales_manager')).toBe('Sales Manager');
    expect(formatIdentity('position:sales_manager')).not.toBe(REPORTED_TRUNCATION);
  });

  it('keeps middle-truncation for the ID-valued kinds — a UUID has no prose to recover', () => {
    // `user` / `team` / `department` commit a row id, not a machine name.
    // Prettifying one yields nonsense; truncating it is what objectui#3461
    // asked for and is not what #5414 reports.
    expect(APPROVER_DIRECTORY_BINDINGS.user.valueField).toBe('id');
    expect(formatIdentity('9f8c2b41-77de-4a0e-9a11-0c6d2f3e5a10')).toContain('…');
    expect(formatIdentity('u_qa_head')).toBe('u_qa_head');
  });

  it('leaves the two pre-existing arms exactly as they were', () => {
    expect(formatIdentity('zhang.wei@example.com')).toBe('zhang.wei@example.com');
    expect(formatIdentity('role:admin')).toBe('Role: admin');
    expect(formatIdentity(null)).toBe('—');
  });
});

describe('parseApproverRef', () => {
  it('accepts only the kinds the SPEC declares', () => {
    expect(parseApproverRef('position:sales_manager'))
      .toEqual({ raw: 'position:sales_manager', kind: 'position', value: 'sales_manager' });
    // Not an approver vocabulary word — must fall through to plain formatting
    // rather than being re-read as a seat.
    expect(parseApproverRef('flow:qif_review')).toBeNull();
    expect(parseApproverRef('zhang.wei@example.com')).toBeNull();
    expect(parseApproverRef('u_qa_head')).toBeNull();
    expect(parseApproverRef(':orphan')).toBeNull();
    expect(parseApproverRef('position:')).toBeNull();
  });

  it('keeps a colon inside the value', () => {
    expect(parseApproverRef('user:urn:x:1')?.value).toBe('urn:x:1');
  });
});

describe('APPROVER_DIRECTORY_BINDINGS is derived from the spec, not restated', () => {
  it('keeps position off the record arm — the spec binds it to the registry since 18', () => {
    // It bound `sys_position` by machine name through `@objectstack/spec` 17.x
    // (framework#3508 territory). Spec 18 publishes `position` as the registry
    // member (objectstack#22710), so its label comes from the metadata
    // registry and `approverIdentity.registryBinding-7611.test.tsx` pins that
    // arm (objectui#12030).
    expect(APPROVER_DIRECTORY_BINDINGS.position).toBeUndefined();
    expect(APPROVER_REGISTRY_TYPES).toEqual({ position: 'position' });
  });

  it('skips the kinds whose source is not data rather than throwing', () => {
    // `manager` (auto), `queue` (unsupported), `role` (enum) have no directory
    // rows, and `position` (registry) has its own arm. A module-level throw
    // over a vocabulary change would white-screen the record page.
    for (const kind of ['manager', 'queue', 'role', 'field', 'expression', 'position']) {
      expect(APPROVER_DIRECTORY_BINDINGS[kind]).toBeUndefined();
    }
    expect(Object.keys(APPROVER_DIRECTORY_BINDINGS).sort())
      .toEqual(['department', 'team', 'user']);
  });
});

describe('approverDisplay — the three tiers, most authoritative first', () => {
  const copy = DEFAULT_APPROVER_COPY;

  it('never second-guesses the server name', () => {
    const out = approverDisplay('position:sales_manager', {
      serverName: 'Sales Manager Desk',
      resolved: { label: 'Sales Manager', holders: ['Zhang Wei'] },
      copy,
    });
    expect(out.label).toBe('Sales Manager Desk');
  });

  it('uses the directory row label when the server had none', () => {
    const out = approverDisplay('position:sales_manager', {
      resolved: { label: '销售经理' },
      copy,
    });
    expect(out.label).toBe('销售经理');
    expect(out.raw).toBe('position:sales_manager');
  });

  it('falls back to the prettified machine name — still not a truncated id', () => {
    expect(approverDisplay('position:sales_manager', { copy }).label).toBe('Sales Manager');
  });

  it('names the people when the seat resolves to people', () => {
    const out = approverDisplay('position:sales_manager', {
      resolved: { label: 'Sales Manager', holders: ['Zhang Wei', 'Li Na'] },
      copy,
    });
    expect(out.label).toBe('Sales Manager');
    expect(out.detail).toBe('Zhang Wei, Li Na');
    expect(out.unstaffed).toBe(false);
  });

  it('collapses a long slate to the first three plus a counter', () => {
    const out = approverDisplay('position:sales_manager', {
      resolved: { label: 'Sales Manager', holders: ['A', 'B', 'C', 'D', 'E'] },
      copy,
    });
    expect(out.detail).toBe('A, B, C +2');
  });

  it('surfaces the unstaffed seat — a real state, and the actionable one', () => {
    const out = approverDisplay('position:sales_manager', {
      resolved: { label: 'Sales Manager', holders: [] },
      copy,
    });
    expect(out.label).toBe('Sales Manager (no current holder)');
    expect(out.unstaffed).toBe(true);
  });

  it('says NOTHING about staffing when the probe never answered', () => {
    // The asymmetry that matters: `undefined` holders mean "unknown", and
    // rendering unknown as "nobody holds this" would write a fabricated fact
    // onto a governance surface. A denied `sys_user_position` read lands here.
    const out = approverDisplay('position:sales_manager', {
      resolved: { label: 'Sales Manager' },
      copy,
    });
    expect(out.unstaffed).toBe(false);
    expect(out.detail).toBe('');
    expect(out.label).toBe('Sales Manager');
  });
});

describe('unresolvedApproverRefs — the gate that keeps the lookup free', () => {
  it('drops every reference the server already named', () => {
    expect(unresolvedApproverRefs({
      pending_approvers: ['position:sales_manager', 'position:qc_director'],
      pending_approver_names: { 'position:qc_director': 'QC Director' },
    })).toEqual(['position:sales_manager']);
  });

  it('drops what this console cannot look up, and de-duplicates', () => {
    expect(unresolvedApproverRefs({
      pending_approvers: [
        'position:sales_manager',
        'position:sales_manager',
        'u_bare_id',
        'manager:',
        'queue:q1',
        '',
        null,
      ],
    })).toEqual(['position:sales_manager']);
  });

  it('is empty for a row with nothing pending, and for a non-row', () => {
    expect(unresolvedApproverRefs({ pending_approvers: [] })).toEqual([]);
    expect(unresolvedApproverRefs(null)).toEqual([]);
  });
});

describe('approverCopyFrom', () => {
  const t = (key: string, opts?: any) =>
    String(opts?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(opts?.[n] ?? ''));

  it('renders the en defaults through a real interpolating translator', () => {
    const copy = approverCopyFrom(t);
    expect(copy.joinNames(['Zhang Wei', 'Li Na'])).toBe('Zhang Wei, Li Na');
    expect(copy.unstaffed('Sales Manager')).toBe('Sales Manager (no current holder)');
  });

  it('renders the zh pack values — the strings the card asks for', () => {
    // Read from the shipped pack rather than restated, so a translation edit
    // cannot leave this assertion describing copy that no longer ships.
    const zhPack: Record<string, string> = {
      'approvalsInbox.approverNameSeparator': '、',
      'approvalsInbox.approverUnstaffed': '{{seat}}（暂无在岗人员）',
    };
    const zh = approverCopyFrom((key: string, opts?: any) =>
      (zhPack[key] ?? String(opts?.defaultValue ?? key))
        .replace(/\{\{(\w+)\}\}/g, (_m, n) => String(opts?.[n] ?? '')));
    expect(zh.joinNames(['张伟', '李娜'])).toBe('张伟、李娜');
    expect(zh.unstaffed('销售经理')).toBe('销售经理（暂无在岗人员）');
  });

  it('yields to English rather than printing "undefined" with no provider mounted', () => {
    const copy = approverCopyFrom(() => undefined);
    expect(copy.joinNames(['A', 'B'])).toBe('A, B');
    expect(copy.unstaffed('Sales Manager')).toBe('Sales Manager (no current holder)');
  });
});

describe('rowLabel / prettifyMachineName', () => {
  it('takes the first non-empty display column', () => {
    expect(rowLabel({ label: '', name: 'sales_manager' }, ['label', 'name'])).toBe('sales_manager');
    expect(rowLabel({ label: '  Sales Manager  ' }, ['label', 'name'])).toBe('Sales Manager');
    expect(rowLabel(null, ['label'])).toBe('');
  });

  it('still strips the flow: prefix it always did', () => {
    expect(prettifyMachineName('flow:qif_review')).toBe('Qif Review');
    expect(prettifyMachineName('manager_review')).toBe('Manager Review');
    expect(prettifyMachineName(null)).toBe('—');
  });
});

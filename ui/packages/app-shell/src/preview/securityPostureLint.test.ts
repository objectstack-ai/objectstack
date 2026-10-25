// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pre-publish security-posture lint — objectui#5418.
 *
 * The card's walk: create an object through Studio's `新建对象`, design its
 * form, save the draft twice, press 发布 → 全部发布, and only THEN meet
 * `security-owd-unset`. This module is the half that moves the same rule one
 * click earlier, into the review sheet.
 *
 * Two things need pinning, and they are different claims:
 *
 *  1. The pass reports what the door would refuse, and stays silent otherwise
 *     — driven with an INJECTED rule so the assertions are about this module's
 *     own plumbing (which drafts it reads, which severities it keeps, how it
 *     maps a positional finding back to a draft name).
 *  2. The REAL `@objectstack/lint` behaves as this module assumes when handed
 *     an objects-only stack. That assumption is load-bearing and invisible:
 *     the pass deliberately supplies no permissions/positions/apps/books, and
 *     if some rule read that absence as a violation the sheet would cry wolf
 *     next to a Publish button. Asserted against the installed package rather
 *     than reasoned about.
 */

import { describe, it, expect, vi } from 'vitest';
import { lintDraftSecurityPosture, type SecurityPostureFinding } from './securityPostureLint';

const draft = (name: string) => ({ type: 'object', name, packageId: 'com.test.crmext' });

/** A client whose `getDraft` serves the given bodies by name. */
function clientOf(bodies: Record<string, Record<string, unknown>>) {
  return {
    getDraft: vi.fn(async (_type: string, name: string) =>
      // The framework wraps draft reads in `{ type, name, item }`; unwrapping
      // that envelope is part of what this module is responsible for.
      name in bodies ? { type: 'object', name, item: bodies[name] } : null,
    ),
  };
}

describe('lintDraftSecurityPosture — plumbing (injected rule)', () => {
  const owdUnset: SecurityPostureFinding = {
    severity: 'error',
    rule: 'security-owd-unset',
    where: 'object "crmext_visit"',
    path: 'objects[0].sharingModel',
    message: 'custom object "crmext_visit" declares no sharingModel (OWD).',
    hint: "Declare sharingModel explicitly: 'private' (owner + shares; recommended default), …",
  };

  it('anchors a positional finding back onto the draft that carries it', async () => {
    const problems = await lintDraftSecurityPosture(
      clientOf({ crmext_visit: { name: 'crmext_visit', label: '客户拜访' } }),
      [draft('crmext_visit')],
      () => [owdUnset],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].name).toBe('crmext_visit');
    expect(problems[0].rule).toBe('security-owd-unset');
    // The HINT is the actionable half — it is what the sheet renders.
    expect(problems[0].hint).toContain('sharingModel');
  });

  it('keeps only blocking findings — advisory severities are not shown beside Publish', async () => {
    const problems = await lintDraftSecurityPosture(
      clientOf({ crmext_visit: { name: 'crmext_visit' } }),
      [draft('crmext_visit')],
      () => [
        { ...owdUnset, severity: 'warning', rule: 'security-master-detail-ungranted' },
        { ...owdUnset, severity: 'info', rule: 'security-private-no-readscope' },
      ],
    );
    expect(problems).toEqual([]);
  });

  it('passes ONLY object drafts to the rule, in the order it will index them', async () => {
    const rule = vi.fn((_stack: Record<string, unknown>): SecurityPostureFinding[] => []);
    await lintDraftSecurityPosture(
      clientOf({ a: { name: 'a' }, b: { name: 'b' } }),
      [draft('a'), { type: 'flow', name: 'f', packageId: null }, draft('b')],
      rule,
    );
    expect(rule).toHaveBeenCalledTimes(1);
    const stack = rule.mock.calls[0][0] as unknown as { objects: Array<{ name: string }> };
    expect(stack.objects.map((o) => o.name)).toEqual(['a', 'b']);
  });

  it('skips a draft whose body cannot be read, and still indexes the rest correctly', async () => {
    // `a` 404s; the surviving object must be `objects[0]`, so a finding on
    // index 0 must anchor to `b` and never to the draft that was dropped.
    const problems = await lintDraftSecurityPosture(
      clientOf({ b: { name: 'b' } }),
      [draft('a'), draft('b')],
      () => [{ ...owdUnset, where: 'object "b"', path: 'objects[0].sharingModel' }],
    );
    expect(problems.map((p) => p.name)).toEqual(['b']);
  });

  it('is a no-op when the rule is unavailable — an old lint must not block publish', async () => {
    const problems = await lintDraftSecurityPosture(
      clientOf({ crmext_visit: { name: 'crmext_visit' } }),
      [draft('crmext_visit')],
      null,
    );
    expect(problems).toEqual([]);
  });

  it('swallows a throwing rule — the lint is advisory and never breaks the sheet', async () => {
    const problems = await lintDraftSecurityPosture(
      clientOf({ crmext_visit: { name: 'crmext_visit' } }),
      [draft('crmext_visit')],
      () => {
        throw new Error('rule exploded');
      },
    );
    expect(problems).toEqual([]);
  });
});

describe('lintDraftSecurityPosture — against the REAL @objectstack/lint', () => {
  it('reports the card’s own defect: an object created without an OWD', async () => {
    const problems = await lintDraftSecurityPosture(
      clientOf({
        crmext_visit: {
          name: 'crmext_visit',
          label: '客户拜访',
          fields: { name: { type: 'text', label: '名称' } },
        },
      }),
      [draft('crmext_visit')],
    );
    expect(problems.map((p) => p.rule)).toContain('security-owd-unset');
    expect(problems.find((p) => p.rule === 'security-owd-unset')?.name).toBe('crmext_visit');
  });

  it('says NOTHING about the same object once the baseline is authored', async () => {
    // This is the fix the create dialog now performs by construction: the very
    // same body plus the `sharingModel` the dialog asks for.
    const problems = await lintDraftSecurityPosture(
      clientOf({
        crmext_visit: {
          name: 'crmext_visit',
          label: '客户拜访',
          sharingModel: 'private',
          fields: { name: { type: 'text', label: '名称' } },
        },
      }),
      [draft('crmext_visit')],
    );
    expect(problems).toEqual([]);
  });

  it('an objects-only stack produces no phantom errors from the collections it omits', async () => {
    // The counter-probe for this module's central simplification. Every OWD
    // value the create dialog can produce must come back clean; if handing the
    // rule a stack with no permissions/positions/apps ever manufactured an
    // error, the sheet would warn about correct packages.
    for (const sharingModel of ['private', 'public_read', 'public_read_write']) {
      const problems = await lintDraftSecurityPosture(
        clientOf({ ok_obj: { name: 'ok_obj', label: 'Fine', sharingModel, fields: {} } }),
        [draft('ok_obj')],
      );
      expect(problems, `unexpected findings for sharingModel=${sharingModel}`).toEqual([]);
    }
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11779 — `deriveFlowRunStatus`, the one run status the Automations
 * rail, the flow header and the Problems panel read, case by case.
 *
 * The rail and header pins through the real pillar live in
 * `StudioDesignSurface.flowStatusTruth-11779.test.tsx`; this file pins the
 * derivation's table on its own, including the two readings the pillar cannot
 * show: a disabled row, and the draft-only reading a host without `_status`
 * gets (the metadata-admin page renders the same preview with no runtime).
 */

import { describe, it, expect } from 'vitest';
import { deriveFlowRunStatus, describeFlowRunStatus } from './flow-problems';
import { t } from '../i18n';
import { FLOW_UNBOUND_CAUSES } from '@objectstack/spec/contracts';

const REASON = 'FIXTURE: the platform sentence, shown as sent.';

describe('deriveFlowRunStatus — from a runtime row (objectui#11779)', () => {
  it('enabled and bound: on', () => {
    expect(deriveFlowRunStatus({ enabled: true, bound: true, triggerType: 'record_change' })).toEqual({ kind: 'on' });
  });

  it('enabled with no declared trigger: manual, which reads On — never "not running"', () => {
    const s = deriveFlowRunStatus({ enabled: true, bound: false });
    expect(s).toEqual({ kind: 'manual' });
    expect(describeFlowRunStatus(s, 'en').label).toBe(t('engine.studio.auto.on', 'en'));
  });

  it('enabled, a declared trigger, not bound: not-running, with the platform reason when sent', () => {
    expect(deriveFlowRunStatus({ enabled: true, bound: false, triggerType: 'schedule', reason: REASON })).toEqual({
      kind: 'not-running',
      reason: REASON,
    });
    expect(deriveFlowRunStatus({ enabled: true, bound: false, triggerType: 'schedule' })).toEqual({ kind: 'not-running' });
  });

  it('the reason is the hover text verbatim, in every locale; without one, the designer row says only "not armed"', () => {
    const withReason = deriveFlowRunStatus({ enabled: true, bound: false, triggerType: 'schedule', reason: REASON });
    expect(describeFlowRunStatus(withReason, 'zh-CN').title).toBe(REASON);
    const without = deriveFlowRunStatus({ enabled: true, bound: false, triggerType: 'schedule' });
    expect(describeFlowRunStatus(without, 'en').title).toBe(t('engine.studio.auto.notRunningTitle', 'en'));
    expect(describeFlowRunStatus(without, 'en').label).toBe(t('engine.studio.auto.notRunning', 'en'));
  });

  it('disabled: off, whatever the binding says', () => {
    expect(deriveFlowRunStatus({ enabled: false, bound: false, triggerType: 'schedule' })).toEqual({ kind: 'off' });
    expect(deriveFlowRunStatus({ enabled: false, bound: true })).toEqual({ kind: 'off' });
  });

  it('the runtime row outranks the draft: a row decides, whatever `status` the draft holds', () => {
    expect(deriveFlowRunStatus({ enabled: true, bound: true }, 'obsolete')).toEqual({ kind: 'on' });
  });
});

describe('deriveFlowRunStatus — without a runtime row (objectui#11779)', () => {
  it('`null` (the engine has no row for the flow): unpublished', () => {
    expect(deriveFlowRunStatus(null, 'active')).toEqual({ kind: 'unpublished' });
  });

  it('no runtime reading: the draft switch as the engine reads it — no key and `draft` are ON, never "draft"', () => {
    for (const status of [undefined, 'draft', 'active']) {
      const s = deriveFlowRunStatus(undefined, status);
      expect(s, String(status)).toEqual({ kind: 'enabled' });
      expect(describeFlowRunStatus(s, 'en').label).toBe(t('engine.studio.auto.enabled', 'en'));
    }
    for (const status of ['obsolete', 'invalid']) {
      expect(deriveFlowRunStatus(undefined, status), status).toEqual({ kind: 'disabled' });
    }
  });

  it('no reading is ever worded as an error', () => {
    const all = [
      deriveFlowRunStatus({ enabled: true, bound: true }),
      deriveFlowRunStatus({ enabled: true, bound: false }),
      deriveFlowRunStatus({ enabled: true, bound: false, triggerType: 'schedule', reason: REASON }),
      deriveFlowRunStatus({ enabled: false, bound: false }),
      deriveFlowRunStatus(null),
      deriveFlowRunStatus(undefined, 'active'),
      deriveFlowRunStatus(undefined, 'obsolete'),
    ];
    for (const s of all) {
      const view = describeFlowRunStatus(s, 'en');
      expect(['green', 'muted', 'amber', 'plain']).toContain(view.tone);
      expect(view.label, s.kind).not.toBe('');
    }
  });
});

describe('the not-running note words a known cause in the console language (objectstack#30039)', () => {
  const MISSING = "no 'record_change' trigger is registered — add requires: ['triggers']";
  const missingRow = {
    enabled: true,
    bound: false,
    triggerType: 'record_change',
    reason: MISSING,
    unboundCause: 'missing_trigger',
  };

  it('carries the engine cause code beside the reason, and only when the row sends one', () => {
    expect(deriveFlowRunStatus(missingRow)).toEqual({ kind: 'not-running', reason: MISSING, cause: 'missing_trigger' });
    expect(deriveFlowRunStatus({ enabled: true, bound: false, triggerType: 'schedule', reason: REASON })).toEqual({
      kind: 'not-running',
      reason: REASON,
    });
  });

  it('a known cause reads its designer row in zh and en; the platform sentence moves to the detail', () => {
    const s = deriveFlowRunStatus(missingRow);
    for (const locale of ['zh-CN', 'en']) {
      const view = describeFlowRunStatus(s, locale);
      expect(view.title).toBe(t('engine.studio.auto.unboundCause.missing_trigger', locale));
      expect(view.detail).toBe(MISSING);
    }
    const zh = describeFlowRunStatus(s, 'zh-CN').title ?? '';
    expect(zh).toMatch(/[一-鿿]/);
    expect(zh).not.toBe(t('engine.studio.auto.unboundCause.missing_trigger', 'en'));
  });

  it('every contract cause has a row in both tables', () => {
    for (const cause of FLOW_UNBOUND_CAUSES) {
      for (const locale of ['zh-CN', 'en']) {
        const key = `engine.studio.auto.unboundCause.${cause}`;
        expect(t(key, locale), `${cause} @ ${locale}`).not.toBe(key);
      }
    }
  });

  it('a cause the console has no row for keeps the platform sentence as the title — the control', () => {
    const view = describeFlowRunStatus(deriveFlowRunStatus({ ...missingRow, reason: REASON, unboundCause: 'added_later' }), 'zh-CN');
    expect(view.title).toBe(REASON);
    expect(view.detail).toBeUndefined();
  });
});

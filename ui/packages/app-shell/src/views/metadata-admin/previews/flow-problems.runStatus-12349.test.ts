// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12349 — `deriveFlowRunStatus` reads the engine's registration
 * verdict (objectstack#23316), which the flow metadata read serves beside the
 * item: one pin per verdict, plus absence.
 *
 * The verdicts are built from the spec's own `FlowRegistrationSchema`, so a
 * fixture that stops being a verdict the platform can send fails here first.
 * The refusal message is fixture text, ⛔ not an engine sentence: the surfaces
 * show whatever string arrives, so any string proves "as sent".
 *
 * The rail and header pins through the real pillar live in
 * `StudioDesignSurface.flowRegistration-12349.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { FlowRegistrationSchema, type FlowRegistration } from '@objectstack/spec/api';
import { deriveFlowRunStatus, describeFlowRunStatus } from './flow-problems';
import { t } from '../i18n';

const MESSAGE = 'FIXTURE: what the engine threw for this flow, shown as sent — e.g. "node x: unknown key `y`".';

const verdict = (v: unknown): FlowRegistration => FlowRegistrationSchema.parse(v) as FlowRegistration;

const REFUSED = verdict({ state: 'refused', reason: { message: MESSAGE, code: 'FIXTURE_CODE' } });
const UNREGISTERED = verdict({ state: 'unregistered' });
const REGISTERED = verdict({ state: 'registered' });

/** Every runtime reading the host can hand over: a row, "the engine has no row", no reading. */
const RUNTIMES = [
  { enabled: true, bound: true, triggerType: 'record_change' },
  null,
  undefined,
] as const;

describe('deriveFlowRunStatus — the engine refused the flow (objectui#12349)', () => {
  it('reads refused, whatever the runtime reading and the stored `status`, carrying `reason.message` as sent', () => {
    for (const runtime of RUNTIMES) {
      for (const stored of ['active', undefined, 'obsolete']) {
        expect(deriveFlowRunStatus(runtime, stored, REFUSED), `${JSON.stringify(runtime)} / ${stored}`).toEqual({
          kind: 'refused',
          message: MESSAGE,
        });
      }
    }
  });

  it('is worded "Refused by the engine", titled with the message verbatim in every locale — never "enabled" or "unpublished"', () => {
    const s = deriveFlowRunStatus(null, 'active', REFUSED);
    for (const locale of ['en', 'zh-CN']) {
      const view = describeFlowRunStatus(s, locale);
      expect(view.label).toBe(t('engine.studio.auto.refused', locale));
      expect(view.title).toBe(MESSAGE);
    }
    const view = describeFlowRunStatus(s, 'en');
    expect(view.label).not.toBe(t('engine.studio.auto.enabled', 'en'));
    expect(view.label).not.toBe(t('engine.studio.unpublishedDraft', 'en'));
    expect(view.tone).toBe('amber');
  });

  it('does not read the message: its text never changes the reading', () => {
    const other = verdict({ state: 'refused', reason: { message: 'registered enabled on bound' } });
    expect(deriveFlowRunStatus({ enabled: true, bound: true }, 'active', other)).toEqual({
      kind: 'refused',
      message: 'registered enabled on bound',
    });
  });
});

describe('deriveFlowRunStatus — the engine holds no registration (objectui#12349)', () => {
  it('reads unregistered, whatever the runtime reading — never running', () => {
    for (const runtime of RUNTIMES) {
      expect(deriveFlowRunStatus(runtime, 'active', UNREGISTERED), JSON.stringify(runtime)).toEqual({ kind: 'unregistered' });
    }
  });

  it('is worded with the existing "Not running here" label, titled by its own row, and not as an error', () => {
    const view = describeFlowRunStatus(deriveFlowRunStatus(undefined, 'active', UNREGISTERED), 'en');
    expect(view.label).toBe(t('engine.studio.auto.notRunning', 'en'));
    expect(view.title).toBe(t('engine.studio.auto.unregisteredTitle', 'en'));
    expect(view.tone).toBe('muted');
  });
});

describe('deriveFlowRunStatus — a registered verdict reads as today (objectui#12349)', () => {
  it('leaves every runtime reading exactly as it read without the verdict', () => {
    for (const runtime of RUNTIMES) {
      for (const stored of ['active', 'obsolete']) {
        expect(deriveFlowRunStatus(runtime, stored, REGISTERED)).toEqual(deriveFlowRunStatus(runtime, stored));
      }
    }
  });
});

describe('deriveFlowRunStatus — no verdict reads as today (objectui#12349)', () => {
  it('absence is no engine judging the flow, not `registered`: the reading is the two-argument one', () => {
    expect(deriveFlowRunStatus({ enabled: true, bound: true }, 'active', undefined)).toEqual({ kind: 'on' });
    expect(deriveFlowRunStatus(null, 'active', undefined)).toEqual({ kind: 'unpublished' });
    expect(deriveFlowRunStatus(undefined, 'active', undefined)).toEqual({ kind: 'enabled' });
    expect(deriveFlowRunStatus(undefined, 'obsolete', undefined)).toEqual({ kind: 'disabled' });
  });
});

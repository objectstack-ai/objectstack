// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The Automations rail's per-flow status dot (UX #6): a flow's live enable state
// must be visible at a glance, from the engine's runtime `_status` — not left to
// guess. Renders nothing for a flow the engine doesn't know yet (never published).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowStatusDot } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

describe('FlowStatusDot', () => {
  it('shows a green "On" for an enabled flow', () => {
    render(<FlowStatusDot state={{ enabled: true, bound: true }} locale="en" />);
    expect(screen.getByText('On')).toBeTruthy();
  });

  it('shows "Off" for a disabled flow', () => {
    render(<FlowStatusDot state={{ enabled: false, bound: false }} locale="en" />);
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('renders nothing when the flow has no runtime state (never published)', () => {
    const { container } = render(<FlowStatusDot state={undefined} locale="en" />);
    expect(container.firstChild).toBeNull();
  });

  it('distinguishes bound vs unbound (no-trigger) enabled flows in its tooltip', () => {
    const { rerender } = render(<FlowStatusDot state={{ enabled: true, bound: true }} locale="en" />);
    expect(screen.getByTitle(/bound to its trigger/i)).toBeTruthy();
    rerender(<FlowStatusDot state={{ enabled: true, bound: false }} locale="en" />);
    expect(screen.getByTitle(/no trigger/i)).toBeTruthy();
  });
});

/**
 * objectui#11281 — `bound: false` is not "no trigger".
 *
 * `FlowRuntimeState.bound` (`@objectstack/spec`) is false both for a flow that
 * declares no trigger and for one whose declared trigger the engine has not
 * armed, and the contract says `triggerType` tells the two apart. `reason` is
 * the platform's sentence for why such a flow is not armed: it is rendered,
 * never parsed (objectui#9217 ruling B, delivered on the Setup page by PR
 * objectui#11271).
 *
 * The reason below is fixture text, deliberately NOT a platform sentence: the
 * dot shows whatever string arrives, so any string proves "verbatim", and no
 * platform wording is copied into this repo.
 *
 * The assertions name the locale KEY each title must come from rather than its
 * English text, so a reworded title cannot turn these pins green or red.
 */
describe('FlowStatusDot — a declared trigger the engine has not armed (objectui#11281)', () => {
  const REASON = 'FIXTURE: the platform sentence for why this flow is not armed — shown as sent, never parsed.';

  const dot = (container: HTMLElement) => container.querySelector('span[title]') as HTMLElement;

  it('titles a policy-unbound schedule flow with its reason, verbatim — not "no trigger"', () => {
    const { container } = render(
      <FlowStatusDot state={{ enabled: true, bound: false, triggerType: 'schedule', reason: REASON }} locale="en" />,
    );
    const el = dot(container);
    expect(el.getAttribute('title')).toBe(REASON);
    expect(el.getAttribute('title')).not.toBe(t('engine.studio.auto.onUnbound', 'en'));
    // objectui#11779 — and it says, without hovering, that the deployment does
    // not run it: a grey "Not running here", not the green "On" of a flow that
    // runs. Still nothing is styled as an error: a policy is not a defect.
    expect(el.textContent).toBe(t('engine.studio.auto.notRunning', 'en'));
    expect(el.textContent).not.toBe(t('engine.studio.auto.on', 'en'));
    expect(container.querySelector('.bg-emerald-500')).toBeNull();
    expect(container.innerHTML).not.toMatch(/emerald/);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/destructive/);
  });

  it('shows the reason verbatim in every locale — it is the platform\'s text, not a key', () => {
    const { container } = render(
      <FlowStatusDot state={{ enabled: true, bound: false, triggerType: 'schedule', reason: REASON }} locale="zh" />,
    );
    expect(dot(container).getAttribute('title')).toBe(REASON);
  });

  it('a flow with no declared trigger (no `triggerType`) still says "no trigger", and still reads "On" — the control', () => {
    const { container } = render(<FlowStatusDot state={{ enabled: true, bound: false }} locale="en" />);
    expect(dot(container).getAttribute('title')).toBe(t('engine.studio.auto.onUnbound', 'en'));
    // objectui#11779 — a manual flow runs when invoked: never "not running".
    expect(dot(container).textContent).toBe(t('engine.studio.auto.on', 'en'));
    expect(container.querySelector('.bg-emerald-500')).not.toBeNull();
  });

  it('a declared trigger with no reason (a backend older than `reason`) reads "Not running here", never "no trigger"', () => {
    const { container } = render(
      <FlowStatusDot state={{ enabled: true, bound: false, triggerType: 'record_change' }} locale="en" />,
    );
    // objectui#11779 — `bound: false` WITH a `triggerType` is the contract's
    // "declared trigger type has no registered trigger": not armed here, whatever
    // the reason. Without the platform's sentence the title says only that.
    expect(dot(container).textContent).toBe(t('engine.studio.auto.notRunning', 'en'));
    expect(dot(container).getAttribute('title')).toBe(t('engine.studio.auto.notRunningTitle', 'en'));
    expect(dot(container).getAttribute('title')).not.toBe(t('engine.studio.auto.onUnbound', 'en'));
  });

  it('a bound flow and a disabled flow keep their titles, whatever `triggerType` says — the controls', () => {
    const { container, rerender } = render(
      <FlowStatusDot state={{ enabled: true, bound: true, triggerType: 'schedule' }} locale="en" />,
    );
    expect(dot(container).getAttribute('title')).toBe(t('engine.studio.auto.onBound', 'en'));
    rerender(<FlowStatusDot state={{ enabled: false, bound: false, triggerType: 'schedule' }} locale="en" />);
    expect(dot(container).getAttribute('title')).toBe(t('engine.studio.auto.offTitle', 'en'));
    expect(dot(container).textContent).toBe(t('engine.studio.auto.off', 'en'));
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12349 — the Automations rail's status reads the engine's
 * registration verdict (objectstack#23316). A refused flow has no runtime row,
 * so the dot used to render nothing for it; one pin per verdict, plus absence.
 *
 * The refusal message is fixture text, ⛔ not an engine sentence. Assertions
 * name the designer-table KEY each string comes from.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FlowStatusDot } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

const MESSAGE = 'FIXTURE: what the engine threw for this flow, shown as sent.';

const chip = (container: HTMLElement) => container.querySelector('span[title]') as HTMLElement | null;

describe('FlowStatusDot — the engine registration verdict (objectui#12349)', () => {
  it('refused, with no runtime row: an amber "Refused by the engine" chip titled with the message as sent', () => {
    for (const locale of ['en', 'zh']) {
      const { container, unmount } = render(
        <FlowStatusDot state={undefined} registration={{ state: 'refused', reason: { message: MESSAGE } }} locale={locale} />,
      );
      const el = chip(container);
      expect(el).not.toBeNull();
      expect(el!.textContent).toBe(t('engine.studio.auto.refused', locale));
      expect(el!.getAttribute('title')).toBe(MESSAGE);
      expect(container.innerHTML).toMatch(/amber/);
      expect(container.innerHTML).not.toMatch(/emerald/);
      unmount();
    }
  });

  it('refused outranks a runtime row that reads On', () => {
    const { container } = render(
      <FlowStatusDot
        state={{ enabled: true, bound: true }}
        registration={{ state: 'refused', reason: { message: MESSAGE, code: 'FIXTURE_CODE' } }}
        locale="en"
      />,
    );
    expect(chip(container)!.textContent).toBe(t('engine.studio.auto.refused', 'en'));
    expect(container.innerHTML).not.toMatch(/emerald/);
  });

  it('unregistered, with no runtime row: the grey "Not running here" chip, titled by its own row', () => {
    const { container } = render(<FlowStatusDot state={undefined} registration={{ state: 'unregistered' }} locale="en" />);
    const el = chip(container)!;
    expect(el.textContent).toBe(t('engine.studio.auto.notRunning', 'en'));
    expect(el.getAttribute('title')).toBe(t('engine.studio.auto.unregisteredTitle', 'en'));
    expect(container.innerHTML).not.toMatch(/emerald/);
  });

  it('registered reads as today: the row decides, and no row still renders nothing', () => {
    const { container, rerender } = render(
      <FlowStatusDot state={{ enabled: true, bound: true }} registration={{ state: 'registered' }} locale="en" />,
    );
    expect(chip(container)!.getAttribute('title')).toBe(t('engine.studio.auto.onBound', 'en'));
    expect(container.textContent).toBe(t('engine.studio.auto.on', 'en'));
    rerender(<FlowStatusDot state={undefined} registration={{ state: 'registered' }} locale="en" />);
    expect(container.firstChild).toBeNull();
  });

  it('no verdict reads as today: the row decides, and no row renders nothing', () => {
    const { container, rerender } = render(<FlowStatusDot state={{ enabled: false, bound: false }} locale="en" />);
    expect(container.textContent).toBe(t('engine.studio.auto.off', 'en'));
    rerender(<FlowStatusDot state={undefined} registration={undefined} locale="en" />);
    expect(container.firstChild).toBeNull();
  });
});

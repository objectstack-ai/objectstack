/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Studio widget config panel must never author a retired widget-level
 * action key (objectstack#7129).
 *
 * `actionUrl` / `actionType` / `actionIcon` were retired at the widget level in
 * @objectstack/spec 17.0.0-rc.3 (objectstack#5010, ADR-0049 D2). They are
 * `retiredKey` tombstones: `DashboardWidgetSchema` types them `never` and
 * REFUSES any value — including `''`. Until this pin, `WidgetConfigPanel`
 * offered a Behavior-group "Click-through URL" field bound to `actionUrl`, and
 * `DashboardWithConfig` seeded `actionUrl: widget.actionUrl ?? ''` into every
 * widget config it handed the panel — so every save from Studio persisted a
 * parse-error key, even when the author never opened the Behavior group. The
 * ADR-0021 save scrub did not drop it (it only knows the dataset-shape keys).
 *
 * Note the two different `actionUrl`s: `header.actions[]` keeps its own,
 * string-typed and live (see `DashboardRenderer.headerActions.test.tsx`). Only
 * the WIDGET-level key is a tombstone. Each case here therefore carries a
 * live-neighbour falsifier (`colorVariant`, the sibling that flows through the
 * exact same seed → field → draft → scrub path), so a green result cannot come
 * from the assertion simply never reaching anything.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DashboardWidgetSchema } from '@objectstack/spec/ui';
import type { DashboardComponentSchema } from '@object-ui/types';
import { WidgetConfigPanel, sanitizeDraftForType } from '../WidgetConfigPanel';
import { DashboardWithConfig } from '../DashboardWithConfig';

afterEach(cleanup);

const RETIRED_ACTION_KEYS = ['actionUrl', 'actionType', 'actionIcon'] as const;

// A widget the spec accepts, used as the base for every round-trip assertion.
const SPEC_VALID_WIDGET = {
  id: 'w1',
  type: 'bar',
  dataset: 'sales_pipeline',
  dimensions: ['stage'],
  values: ['revenue'],
} as const;

describe('the spec really does refuse these keys (premise check)', () => {
  it('accepts the base widget but refuses each retired action key by name', () => {
    expect(DashboardWidgetSchema.safeParse({ ...SPEC_VALID_WIDGET }).success).toBe(true);
    // Falsifier: a live sibling key on the same shape still parses, so the
    // refusals below are the tombstones firing, not a schema that rejects
    // everything.
    expect(
      DashboardWidgetSchema.safeParse({ ...SPEC_VALID_WIDGET, colorVariant: 'blue' }).success,
    ).toBe(true);

    for (const key of RETIRED_ACTION_KEYS) {
      // `''` — not just a real URL — is what an untouched panel save emitted.
      for (const value of ['', 'https://example.com/deals']) {
        const result = DashboardWidgetSchema.safeParse({ ...SPEC_VALID_WIDGET, [key]: value });
        expect(result.success, `'${key}': ${JSON.stringify(value)} must be refused`).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path[0] === key)).toBe(true);
        }
      }
    }
  });
});

describe('sanitizeDraftForType — scrubs the retired widget action keys', () => {
  it('drops all three, keeping the live sibling', () => {
    const out = sanitizeDraftForType({
      ...SPEC_VALID_WIDGET,
      colorVariant: 'blue',
      actionUrl: 'https://example.com/deals',
      actionType: 'url',
      actionIcon: 'Link',
    });
    for (const key of RETIRED_ACTION_KEYS) expect(out).not.toHaveProperty(key);
    // Falsifier: the scrub is selective, not a wholesale strip.
    expect(out.colorVariant).toBe('blue');
    expect(out.dataset).toBe('sales_pipeline');
    expect(DashboardWidgetSchema.safeParse(out).success).toBe(true);
  });

  it('drops the empty-string spelling too', () => {
    const out = sanitizeDraftForType({ ...SPEC_VALID_WIDGET, actionUrl: '' });
    expect(out).not.toHaveProperty('actionUrl');
  });
});

describe('WidgetConfigPanel — offers no retired action key as an authoring field', () => {
  const config = { ...SPEC_VALID_WIDGET, title: 'Revenue', colorVariant: 'blue' };

  it('renders no Behavior section and no field bound to a retired key', () => {
    render(<WidgetConfigPanel open onClose={vi.fn()} config={config} onSave={vi.fn()} />);

    expect(screen.queryByTestId('config-section-behavior')).not.toBeInTheDocument();
    expect(screen.queryByText('Click-through URL')).not.toBeInTheDocument();
    for (const key of RETIRED_ACTION_KEYS) {
      expect(screen.queryByTestId(`config-field-${key}`)).not.toBeInTheDocument();
    }

    // Falsifier: the sibling group that was NOT removed still renders, so the
    // absences above are not "the panel failed to render at all". `appearance`
    // is `defaultCollapsed` exactly like `behavior` was, so this also proves
    // the section-level assertion is not blind to collapsed sections.
    expect(screen.getByTestId('config-section-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('config-section-general')).toBeInTheDocument();
  });

  it('emits none of the retired keys on save, even when handed a config carrying them', () => {
    const onSave = vi.fn();
    render(
      <WidgetConfigPanel
        open
        onClose={vi.fn()}
        config={{ ...config, actionUrl: 'https://example.com/deals', actionType: 'url', actionIcon: 'Link' }}
        onSave={onSave}
      />,
    );

    // The footer only appears once the draft is dirty — mirror a real edit.
    fireEvent.change(screen.getByTestId('config-field-title'), { target: { value: 'Revenue v2' } });
    fireEvent.click(screen.getByTestId('config-panel-save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as Record<string, unknown>;
    for (const key of RETIRED_ACTION_KEYS) expect(saved).not.toHaveProperty(key);
    // Falsifier: the edit and the live sibling did survive the same path.
    expect(saved.title).toBe('Revenue v2');
    expect(saved.colorVariant).toBe('blue');
    expect(DashboardWidgetSchema.safeParse(saved).success).toBe(true);
  });
});

describe('DashboardWithConfig — a Studio save round-trip persists no retired key', () => {
  // No dashboard-root `title`: retired (objectui#7509), so inert here, and it
  // compiled only through `BaseSchema`'s index signature (objectui#11348).
  const schema: DashboardComponentSchema = {
    type: 'dashboard',
    widgets: [{ id: 'w1', title: 'Revenue', type: 'bar', colorVariant: 'blue' } as never],
  };

  it('hands the host a config the spec accepts, with the retired keys absent', () => {
    const onWidgetSave = vi.fn();
    render(
      <DashboardWithConfig
        schema={schema}
        config={{}}
        onConfigSave={vi.fn()}
        onWidgetSave={onWidgetSave}
        defaultConfigOpen
      />,
    );

    fireEvent.click(screen.getByTestId('dashboard-preview-widget-w1'));
    fireEvent.change(screen.getByTestId('config-field-title'), { target: { value: 'Revenue v2' } });
    fireEvent.click(screen.getByTestId('config-panel-save'));

    expect(onWidgetSave).toHaveBeenCalledTimes(1);
    const [widgetId, saved] = onWidgetSave.mock.calls[0] as [string, Record<string, unknown>];
    expect(widgetId).toBe('w1');

    // The regression this pins: the author never touched any action field, and
    // the seeded `actionUrl: ''` used to ride along into stored metadata.
    for (const key of RETIRED_ACTION_KEYS) expect(saved).not.toHaveProperty(key);

    // Falsifier: the same seed → panel → scrub path DOES carry the live sibling
    // and the author's edit, so the absence above is a scrub, not an empty
    // payload.
    expect(saved.title).toBe('Revenue v2');
    expect(saved.colorVariant).toBe('blue');

    // The panel's payload is the documented FLATTENED shape (`layout.w` →
    // `layoutW`, see `WidgetConfigPanelProps.config`), which the host
    // un-flattens before persisting; un-flatten it here so the parse measures
    // the retired action keys and not that intermediate shape.
    const { layoutW, layoutH, ...rest } = saved as Record<string, never>;
    const parsed = DashboardWidgetSchema.safeParse({
      ...rest,
      layout: { x: 0, y: 0, w: layoutW ?? 1, h: layoutH ?? 1 },
      dataset: 'sales_pipeline',
      values: ['revenue'],
    });
    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues),
    ).toBe(true);
  });
});

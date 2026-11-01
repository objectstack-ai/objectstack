// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28562 (ADR-0146 D2, D3) — the pieces Studio's Customize door is
 * built from, each pinned on its own:
 *
 *  - which types Studio customizes, asked of the spec's classification;
 *  - the override declaration a document carries, parsed by the spec's schema;
 *  - the body a customization's draft is written with: no `_` keys, the
 *    declaration of the base, an existing declaration kept as it is, and
 *    nothing at all when there is no version to declare;
 *  - whether the ensure door refuses this caller, from the posture and the
 *    platform-operator flag the server publishes;
 *  - the ensure door's client (`packages-io.ts#ensureCustomizationPackage`):
 *    the pair's id from the answer, 201 and 200 told apart, a refusal
 *    rejected with the server's own sentence, and the package list told only
 *    when a pair was created;
 *  - what the package list says of a base: its version, its listed pair;
 *  - the Customize button's reasons and the override badge.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import {
  StudioCustomizeButton,
  StudioOverrideChip,
  customizeDoorWalled,
  declaredOverrideOf,
  isStudioCustomizeType,
  overrideDraftBody,
} from './StudioCustomizeControls';
import {
  ensureCustomizationPackage,
  listedCustomizationPairOf,
  listedPackageVersion,
  parseListedPackageManifests,
} from './packages-io';
import { t, tFormat } from '../metadata-admin/i18n';

const BASE = 'com.example.hotcrm';
const PAIR = 'com.example.hotcrm.custom';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the types Studio customizes (objectstack#28562)', () => {
  it.each(['view', 'dashboard', 'report'])('%s is customized', (type) => {
    expect(isStudioCustomizeType(type)).toBe(true);
  });

  it.each(['page', 'object', 'flow', 'app', 'translation', '', undefined, null])(
    '%s is not: no pillar here customizes it, or it is not overridable',
    (type) => {
      expect(isStudioCustomizeType(type as string | undefined)).toBe(false);
    },
  );
});

describe('the declaration a document carries (objectstack#28562)', () => {
  it('reads a declaration of this base', () => {
    expect(declaredOverrideOf({ name: 'pipeline', overrides: { package: BASE, basedOn: '4.0.0' } }, BASE)).toEqual({
      package: BASE,
      basedOn: '4.0.0',
    });
  });

  it.each([
    ['no declaration', { name: 'pipeline' }],
    ['a declaration of another base', { overrides: { package: 'com.example.other', basedOn: '1.0.0' } }],
    ['a declaration with no version', { overrides: { package: BASE } }],
    ['not a document', null],
  ])('%s declares no override of the base', (_case, doc) => {
    expect(declaredOverrideOf(doc, BASE)).toBeNull();
  });
});

describe('the body a customization is written with (objectstack#28562)', () => {
  it('drops the top-level `_` keys and declares the override of the base at its version', () => {
    const doc = { name: 'pipeline', label: 'Pipeline', widgets: [{ id: 'w1', _note: 'kept below the top' }], _packageId: BASE, _lock: 'full' };
    expect(overrideDraftBody(doc, BASE, '4.0.0')).toStrictEqual({
      name: 'pipeline',
      label: 'Pipeline',
      widgets: [{ id: 'w1', _note: 'kept below the top' }],
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
  });

  it('keeps a declaration of the base the document already carries, its version included', () => {
    const doc = { name: 'pipeline', overrides: { package: BASE, basedOn: '3.2.0' } };
    expect(overrideDraftBody(doc, BASE, '4.0.0')?.overrides).toEqual({ package: BASE, basedOn: '3.2.0' });
  });

  it('declares nothing it would have to guess: no version and no declaration is no body', () => {
    expect(overrideDraftBody({ name: 'pipeline' }, BASE, null)).toBeNull();
  });

  it('with no version, a document that already declares the base is still written', () => {
    const doc = { name: 'pipeline', overrides: { package: BASE, basedOn: '3.2.0' } };
    expect(overrideDraftBody(doc, BASE, null)).toStrictEqual(doc);
  });
});

describe('whether the ensure door refuses this caller (objectstack#28562)', () => {
  it.each([
    ['group', false, true],
    ['isolated', false, true],
    ['group', true, false],
    ['isolated', true, false],
    ['single', false, false],
    [undefined, false, false],
  ] as const)('posture %s, platform operator %s: walled %s', (posture, isPlatformOperator, walled) => {
    expect(customizeDoorWalled({ posture, isPlatformOperator })).toBe(walled);
  });
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const answer = (created: boolean) => ({
  success: true,
  data: { basePackageId: BASE, packageId: PAIR, namespace: 'hotcrm_custom', dependencyRange: '^4', created, writable: true },
});

describe('the ensure door client (objectstack#28562)', () => {
  it('POSTs no body to the base’s door, and names the pair from the answer; a created pair tells the package list', async () => {
    const fetchMock = vi.fn(async () => json(answer(true), 201));
    vi.stubGlobal('fetch', fetchMock);
    const changed = vi.fn();
    window.addEventListener('objectui:packages-changed', changed);
    try {
      await expect(ensureCustomizationPackage(BASE)).resolves.toEqual({
        basePackageId: BASE,
        packageId: PAIR,
        created: true,
        writable: true,
      });
    } finally {
      window.removeEventListener('objectui:packages-changed', changed);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/v1/packages/${BASE}/ensure-customization`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('a pair that was there (200) is named the same way, and the package list is not told', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(answer(false), 200)));
    const changed = vi.fn();
    window.addEventListener('objectui:packages-changed', changed);
    try {
      await expect(ensureCustomizationPackage(BASE)).resolves.toMatchObject({ packageId: PAIR, created: false });
    } finally {
      window.removeEventListener('objectui:packages-changed', changed);
    }
    expect(changed).not.toHaveBeenCalled();
  });

  it('a refusal rejects with the server’s own sentence', async () => {
    const sentence = 'Only the platform operator may create a customization package under the group posture.';
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false, error: { code: 'FORBIDDEN', message: sentence } }, 403)));
    await expect(ensureCustomizationPackage(BASE)).rejects.toMatchObject({ message: `${sentence} (FORBIDDEN)` });
  });

  it('an answer its declaration refuses names no pair', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: { packageId: PAIR } }, 201)));
    await expect(ensureCustomizationPackage(BASE)).rejects.toThrow(BASE);
  });
});

describe('what the package list says of a base (objectstack#28562)', () => {
  const listed = (withPair: boolean, version?: string) =>
    parseListedPackageManifests({
      data: [
        { manifest: { id: BASE, name: 'HotCRM', ...(version ? { version } : {}) }, writable: false },
        ...(withPair ? [{ manifest: { id: PAIR, name: 'HotCRM customizations', version: '0.0.0' }, writable: true }] : []),
      ],
    });

  it('the version its manifest declares, else none', () => {
    expect(listedPackageVersion(listed(false, '4.0.0'), BASE)).toBe('4.0.0');
    expect(listedPackageVersion(listed(false), BASE)).toBeNull();
    expect(listedPackageVersion(listed(false, '4.0.0'), 'com.example.unlisted')).toBeNull();
  });

  it('its pair when the list lists one, else none: the read never spells a pair that is not there', () => {
    expect(listedCustomizationPairOf(listed(true, '4.0.0'), BASE)).toBe(PAIR);
    expect(listedCustomizationPairOf(listed(false, '4.0.0'), BASE)).toBeNull();
  });
});

describe('the Customize button and the override badge (objectstack#28562)', () => {
  it('offered: enabled, titled with the base, and pressing it calls back', () => {
    const onCustomize = vi.fn();
    render(<StudioCustomizeButton block={null} baseLabel="HotCRM" locale="en" onCustomize={onCustomize} />);
    const button = screen.getByTestId('studio-customize');
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent(t('engine.studio.customize.action', 'en'));
    expect(button).toHaveAttribute('title', tFormat('engine.studio.customize.actionTitle', 'en', { base: 'HotCRM' }));
    button.click();
    expect(onCustomize).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('studio-customize-blocked')).toBeNull();
  });

  it.each([
    ['walled', t('engine.studio.customize.walled', 'en')],
    ['noVersion', tFormat('engine.studio.customize.noVersion', 'en', { base: 'HotCRM' })],
  ] as const)('blocked (%s): disabled, and its wrapper says why', (block, reason) => {
    const onCustomize = vi.fn();
    render(<StudioCustomizeButton block={block} baseLabel="HotCRM" locale="en" onCustomize={onCustomize} />);
    const button = screen.getByTestId('studio-customize');
    expect(button).toBeDisabled();
    const wrapper = screen.getByTestId('studio-customize-blocked');
    expect(wrapper).toHaveAttribute('data-block', block);
    expect(wrapper).toHaveAttribute('title', reason);
    expect(document.getElementById(button.getAttribute('aria-describedby')!)).toHaveTextContent(reason);
  });

  it('the badge names the base, and its title the version the override is based on', () => {
    render(<StudioOverrideChip baseLabel="HotCRM" basedOn="4.0.0" locale="en" />);
    const chip = screen.getByTestId('studio-override-chip');
    expect(chip).toHaveTextContent(tFormat('engine.studio.customize.overrides', 'en', { base: 'HotCRM' }));
    expect(chip).toHaveAttribute(
      'title',
      tFormat('engine.studio.customize.overridesTitle', 'en', { base: 'HotCRM', basedOn: '4.0.0' }),
    );
  });
});

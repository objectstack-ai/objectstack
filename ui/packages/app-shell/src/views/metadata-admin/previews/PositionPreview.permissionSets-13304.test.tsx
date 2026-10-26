// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PositionPreview lists the permission sets a position declares (objectui#13304).
 *
 * `PositionSchema.permissionSets` (ADR-0131 D4) names the sets a position
 * distributes. The preview read only name / label / description and always
 * rendered "Positions don't grant data access on their own … bind it to
 * Permission Sets" — telling an admin to do what the draft had already done.
 *
 * The callout now lists the declared sets by machine name, in declared order,
 * and keeps the "grants nothing on its own" note for a position that declares
 * none: absent, empty, or not an array.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PositionPreview } from './PositionPreview';
import { t } from '../i18n';

afterEach(cleanup);

const EN = 'en-US';
const NO_ACCESS = t('engine.positionPreview.noAccess', EN);

function mount(draft: Record<string, unknown>) {
  return render(<PositionPreview type="position" name="service_manager" draft={draft} locale={EN} />);
}

/** The machine names the callout lists, in rendered order. */
function listedSets(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('li code')).map((el) => el.textContent ?? '');
}

const BASE = { name: 'service_manager', label: 'Service Manager' };

describe('PositionPreview — declared permissionSets (objectui#13304)', () => {
  it('lists every declared set by machine name, in declared order, and drops the "grants nothing" note', () => {
    const { container } = mount({ ...BASE, permissionSets: ['service_agent', 'support_viewer'] });
    expect(listedSets(container)).toEqual(['service_agent', 'support_viewer']);
    expect(container.textContent).not.toContain(NO_ACCESS);
  });

  it('CONTROL: a draft with no permissionSets renders the existing note', () => {
    const { container } = mount({ ...BASE });
    expect(container.textContent).toContain(NO_ACCESS);
    expect(listedSets(container)).toEqual([]);
  });

  it('CONTROL: an empty permissionSets array renders the existing note', () => {
    const { container } = mount({ ...BASE, permissionSets: [] });
    expect(container.textContent).toContain(NO_ACCESS);
    expect(listedSets(container)).toEqual([]);
  });

  it('a permissionSets value that is not an array (a string) declares none', () => {
    const { container } = mount({ ...BASE, permissionSets: 'service_agent' });
    expect(container.textContent).toContain(NO_ACCESS);
    expect(listedSets(container)).toEqual([]);
  });
});

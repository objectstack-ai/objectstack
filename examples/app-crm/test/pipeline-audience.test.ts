// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27735] The Pipeline nav entry is offered only to a member who can read
 * what the dashboard shows (ruling 6512784198, letter G).
 *
 * The entry carries a `visible` predicate, `current_user.can(OBJECT, 'read')`,
 * which the console's nav guard answers from the member's permissions payload.
 * It hides; it refuses nothing. The refusal stays where it already is: the
 * dataset query of every widget answers 403 to a caller who cannot read the
 * dataset's object (ADR-0066 D4: `visibleWhen` hides, `requiredPermissions`
 * refuses). So the one thing that can go wrong here is the predicate naming
 * an object other than the one the widgets read, and that is what is pinned,
 * off the parsed stack rather than the source constants.
 */

import { describe, expect, it } from 'vitest';
import stack from '../objectstack.config.js';

type NavEntry = {
  id?: string;
  type?: string;
  dashboardName?: string;
  visible?: { dialect?: string; source?: string };
  children?: NavEntry[];
};

function findNav(entries: NavEntry[] | undefined, id: string): NavEntry | undefined {
  for (const entry of entries ?? []) {
    if (entry.id === id) return entry;
    const hit = findNav(entry.children, id);
    if (hit) return hit;
  }
  return undefined;
}

const READ_PREDICATE = /^current_user\.can\('([a-z0-9_]+)', 'read'\)$/;

const app = (stack.apps ?? []).find((a) => a.name === 'crm_app');
const navEntry = findNav(app?.navigation as NavEntry[] | undefined, 'nav_pipeline_dashboard');
const dashboard = (stack.dashboards ?? []).find((d) => d.name === 'pipeline_dashboard');
// The stack parse normalises an authored CEL string to `{ dialect, source }`.
const predicate = navEntry?.visible;

describe('Pipeline nav entry audience (#27735)', () => {
  it('carries a read predicate on one object', () => {
    expect(navEntry).toMatchObject({ type: 'dashboard', dashboardName: 'pipeline_dashboard' });
    expect(predicate?.dialect).toBe('cel');
    expect(predicate?.source).toMatch(READ_PREDICATE);
  });

  it('names the object of the dataset every pipeline_dashboard widget reads', () => {
    const named = predicate?.source?.match(READ_PREDICATE)?.[1];
    expect(named).toBeDefined();
    const widgets = (dashboard?.widgets ?? []) as Array<{ dataset?: string }>;
    expect(widgets.length).toBeGreaterThan(0);
    const objects = new Set(
      widgets.map((w) => (stack.datasets ?? []).find((d) => d.name === w.dataset)?.object),
    );
    expect([...objects]).toEqual([named]);
  });
});

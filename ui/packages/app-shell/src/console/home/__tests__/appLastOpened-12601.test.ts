// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12601 — `lastOpenedByApp`, the reading behind a Home tile's
 * "Opened 2 hours ago": the newest recent-items entry opened inside each app.
 *
 * The store records what was opened INSIDE an app at its `/apps/<segment>/…`
 * address, the segment being the route's own — the package id, or the name
 * alias a URL may use (ADR-0048). So these cases pin: the newest entry decides,
 * whatever order the list is in; both spellings of an app's segment resolve to
 * it; an entry outside every app (`/studio/…`) or under an app the list does
 * not hold names nothing; an unreadable time is no time.
 */
import { describe, it, expect } from 'vitest';
import { lastOpenedByApp } from '../appLastOpened';

const CRM = { name: 'crm', _packageId: 'com.acme.crm' };
const OPS = { name: 'ops' };

const visit = (href: string, visitedAt: string) => ({ href, visitedAt });

describe('lastOpenedByApp (objectui#12601)', () => {
  it('takes the newest entry opened inside each app, keyed by app name', () => {
    const opened = lastOpenedByApp(
      [CRM, OPS],
      [
        visit('/apps/com.acme.crm/account', '2026-10-16T08:00:00.000Z'),
        visit('/apps/ops/dashboard/sla', '2026-10-15T09:00:00.000Z'),
        // Older than the CRM entry above, though listed after it.
        visit('/apps/com.acme.crm/opportunity/record/7', '2026-10-14T10:00:00.000Z'),
      ],
    );
    expect(opened).toEqual(
      new Map([
        ['crm', '2026-10-16T08:00:00.000Z'],
        ['ops', '2026-10-15T09:00:00.000Z'],
      ]),
    );
  });

  it('resolves the name alias a URL may use to the same app as its package id', () => {
    const opened = lastOpenedByApp(
      [CRM],
      [
        visit('/apps/com.acme.crm/account', '2026-10-14T10:00:00.000Z'),
        visit('/apps/crm/lead?view=all', '2026-10-16T08:00:00.000Z'),
      ],
    );
    expect(opened.get('crm')).toBe('2026-10-16T08:00:00.000Z');
  });

  it('names nothing for an entry outside every app, under an unknown app, or with no readable time', () => {
    const opened = lastOpenedByApp(
      [CRM, OPS],
      [
        visit('/studio/com.acme.crm/data', '2026-10-16T08:00:00.000Z'),
        visit('/apps/finance/invoice', '2026-10-16T08:00:00.000Z'),
        visit('/apps/ops/dashboard/sla', ''),
        visit('/home', '2026-10-16T08:00:00.000Z'),
      ],
    );
    expect(opened.size).toBe(0);
  });

  it('CONTROL — the same entries under a known app do name it', () => {
    const opened = lastOpenedByApp([CRM, OPS], [visit('/apps/ops/dashboard/sla', '2026-10-16T08:00:00.000Z')]);
    expect(opened.get('ops')).toBe('2026-10-16T08:00:00.000Z');
  });
});

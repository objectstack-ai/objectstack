// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36909 — every retired pillar address lands on the page that
 * replaced it, in ONE redirect.
 *
 *  - The table walks every old pillar address — each package pillar (`data`,
 *    `automations`, `access`, `interfaces`), the bare package address, a
 *    base's `.custom` pair, and the package-less scope's (`~org`) — to the
 *    address it lands on. Every expected value is a literal.
 *  - One hop: a target in the "All metadata" area is already where the area
 *    would put it (`areaLocationRedirect` answers `null`), so the area does
 *    not redirect a second time. The old `/data` address — the server's draft
 *    review link included — went through two redirects before this.
 *  - CONTROL: a current address (the sharing overview, the area, a segment
 *    no page has, the cross-package leg) is no retired pillar address and
 *    does not redirect.
 */

import { describe, expect, it } from 'vitest';
import { areaLocationRedirect } from './metadataArea.js';
import { accessPillarRedirect } from './accessPillarRedirect.js';
import { INTERFACES_RETIRED_STATE } from './studioInterfacesRetired.js';
import { STUDIO_RETIRED_PILLAR_SEGMENTS, studioPillarRedirect } from './studioPillarRedirectModel.js';

/** Splits `/studio/<segment>[/<pillar>][?query]` the way the route reads it. */
function redirectOf(address: string) {
  const queryAt = address.indexOf('?');
  const path = queryAt >= 0 ? address.slice(0, queryAt) : address;
  const search = queryAt >= 0 ? address.slice(queryAt) : '';
  const [, , segment, pillar] = path.split('/');
  return studioPillarRedirect(decodeURIComponent(segment), pillar === undefined ? undefined : decodeURIComponent(pillar), search);
}

/** Whether the area would redirect `address` again: `false` for any address outside the area. */
function areaRedirectsAgain(address: string): boolean {
  const queryAt = address.indexOf('?');
  const path = queryAt >= 0 ? address.slice(0, queryAt) : address;
  const search = queryAt >= 0 ? address.slice(queryAt) : '';
  const [, , segment, section, ...rest] = path.split('/');
  if (section !== 'metadata') return false;
  return areaLocationRedirect(decodeURIComponent(segment), rest.join('/'), search) !== null;
}

const P = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';

/** Old address → where it lands. */
const NAVIGATE_TABLE: ReadonlyArray<readonly [string, string]> = [
  // The bare package address landed on `data`.
  [`/studio/${P}`, `/studio/${P}/metadata/object?package=${P}`],
  // Data (objectstack#36904): the object list, or one object's designer.
  [`/studio/${P}/data`, `/studio/${P}/metadata/object?package=${P}`],
  [`/studio/${P}/data?surface=object%3Aaccount`, `/studio/${P}/metadata/object/account?package=${P}`],
  [`/studio/${P}/data?surface=object:account`, `/studio/${P}/metadata/object/account?package=${P}`],
  [
    `/studio/${P}/data?surface=object%3Aaccount&action=approve&view=account.all&nav=n1`,
    `/studio/${P}/metadata/object/account?action=approve&package=${P}`,
  ],
  // The server's draft review link (`studioChangesReviewLink`): the drawer opens on the object list.
  [`/studio/${P}/data?changes=review`, `/studio/${P}/metadata/object?changes=review&package=${P}`],
  // A `?package=` naming another package re-roots, as the area would.
  [`/studio/${P}/data?package=com.acme.hr`, `/studio/com.acme.hr/metadata/object?package=com.acme.hr`],
  // Automations (objectstack#36903): the flow list, or one flow's designer.
  [`/studio/${P}/automations`, `/studio/${P}/metadata/flow?package=${P}`],
  [`/studio/${P}/automations?surface=flow%3Anotify`, `/studio/${P}/metadata/flow/notify?package=${P}`],
  [`/studio/${P}/automations?surface=flow%3Anotify&changes=review`, `/studio/${P}/metadata/flow/notify?changes=review&package=${P}`],
  // Interfaces (objectstack#36502): the package's object list, only `?changes=` kept.
  [`/studio/${P}/interfaces`, `/studio/${P}/metadata/object?package=${P}`],
  [`/studio/${P}/interfaces?surface=page%3Ahome&changes=review&nav=n1`, `/studio/${P}/metadata/object?changes=review&package=${P}`],
  // A base's `.custom` pair: Data and Automations in the pair's own area, Interfaces on the base.
  [`/studio/${PAIR}`, `/studio/${PAIR}/metadata/object?package=${PAIR}`],
  [`/studio/${PAIR}/data?surface=object%3Avisit`, `/studio/${PAIR}/metadata/object/visit?package=${PAIR}`],
  [`/studio/${PAIR}/automations?surface=flow%3Anotify`, `/studio/${PAIR}/metadata/flow/notify?package=${PAIR}`],
  [`/studio/${PAIR}/interfaces`, `/studio/${P}/metadata/object?package=${P}`],
  // The package-less scope (objectstack#36903): its one pillar, and every other address of it.
  ['/studio/~org/automations', '/studio/~org/metadata/flow?source=runtime'],
  ['/studio/~org/automations?surface=flow%3Aclone_1', '/studio/~org/metadata/flow/clone_1?source=runtime'],
  ['/studio/~org/automations?surface=flow%3Aclone_1&package=~org', '/studio/~org/metadata/flow/clone_1?source=runtime'],
  ['/studio/~org/data', '/studio/~org/metadata/flow?source=runtime'],
  ['/studio/~org/access', '/studio/~org/metadata/flow?source=runtime'],
  ['/studio/~org/interfaces', '/studio/~org/metadata/flow?source=runtime'],
  ['/studio/~org/owd', '/studio/~org/metadata/flow?source=runtime'],
];

describe('every retired pillar address lands on the page that replaced it (objectstack#36909)', () => {
  it.each(NAVIGATE_TABLE)('%s → %s', (from, to) => {
    expect(redirectOf(from)).toEqual(
      from.includes('/interfaces') && !from.includes('~org')
        ? { kind: 'navigate', to, state: { [INTERFACES_RETIRED_STATE]: true } }
        : { kind: 'navigate', to },
    );
  });

  it('the Access pillar lands through its reads, on the base, its targets settled', () => {
    // Which package holds a named set is a read (`AccessPillarLanding`); the
    // table picks the package whose sets are read, the base for its pair.
    expect(redirectOf(`/studio/${P}/access?surface=permission%3Asales_rep`)).toEqual({ kind: 'access', packageId: P });
    expect(redirectOf(`/studio/${PAIR}/access`)).toEqual({ kind: 'access', packageId: P });
    expect(accessPillarRedirect(P, '?surface=permission%3Asales_rep')).toBe(
      `/studio/${P}/metadata/permission/sales_rep?package=${P}`,
    );
    expect(accessPillarRedirect(P, '?surface=permission%3Asales_rep', { setHeldIn: PAIR })).toBe(
      `/studio/${PAIR}/metadata/permission/sales_rep?package=${PAIR}`,
    );
    expect(accessPillarRedirect(P, '')).toBe(`/studio/${P}/metadata/permission?package=${P}`);
    expect(accessPillarRedirect(P, '?surface=owd%3Aoverview')).toBe(`/studio/${P}/owd`);
  });

  it('the table covers every retired pillar segment, on a package and on the package-less scope', () => {
    for (const segment of STUDIO_RETIRED_PILLAR_SEGMENTS) {
      expect(redirectOf(`/studio/${P}/${segment}`), segment).not.toBeNull();
      expect(redirectOf(`/studio/~org/${segment}`), `~org ${segment}`).not.toBeNull();
      if (segment === 'access') continue;
      expect(NAVIGATE_TABLE.some(([from]) => from.startsWith(`/studio/${P}/${segment}`)), segment).toBe(true);
    }
  });
});

describe('one hop: the area redirects none of the targets again (objectstack#36909)', () => {
  it('the old `/data` address reaches the object list in one redirect', () => {
    for (const from of [`/studio/${P}/data`, `/studio/${P}/data?changes=review`, `/studio/${P}/data?surface=object%3Aaccount`]) {
      const target = redirectOf(from);
      expect(target?.kind, from).toBe('navigate');
      const to = (target as { to: string }).to;
      expect(to.startsWith(`/studio/${P}/metadata/object`), from).toBe(true);
      expect(areaRedirectsAgain(to), to).toBe(false);
    }
  });

  it('every target in the table, and every Access target, is where the area would put it', () => {
    for (const [, to] of NAVIGATE_TABLE) expect(areaRedirectsAgain(to), to).toBe(false);
    for (const search of ['', '?surface=permission%3Asales_rep', '?changes=review']) {
      const to = accessPillarRedirect(P, search);
      expect(areaRedirectsAgain(to), to).toBe(false);
    }
  });
});

describe('CONTROL — a current address does not redirect', () => {
  it.each([
    // The sharing overview's own route (objectstack#36905).
    [P, 'owd', '?object=account'],
    // A segment no page has: the builder draws its not-found state (objectstack#26708).
    [P, 'bogus_pillar', ''],
    // The area's segment, should a host route it here.
    [P, 'metadata', ''],
    // The cross-package leg is the area's.
    ['~all', 'data', ''],
    ['~all', undefined, ''],
    // No package at all.
    ['', 'data', ''],
  ] as const)('/studio/%s/%s%s', (segment, pillar, search) => {
    expect(studioPillarRedirect(segment, pillar, search)).toBeNull();
  });
});

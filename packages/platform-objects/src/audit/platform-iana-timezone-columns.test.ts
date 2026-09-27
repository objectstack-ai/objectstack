// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15872 — `sys_job.timezone`, the platform's OLDER IANA column, predates
 * `valueDomain`. It had a sibling, `sys_report_schedule.timezone`, and the two
 * disagreed in three dimensions at once (length 100 vs 64, default none vs
 * `'UTC'`, validation none vs none); that sibling was retired with the
 * saved-report stack (#20102), so what this file pins is the surviving column —
 * what #15872 changed on it and, just as deliberately, what it did NOT.
 *
 * CLOSED here — validation. The column declares `valueDomain: 'iana_time_zone'`,
 * the same declaration the ruled pair `sys_business_unit.timezone` /
 * `sys_organization.timezone` carries (#14238, pinned in
 * `identity/org-hierarchy-timezone.test.ts`). Three columns, one membership
 * predicate.
 *
 * LEFT ALONE, and pinned so that staying alone is a decision rather than a
 * drift someone repairs by reflex:
 *
 *  - NO DEFAULT. A default here is a CONSUMER semantic, not a shape question:
 *    `sys_job.timezone` is written and never read, and giving it a default
 *    would change what an unset row means.
 *  - the BOUND stays 100. `maxLength` is not only a write bound: it reaches
 *    DDL, and narrowing a physical `varchar(100)` is `driver-sql`'s
 *    `narrow_varchar` op at severity `error`, category destructive. What the
 *    column physically holds in a deployment is not readable from the repo.
 */

import { describe, it, expect } from 'vitest';
import { isValueDomainMember } from '@objectstack/spec/shared';
import { SysJob } from './sys-job.object';

type ColumnShape = {
  type?: unknown;
  required?: unknown;
  maxLength?: unknown;
  valueDomain?: unknown;
  defaultValue?: unknown;
};

const jobColumn = () => (SysJob.fields as Record<string, ColumnShape>).timezone;

describe('#15872 — the platform\'s older IANA time-zone column', () => {
  it('reads the real declaration, not an empty probe', () => {
    // Vacuity control: a renamed column or a changed export would otherwise let
    // every assertion below pass over `undefined`.
    expect(SysJob.name).toBe('sys_job');
    expect(jobColumn()).toBeTypeOf('object');
  });

  it('sys_job.timezone is an optional text column validated against the IANA domain', () => {
    const c = jobColumn();
    // `VALUE_DOMAIN_FIELD_TYPES` is `{text}`, so the declaration below is also
    // the reason the type must stay `text`.
    expect(c.type).toBe('text');
    expect(c.required).toBe(false);
    expect(c.valueDomain).toBe('iana_time_zone');
  });

  it('declares NO default — a default here is a consumer semantic', () => {
    // ⛔ Not a tidy-up target. `sys_job` has no reader at all, and minting a
    // default would give "unset" a new meaning on rows that predate it.
    expect('defaultValue' in jobColumn()).toBe(false);
  });

  it('keeps its 100-character bound — narrowing it is a DDL question, not a shape one', () => {
    // If someone narrows this, they owe the reading #15872 could not take:
    // what the physical column holds. Red here is the prompt to go and take it.
    expect(jobColumn().maxLength).toBe(100);
  });

  it('the declared domain refuses every non-member this card was filed over', () => {
    // Asked of the predicate the write path calls (`isValueDomainMember`) under
    // the domain the column actually declares — never a re-implementation.
    const domain = jobColumn().valueDomain as 'iana_time_zone';
    // The card's own three examples. `Mars/Olympus` is shape-valid and
    // nonexistent, `UTC+8` and `China Standard Time` are the two spellings a
    // human reaches for that the tzdb does not carry.
    expect(isValueDomainMember(domain, 'Mars/Olympus')).toBe(false);
    expect(isValueDomainMember(domain, 'UTC+8')).toBe(false);
    expect(isValueDomainMember(domain, 'China Standard Time')).toBe(false);
    // …and still admits what the column must keep taking, `UTC` included —
    // which `Intl.supportedValuesOf('timeZone')` omits, so a column judged
    // against the enumeration would refuse the platform's own default zone.
    expect(isValueDomainMember(domain, 'UTC')).toBe(true);
    expect(isValueDomainMember(domain, 'Asia/Shanghai')).toBe(true);
  });

  it('the bound admits every zone the runtime enumerates, so it refuses no legal value', () => {
    // A future ICU that enumerates a longer name reds here rather than silently
    // refusing a legal zone at the write seam.
    // `Intl.supportedValuesOf` is ES2022; the package's `lib` predates it, so
    // the call is typed here rather than the whole program's lib widened.
    const intl = Intl as unknown as { supportedValuesOf(key: 'timeZone'): string[] };
    const longest = Math.max(...intl.supportedValuesOf('timeZone').map((z) => z.length));
    expect(longest).toBeLessThanOrEqual(jobColumn().maxLength as number);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15872 — the platform's two OLDER IANA columns, `sys_job.timezone` and
 * `sys_report_schedule.timezone`, predate `valueDomain` and disagreed with each
 * other in three dimensions at once (length 100 vs 64, default none vs `'UTC'`,
 * validation none vs none). This file pins what that card actually changed and,
 * just as deliberately, what it did NOT.
 *
 * CLOSED here — validation. Both columns now declare
 * `valueDomain: 'iana_time_zone'`, the same declaration the ruled pair
 * `sys_business_unit.timezone` / `sys_organization.timezone` carries (#14238,
 * pinned in `identity/org-hierarchy-timezone.test.ts`). Four columns, one
 * membership predicate.
 *
 * LEFT ALONE, and pinned so that staying alone is a decision rather than a
 * drift someone repairs by reflex:
 *
 *  - the DEFAULTS still differ, because a default here is a CONSUMER semantic,
 *    not a shape question. `sys_report_schedule` documents "default UTC" and its
 *    reader falls back to `'UTC'`; `sys_job` says nothing, and giving it one
 *    would change what an unset row means. The ruled pair, for its own reasons,
 *    has none on either column — so "all four agree" is NOT the invariant, and
 *    a test asserting it would be asserting a bug.
 *  - the BOUNDS still differ (100 vs 64). `maxLength` is not only a write bound:
 *    it reaches DDL, and narrowing a physical `varchar(100)` is `driver-sql`'s
 *    `narrow_varchar` op at severity `error`, category destructive. What the
 *    column physically holds in a deployment is not readable from the repo, so
 *    the convergence is a separate decision and #15872 stays open on it.
 *
 * The reader measurement that decided the card's severity is recorded beside
 * each declaration, not here: the `sys_job` column is written and never read,
 * while the `sys_report_schedule` column is read back into croner by
 * `ReportService.nextRunAt`, whose catch turned a non-member zone into a silent
 * fall back to `interval_minutes` — the wrong instant, forever.
 */

import { describe, it, expect } from 'vitest';
import { isValueDomainMember } from '@objectstack/spec/shared';
import { SysJob } from './sys-job.object';
import { SysReportSchedule } from './sys-report-schedule.object';

type ColumnShape = {
  type?: unknown;
  required?: unknown;
  maxLength?: unknown;
  valueDomain?: unknown;
  defaultValue?: unknown;
};

const jobColumn = () => (SysJob.fields as Record<string, ColumnShape>).timezone;
const scheduleColumn = () => (SysReportSchedule.fields as Record<string, ColumnShape>).timezone;

describe('#15872 — the platform\'s two older IANA time-zone columns', () => {
  it('reads the real declarations, not an empty probe', () => {
    // Vacuity control: a renamed column or a changed export would otherwise let
    // every assertion below pass over `undefined`.
    expect(SysJob.name).toBe('sys_job');
    expect(SysReportSchedule.name).toBe('sys_report_schedule');
    expect(jobColumn()).toBeTypeOf('object');
    expect(scheduleColumn()).toBeTypeOf('object');
  });

  it.each([
    ['sys_job', jobColumn],
    ['sys_report_schedule', scheduleColumn],
  ])('%s.timezone is an optional text column validated against the IANA domain', (_object, column) => {
    const c = column();
    // `VALUE_DOMAIN_FIELD_TYPES` is `{text}`, so the declaration below is also
    // the reason the type must stay `text`.
    expect(c.type).toBe('text');
    expect(c.required).toBe(false);
    expect(c.valueDomain).toBe('iana_time_zone');
  });

  it('the DEFAULTS deliberately still differ — a default here is a consumer semantic', () => {
    // ⛔ Not a tidy-up target. `sys_report_schedule`'s reader documents and
    // implements a UTC default; `sys_job` has no reader at all, and minting one
    // would give "unset" a new meaning on rows that predate it.
    expect(scheduleColumn().defaultValue).toBe('UTC');
    expect('defaultValue' in jobColumn()).toBe(false);
  });

  it('the BOUNDS deliberately still differ — converging them is a DDL question, not a shape one', () => {
    // If someone converges these, they owe the reading #15872 could not take:
    // what the physical column holds. Red here is the prompt to go and take it.
    expect(jobColumn().maxLength).toBe(100);
    expect(scheduleColumn().maxLength).toBe(64);
  });

  it('the declared domain refuses every non-member this card was filed over', () => {
    // Asked of the predicate the write path calls (`isValueDomainMember`) under
    // the domain the columns actually declare — never a re-implementation.
    const domain = jobColumn().valueDomain as 'iana_time_zone';
    expect(domain).toBe(scheduleColumn().valueDomain);
    // The card's own three examples. `Mars/Olympus` is shape-valid and
    // nonexistent, `UTC+8` and `China Standard Time` are the two spellings a
    // human reaches for that the tzdb does not carry.
    expect(isValueDomainMember(domain, 'Mars/Olympus')).toBe(false);
    expect(isValueDomainMember(domain, 'UTC+8')).toBe(false);
    expect(isValueDomainMember(domain, 'China Standard Time')).toBe(false);
    // …and still admits what both columns must keep taking, `UTC` included —
    // which `Intl.supportedValuesOf('timeZone')` omits, so a column judged
    // against the enumeration would refuse `sys_report_schedule`'s own default.
    expect(isValueDomainMember(domain, 'UTC')).toBe(true);
    expect(isValueDomainMember(domain, 'Asia/Shanghai')).toBe(true);
    expect(isValueDomainMember(domain, scheduleColumn().defaultValue as string)).toBe(true);
  });

  it('both bounds admit every zone the runtime enumerates, so neither refuses a legal value', () => {
    // The smaller bound is the one that could bite; assert against both so a
    // future ICU that enumerates a longer name reds here rather than silently
    // refusing a legal zone at the write seam.
    // `Intl.supportedValuesOf` is ES2022; the package's `lib` predates it, so
    // the call is typed here rather than the whole program's lib widened.
    const intl = Intl as unknown as { supportedValuesOf(key: 'timeZone'): string[] };
    const longest = Math.max(...intl.supportedValuesOf('timeZone').map((z) => z.length));
    expect(longest).toBeLessThanOrEqual(scheduleColumn().maxLength as number);
    expect(longest).toBeLessThanOrEqual(jobColumn().maxLength as number);
  });
});

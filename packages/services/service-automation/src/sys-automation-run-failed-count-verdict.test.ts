// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysAutomationRun } from './sys-automation-run.object.js';

/**
 * `sys_automation_run` — the DELIBERATE "no `failed_count` column" verdict
 * (#15606, decision batch #76: option 2, `failed` stays in the blob).
 *
 * `FlowRunSummary` carries five run-level totals. Four of them
 * (`selected_count`, `acted_count`, `skipped_count`, `unmeasured_count`) have a
 * column on this object; `failed` does not. That asymmetry was filed as a
 * finding and ruled on rather than fixed: the four are columns because ONE
 * filter expression needs them in ONE row — `selected_count > 0 AND
 * acted_count = 0`, qualified by `unmeasured_count` — and a WHERE clause cannot
 * reach into a JSON blob for an operand. `failed` is not an operand of that
 * expression; it would be its own predicate (`failed_count > 0`), nobody alerts
 * on it today, and a caller that wants it has already fetched `summary_json`.
 *
 * This file is what stops the verdict from being an absence nobody can see. The
 * reasoning itself lives where the next reader meets it — in the comment above
 * `selected_count`, the same paragraph that provokes the question — and this
 * pin holds the SCHEMA half of it honest:
 *
 *  - the asymmetry it explains is still real (four columns, no fifth), so the
 *    prose cannot outlive its subject;
 *  - `summary_json`'s description still NAMES `failed` as the place to read
 *    lost-row counts, so "read it from the blob" does not decay into a blob
 *    with no documented way in.
 *
 * ⛔ Do not "fix" a failure here by deleting the assertion. Two legitimate ways
 * to turn this file red, and both are edits to the verdict, not to the pin:
 * add `failed_count` (the re-open condition — a real need to ALERT on "which
 * runs lost rows", null on old rows and never `0`, mirroring `unmeasured_count`;
 * one column on an ADR-0103 engine-owned object, human floor), or rewrite the
 * `summary_json` description — in which case it still has to name `failed`.
 */
describe('sys_automation_run — `failed` stays in the blob (#15606 verdict)', () => {
  const fields = SysAutomationRun.fields as Record<string, Record<string, unknown>>;

  it('carries the four counters that a single filter expression needs in one row', () => {
    // Positive control for the absence assertion below: these four read back
    // through the SAME accessor path, so `failed_count === undefined` is a
    // measurement of the schema and not of a typo'd lookup.
    for (const name of ['selected_count', 'acted_count', 'skipped_count', 'unmeasured_count']) {
      expect(fields[name], `${name} is expected to be a column`).toBeDefined();
      expect(fields[name].type).toBe('number');
    }
  });

  it('declares no `failed_count` column — the verdict itself', () => {
    expect(fields.failed_count).toBeUndefined();
    // Guard the spelling too: a `failed`/`failures` column landing under any
    // other name is the same stored-surface change and needs the same ruling.
    const match = (names: string[]) => names.filter((name) => /fail/i.test(name));
    // Positive control, so the empty result below is a measurement: the same
    // matcher over the same key list plus the name the re-open condition would
    // add does fire.
    expect(match([...Object.keys(fields), 'failed_count'])).toEqual(['failed_count']);
    expect(match(Object.keys(fields))).toEqual([]);
  });

  it('`summary_json` description NAMES `failed` as the place to read lost-row counts', () => {
    const description = fields.summary_json?.description;
    expect(typeof description).toBe('string');
    // The load-bearing token: the blob is only a usable answer to "which runs
    // lost rows?" if the field that answers it is named here by the name a
    // caller will find in the parsed JSON.
    expect(description as string).toContain('`failed`');
  });

  it('does not hide the counter from the run row by promoting a phantom column into the highlight set', () => {
    // `highlightFields` is the operator-facing surface of this object; if a
    // later edit lists `failed_count` there, the column verdict has moved and
    // the prose above `selected_count` is stale.
    expect(SysAutomationRun.highlightFields).not.toContain('failed_count');
    expect(SysAutomationRun.highlightFields).toContain('acted_count');
  });
});

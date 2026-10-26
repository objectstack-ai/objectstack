import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { childVitestEnv } from './helpers/child-vitest-env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * objectui#10183 — drives the date-only zone pins, which cannot drive
 * themselves.
 *
 * ## What the pins are
 *
 * objectui#10110 moved the date-only repair into the shared parse step
 * (`toDisplayDate` in `@object-ui/core`). Four sites never reached it, and
 * each read `2026-08-01` as July 31st west of UTC: `data-table`'s default
 * cell face (and through it a related list with no child schema), the record
 * summary chip, the History tab's date faces and the `date` cell's overdue
 * colouring. Each has a pin beside it, listed in {@link PINS}.
 * objectui#10293 added a fifth under the same convention: the `ui:calendar`
 * primitive's selected date, which the renderer now coerces through the same
 * shared step. objectui#10844, the family's closure card, added the dashboard
 * filter's custom range bounds, the `date-picker` renderer's value and the
 * report cell's date face. objectui#10866, its successor, added the calendar
 * and the gantt, whose pins also hold the written payload of a `date` field,
 * then the timeline, a chart's date axis and `@object-ui/i18n`'s published
 * date helpers, then the timeline's gantt axis and core's formula date
 * arithmetic, then the calendar's day moves across a DST change and the pins
 * for the calendar's end-date write, its no-schema fallback and the gantt's
 * no-schema path. objectui#11005 added the month grid's own drags, which move
 * a value by calendar days across a DST change, and objectui#11037 the week
 * and day views' move, which keeps an event's elapsed length across one.
 * objectui#10866 then added a gantt with a business `timeZone` read and
 * dropped on a DST day, from a viewer zone whose DST differs from the chart's,
 * and the gantt's drags, which move every value by calendar days across a DST
 * change, as objectui#11005 ruled for the calendar.
 * A later date-only read site registers here the same way.
 *
 * ## Why a driver, and why the forks pool
 *
 * The zone is those pins' input, and this suite runs in UTC — the one offset
 * where the defect is invisible (`vitest.config.mts` pins it, objectui#8366).
 * ⚠️ Writing `process.env.TZ` inside a test of the normal run does NOT move
 * the zone: the root config runs `pool: 'threads'`, a worker thread's
 * `process.env` is a plain copy with no native setter, and `Intl` keeps
 * reading UTC. Measured while writing these pins: the same assignment in the
 * same test file resolved `America/Los_Angeles` on `--pool=forks` and `UTC`
 * on the default pool. A forked worker is a real process's MAIN thread, where
 * Node's `TZ` setter resets the zone. ⚠️ Nor can the zone be handed to a child
 * vitest in its environment: loading the root config re-pins `UTC` before any
 * worker starts, which is exactly what `vitest-timezone-pin-8366.test.ts`
 * spawns a vitest to prove. So the pins set the zone themselves, per case,
 * and only a forked child can run them.
 *
 * Each pin is therefore skipped in the normal run and runs only here: one
 * vitest over every file in {@link PINS}, `--pool=forks`, with
 * `OBJECTUI_DATE_ZONE_CHILD=1`. Every zone in every pin opens with a rig case
 * — the zone `Intl` resolved, and the local hour of a fixed instant — so a
 * child whose zone did not move reds inside the child.
 *
 * ## What this file asserts, and why "ran" is half of it
 *
 * Reading the child's JSON report, per pin: the file was collected, it ran at
 * least one case, and every case PASSED — skipped counts as failure. A child
 * that stopped honouring the flag would skip every case, exit 0 and say
 * nothing; that is the silent shape this rules out. One spawn, not one per pin,
 * because the spawn is the whole cost.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The pins this file drives, relative to the repository root. */
const PINS = [
  'packages/components/src/__tests__/data-table.dateOnlyZone-10183.test.tsx',
  'packages/plugin-detail/src/__tests__/summaryChip.dateOnlyZone-10183.test.tsx',
  'packages/app-shell/src/utils/__tests__/auditHistoryDisplay.dateOnlyZone-10183.test.ts',
  'packages/fields/src/__tests__/dateCell.overdueZone-10183.test.tsx',
  // objectui#10293: the `ui:calendar` primitive's selected date, the same
  // date-only convention at a fifth read site.
  'packages/components/src/renderers/form/__tests__/calendar.dateValueZone-10293.test.tsx',
  // objectui#10844, the family's closure card: the dashboard filter's custom
  // range bounds, the `date-picker` renderer's authored value, and the report
  // cell's date face its census found.
  'packages/plugin-dashboard/src/__tests__/DashboardFilterBar.dateOnlyZone-10844.test.tsx',
  'packages/components/src/renderers/form/__tests__/date-picker.dateValueZone-10844.test.tsx',
  'packages/plugin-report/src/__tests__/formatValue.dateOnlyZone-10844.test.ts',
  // objectui#10866, the family's successor closure card, slice 1: the
  // calendar's and the gantt's reads, each with the write of a `date` field
  // pinned beside it, and the gantt's working-calendar day math.
  'packages/plugin-calendar/src/__tests__/ObjectCalendar.dateOnlyZone-10866.test.tsx',
  'packages/plugin-calendar/src/__tests__/calendarViewRenderer.dateOnlyZone-10866.test.tsx',
  'packages/plugin-gantt/src/__tests__/ObjectGantt.dateOnlyZone-10866.test.tsx',
  'packages/plugin-gantt/src/__tests__/GanttView.dateOnlyZone-10866.test.tsx',
  'packages/plugin-gantt/src/__tests__/scheduling.dateOnlyZone-10866.test.ts',
  // objectui#10866, slice 2: the timeline's date bucket, sort and item date,
  // the chart's date-only axis tick, and `@object-ui/i18n`'s published date
  // helpers.
  'packages/plugin-timeline/src/__tests__/ObjectTimeline.dateOnlyZone-10866.test.tsx',
  'packages/plugin-timeline/src/__tests__/TimelineRenderer.dateOnlyZone-10866.test.tsx',
  'packages/plugin-charts/src/__tests__/AdvancedChartImpl.dateOnlyZone-10866.test.tsx',
  'packages/i18n/src/__tests__/formatting.dateOnlyZone-10866.test.ts',
  // objectui#10866, slice 3: the timeline renderer's gantt variant (its axis
  // headers, extent, bar geometry, validity gate, min-over-max guard and the
  // empty plan's today) and core `FormulaFunctions`' day arithmetic.
  'packages/plugin-timeline/src/__tests__/TimelineGantt.dateOnlyZone-10866.test.tsx',
  'packages/core/src/evaluator/__tests__/FormulaFunctions.dateOnlyZone-10866.test.ts',
  // objectui#10866, slice 4: the calendar's day moves across a DST change,
  // and the paths slice 1 repaired that no zone pin covered: the calendar's
  // end-date write and no-schema fallback, and the gantt's no-schema path.
  'packages/plugin-calendar/src/__tests__/ObjectCalendar.dstDayMove-10866.test.tsx',
  'packages/plugin-calendar/src/__tests__/ObjectCalendar.endDateNoSchemaZone-10866.test.tsx',
  'packages/plugin-gantt/src/__tests__/ObjectGantt.noSchemaZone-10866.test.tsx',
  // objectui#11005: the month grid moves a value by calendar days and keeps
  // its wall-clock time across a DST change, for a move and an end drag.
  'packages/plugin-calendar/src/__tests__/CalendarView.monthMoveCalendarDays-11005.test.tsx',
  // objectui#11037: the week and day views move an event by its own elapsed
  // length and grab offset, so a 4-hour event keeps 4 hours across a DST change.
  'packages/plugin-calendar/src/__tests__/CalendarView.timeGridMoveDuration-11037.test.tsx',
  // objectui#10866, slice 5: a gantt with a business `timeZone` draws and
  // writes a stored day as that day on a DST change of either zone.
  'packages/plugin-gantt/src/__tests__/ObjectGantt.zonedDstDay-10866.test.tsx',
  // objectui#10866, slice 6: a gantt move, end drag and group move shift every
  // value by calendar days and keep its wall-clock time across a DST change.
  'packages/plugin-gantt/src/__tests__/GanttView.moveCalendarDays-10866.test.tsx',
  // objectui#12206: the record page's inline editor writes a `date` field as
  // the plain day the Edit form writes, at UTC+8 and at UTC-5.
  'packages/plugin-detail/src/__tests__/InlineFieldInput.dateOnlyWriteZone-12206.test.tsx',
  // objectui#12759: the same editor moves a `datetime` to another day and
  // keeps its wall-clock time, at UTC+8 and at UTC-5.
  'packages/plugin-detail/src/__tests__/InlineFieldInput.datetimePicker-12759.test.tsx',
] as const;

/** The vitest CLI entry, resolved rather than assumed at a `node_modules` path. */
const vitestCli = (() => {
  const require = createRequire(path.join(repoRoot, 'noop.js'));
  const pkgPath = require.resolve('vitest/package.json');
  const bin = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).bin as { vitest: string }).vitest;
  return path.resolve(path.dirname(pkgPath), bin);
})();

interface AssertionResult {
  title: string;
  status: string;
  failureMessages: string[];
}
interface FileResult {
  name: string;
  assertionResults: AssertionResult[];
}
interface Run {
  status: number | null;
  output: string;
  files: FileResult[];
}

let cached: Run | undefined;

/** One child for all the pins, memoized. */
function run(): Run {
  if (cached) return cached;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'date-zone-10183-'));
  const report = path.join(dir, 'report.json');
  try {
    const env = childVitestEnv({ OBJECTUI_DATE_ZONE_CHILD: '1' });
    const child = spawnSync(
      process.execPath,
      [vitestCli, 'run', ...PINS, '--pool=forks', '--reporter=json', '--outputFile', report],
      { cwd: repoRoot, encoding: 'utf8', env, timeout: 300_000 },
    );
    const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    const files = fs.existsSync(report)
      ? (JSON.parse(fs.readFileSync(report, 'utf8')) as { testResults: FileResult[] }).testResults
      : [];
    cached = { status: child.status, output, files };
    return cached;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('objectui#10183 — the date-only zone pins, driven on the forks pool', { timeout: 360_000 }, () => {
  it.each(PINS)('%s ran every case in its zone, and every case passed', (pin) => {
    const { files, output } = run();
    const file = files.find((f) => path.relative(repoRoot, f.name) === pin);
    expect(file, `the child did not collect ${pin}\n${output}`).toBeDefined();
    const cases = file!.assertionResults;
    const notPassed = cases
      .filter((c) => c.status !== 'passed')
      .map((c) => `${c.status}: ${c.title}\n${c.failureMessages.join('\n')}`);
    expect(cases.length, `${pin} ran no case at all`).toBeGreaterThan(0);
    expect(notPassed, `${pin}: cases that did not pass in the forked child`).toEqual([]);
  });

  it('the child run itself exited 0', () => {
    const { status, output } = run();
    expect(status, output).toBe(0);
  });
});

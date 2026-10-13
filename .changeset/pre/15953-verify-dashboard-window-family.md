---
'@objectstack/verify': minor
'@objectstack/cli': minor
---

feat(verify): the dashboard date-window family — every widget a dashboard's `dateRange` binds counts, under each preset of the picker, the rows that window selects, runnable as `os verify --dashboard-windows` (#15953)

Clause-②: yes

A seventh derived proof family beside `runCrudVerification`, `runRlsProofs`, `runReferenceShapeProofs`, `runDeleteBehaviorProofs`, `runUniqueScopeProofs` and `runParentWriteReachProofs`. It needs no hand-written test: from the app's own dashboards and datasets, read through the spec's own parse (`DashboardSchema`, `DatasetSchema`), it takes every dashboard that declares a `dateRange` and every widget that window binds, and asks the dataset door what each one counts.

Where each half of the promise is read from:

- the field a widget's window lands on is `DashboardWidgetSchema.filterBindings`' contract: `filterBindings.dateRange` names it, `false` opts the widget out (reported `unbound`), and absent means the dashboard's `dateRange.field` (`created_at` when unauthored). It resolves against the object behind the widget's dataset, as the stack registers it, and must be a `date` or `datetime` field;
- a preset's window is `DATE_RANGE_PRESET_MACRO_WINDOWS`, the `{date-macro}` pair each of the 13 `DATE_RANGE_PRESETS` names. It is handed to `POST /analytics/dataset/query` as written (`{ $gte: '{7_days_ago}' }`, `{ $gte: '{month_start}', $lte: '{month_end}' }`), ANDed with the widget's own filter as `runtimeFilter`, and the server resolves the tokens;
- the days a window selects, for the ground truth, are that same window resolved by `@objectstack/core`'s `resolveFilterTokens` on the caller's reference timezone (UTC unless the `ExecutionContext` carries one), first and last day inclusive.

Per bound widget and count measure, fixture rows are written through the seed door on every preset's first and last day and the day either side (never after today), each stamped at UTC noon (a `date` field takes the day itself), owned by the caller, with every column the widget's filter, the dataset's filter and the measure's filter compare held to a value they select, and read back before anything is judged. The widget is asked as the signed-in caller with no window and under every preset, before and after the fixtures, so each count is a difference and the app's own rows cancel out. With no window it must count every fixture row before any window is judged. Under each preset it must count exactly the fixture rows that window selects: a widget that shows nothing there is `blank`, one that counts another number is contradicted, and one whose every preset answers what no window answers is named inert.

A widget is `proven`, `contradicted` (a preset went blank or counted other rows), `failed` (the door refused or faulted on a windowed query while the widget's own query answered), `inconclusive` (a fixture could not be written or did not read back as written, the widget with no window did not count every fixture row, its own query is refused, the UTC day turned after the run started, or the caller's timezone is not UTC), `unbound` or `excluded` (`excludedKind` names why: no count measure, a filter the ground truth cannot model, a window on a missing or non-temporal field, an undeclared or unparsed dataset or dashboard, an object the app does not declare or the CRUD derivation cannot synthesize). `contradicted + failed` widgets are the report's `hardFailures`. An average, a sum or a derived measure is counted as excluded; a held column is an equality, an `$in`, a `$nin` or `$ne` on a field that declares its options, or `{current_user_id}`.

**`@objectstack/verify` — new exports.**

- `runDashboardWindowProofs(stack, token, config)` → `DashboardWindowReport`. Run it on a fresh stack of its own, as a principal that reads the dashboards' objects: it writes fixture rows. The presets resolve once, when the run starts, on the current instant, which is the clock the server resolves them on.
- `deriveDashboardWindowCases(config)`, `formatDashboardWindowReport(report)`.
- Types: `DashboardWindowExclusion`, `DashboardWindowMeasureCase`, `DashboardWindowCase`, `DashboardWindowDashboard`, `DashboardWindowPreset`, `DashboardWindowAnswer`, `DashboardWindowPresetProbe`, `DashboardWindowMeasureResult`, `DashboardWindowWidgetStatus`, `DashboardWindowWidgetResult`, `DashboardWindowReport`.

```ts
import { bootStack, runDashboardWindowProofs, formatDashboardWindowReport } from '@objectstack/verify';

const stack = await bootStack(myApp);
const report = await runDashboardWindowProofs(stack, await stack.signIn(), myApp);
console.log(formatDashboardWindowReport(report)); // report.presets names what each preset handed the door
expect(report.summary.hardFailures).toBe(0);
await stack.stop();
```

**`@objectstack/cli` — `os verify --dashboard-windows`.** Opt-in, like `--unique-scopes` and `--parent-write-reach`, on a fresh boot of its own, as the signed-in admin. A widget that went blank or counted other rows than its window selects, or a windowed query the door refused or faulted, counts in `hardFailures` and fails the run. The `--json` document carries the report as `dashboardWindows` when the flag is given; without the flag the run and its document are unchanged.

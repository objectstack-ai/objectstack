# Gantt Plugin Roadmap — Feature Parity (vs SVAR React Gantt)

> **Status:** Planned. Gap analysis done (June 2026) against [SVAR React Gantt](https://github.com/svar-widgets/react-gantt).
> Current `@object-ui/plugin-gantt` is a draggable day-scale bar chart; it lacks the project-management
> semantics (dependencies, hierarchy, milestones, real time scales) that define a Gantt chart.
> SVAR core is GPLv3 — feature reference only, no code reuse (we are MIT).
>
> Tracked from the main [ROADMAP.md](../../ROADMAP.md) § P2.11.

## What we already have

Bar drag/resize with day snapping + optimistic persistence, pinch-to-zoom, responsive/mobile pass,
Today marker + jump-to-today, weekend highlighting, semantic color fallback, i18n, inline edit
(double-click), record detail drawer on click, delete confirmation.

## Phase 1 — Dependency Links Rendering (highest ROI) ✅

- [x] Render dependency arrows as an SVG overlay in `GanttView` (orthogonal elbow routing, arrowhead markers, backward-link detour)
- [x] Support the 4 link types: finish-to-start (default), start-to-start, finish-to-finish, start-to-finish — per-dependency `{ id, type }` object form; `normalizeDependencies` accepts CSV strings, id arrays, object arrays with id/type aliases
- [x] Recompute arrow paths live during bar drag/resize preview
- [x] Highlight a task's links on hover (and while dragging)
- [x] Tests: link parsing (string id, array, `{id, type}` object), path anchors per type, hover highlight, drag re-render, backward links (8 new GanttView tests + 6 normalizeDependencies tests)

## Phase 2 — Real Time Scales (resurrect `viewMode`) ✅

- [x] Implement day/week/month/quarter column generation in `timeColumns` — calendar-true column widths over one linear ms→px mapping (`pxPerDay = columnWidth / nominalDays`), so bars, grid, links and the Today marker stay aligned in every mode
- [x] Two-row scale header: month groups over day/week units, year groups over month/quarter units
- [x] Restore the view-mode segmented control in the toolbar; zoom buttons fall through to the next coarser/finer granularity at min/max column width
- [x] Drag snapping respects active granularity (day/week columns, calendar-clamped month/quarter shifts preserving duration on move)
- [x] Tests: column generation per mode, header groups/labels, bar geometry per granularity, week + month snap behavior (8 new tests)

## Phase 3 — Task Hierarchy & Types ✅

- [x] `parentField` (+ `task.parent`) → task tree, depth-indented rows, expand/collapse chevrons in the task list; orphans and parent cycles surface as roots instead of dropping rows
- [x] Summary (parent) bars: bracket-style slim bar with end caps spanning the children rollup range; read-only (children drive it)
- [x] Milestone type: diamond marker via `typeField`/`task.type` or the `end <= start` heuristic; movable, not resizable; links anchor at the diamond center
- [x] Auto-rollup: summary dates = min/max of descendants, progress = duration-weighted child progress (client-side, display via `data-progress`)
- [x] Tests: tree building, orphan + cycle handling, collapse hides rows/links, summary range/progress math, milestone rendering + link anchors (9 new tests)

## Phase 4 — Interaction Polish ✅

- [x] Progress drag handle on the bar — grip at the progress boundary, 1% snapping, live fill preview, commits `onTaskUpdate({progress})`
- [x] Rich hover tooltip (title, dates, duration, progress) on task bars, milestones and summary brackets
- [x] Context menu on bar/row — View details / Edit inline / Delete; closes on outside click or Escape (add-dependency is covered by drag-to-create)
- [x] Keyboard support: focusable gantt body, ArrowUp/Down row navigation, Enter to open, Delete to delete, ArrowLeft/Right collapse/expand; `tree`/`treeitem` roles with aria-level/-selected/-expanded
- [x] Drag-to-create dependency — connector dot on bar edge, dashed rubber band, drop-target highlight; fires `onDependencyCreate(source, target, 'fs')`, `ObjectGantt` appends to the dependencies field preserving its shape (CSV ↔ array)
- [x] Row drag-to-reorder — HTML5 drag in the task list, sibling-scoped, fires `onTaskReorder(task, before)` for the host to persist (sort-field wiring is host-specific)
- [x] Tests: progress drag + clamping, tooltip, context menu routing/Escape, keyboard nav + collapse, link create + empty-space release, reorder + cross-parent guard (11 new tests)

## Phase 5 — Scale & Performance ✅

- [x] Virtualized row rendering (windowing) for both task list and timeline — spacer-div windowing over flattened rows (≈viewport + 6-row overscan rendered), driven by scroll position + ResizeObserver-measured viewport; dependency-link SVG keeps absolute row coordinates and skips links fully outside the window
- [x] Virtualized timeline columns for multi-year ranges — prefix-sum column offsets + binary-free linear `visibleRange` scan; header groups, header units and the background grid render as absolutely-positioned cells inside the ±240px overscan window
- [x] Fullscreen mode toggle — toolbar button drives the native Fullscreen API on the Gantt container, icon/aria reflect `fullscreenchange`
- [x] Custom vertical markers — `markers` prop (`{date, label?, color?}`), rendered like the Today line on the shared ms→px mapping; out-of-range/invalid dates dropped; passed through `ObjectGantt` via `schema.markers`
- [x] Tests: 1000-row windowing + spacer heights, scroll window shift, windowed link anchoring, multi-year column windowing, fullscreen enter/exit, marker mapping/fallback color (8 new tests)

## Phase 6 — Advanced (SVAR PRO territory, differentiators)

- [x] Critical path computation + slack visualization — CPM forward/backward passes in `scheduling.ts` (zero-slack chain), toolbar toggle (Activity icon) highlights critical bars/milestones/summaries + joining link arrows in red; `criticalPathDefault` prop / `schema.criticalPath` start it on
- [x] Baselines (planned vs actual bars) — `baselineStart`/`baselineEnd` per task render a thin reference strip hugging each row's bottom (summary / task / milestone) on the shared ms→px mapping; `showBaselines` prop / `schema.showBaselines`, mapped in `ObjectGantt` via `baselineStartField` / `baselineEndField`
- [x] Auto-scheduling: dependency-driven date shifting (forward, finish-to-start first) — `computeProjectReschedule` (顺延: push successors later, durations preserved, never earlier; honors fs/ss/ff/sf; summaries fixed), toolbar button (Wand2) does a one-shot whole-project reschedule via `onTaskUpdate`; `autoSchedule` prop, auto-on in `ObjectGantt` when `dependenciesField` set
- [x] Working calendar (skip weekends/holidays in duration math) — `WorkingCalendar` (`skipWeekends`, `holidays` ISO-day Set) measures durations in working days; `computeCriticalPath` / `computeProjectReschedule` snap rescheduled tasks to working-day boundaries (fs/ss bump via `nextWorkingDay`, ff/sf back-derive via `subWorkingDays`); `workingCalendar` prop, derived in `ObjectGantt` from `schema.skipWeekends` / `schema.holidays`
- [x] Undo/redo for drag/edit operations — `commitTaskUpdates` records before/after field deltas per mutation (group-drag / auto-schedule batched into one entry) and replays through `onTaskUpdate` against `tasksRef`; toolbar Undo/Redo buttons + Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y; only shown when `onTaskUpdate` is wired
- [x] Export PNG (client-side) — toolbar button (Download) rebuilds the whole chart (virtualization-independent) as a standalone SVG with concrete hex colors, rasterizes to a 2× PNG via canvas, downloads `gantt-<mode>.png`; zero dependencies. _(PDF / MS Project XML still pending.)_

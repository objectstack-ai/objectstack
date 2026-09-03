// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#14073] The page door's visualization whitelist.
//
// Two halves, and they check each other. The PREDICATE PIN below restates
// objectui's derivation table verbatim, so a change on THIS side of the mirror
// cannot be silent. The SHOWCASE PIN feeds the shipped interface pages — the
// exact pages the card was filed about — through the rule live, so a change on
// the OBJECTUI side (or in the showcase object's fields) shows up as a page
// that renders today being reported as unbound. Neither half alone is enough:
// the pin is a copy of a copy, and the showcase run cannot see a predicate the
// showcase happens not to exercise.
//
// The showcase reads are a DECLARED cross-package coupling — the three modules
// are named on `@objectstack/lint#test`'s inputs in `turbo.json` and in
// `scripts/cross-package-test-inputs.mjs`, so both of CI's scoping layers move
// when the showcase moves.
//
// ⛔ They are loaded through a path built from `import.meta.url`, NOT by a
// static relative `import`, and that is not a style choice: a static import
// puts the example module inside this package's tsc program, where it is
// outside `rootDir` and reports TS6059. `tsconfig.test.json` inherits `rootDir`
// deliberately and must not loosen it, and `test-typecheck-debt.json` is an
// EXACT, shrink-only ratchet whose expansion is maintainer-only — so a static
// import here would have to buy its way past that ratchet. The path expression
// below is the shape `check:cross-package-test-inputs` recognises
// (`resolve(HERE, '<rel>')` seeded from `import.meta.url`, per AGENTS.md), so
// the coupling stays visible to the gate that scopes CI. Do not "tidy" it back
// into an import statement.
//
// ⚠️ These pins assert the shipped app is CLEAN, which is the direction #8515's
// ruling allows to stay live: nothing here needs the showcase to keep a defect.
// If a showcase edit turns one red, the app is what changed.

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';

import {
  validatePageVisualizationBindings,
  PAGE_VISUALIZATION_WITHOUT_BINDING,
  OBJECTUI_DERIVATION_PREDICATES,
} from './validate-page-visualization-bindings.js';
import { REFERENCE_INTEGRITY_RULES } from './reference-integrity-suite.js';

type AnyRec = Record<string, unknown>;

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOWCASE_TASK_OBJECT = resolve(HERE, '../../../examples/app-showcase/src/data/objects/task.object.ts');
const SHOWCASE_TASK_VIEWS = resolve(HERE, '../../../examples/app-showcase/src/ui/views/task.view.ts');
const SHOWCASE_TASK_PAGES = resolve(HERE, '../../../examples/app-showcase/src/ui/pages/task-visualizations.pages.ts');

const loadShowcase = async (path: string): Promise<AnyRec> =>
  (await import(pathToFileURL(path).href)) as AnyRec;

const { Task } = await loadShowcase(SHOWCASE_TASK_OBJECT);
const { TaskViews } = await loadShowcase(SHOWCASE_TASK_VIEWS);
const {
  TaskBoardPage,
  TaskCalendarPage,
  TaskGalleryPage,
  TaskSchedulePage,
  TaskTimelinePage,
  TaskMapPage,
  TaskAllViewsPage,
} = await loadShowcase(SHOWCASE_TASK_PAGES);

/** A `list` page with an `interfaceConfig`, spelled once. */
function listPage(name: string, cfg: AnyRec): AnyRec {
  return { name, type: 'list', interfaceConfig: cfg };
}

/** An object whose only fields are text — nothing any predicate can find. */
const DATELESS: AnyRec = {
  name: 'crm_note',
  fields: {
    title: { type: 'text' },
    body: { type: 'textarea' },
  },
};

describe('the predicate table is a verbatim mirror of objectui', () => {
  /**
   * ⛔ Do NOT "fix" this list to match a changed rule — it is the specimen.
   *
   * Transcribed from objectui `f0f774b0`,
   * `packages/app-shell/src/views/InterfaceListPage.tsx`: `SELECT_TYPES`,
   * `DATE_TYPES`, `IMAGE_TYPES` (`:149-151`), `LOCATION_TYPES` (`:203`),
   * `defaultKanbanFromObject` (`:153`), `defaultDateField` (`:163`),
   * `defaultCalendarFromObject` (`:170`), `defaultGalleryFromObject` (`:175`),
   * `defaultGanttFromObject` (`:185`), `defaultMapFromObject` (`:253`), and the
   * `view.<viz> ?? derived` precedence at `:409-419` plus
   * `resolveTimelineDateBinding` (`plugin-list/src/ListView.tsx:411-433`) for
   * the timeline's second accepted block.
   *
   * When this goes red the question is never "which side do I edit?" — it is
   * "did objectui's derivation move?". Re-read those symbols before touching
   * either side.
   */
  it('lists the derivation predicates exactly as the renderer applies them', () => {
    expect(OBJECTUI_DERIVATION_PREDICATES).toEqual([
      {
        visualization: 'kanban',
        binding: 'groupByField',
        types: ['select', 'multiselect', 'radio', 'enum', 'boolean'],
        namePattern: 'status|stage|state|priority|category|kind',
        viewBlocks: ['kanban'],
      },
      {
        visualization: 'calendar',
        binding: 'startDateField',
        types: ['date', 'datetime', 'time'],
        namePattern: 'date|due|start|end|deadline|schedule',
        viewBlocks: ['calendar'],
      },
      {
        visualization: 'timeline',
        binding: 'startDateField',
        types: ['date', 'datetime', 'time'],
        namePattern: 'date|due|start|end|deadline|schedule',
        viewBlocks: ['timeline', 'calendar'],
      },
      {
        visualization: 'gallery',
        binding: 'coverField',
        types: ['image', 'file', 'attachment', 'avatar', 'photo'],
        namePattern: null,
        viewBlocks: ['gallery'],
      },
      {
        visualization: 'gantt',
        binding: 'startDateField + endDateField',
        types: ['date', 'datetime', 'time'],
        namePattern: null,
        viewBlocks: ['gantt'],
      },
      {
        visualization: 'map',
        binding: 'locationField',
        types: ['location', 'geo', 'geolocation', 'geopoint', 'point'],
        namePattern: 'location|address|geo|coords?|place|venue',
        viewBlocks: ['map'],
      },
    ]);
  });

  it('covers every visualization the renderer derives, and claims no others', () => {
    // `grid` needs no binding; `chart` and `tree` have NO deriver on this seam,
    // so the rule has no measured verdict about them (skip 3). This assertion
    // is the boundary, written down: widening it is a measurement, not an edit.
    expect(OBJECTUI_DERIVATION_PREDICATES.map((p) => p.visualization)).toEqual([
      'kanban', 'calendar', 'timeline', 'gallery', 'gantt', 'map',
    ]);
  });
});

describe('the shipped showcase interface pages (regression pin)', () => {
  const showcasePages = [
    TaskBoardPage,       // ['kanban']
    TaskCalendarPage,    // ['calendar']
    TaskGalleryPage,     // ['gallery']
    TaskSchedulePage,    // ['gantt']
    TaskTimelinePage,    // ['timeline']
    TaskMapPage,         // ['map'], bound through `sourceView: 'map'`
    TaskAllViewsPage,    // the full switcher
  ] as AnyRec[];

  const stack: AnyRec = {
    objects: [Task],
    views: [TaskViews],
    pages: showcasePages,
  };

  it('are all `list` pages carrying an `allowedVisualizations` whitelist', () => {
    // Guards the pin below against going vacuously green: if `definePage` ever
    // stopped emitting `type: 'list'`, every page would hit skip 1 and the
    // zero-findings assertion would keep passing while checking nothing.
    for (const page of showcasePages) {
      expect(page.type).toBe('list');
      const cfg = page.interfaceConfig as AnyRec;
      const appearance = cfg.appearance as AnyRec;
      expect(Array.isArray(appearance.allowedVisualizations)).toBe(true);
      expect((appearance.allowedVisualizations as string[]).length).toBeGreaterThan(0);
    }
    // …and every visualization the rule judges is actually exercised by them.
    const whitelisted = new Set(
      showcasePages.flatMap(
        (p) => ((p.interfaceConfig as AnyRec).appearance as AnyRec).allowedVisualizations as string[],
      ),
    );
    for (const { visualization } of OBJECTUI_DERIVATION_PREDICATES) {
      expect(whitelisted.has(visualization)).toBe(true);
    }
  });

  it('derive every whitelisted visualization — zero findings', () => {
    expect(validatePageVisualizationBindings(stack)).toEqual([]);
  });

  it('reports the SAME pages once the object loses its date fields', () => {
    // The other direction on the same corpus: strip `showcase_task`'s date
    // fields and the calendar / timeline / gantt pages must go red. Without
    // this, "zero findings" is compatible with a rule that never fires.
    const fields = { ...((Task as AnyRec).fields as AnyRec) };
    for (const dateField of ['due_date', 'start_date', 'end_date', 'created_at']) delete fields[dateField];
    const dated = validatePageVisualizationBindings({
      ...stack,
      objects: [{ ...(Task as AnyRec), fields }],
    });
    expect(dated.map((f) => `${f.severity}:${f.path}`)).toEqual([
      // ['calendar'] — leading, so the page IS the refusal screen
      'error:pages[1].interfaceConfig.appearance.allowedVisualizations[0]',
      // ['gantt'] — leading
      'error:pages[3].interfaceConfig.appearance.allowedVisualizations[0]',
      // ['timeline'] — leading
      'error:pages[4].interfaceConfig.appearance.allowedVisualizations[0]',
      // the all-views switcher: calendar / timeline / gantt are NOT leading
      'warning:pages[6].interfaceConfig.appearance.allowedVisualizations[3]',
      'warning:pages[6].interfaceConfig.appearance.allowedVisualizations[4]',
      'warning:pages[6].interfaceConfig.appearance.allowedVisualizations[5]',
    ]);
  });
});

describe('severity tracks what the visitor sees', () => {
  it('gates when the unbound entry LEADS the whitelist', () => {
    const findings = validatePageVisualizationBindings({
      objects: [DATELESS],
      pages: [listPage('note_calendar', {
        source: 'crm_note',
        appearance: { allowedVisualizations: ['calendar'] },
      })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(PAGE_VISUALIZATION_WITHOUT_BINDING);
    expect(findings[0].where).toBe('page "note_calendar" · interfaceConfig.appearance');
    expect(findings[0].path).toBe('pages[0].interfaceConfig.appearance.allowedVisualizations[0]');
    // The message names the page, the visualization, and what was looked for.
    expect(findings[0].message).toContain('note_calendar');
    expect(findings[0].message).toContain("'calendar'");
    expect(findings[0].message).toContain('startDateField');
    expect(findings[0].message).toContain('a field typed date / datetime / time');
    expect(findings[0].message).toContain('forced view type');
    // …and the hint names `sourceView` as the remedy on this door.
    expect(findings[0].hint).toContain('sourceView');
  });

  it('advises when the unbound entry is not the leading one', () => {
    const findings = validatePageVisualizationBindings({
      objects: [DATELESS],
      pages: [listPage('note_grid_then_calendar', {
        source: 'crm_note',
        appearance: { allowedVisualizations: ['grid', 'calendar'] },
      })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('pages[0].interfaceConfig.appearance.allowedVisualizations[1]');
    expect(findings[0].message).toContain('SILENTLY');
    expect(findings[0].hint).toContain('sourceView');
  });

  it('says nothing about `grid`, which needs no binding', () => {
    expect(validatePageVisualizationBindings({
      objects: [DATELESS],
      pages: [listPage('note_grid', {
        source: 'crm_note',
        appearance: { allowedVisualizations: ['grid'] },
      })],
    })).toEqual([]);
  });

  it('says nothing about `chart` or `tree` — no deriver on this seam to mirror', () => {
    expect(validatePageVisualizationBindings({
      objects: [DATELESS],
      pages: [listPage('note_chart', {
        source: 'crm_note',
        appearance: { allowedVisualizations: ['chart', 'tree'] },
      })],
    })).toEqual([]);
  });
});

describe('`sourceView` is the remedy, and the rule honours it', () => {
  const calendarView = {
    name: 'crm_note_views',
    objectName: 'crm_note',
    listViews: {
      schedule: {
        label: 'Schedule',
        type: 'calendar',
        columns: ['title'],
        calendar: { startDateField: 'reminder' },
      },
    },
  };

  it('passes a page bound through `sourceView` to a view carrying `calendar:`', () => {
    expect(validatePageVisualizationBindings({
      objects: [DATELESS],
      views: [calendarView],
      pages: [listPage('note_calendar_bound', {
        source: 'crm_note',
        sourceView: 'schedule',
        appearance: { allowedVisualizations: ['calendar'] },
      })],
    })).toEqual([]);
  });

  it('still reports a visualization the referenced view does not bind', () => {
    const findings = validatePageVisualizationBindings({
      objects: [DATELESS],
      views: [calendarView],
      pages: [listPage('note_calendar_and_kanban', {
        source: 'crm_note',
        sourceView: 'schedule',
        appearance: { allowedVisualizations: ['calendar', 'kanban'] },
      })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain("'kanban'");
    expect(findings[0].message).toContain('the referenced view "schedule" declares no `kanban:` block');
  });

  it('accepts a `calendar:` block as the TIMELINE axis (resolveTimelineDateBinding)', () => {
    expect(validatePageVisualizationBindings({
      objects: [DATELESS],
      views: [calendarView],
      pages: [listPage('note_timeline_via_calendar', {
        source: 'crm_note',
        sourceView: 'schedule',
        appearance: { allowedVisualizations: ['timeline'] },
      })],
    })).toEqual([]);
  });

  it('resolves the ADR-0017 `<object>.<key>` spelling too', () => {
    expect(validatePageVisualizationBindings({
      objects: [{
        ...DATELESS,
        listViews: { 'crm_note.schedule': { columns: ['title'], calendar: { startDateField: 'reminder' } } },
      }],
      pages: [listPage('note_qualified', {
        source: 'crm_note',
        sourceView: 'schedule',
        appearance: { allowedVisualizations: ['calendar'] },
      })],
    })).toEqual([]);
  });

  it('skips the page when `sourceView` names no view this stack declares', () => {
    // Skip 4: the runtime hydrates a stored view body over the network, so a
    // build-time miss is unknowable — never a finding.
    expect(validatePageVisualizationBindings({
      objects: [DATELESS],
      pages: [listPage('note_hydrated', {
        source: 'crm_note',
        sourceView: 'stored_elsewhere',
        appearance: { allowedVisualizations: ['calendar'] },
      })],
    })).toEqual([]);
  });
});

describe('the derivation, predicate by predicate', () => {
  const pageFor = (viz: string) => listPage(`p_${viz}`, {
    source: 'probe',
    appearance: { allowedVisualizations: [viz] },
  });
  const run = (viz: string, fields: AnyRec) =>
    validatePageVisualizationBindings({
      objects: [{ name: 'probe', fields }],
      pages: [pageFor(viz)],
    });

  it('derives kanban from a select-like TYPE, else a status-like NAME', () => {
    expect(run('kanban', { stage_text: { type: 'text' } })).toEqual([]);      // name fallback
    expect(run('kanban', { flag: { type: 'boolean' } })).toEqual([]);         // type
    expect(run('kanban', { title: { type: 'text' } })).toHaveLength(1);
  });

  it('derives calendar from a date-like TYPE, else a date-like NAME', () => {
    expect(run('calendar', { when: { type: 'datetime' } })).toEqual([]);
    expect(run('calendar', { deadline_note: { type: 'text' } })).toEqual([]); // name fallback
    expect(run('calendar', { title: { type: 'text' } })).toHaveLength(1);
  });

  it('derives gallery from an image-like TYPE ONLY — it has no name fallback', () => {
    expect(run('gallery', { shot: { type: 'attachment' } })).toEqual([]);
    // A field literally called `cover` is NOT enough: the renderer's gallery
    // deriver has no name leg, so a lint that accepted one would be LOOSER
    // than the runtime and miss a real blank-card page.
    expect(run('gallery', { cover: { type: 'text' } })).toHaveLength(1);
  });

  it('needs TWO DISTINCT date fields for gantt', () => {
    expect(run('gantt', { start_date: { type: 'date' }, end_date: { type: 'date' } })).toEqual([]);
    expect(run('gantt', { start_date: { type: 'date' } })).toHaveLength(1);
    // One date field cannot serve both legs.
    expect(run('gantt', { due_date: { type: 'date' }, note: { type: 'text' } })).toHaveLength(1);
  });

  it('derives map from a location-like TYPE, else a geo-like NAME', () => {
    expect(run('map', { spot: { type: 'geopoint' } })).toEqual([]);
    expect(run('map', { venue: { type: 'text' } })).toEqual([]);              // name fallback
    expect(run('map', { title: { type: 'text' } })).toHaveLength(1);
  });

  it('skips hidden and framework-managed fields before any predicate', () => {
    // `created_at` is a system column and `secret_date` is hidden — the
    // renderer filters both out before `defaultDateField` ever sees them.
    expect(run('calendar', {
      created_at: { type: 'datetime' },
      secret_date: { type: 'date', hidden: true },
      flagged: { type: 'date', system: true },
      title: { type: 'text' },
    })).toHaveLength(1);
  });
});

describe('the skips', () => {
  it('says nothing about a page that is not `type: list`', () => {
    expect(validatePageVisualizationBindings({
      objects: [DATELESS],
      pages: [{
        name: 'note_record',
        type: 'record',
        interfaceConfig: { source: 'crm_note', appearance: { allowedVisualizations: ['calendar'] } },
      }],
    })).toEqual([]);
  });

  it('says nothing about an object this stack does not declare', () => {
    expect(validatePageVisualizationBindings({
      objects: [DATELESS],
      pages: [listPage('elsewhere', {
        source: 'installed_by_a_package',
        appearance: { allowedVisualizations: ['calendar'] },
      })],
    })).toEqual([]);
  });

  it('says nothing about an object with no readable field map (ADR-0015 external)', () => {
    expect(validatePageVisualizationBindings({
      objects: [{ name: 'ext_customer', external: true }],
      pages: [listPage('ext', {
        source: 'ext_customer',
        appearance: { allowedVisualizations: ['calendar'] },
      })],
    })).toEqual([]);
  });

  it('falls back to the page-level `object` when `interfaceConfig.source` is absent', () => {
    const findings = validatePageVisualizationBindings({
      objects: [DATELESS],
      pages: [{
        name: 'note_page_object',
        type: 'list',
        object: 'crm_note',
        interfaceConfig: { appearance: { allowedVisualizations: ['calendar'] } },
      }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('crm_note');
  });

  it('tolerates a stack with no pages, no objects and no appearance at all', () => {
    expect(validatePageVisualizationBindings({})).toEqual([]);
    expect(validatePageVisualizationBindings({ pages: [listPage('bare', { source: 'crm_note' })] })).toEqual([]);
    expect(validatePageVisualizationBindings({
      objects: [DATELESS],
      pages: [listPage('empty_whitelist', {
        source: 'crm_note',
        appearance: { allowedVisualizations: [] },
      })],
    })).toEqual([]);
  });
});

describe('suite wiring', () => {
  it('runs as a member of the reference-integrity suite', () => {
    const member = REFERENCE_INTEGRITY_RULES.find(
      (r) => r.name === 'validatePageVisualizationBindings',
    );
    expect(member).toBeDefined();
    expect(member?.run).toBe(validatePageVisualizationBindings);
    // Frozen `flow` default: the per-write `view` snapshot carries no pages.
    expect(member?.runtimeTypes).toBeUndefined();
  });
});

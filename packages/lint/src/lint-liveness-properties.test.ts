// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { lintLivenessProperties } from './lint-liveness-properties.js';

/**
 * These run against the REAL ledgers shipped by `@objectstack/spec` (the same
 * files the gate enforces), so they double as a contract test: if an
 * `authorWarn` annotation is removed from a still-dead prop (e.g. tool
 * `permissions`, flow `nodes.outputSchema`), the matching assertion fails.
 */

const objStack = (obj: Record<string, unknown>) => ({ objects: [{ name: 'widget', ...obj }] });
const paths = (findings: { message: string }[]) => findings.map((f) => f.message);

describe('lintLivenessProperties', () => {
  // NOTE: as of #2377 the object- and field-level dead+authorWarn surface is
  // empty (enforce-or-remove complete for those types), so the positive-warn
  // assertions here run against still-dead props of OTHER governed types
  // (flow.nodes.outputSchema, tool.permissions, agent.memory). The object/field
  // WALKER is still exercised by the silent-clean and default-on-suppression
  // cases below.

  it('does NOT warn on a default-on flag the author left alone (enable.searchable: true)', () => {
    const findings = lintLivenessProperties(objStack({ enable: { searchable: true } }));
    expect(paths(findings).some((m) => m.includes('enable.searchable'))).toBe(false);
  });

  // #2707/#2727: every ObjectCapabilities flag is now LIVE (opt-out
  // writer/UI gates, the History-tab master switch, the opt-in Attachments
  // gate) — authoring them must no longer warn.
  it('does NOT warn on the now-live capability flags (feeds/activities/trackHistory/files)', () => {
    const findings = lintLivenessProperties(
      objStack({ enable: { feeds: true, activities: true, trackHistory: true, files: true } }),
    );
    expect(paths(findings).some((m) => m.includes('enable.'))).toBe(false);
  });

  it('is silent for a clean object with only live properties', () => {
    const findings = lintLivenessProperties(
      objStack({
        label: 'Widget',
        enable: { apiEnabled: true },
        fields: [{ name: 'name', type: 'text', label: 'Name' }],
      }),
    );
    expect(findings).toEqual([]);
  });

  it('handles objects as a keyed record (not just arrays)', () => {
    // Record form ({ name: obj }) is walked like the array form — a clean object
    // in record form yields no findings and does not throw (no object-level
    // dead+authorWarn prop remains to assert a positive on, post-#2377).
    const findings = lintLivenessProperties({
      objects: { widget: { name: 'widget', label: 'Widget', enable: { apiEnabled: true } } },
    });
    expect(findings).toEqual([]);
  });

  it('returns [] on an empty / shapeless stack', () => {
    expect(lintLivenessProperties({})).toEqual([]);
    expect(lintLivenessProperties({ objects: [] })).toEqual([]);
  });

  // ── Coverage beyond object/field: flat stack collections ─────────────
  // The 2026-07 authorWarn pass marked misleading dead props on flows,
  // actions, agents, tools, datasets, permissions, and the object tenancy
  // block. These run against the REAL ledgers, so they double as contract
  // tests for those markings.

  // flow.errorHandling.fallbackNodeId and nodes[].outputSchema left the warn
  // list with the #3896 close-out sweep: the keys were REMOVED from the
  // schema (retiredKey tombstones carry the prescription at parse), so the
  // advisory warn's job is done by a hard error and the ledger entries this
  // lint keyed on are gone. Same shape as tool.permissions below.
  it('retired flow keys no longer warn — the strict parse owns them now', () => {
    const findings = lintLivenessProperties({
      flows: [{
        name: 'f1',
        errorHandling: { fallbackNodeId: 'n2' },
        nodes: [{ id: 'n2', outputSchema: { type: 'object' } }],
      }],
    });
    expect(findings.some((x) => x.message.includes('errorHandling.fallbackNodeId'))).toBe(false);
    expect(findings.some((x) => x.message.includes('nodes.outputSchema'))).toBe(false);
  });

  it('warns on an experimental prop with no authorWarn of its own (agent.memory)', () => {
    // `experimental` warns implicitly — shouldWarn() treats a declared-but-
    // unenforced guarantee like an opted-in dead prop. Repointed from
    // action.undoable in #3714, which turned out to have two objectui readers.
    const findings = lintLivenessProperties({ agents: [{ name: 'ag1', memory: { kind: 'buffer' } }] });
    const f = findings.find((x) => x.message.includes('`memory`'));
    expect(f).toBeDefined();
    expect(f!.rule).toBe('liveness-experimental-property');
  });

  it('stays silent on action.undoable — live since #3714, not experimental', () => {
    // Regression guard for the OTHER failure direction: an understated ledger
    // entry warns "declared but NOT enforced" on a property that works, telling
    // authors (and AI) to skip a shipped feature.
    const findings = lintLivenessProperties({ actions: [{ name: 'a1', undoable: true }] });
    expect(paths(findings).some((m) => m.includes('`undoable`'))).toBe(false);
  });

  it('retired props leave the warn list with their ledger entries', () => {
    // tenancy.strategy/crossTenantAccess left this list after spec 15.0 (#2763):
    // the schema now REJECTS them (strict tenancy block), so the ledger entries
    // are gone and the live tenancy knobs must not warn.
    const tenancy = lintLivenessProperties(objStack({ tenancy: { enabled: true, tenantField: 'org_id' } }));
    expect(paths(tenancy).some((m) => m.includes('tenancy'))).toBe(false);

    // tool.permissions left with the #3896 close-out: the key was REMOVED from
    // ToolSchema (with category/active/builtIn), so enforcement moved a layer
    // down — the strict parse now rejects it with its prescription before any
    // lint could run, and the ledger entry this warn keyed on is gone. The
    // advisory warn's job is done by a hard error; warning again would be noise.
    const tool = lintLivenessProperties({ tools: [{ name: 't1', permissions: ['crm.admin'] }] });
    expect(paths(tool).some((m) => m.includes('`permissions`'))).toBe(false);

    // permission.contextVariables left this list with ADR-0105 D11: the prop was
    // REMOVED outright (enforce-or-remove), so its ledger entry is gone and the
    // lint no longer has anything to warn about.
    const perm = lintLivenessProperties({ permissions: [{ name: 'p1', contextVariables: { region: 'emea' } }] });
    expect(paths(perm).some((m) => m.includes('contextVariables'))).toBe(false);
  });

  it('stays silent on clean flat-collection items', () => {
    const findings = lintLivenessProperties({
      flows: [{ name: 'clean', nodes: [{ id: 'n1' }] }],
      actions: [{ name: 'clean' }],
      tools: [{ name: 'clean' }],
    });
    expect(findings).toEqual([]);
  });

  // ── view (#2998 Track B) ──────────────────────────────────────────────────

  // list.responsive / form.defaultSort left the warn list with the #3896
  // close-out sweep (keys REMOVED, strict parse owns them). form.data is the
  // sweep's one CORRECTION: the removal attempt broke the build — defineForm
  // writes data.provider='schema' on every metadata form — so its ledger
  // entry flipped to live and it must not warn either.
  it('retired/corrected view keys no longer warn', () => {
    const findings = lintLivenessProperties({
      views: [{
        object: 'task',
        list: { type: 'grid', responsive: { breakpoint: 'md' } },
        form: {
          type: 'wizard',
          sections: [{ fields: ['title'] }],
          data: { provider: 'object', object: 'task' },
          defaultSort: [{ field: 'created_at' }],
        },
      }],
    });
    const msgs = paths(findings);
    expect(msgs.some((m) => m.includes('list.responsive'))).toBe(false);
    expect(msgs.some((m) => m.includes('form.defaultSort'))).toBe(false);
    expect(msgs.some((m) => m.includes('form.data'))).toBe(false);
  });

  it('stays silent on a clean grid view', () => {
    const findings = lintLivenessProperties({
      views: [{ object: 'task', list: { type: 'grid', columns: ['title'] } }],
    });
    expect(findings).toEqual([]);
  });

  // ── webhook (#3461 bridge landed → #3490; #3494 prune) ────────────────────
  // Two things closed the old "entire surface is dead" state: #3494 PRUNED the
  // aspirational dead props (body/payloadFields/includeSession/retryPolicy/tags/
  // authentication) from the schema, and the #3489 materializer bridge makes
  // every REMAINING prop live (object/isActive/url/triggers/method/name/headers/
  // secret/timeoutMs/label/description). So a webhook has no misleading dead
  // surface left — authoring one is silent. Runs against the REAL webhook.json.

  it('does not warn on an authored webhook — all remaining props are live (#3490)', () => {
    const findings = lintLivenessProperties({
      webhooks: [{
        name: 'showcase_task_changed',
        object: 'showcase_task',
        triggers: ['create', 'update', 'delete'],
        url: 'https://hooks.example/showcase/task',
        method: 'POST',
        isActive: true,
        description: 'Sends task lifecycle events to an external system.',
      }],
    });
    expect(findings).toEqual([]);
  });

  // ── datasource (#4487 — the type was ungoverned until the ledger was seeded) ──
  // Runs against the REAL datasource.json. These pin the ledger→author loop for
  // the type that most needed it: 20 of its 43 props have no runtime consumer,
  // and until #4487 nothing told an author so.

  it('no longer warns on ANY datasource block — the whole dead surface is gone (#4583)', () => {
    // This assertion has now inverted twice, and the direction of travel is the
    // point. It began (#4487) asserting warnings on capabilities/healthCheck/
    // retryPolicy; batch A removed `capabilities`, so it narrowed to the other
    // two; batches B/C/D removed those as well. Every one of the twenty dead
    // datasource properties is now a hard parse rejection carrying its own
    // prescription — strictly stronger than an advisory lint warning, which is
    // why their ledger rows are deleted rather than flipped.
    //
    // Kept (rather than deleted) as a REGRESSION GUARD: it runs against the
    // real shipped ledger, so re-introducing a dead+authorWarn datasource
    // property fails here rather than shipping quietly.
    const findings = lintLivenessProperties({
      datasources: [{
        name: 'warehouse',
        label: 'Warehouse',
        driver: 'postgres',
        config: { host: 'db.internal', database: 'analytics' },
      }],
    });
    expect(findings).toEqual([]);
  });

  // The entry the whole audit was worth doing for. `capabilities.readOnly` read
  // as a safety switch and gated nothing — a datasource labelled a read replica
  // took writes like any other. #4583 REMOVED it rather than warn about it for
  // another release, so the check moved up a level: the lint no longer has an
  // opinion because the schema refuses the key outright. The prescription that
  // replaces the hint is asserted in `packages/spec` (datasource.test.ts), where
  // it can also assert the part a hint could not carry — that the enforced gate
  // does NOT cover managed datasources (#4584).
  it('no longer warns on capabilities.readOnly — the key is gone, not merely flagged (#4583)', () => {
    const findings = lintLivenessProperties({
      datasources: [{
        name: 'reporting',
        driver: 'postgres',
        config: { host: 'ro.internal', database: 'reporting' },
      }],
    });
    expect(findings.some((f) => f.message.includes('capabilities'))).toBe(false);
  });

  it('stays silent on a datasource that only sets live properties (#4487)', () => {
    const findings = lintLivenessProperties({
      datasources: [{
        name: 'warehouse',
        label: 'Warehouse',
        driver: 'postgres',
        config: { host: 'db.internal', database: 'analytics' },
        pool: { min: 1, max: 10 },
        ssl: { enabled: true, rejectUnauthorized: true },
        active: true,
        autoConnect: true,
        schemaMode: 'external',
        external: { allowWrites: false, allowedSchemas: ['public'] },
      }],
    });
    expect(findings).toEqual([]);
  });

  // ── #4488 — the nine remaining types, governed. Pins run against the REAL
  // ledgers, one per finding class the audit surfaced.

  // The app ledger's most important entries were the area-level gating keys
  // that FAILED OPEN — nothing evaluated them, so a "hidden"/"gated" area
  // showed for everyone, on the surface whose item-level siblings ARE enforced.
  // This test used to assert the WARNING. #4651 removed the keys (route B),
  // so the advisory lint must now say nothing about them: `NavigationAreaSchema`
  // is strict and rejects them at parse with the prescription, which reaches an
  // author harder and earlier than an advisory line, and warning about a key
  // that no longer parses is noise. Same disposition `homePageId` and
  // `areas.order` reached in #4667.
  //
  // Kept as a SILENCE pin rather than deleted: a half-reverted retirement
  // (ledger rows restored without the schema, or vice versa) shows up here.
  it('is silent on the fail-open area gates — retired in 17.0.0 (#4651)', () => {
    const findings = lintLivenessProperties({
      apps: [{
        name: 'crm',
        label: 'CRM',
        areas: [{
          id: 'area_sales',
          label: 'Sales',
          visible: "'sales' in current_user.positions",
          requiredPermissions: ['crm.access'],
          navigation: [],
        }],
      }],
    });
    const msgs = paths(findings);
    expect(msgs.some((m) => m.includes('areas.visible'))).toBe(false);
    expect(msgs.some((m) => m.includes('areas.requiredPermissions'))).toBe(false);
    expect(findings).toEqual([]);
  });

  // Anti-vacuity guard for the pin above. `lintLivenessProperties` resolves the
  // shipped ledgers off `@objectstack/spec/package.json` and returns [] when it
  // cannot find them — so "no findings" is also what a BROKEN lint returns, and
  // the silence pin alone would pass on a lint that had stopped reading ledgers
  // entirely. This asserts it still warns on a property that is still marked
  // `authorWarn` (`object.externalSharingModel`, the last one in tree), in the
  // same call that authors the retired area gates: same process, same ledger
  // load, one warning and not three.
  it('the area-gate silence is a real verdict, not a lint that stopped loading ledgers', () => {
    const findings = lintLivenessProperties({
      objects: [{ name: 'widget', externalSharingModel: 'read' }],
      apps: [{
        name: 'crm',
        label: 'CRM',
        areas: [{
          id: 'area_sales',
          label: 'Sales',
          visible: "'sales' in current_user.positions",
          requiredPermissions: ['crm.access'],
          navigation: [],
        }],
      }],
    });
    expect(paths(findings).some((m) => m.includes('externalSharingModel'))).toBe(true);
    expect(paths(findings).some((m) => m.includes('areas.'))).toBe(false);
  });

  // email_template used to carry a per-artifact warn on `name`: the WHOLE
  // authoring surface was disconnected from sendTemplate (the webhook shape).
  // #4509 built the materializer bridge, so authoring is no longer a no-op and
  // a well-formed template must warn about NOTHING. The type stays in
  // TYPE_COLLECTIONS — a listed type with zero warns is the resolved state
  // (webhook sits there the same way), and keeping it means a future
  // regression that re-deadens a prop starts warning again on its own.
  it('does not warn on a well-formed email_template — the bridge closed it (#4509)', () => {
    const findings = lintLivenessProperties({
      emailTemplates: [{
        name: 'crm.welcome',
        label: 'Welcome',
        subject: 'Hi {{user.name}}',
        bodyHtml: '<p>Welcome</p>',
      }],
    });
    expect(findings).toEqual([]);
  });

  // The advisory lint's job is the keys the PARSE still accepts. #4667 retired
  // the last batch it was warning about — book `translations` (both levels),
  // `job.id`, `translation.validationMessages`, `app.homePageId`,
  // `app.areas[].order` — so those warnings are gone by design: a strict
  // rejection or a `retiredKey` tombstone reaches the author harder and earlier
  // than an advisory line, and warning about a key that no longer parses would
  // be noise. `mapping.extractQuery` left the same way in #4509.
  //
  // This test pins that the lint has genuinely fallen silent on them, so a
  // half-reverted retirement (schema restored, ledger not, or vice versa) shows
  // up here rather than as a mysteriously chatty lint.
  it('is silent on the keys retired in #4509 / #4667 — the schema owns them now', () => {
    const findings = lintLivenessProperties({
      books: [{ name: 'crm_guide', label: 'CRM Guide', groups: [{ key: 'basics', label: 'Basics' }] }],
      jobs: [{
        name: 'nightly_sync',
        schedule: { type: 'cron', expression: '0 0 * * *' },
        handler: 'syncAll',
      }],
      translations: [{ name: 'zh_cn', locale: 'zh-CN', messages: { 'common.save': '保存' } }],
      apps: [{ name: 'crm', label: 'CRM', navigation: [] }],
    });
    expect(findings).toEqual([]);
  });

  // The unwarnable-default rule, and what became of it.
  //
  // mapping `errorPolicy`/`batchSize` and selector `includeAll`/`placement`
  // were the four keys this lint structurally COULD NOT warn about: their
  // schema defaults materialize on every compiled artifact, so presence never
  // implied authorship, and their ledger entries carried `_authorWarnSkipped`
  // rather than `authorWarn`. That is precisely why they were REMOVED in 17.0.0
  // (#4509) instead of being warned about first — the strict schemas reject
  // them now, which is the only channel that ever reached those authors.
  //
  // The surviving assertion is the rule itself, not those four keys: a compiled
  // artifact carrying only materialized defaults must stay silent.
  it('stays silent on schema-default values and live-only artifacts (#4488)', () => {
    const findings = lintLivenessProperties({
      mappings: [{
        name: 'api_sync_orders',
        targetObject: 'order',
        fieldMapping: [{ source: 'Total', target: 'total' }],
        mode: 'upsert',
        upsertKey: ['external_ref'],
        // materialized default — must NOT warn:
        sourceFormat: 'csv',
      }],
      apps: [{
        name: 'sales',
        label: 'Sales',
        contextSelectors: [{
          id: 'active_region',
          label: 'Region',
          optionsSource: { endpoint: '/api/v1/regions', valueKey: 'id', labelKey: 'name' },
          // materialized defaults — must NOT warn:
          allValue: '',
          persist: 'query',
        }],
      }],
      seeds: [],
    });
    expect(findings).toEqual([]);
  });

  // ── #4956: the dashboard widget subtree ────────────────────────────────────
  //
  // These assertions are what make the drill worth doing on the AUTHOR side.
  // Until #4956 the ledger classified `dashboard.widgets` with one blanket
  // `live` and claimed in prose that the per-widget keys were classified in a
  // "DashboardWidgetSchema subtree" that never existed — so no widget key had a
  // verdict, and this lint (which is ledger-driven by design) had nothing to
  // say about any of them. Two things had to change together: the ledger gained
  // 22 child verdicts, and `dashboard` was registered in TYPE_COLLECTIONS.
  // Registering the type is the half that is easy to forget and impossible to
  // notice — the ledger would read correct and warn nobody.
  describe('dashboard widgets (#4956)', () => {
    const dash = (widget: Record<string, unknown>) => ({
      dashboards: [{
        name: 'sales_overview',
        label: 'Sales',
        widgets: [{ id: 'total_pipe', type: 'metric', dataset: 'orders', values: ['total'], ...widget }],
      }],
    });

    // ── #6774: `colorVariant` went LIVE, so this lint must go quiet on it ─────
    //
    // Until 2026-08-09 this block's first assertion was the opposite — that
    // authoring `colorVariant` produced a warning whose hint said "move it under
    // `options`". That advisory was correct on the premise it rested on: no
    // renderer read the top-level key. #5010 ruling B resolved the
    // enforce-or-remove the other way (keep the declaration, objectui
    // implements), and objectui#3359 / PR objectui#3799 landed the reader —
    // absorbed here by the `.objectui-sha` pin `09987b68`. The ledger row is
    // `live` now and carries no `authorWarn`, so the warning is gone and the
    // hint would have been telling authors to relocate a key that works.
    //
    // Kept as a SILENCE pin rather than deleted, the disposition #4651's area
    // gates reached above: a half-reverted flip (the ledger row restored to
    // `dead`, or the pin rolled back under it) shows up right here.
    it('no longer warns on `colorVariant` — the renderer reads it since objectui#3799 (#6774)', () => {
      const findings = lintLivenessProperties(dash({ colorVariant: 'teal' }));
      expect(findings.map((f) => f.message).some((m) => m.includes('widgets.colorVariant'))).toBe(false);
    });

    // ⚠️ What this flip COST, recorded so the next author does not read the
    // absence as an oversight: `widgets.colorVariant` was the only warned entry
    // in any ledger sitting under an array container, so it was the only subject
    // `getNested`'s array fan-out ever had. The assertion that used to live here
    // — "fans out over EVERY widget, not just the first" — cannot be written
    // against a warn-map that is empty for `dashboard`, and no other type offers
    // a dotted warned path today. The fan-out is now untested; filed as #7079
    // rather than replaced with a test that would pass on a lint which never
    // walks past `widgets[0]`.

    // ── #5010: four of these keys are RETIRED, so this lint must go quiet ─────
    //
    // This lint is ledger-driven by design: it warns on rows carrying
    // `authorWarn`. When a key is retired the row keeps its `dead` verdict (the
    // tombstone keeps the key in the walked shape) but drops `authorWarn`,
    // because the advisory has been replaced by something strictly louder — a
    // `tsc` error and a parse error carrying the prescription.
    //
    // Asserting the SILENCE is the point. A retired key that still warned here
    // would tell an author to "move the affordance" for a key they cannot
    // author at all, and would double-report every real occurrence.
    it.each(['actionUrl', 'actionType', 'actionIcon', 'aria'])(
      'no longer warns on the retired `%s` — the strict parse owns it now (#5010)',
      (key) => {
        const value = key === 'aria' ? { ariaLabel: 'Total pipeline' } : 'x';
        const findings = lintLivenessProperties(dash({ [key]: value }));
        expect(findings.map((f) => f.message).some((m) => m.includes(`widgets.${key}`))).toBe(false);
      },
    );

    // Anti-vacuity guard for every dashboard silence pin above — the shape
    // #4651's area gates use, and the reason those pins are worth keeping at
    // all. `lintLivenessProperties` returns [] when it cannot resolve the
    // shipped ledgers, so "no dashboard findings" is also what a lint that had
    // stopped reading ledgers returns; and since #6774 flipped `colorVariant`,
    // `dashboard` is a registered type with an EMPTY warn map, so nothing inside
    // the dashboard walk can tell a working walk from one that was dropped from
    // TYPE_COLLECTIONS. This authors all five once-warned widget keys and a
    // property that IS still `authorWarn` (`object.externalSharingModel`, the
    // last one in tree) in the SAME call: same process, same ledger load, one
    // warning and not six.
    it('the dashboard silence is a real verdict, not a lint that stopped loading ledgers', () => {
      const findings = lintLivenessProperties({
        objects: [{ name: 'widget', externalSharingModel: 'read' }],
        ...dash({
          actionUrl: '/apps/sales/orders',
          actionType: 'url',
          actionIcon: 'plus',
          aria: { ariaLabel: 'Total pipeline' },
          colorVariant: 'teal',
        }),
      });
      const messages = findings.map((f) => f.message);
      expect(messages.some((m) => m.includes('externalSharingModel'))).toBe(true);
      for (const quiet of ['actionUrl', 'actionType', 'actionIcon', 'aria', 'colorVariant']) {
        expect(messages.some((m) => m.includes(`widgets.${quiet}`))).toBe(false);
      }
    });

    it('stays silent on a widget built entirely from live keys', () => {
      const findings = lintLivenessProperties(dash({
        title: 'Total Pipe',
        dimensions: ['region'],
        filter: { stage: 'closed_won' },
        layout: { x: 0, y: 0, w: 3, h: 2 },
        options: { limit: 10, sortBy: 'total' },
        requiresObject: 'order',
        requiresService: 'analytics',
        filterBindings: { dateRange: 'closed_at' },
        suppressWarnings: ['table-count-only'],
      }));
      expect(findings).toEqual([]);
    });
  });
});

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

  it('warns on the dead datasource blocks that remain — healthCheck / retryPolicy (#4487)', () => {
    // `capabilities` left this list in #4583: the block was REMOVED from the
    // schema, so an author who writes it now gets a hard parse rejection with a
    // prescription — a stronger signal than a lint warning, and the reason its
    // ledger rows are gone rather than flipped. healthCheck / retryPolicy are
    // still authorable and still dead (batches B and C of #4583).
    const findings = lintLivenessProperties({
      datasources: [{
        name: 'warehouse',
        driver: 'postgres',
        config: { host: 'db.internal', database: 'analytics' },
        healthCheck: { enabled: true, intervalMs: 30000 },
        retryPolicy: { maxRetries: 5, baseDelayMs: 1000 },
      }],
    });
    const msgs = paths(findings);
    expect(msgs.some((m) => m.includes('healthCheck.enabled'))).toBe(true);
    expect(msgs.some((m) => m.includes('healthCheck.intervalMs'))).toBe(true);
    expect(msgs.some((m) => m.includes('retryPolicy.maxRetries'))).toBe(true);
    expect(msgs.some((m) => m.includes('retryPolicy.baseDelayMs'))).toBe(true);
    // The removed block must no longer be reported by the lint at all.
    expect(msgs.some((m) => m.includes('capabilities'))).toBe(false);
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

  // The app ledger's most important entries: area-level gating keys that FAIL
  // OPEN (nothing evaluates them, so a "hidden"/"gated" area shows for
  // everyone), on the surface whose item-level siblings ARE enforced.
  it('warns on the fail-open area gates and dead homePageId (#4488)', () => {
    const findings = lintLivenessProperties({
      apps: [{
        name: 'crm',
        label: 'CRM',
        homePageId: 'nav_pipeline',
        areas: [{
          id: 'area_sales',
          label: 'Sales',
          order: 2,
          visible: "'sales' in current_user.positions",
          requiredPermissions: ['crm.access'],
          navigation: [],
        }],
      }],
    });
    const msgs = paths(findings);
    expect(msgs.some((m) => m.includes('homePageId'))).toBe(true);
    expect(msgs.some((m) => m.includes('areas.order'))).toBe(true);
    expect(msgs.some((m) => m.includes('areas.visible'))).toBe(true);
    expect(msgs.some((m) => m.includes('areas.requiredPermissions'))).toBe(true);
    // The gating hints must point at the enforced alternative (per-item gates),
    // or the warning just relocates the author's confusion.
    const perms = findings.find((f) => f.message.includes('areas.requiredPermissions'));
    expect(perms!.hint).toMatch(/per item|Per-item/i);
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

  // translation.validationMessages: pointed at by #3778's own migration table,
  // read by nothing — the hint must say what actually renders (rule.message).
  it('warns on translation.validationMessages (#4488)', () => {
    const findings = lintLivenessProperties({
      translations: [{
        name: 'zh_cn',
        locale: 'zh-CN',
        validationMessages: { discount_limit: '折扣不能超过40%' },
      }],
    });
    const hit = findings.find((f) => f.message.includes('validationMessages'));
    expect(hit).toBeDefined();
    expect(hit!.hint).toMatch(/message/);
  });

  // book: both inline translations maps are dead (the doc-level map two files
  // over works, which is what makes these read alive); job.id and
  // mapping.extractQuery are the other flat dead keys.
  it('warns on book/job/mapping dead keys (#4488)', () => {
    const findings = lintLivenessProperties({
      books: [{
        name: 'crm_guide',
        label: 'CRM Guide',
        translations: { 'zh-CN': { label: 'CRM 指南' } },
        groups: [{ key: 'basics', label: 'Basics', translations: { 'zh-CN': { label: '基础' } } }],
      }],
      jobs: [{
        name: 'nightly_sync',
        id: 'job_nightly',
        schedule: { type: 'cron', expression: '0 0 * * *' },
        handler: 'syncAll',
      }],
      mappings: [{
        name: 'csv_import_contacts',
        targetObject: 'contact',
        fieldMapping: [],
        extractQuery: { object: 'contact', fields: ['name'] },
      }],
    });
    const msgs = paths(findings);
    expect(msgs.some((m) => m.includes('`translations`'))).toBe(true);
    expect(msgs.some((m) => m.includes('groups.translations'))).toBe(true);
    expect(msgs.some((m) => m.includes('`id`'))).toBe(true);
    expect(msgs.some((m) => m.includes('extractQuery'))).toBe(true);
  });

  // The unwarnable-default rule, negative direction: errorPolicy/batchSize
  // (mapping) and includeAll/placement (app selectors) materialize from schema
  // defaults on every compiled artifact, so their dead entries carry
  // _authorWarnSkipped instead of authorWarn — a compiled stack that only has
  // defaults must stay silent.
  it('stays silent on schema-default values and live-only artifacts (#4488)', () => {
    const findings = lintLivenessProperties({
      mappings: [{
        name: 'api_sync_orders',
        targetObject: 'order',
        fieldMapping: [{ source: 'Total', target: 'total' }],
        mode: 'upsert',
        upsertKey: ['external_ref'],
        // materialized defaults — must NOT warn:
        sourceFormat: 'csv',
        errorPolicy: 'skip',
        batchSize: 1000,
      }],
      apps: [{
        name: 'sales',
        label: 'Sales',
        contextSelectors: [{
          id: 'active_region',
          label: 'Region',
          optionsSource: { endpoint: '/api/v1/regions', valueKey: 'id', labelKey: 'name' },
          // materialized defaults — must NOT warn:
          includeAll: true,
          allValue: '',
          persist: 'query',
          placement: 'sidebar_header',
        }],
      }],
      seeds: [],
    });
    expect(findings).toEqual([]);
  });
});

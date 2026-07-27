// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { lintLivenessProperties } from './lint-liveness-properties.js';

/**
 * These run against the REAL ledgers shipped by `@objectstack/spec` (the same
 * files the gate enforces), so they double as a contract test: if an
 * `authorWarn` annotation is removed from a still-dead prop (e.g. tool
 * `permissions`, permission `contextVariables`, flow `nodes.outputSchema`),
 * the matching assertion fails.
 */

const objStack = (obj: Record<string, unknown>) => ({ objects: [{ name: 'widget', ...obj }] });
const paths = (findings: { message: string }[]) => findings.map((f) => f.message);

describe('lintLivenessProperties', () => {
  // NOTE: as of #2377 the object- and field-level dead+authorWarn surface is
  // empty (enforce-or-remove complete for those types), so the positive-warn
  // assertions here run against still-dead props of OTHER governed types
  // (flow.nodes.outputSchema, tool.permissions, permission.contextVariables,
  // action.undoable). The object/field WALKER is still exercised by the
  // silent-clean and default-on-suppression cases below.

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

  it('warns on flow.errorHandling.fallbackNodeId (engine uses fault edges)', () => {
    const findings = lintLivenessProperties({
      flows: [{ name: 'f1', errorHandling: { fallbackNodeId: 'n2' } }],
    });
    const f = findings.find((x) => x.message.includes('errorHandling.fallbackNodeId'));
    expect(f).toBeDefined();
    expect(f!.where).toBe("flow 'f1'");
  });

  it('fans out array containers: flow.nodes[].outputSchema warns once per flow', () => {
    const findings = lintLivenessProperties({
      flows: [{
        name: 'f1',
        nodes: [
          { id: 'n1' },
          { id: 'n2', outputSchema: { type: 'object' } },
          { id: 'n3', outputSchema: { type: 'object' } },
        ],
      }],
    });
    const hits = findings.filter((x) => x.message.includes('nodes.outputSchema'));
    expect(hits.length).toBe(1); // one finding per (flow, path), not per node
    expect(hits[0].where).toBe("flow 'f1'");
  });

  it('warns on action.undoable (experimental — declared but not enforced)', () => {
    const findings = lintLivenessProperties({ actions: [{ name: 'a1', undoable: true }] });
    expect(paths(findings).some((m) => m.includes('`undoable`'))).toBe(true);
  });

  it('warns on the security-shaped dead props (tool.permissions / permission.contextVariables)', () => {
    // tenancy.strategy/crossTenantAccess left this list after spec 15.0 (#2763):
    // the schema now REJECTS them (strict tenancy block), so the ledger entries
    // are gone and the live tenancy knobs must not warn.
    const tenancy = lintLivenessProperties(objStack({ tenancy: { enabled: true, tenantField: 'org_id' } }));
    expect(paths(tenancy).some((m) => m.includes('tenancy'))).toBe(false);

    const tool = lintLivenessProperties({ tools: [{ name: 't1', permissions: ['crm.admin'] }] });
    expect(paths(tool).some((m) => m.includes('`permissions`'))).toBe(true);

    const perm = lintLivenessProperties({ permissions: [{ name: 'p1', contextVariables: { region: 'emea' } }] });
    expect(paths(perm).some((m) => m.includes('contextVariables'))).toBe(true);
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

  it('warns on dead list-level responsive config (view ledger, list.responsive)', () => {
    const findings = lintLivenessProperties({
      views: [{ object: 'task', list: { type: 'grid', responsive: { breakpoint: 'md' } } }],
    });
    const f = findings.find((x) => x.message.includes('list.responsive'));
    expect(f).toBeDefined();
    expect(f!.where).toBe("view 'task'"); // container binds via `object`, not `name`
    expect(f!.hint.length).toBeGreaterThan(0);
  });

  it('warns on form.data and form.defaultSort but not on live form config', () => {
    const findings = lintLivenessProperties({
      views: [{
        object: 'task',
        form: {
          type: 'wizard',
          sections: [{ fields: ['title'] }],
          data: { provider: 'object', object: 'task' },
          defaultSort: [{ field: 'created_at' }],
        },
      }],
    });
    const msgs = paths(findings);
    expect(msgs.some((m) => m.includes('form.data'))).toBe(true);
    expect(msgs.some((m) => m.includes('form.defaultSort'))).toBe(true);
    expect(msgs.some((m) => m.includes('form.sections') || m.includes('form.type'))).toBe(false);
  });

  it('stays silent on a clean grid view', () => {
    const findings = lintLivenessProperties({
      views: [{ object: 'task', list: { type: 'grid', columns: ['title'] } }],
    });
    expect(findings).toEqual([]);
  });

  // ── webhook (#3461 bridge landed → #3490) ─────────────────────────────────
  // The WebhookSchema authoring surface is now materialized into dispatchable
  // sys_webhook rows on boot (#3489), so most props are live. The author warning
  // moved OFF the now-live `url` carrier onto the props that are STILL dead and
  // misleading — retryPolicy/body/payloadFields/includeSession (folded into
  // definition_json but never read) — plus experimental `authentication`. These
  // run against the REAL webhook.json ledger.

  it('does not warn on a webhook that only authors now-live props (#3490)', () => {
    const findings = lintLivenessProperties({
      webhooks: [{ name: 'w1', object: 'task', triggers: ['create'], url: 'https://hooks.example/x', method: 'POST', isActive: true }],
    });
    expect(findings).toEqual([]);
  });

  it('emits exactly one warning for the showcase webhook — its still-dead retryPolicy', () => {
    // object/triggers/url/method/isActive/description are live now; only
    // retryPolicy is still dead + misleading (the messaging dispatcher owns a
    // fixed retry schedule), so the showcase-shaped webhook yields ONE finding,
    // not one-per-prop.
    const findings = lintLivenessProperties({
      webhooks: [{
        name: 'showcase_task_changed',
        object: 'showcase_task',
        triggers: ['create', 'update', 'delete'],
        url: 'https://hooks.example/showcase/task',
        method: 'POST',
        retryPolicy: { maxRetries: 3, backoffStrategy: 'exponential' },
        isActive: true,
        description: 'Sends task lifecycle events to an external system.',
      }],
    });
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('`retryPolicy`');
    expect(findings[0].where).toBe("webhook 'showcase_task_changed'");
  });

  it('also warns on authentication (experimental — HMAC-secret-only)', () => {
    const findings = lintLivenessProperties({
      webhooks: [{ name: 'w1', url: 'https://hooks.example/x', authentication: { type: 'bearer' } }],
    });
    expect(paths(findings).some((m) => m.includes('`authentication`'))).toBe(true);
  });

  it('does NOT warn on isActive (live now — remapped to sys_webhook.active by the bridge)', () => {
    const findings = lintLivenessProperties({
      webhooks: [{ name: 'w1', url: 'https://hooks.example/x', isActive: true }],
    });
    expect(paths(findings).some((m) => m.includes('`isActive`'))).toBe(false);
  });
});

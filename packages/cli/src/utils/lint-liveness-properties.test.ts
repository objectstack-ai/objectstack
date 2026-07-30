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
});

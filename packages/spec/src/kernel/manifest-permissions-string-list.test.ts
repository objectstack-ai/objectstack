// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flat string-list arm of a package manifest's `permissions` is RETIRED
 * (ADR-0049 enforce-or-remove; ADR-0087 conversion
 * `manifest-permissions-string-list-removed`, D3 entry
 * `manifest-permissions-string-list-retired`).
 *
 * `ManifestPermissionsSchema` was `z.union([z.array(z.string()), block])`. No
 * loader ever read the list — what a package is granted at load is the
 * consented `grantedPermissions` set, never the manifest's request — so the
 * structured ADR-0025 §3.2 block is now the only form.
 *
 * What this file holds, in the order an upgrading author meets it:
 *
 *   1. the PARSE refuses a list, with the block's own prescription rather
 *      than zod's bare type error, on both carriers of the one declaration;
 *   2. TypeScript refuses it at the authoring site;
 *   3. the structured block's accept set did not move (H3 of the dispatch:
 *      the retirement removed the other arm, nothing else);
 *   4. the D2 conversion strips a list from the stack's manifest and every
 *      `packages[].manifest`, leaves everything else alone, is idempotent, and
 *      is NOT replayed on the authoring funnel.
 *
 * ⛔ No tree-scoped absence pin rides with this retirement: the KEY survives,
 * only a value form leaves, and the same key is the legal ADR-0090
 * permission-set collection one stage along — `permissions: [` is correct at a
 * stack's top level — so no text pattern can tell a retired authoring-stage
 * list from a live collection. The parse and `tsc` channels are the sweep.
 */

import { describe, expect, it } from 'vitest';

import { applyConversions } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import type { ConversionNotice } from '../conversions/types';
import { normalizeStackInput } from '../shared/metadata-collection.zod';
import { formatZodError } from '../shared/error-map.zod';
import {
  ManifestPermissionsSchema,
  ManifestSchema,
  PluginPermissionsSchema,
  type ManifestPermissions,
  type ObjectStackManifest,
} from './manifest.zod';

const legal = () => ({
  id: 'com.example.probe',
  namespace: 'probe',
  version: '1.0.0',
  type: 'plugin' as const,
  name: 'Probe',
  engines: { protocol: '^17' },
});

/**
 * The prescription, as the parts an upgrading author needs: what the slot
 * takes, that the list was removed and in which release, and the house
 * two-clause `os migrate meta` sentence naming the case the conversion covers.
 */
const PRESCRIPTION =
  /^Expected the plugin permission block `\{ services\?, hooks\?, network\?, fs\? \}`, received a flat list\..*removed in @objectstack\/spec 17 \(ADR-0049 enforce-or-remove\).*translate each one by hand, or delete `permissions` when the plugin needs none\. Run `os migrate meta --from 17` to list the mechanical edits for the package manifest case; a granted-permission record is not a source it reads\.$/s;

const permissionsIssue = (input: unknown) => {
  const result = ManifestSchema.safeParse(input);
  expect(result.success, 'the manifest must be refused').toBe(false);
  if (result.success) throw new Error('unreachable');
  const issue = result.error.issues.find((i) => i.path.length === 1 && i.path[0] === 'permissions');
  expect(issue, 'the refusal answers at `permissions`').toBeDefined();
  return { issue: issue!, error: result.error };
};

describe('manifest.permissions — the flat string list is refused at parse, with its prescription', () => {
  it('a list of permission strings is refused at `permissions` with the block\'s own answer', () => {
    const { issue } = permissionsIssue({ ...legal(), permissions: ['system.user.read', 'system.data.write'] });
    expect(issue.code).toBe('invalid_type');
    expect(issue.message).toMatch(PRESCRIPTION);
  });

  it('the EMPTY list is refused too — it was the retired arm\'s shape, and absence is the spelling for "nothing"', () => {
    const { issue } = permissionsIssue({ ...legal(), permissions: [] });
    expect(issue.code).toBe('invalid_type');
    expect(issue.message).toMatch(PRESCRIPTION);
  });

  it('an array of permission-set objects is refused with the same answer — that collection is one stage along, never on the manifest', () => {
    const { issue } = permissionsIssue({ ...legal(), permissions: [{ name: 'support_agent', isDefault: true }] });
    expect(issue.code).toBe('invalid_type');
    expect(issue.message).toMatch(PRESCRIPTION);
  });

  it('the author reads the prescription through `formatZodError`, not a bare type error', () => {
    const { error } = permissionsIssue({ ...legal(), permissions: ['system.user.read'] });
    const rendered = formatZodError(error);
    expect(rendered).toContain('permissions: Expected the plugin permission block');
    expect(rendered).not.toContain('expected object, received array');
  });

  it('a non-list wrong type keeps zod\'s own message — "was removed" would misinform its author', () => {
    const { issue } = permissionsIssue({ ...legal(), permissions: 'system.user.read' });
    expect(issue.code).toBe('invalid_type');
    expect(issue.message).not.toMatch(/removed in @objectstack\/spec/);
  });

  it('the second carrier of the one declaration — a `grantedPermissions` value — gets the same answer', () => {
    // `EnvironmentArtifactSchema.grantedPermissions` is a record whose values
    // ARE this block (`system/environment-artifact.test.ts` pins the identity),
    // so the list answer is worded true on both: the clause naming the
    // conversion says which case it covers.
    const value = PluginPermissionsSchema.safeParse(['system.user.read']);
    expect(value.success).toBe(false);
    if (value.success) return;
    expect(value.error.issues[0]!.message).toMatch(PRESCRIPTION);
  });

  it('`ManifestPermissionsSchema` IS the structured block — one declaration, by identity', () => {
    expect(ManifestPermissionsSchema).toBe(PluginPermissionsSchema);
  });

  it('TypeScript refuses a list at the authoring site', () => {
    // @ts-expect-error — the retired arm: a list is not the block.
    const list: ManifestPermissions = ['system.user.read'];
    const manifest: ObjectStackManifest = {
      ...legal(),
      // @ts-expect-error — the same refusal on the manifest itself.
      permissions: ['system.user.read'],
    };
    expect(Array.isArray(list) && Array.isArray(manifest.permissions)).toBe(true);
  });
});

describe('manifest.permissions — the structured block\'s accept set did not move', () => {
  it('accepts every declared key alone, the full block, and the empty block', () => {
    for (const key of ['services', 'hooks', 'network', 'fs']) {
      expect(ManifestSchema.safeParse({ ...legal(), permissions: { [key]: ['x'] } }).success, key).toBe(true);
    }
    expect(ManifestSchema.safeParse({
      ...legal(),
      permissions: { services: ['object', 'http'], hooks: ['record.beforeInsert'], network: ['api.acme.com'], fs: [] },
    }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...legal(), permissions: {} }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...legal() }).success, 'absent is still legal').toBe(true);
  });

  it('refuses what it always refused — an unknown key, and a non-string list member', () => {
    expect(ManifestSchema.safeParse({ ...legal(), permissions: { hoooks: ['x'] } }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...legal(), permissions: { services: [1] } }).success).toBe(false);
  });
});

describe('ADR-0087 D2 `manifest-permissions-string-list-removed`', () => {
  const entry = ALL_CONVERSIONS.find((c) => c.id === 'manifest-permissions-string-list-removed');

  const replay = (stack: Record<string, unknown>) => {
    const notices: ConversionNotice[] = [];
    const out = applyConversions(stack, { includeRetired: true, onNotice: (n) => notices.push(n) });
    return { out, notices: notices.filter((n) => n.conversionId === 'manifest-permissions-string-list-removed') };
  };

  it('is registered at protocol 18 and retired from the authoring load path', () => {
    expect(entry, 'premise: the entry exists').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
  });

  it('strips a list from the stack\'s manifest and names the dropped strings in the notice', () => {
    const { out, notices } = replay({ manifest: { id: 'com.acme.x', permissions: ['system.user.read'] } });
    expect(out.manifest).toEqual({ id: 'com.acme.x' });
    expect(notices).toHaveLength(1);
    expect(notices[0]!.path).toBe('manifest.permissions');
    expect(notices[0]!.from).toBe('permissions: ["system.user.read"]');
    expect(notices[0]!.to).toBe('(removed)');
  });

  it('strips an EMPTY list — the retired arm accepted it, and the block would refuse it', () => {
    const { out, notices } = replay({ manifest: { id: 'com.acme.x', permissions: [] } });
    expect(out.manifest).toEqual({ id: 'com.acme.x' });
    expect(notices).toHaveLength(1);
  });

  it('strips a list from each `packages[].manifest`, and only there', () => {
    const { out, notices } = replay({
      packages: [
        { manifest: { id: 'com.acme.a', permissions: ['x.y'] } },
        { manifest: { id: 'com.acme.b' } },
      ],
    });
    expect(out.packages).toEqual([{ manifest: { id: 'com.acme.a' } }, { manifest: { id: 'com.acme.b' } }]);
    expect(notices.map((n) => n.path)).toEqual(['packages[0].manifest.permissions']);
  });

  it('never touches the structured block, an array of objects, or the top-level permission-set collection', () => {
    const stack = {
      manifest: { id: 'com.acme.x', permissions: { services: ['object'] } },
      packages: [{ manifest: { id: 'com.acme.y', permissions: [{ name: 'set_written_one_stage_early' }] } }],
      // The ADR-0090 collection — the SAME key, one stage along. Never this entry's surface.
      permissions: [{ name: 'support_agent', label: 'Support Agent' }],
    };
    const { out, notices } = replay(structuredClone(stack));
    expect(out).toEqual(stack);
    expect(notices).toEqual([]);
  });

  it('is idempotent — the converted stack replays to itself with nothing applied', () => {
    const once = replay({ manifest: { id: 'com.acme.x', permissions: ['system.user.read'] } }).out;
    const twice = replay(once);
    expect(twice.out).toBe(once);
    expect(twice.notices).toEqual([]);
  });

  it('⛔ is NOT replayed on the authoring funnel — an author meets the refusal, never a silent rewrite', () => {
    const notices: ConversionNotice[] = [];
    const authored = { manifest: { ...legal(), permissions: ['system.user.read'] } };
    const out = normalizeStackInput(structuredClone(authored), { onConversionNotice: (n) => notices.push(n) });
    expect((out.manifest as { permissions?: unknown }).permissions).toEqual(['system.user.read']);
    expect(notices.filter((n) => n.conversionId === 'manifest-permissions-string-list-removed')).toEqual([]);
  });
});

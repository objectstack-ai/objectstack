// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The cloud orchestrator's slug action reaches the organization record page
 * from the composition that serves its route — measured on a booted
 * multi-organization showcase, on the wire.
 *
 * ## Why the platform object no longer declares it
 *
 * `change_slug` targets `/api/v1/cloud/organizations/{id}/change-slug`, a
 * route only the cloud orchestrator serves. Declared on `sys_organization`, it
 * was offered on every multi-organization composition, and outside cloud the
 * click answered `404 ENDPOINT_NOT_FOUND`. The composition that mounts the
 * route declares the action itself, as a top-level action bound by
 * `objectName: 'sys_organization'`; the registry attaches such an action to
 * the served object, whichever package registers first.
 *
 * ## What this pins
 *
 * A package shaped like cloud's — its own manifest, one top-level action with
 * the declaration the platform object carried — is mounted beside the
 * showcase. Then:
 *  - `GET /meta/object/sys_organization` serves `change_slug` once, with the
 *    orchestrator's target, method, `record_header` location and one `slug`
 *    param, and the `multiOrgEnabled` gate lowered exactly as the platform's
 *    own `requiresFeature` actions are;
 *  - the gate admits it with multi-org on and hides it with multi-org off,
 *    under `@objectstack/formula`'s `celEngine`, the console's engine;
 *  - in the header's stable `order` sort it follows the rename and precedes
 *    leave, so it sits in the `⋯` overflow, where the platform copy sat;
 *  - the boot names no collision for it: the platform object declares no
 *    `change_slug` of its own.
 *
 * The open-source half — the record page offers no action whose door this
 * composition does not mount — is `org-record-admin-reach.dogfood.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { defineStack } from '@objectstack/spec';
import { featureGatePredicate } from '@objectstack/spec/kernel';
import { celEngine } from '@objectstack/formula';
import { bootShowcase } from './showcase-boot.js';

const TARGET = '/api/v1/cloud/organizations/{id}/change-slug';
const BINDER = 'com.fixture.cloud-orchestrator-shaped';

/** The declaration cloud's composition carries: the platform object's former copy, bound by `objectName`. */
const cloudShaped = defineStack({
  manifest: { id: BINDER, name: 'cloud_orchestrator_shaped', version: '0.0.1', type: 'app' },
  actions: [
    {
      name: 'change_slug',
      objectName: 'sys_organization',
      label: 'Change Slug',
      icon: 'edit-3',
      variant: 'secondary',
      mode: 'custom',
      locations: ['record_header'],
      type: 'api',
      target: TARGET,
      method: 'POST',
      requiresFeature: 'multiOrgEnabled',
      description: 'Renaming the slug rewrites every platform subdomain for this org and parks the old slug for 90 days. Continue?',
      successMessage: 'Organization slug changed',
      refreshAfter: true,
      params: [{ field: 'slug', required: true, defaultFromRow: true }],
    },
  ],
} as never);

type ServedAction = {
  name: string;
  type?: string;
  target?: string;
  method?: string;
  order?: number;
  locations?: string[];
  visible?: { dialect?: string; source?: string };
  params?: Array<Record<string, unknown>>;
};

describe('a cloud-shaped composition binds change_slug to sys_organization, and it is served gated', () => {
  let stack: VerifyStack;
  let actions: ServedAction[] = [];
  let features: Record<string, unknown> = {};
  const bootLines: string[] = [];

  beforeAll(async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      bootLines.push(...String(chunk).replace(/\u001b\[[0-9;]*m/g, '').split('\n'));
      return true;
    }) as never);
    try {
      stack = await bootShowcase({ multiTenant: 'posture-only', extraPlugins: [new AppPlugin(cloudShaped as never)] });
    } finally {
      spy.mockRestore();
    }
    const token = await stack.signUp('org-change-slug.binder@verify.test', 'ChangeSlug!Pass123', 'Change slug binder');
    const config = await stack.apiAs(token, 'GET', '/auth/config');
    expect(config.status).toBe(200);
    features = ((await config.json()) as { data: { features: Record<string, unknown> } }).data.features;
    const meta = await stack.apiAs(token, 'GET', '/meta/object/sys_organization');
    expect(meta.status).toBe(200);
    actions = ((await meta.json()) as { item?: { actions?: ServedAction[] } }).item?.actions ?? [];
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('serves change_slug once, with the orchestrator target, its location and its one slug param', () => {
    const served = actions.filter((a) => a.name === 'change_slug');
    expect(served).toHaveLength(1);
    expect(served[0]).toMatchObject({ type: 'api', target: TARGET, method: 'POST', locations: ['record_header'] });
    expect(served[0].params).toEqual([{ field: 'slug', required: true, defaultFromRow: true }]);
  });

  it('carries the multiOrgEnabled gate, lowered as the platform lowers its own', () => {
    const changeSlug = actions.find((a) => a.name === 'change_slug');
    const leave = actions.find((a) => a.name === 'leave_organization');
    expect(changeSlug?.visible).toEqual({ dialect: 'cel', source: featureGatePredicate('multiOrgEnabled') });
    // The platform's own multi-org action, gated by nothing else, serves the same predicate.
    expect(changeSlug?.visible).toEqual(leave?.visible);
  });

  it('the gate admits it with multi-org on and hides it with multi-org off', () => {
    expect(features.multiOrgEnabled).toBe(true);
    const visible = actions.find((a) => a.name === 'change_slug')?.visible;
    const evaluate = (multiOrgEnabled: boolean) => {
      const result = celEngine.evaluate(visible as never, { record: {}, extra: { features: { ...features, multiOrgEnabled } } });
      if (!result.ok) throw new Error(`change_slug's gate faulted: ${JSON.stringify(result)}`);
      return result.value;
    };
    expect(evaluate(true)).toBe(true);
    expect(evaluate(false)).toBe(false);
  });

  it('sorts after the rename and before leave in the record header, so it sits in the overflow', () => {
    const header = actions
      .filter((a) => (a.locations ?? []).includes('record_header'))
      .map((a, i) => ({ a, i }))
      .sort((x, y) => (x.a.order ?? 0) - (y.a.order ?? 0) || x.i - y.i)
      .map(({ a }) => a.name);
    expect(header).toEqual(['invite_user', 'set_active_organization', 'rename_organization', 'change_slug', 'leave_organization']);
  });

  it('the boot names no collision for it: the platform object declares no change_slug of its own', () => {
    // Positive control: the capture saw the boot's own kernel log (the ObjectQL
    // plugin's lines), so an empty match below is a reading, not a dead spy.
    expect(bootLines.some((line) => line.includes('[ObjectQLPlugin]'))).toBe(true);
    expect(bootLines.filter((line) => line.includes("'change_slug'") && / (WARN|ERROR) /.test(line))).toEqual([]);
  });
});

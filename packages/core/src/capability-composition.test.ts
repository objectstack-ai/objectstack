// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 — the rule both `os serve` and `@objectstack/verify`'s `bootStack`
 * read for which capability tokens a served boot mounts providers for, and
 * what it constructs each provider with. One case per step of each rule, each
 * against the answer the step changes, so a step that stops running turns a
 * case red rather than leaving every case green.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { composeStacks, defineStack } from '@objectstack/spec';
import { PLATFORM_ALWAYS_ON_CAPABILITIES } from '@objectstack/spec/kernel';
import { resolveCapabilityArgument, resolveServedCapabilities } from './capability-composition.js';
import { stackDeclaredCapabilities } from './stack-collections.js';

const SLATE = [...PLATFORM_ALWAYS_ON_CAPABILITIES];

const svcManifest = { id: 'com.example.ccp.svc', name: 'CCP Service', namespace: 'ccp', version: '1.0.0', type: 'module' };
const appManifest = { id: 'com.example.ccp.app', name: 'CCP App', namespace: 'ccp', version: '1.0.0', type: 'app' };
const note = {
  name: 'ccp_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'public_read_write',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
};
const ticket = {
  name: 'ccp_ticket', label: 'Ticket', pluralLabel: 'Tickets', sharingModel: 'public_read_write',
  fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } },
};

/** Two packages through the real producer: `svcExtra` lives only in the service package's body. */
const twoPackages = (svcExtra: Record<string, unknown>): Record<string, unknown> =>
  composeStacks(
    [
      defineStack({ manifest: svcManifest, objects: [note], ...svcExtra } as never),
      defineStack({ manifest: appManifest, objects: [ticket] } as never),
    ],
    { manifest: 'preserve' },
  ) as unknown as Record<string, unknown>;

describe('resolveServedCapabilities — which tokens a served boot mounts', () => {
  it('an app that declares nothing gets the always-on slate, in the slate\'s order', () => {
    const served = resolveServedCapabilities([]);
    // Anti-vacuity: the slate is the spec's, and it is not empty.
    expect(SLATE.length).toBeGreaterThan(0);
    expect(served.tokens).toEqual(SLATE);
    expect([...served.declared]).toEqual([]);
  });

  it('the declared tokens come first, deduplicated, and a slate member declared is not repeated', () => {
    const served = resolveServedCapabilities(['automation', 'cache', 'automation']);
    expect(served.tokens.slice(0, 2)).toEqual(['automation', 'cache']);
    expect(served.tokens.filter((token) => token === 'cache')).toEqual(['cache']);
    expect(served.tokens.slice(2)).toEqual(SLATE.filter((token) => token !== 'cache'));
    expect([...served.declared]).toEqual(['automation', 'cache']);
  });

  it('`--preset minimal` mounts no slate — only what the stack declares', () => {
    expect(resolveServedCapabilities(['automation'], { preset: 'minimal' }).tokens).toEqual(['automation']);
    // Control: any other preset name keeps the slate.
    expect(resolveServedCapabilities(['automation'], { preset: 'default' }).tokens).toEqual([
      'automation',
      ...SLATE,
    ]);
  });

  it('a declared `auth` brings `email`, and `job` / `queue` move ahead of what schedules background work', () => {
    const served = resolveServedCapabilities(['auth'], { preset: 'minimal' });
    expect(served.tokens).toEqual(['job', 'queue', 'auth', 'email']);
    // `email` was appended by the platform, not declared by the stack.
    expect([...served.declared]).toEqual(['auth']);
    // Control: nothing that schedules background work, nothing moved.
    expect(resolveServedCapabilities(['automation'], { preset: 'minimal' }).tokens).toEqual(['automation']);
  });

  it('the host defaults land after the declared tokens and before the slate', () => {
    const served = resolveServedCapabilities(['automation'], { hostDefaults: ['mcp', 'pinyin-search'] });
    expect(served.tokens).toEqual(['automation', 'mcp', 'pinyin-search', ...SLATE]);
    expect(served.declared.has('mcp')).toBe(false);
  });

  it('a package body\'s `requires`, as `stackDeclaredCapabilities` reads it for the boots, is what the rule mounts', () => {
    const stack = twoPackages({ requires: ['approvals'] });
    // Anti-vacuity: the producer really left `requires` out of the top level.
    expect(stack.requires).toBeUndefined();
    const served = resolveServedCapabilities(stackDeclaredCapabilities(stack), { preset: 'minimal' });
    expect(served.tokens).toEqual(['job', 'queue', 'approvals']);
    expect([...served.declared]).toEqual(['approvals']);
  });
});

describe('resolveCapabilityArgument — what each provider is constructed with', () => {
  it('`automation` is handed the app\'s root', () => {
    expect(resolveCapabilityArgument('automation', { stack: {}, packageRoot: '/srv/app' }).argument).toEqual({
      packageRoot: '/srv/app',
    });
  });

  it('`analytics` is handed the stack\'s cubes: the top level first, then `cubes`, then the package bodies', () => {
    const top = [{ name: 'top_cube' }];
    const legacy = [{ name: 'legacy_cube' }];
    const arg = (stack: unknown) => resolveCapabilityArgument('analytics', { stack, packageRoot: '/app' }).argument;
    expect(arg({ analyticsCubes: top, cubes: legacy })).toEqual({ cubes: top });
    expect(arg({ cubes: legacy })).toEqual({ cubes: legacy });
    const bodyCube = {
      name: 'ccp_note_cube', title: 'Notes', sql: 'ccp_note',
      measures: { count: { label: 'Count', type: 'count', sql: '*' } },
      dimensions: { name: { label: 'Name', type: 'string', sql: 'name' } },
    };
    const stack = twoPackages({ analyticsCubes: [bodyCube] });
    expect(stack.analyticsCubes).toBeUndefined();
    expect((arg(stack) as { cubes: Array<{ name: string }> }).cubes.map((cube) => cube.name)).toEqual(['ccp_note_cube']);
    // Control: a stack with no cubes hands an empty list, never someone else's.
    expect(arg({})).toEqual({ cubes: [] });
  });

  it('`email` and `sms` are built by the reader their provider module exports, from the stack and the env', () => {
    const calls: unknown[][] = [];
    const providerModule = {
      resolveEmailCapabilityArg: (...args: unknown[]) => {
        calls.push(['email', ...args]);
        return { options: { built: 'email' } };
      },
      resolveSmsCapabilityArg: (...args: unknown[]) => {
        calls.push(['sms', ...args]);
        return { options: { built: 'sms' } };
      },
    };
    const env = { OS_EMAIL_PROVIDER: 'log' };
    const stack = { email: { persist: false }, sms: { provider: 'log' }, appName: 'Acme' };
    expect(resolveCapabilityArgument('email', { stack, packageRoot: '/app', providerModule, env }).argument).toEqual({
      built: 'email',
    });
    expect(resolveCapabilityArgument('sms', { stack, packageRoot: '/app', providerModule, env }).argument).toEqual({
      built: 'sms',
    });
    expect(calls).toEqual([
      ['email', { persist: false }, env, 'Acme'],
      ['sms', { provider: 'log' }, env],
    ]);
    // An absent block is read as `{}`, never skipped.
    calls.length = 0;
    resolveCapabilityArgument('email', { stack: {}, packageRoot: '/app', providerModule, env });
    expect(calls).toEqual([['email', {}, env, undefined]]);
  });

  it('a provider module without its reader is refused by name, never built with defaults', () => {
    expect(() => resolveCapabilityArgument('email', { stack: {}, packageRoot: '/app', providerModule: {} })).toThrow(
      /does not export resolveEmailCapabilityArg/,
    );
    expect(() => resolveCapabilityArgument('sms', { stack: {}, packageRoot: '/app' })).toThrow(
      /does not export resolveSmsCapabilityArg/,
    );
  });

  describe('`storage` is handed its local root', () => {
    const saved = { canonical: process.env.OS_STORAGE_LOCAL_ROOT, legacy: process.env.OS_STORAGE_ROOT };
    afterEach(() => {
      for (const [name, value] of [['OS_STORAGE_LOCAL_ROOT', saved.canonical], ['OS_STORAGE_ROOT', saved.legacy]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it('the built-in root when the environment names none, and the environment\'s when it does', () => {
      delete process.env.OS_STORAGE_LOCAL_ROOT;
      delete process.env.OS_STORAGE_ROOT;
      expect(resolveCapabilityArgument('storage', { stack: {}, packageRoot: '/app' })).toEqual({
        argument: { adapter: 'local', local: { rootDir: '.objectstack/data/uploads' } },
        localStorageRoot: '.objectstack/data/uploads',
      });
      process.env.OS_STORAGE_LOCAL_ROOT = '/srv/uploads';
      expect(resolveCapabilityArgument('storage', { stack: {}, packageRoot: '/app' }).argument).toEqual({
        adapter: 'local',
        local: { rootDir: '/srv/uploads' },
      });
    });
  });

  it('any other token is constructed with no argument', () => {
    for (const token of ['cache', 'queue', 'job', 'messaging', 'approvals', 'not-a-token']) {
      expect(resolveCapabilityArgument(token, { stack: { analyticsCubes: [] }, packageRoot: '/app' }), token).toEqual({
        argument: undefined,
      });
    }
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevPlugin } from './dev-plugin';

/**
 * `DevPlugin` constructs `AuthPlugin` itself, so it is one of the two
 * composition roots (with `os serve`) that decide whether `plugin-auth`'s
 * `sys_organization` default record page registers. One default record page
 * per object per deployment (ruling A on objectstack#23015, record
 * 6134056653): when the stack this plugin serves declares its own default
 * record page for `sys_organization`, the root passes
 * `registerOrganizationRecordPage: false`; otherwise `true`, today's page.
 * What `false` then does inside `plugin-auth` (the host's page is the single
 * default, in either plugin order) is pinned on a real kernel there:
 * `organization-record-page-option.test.ts`.
 *
 * `@objectstack/plugin-auth` is replaced by a class that records the options it
 * is constructed with. Every other optional dependency is genuinely absent, as
 * in `dev-plugin.test.ts` (#3060), so the boot reaches the auth step and the
 * record is the only thing read.
 */

const constructed: Array<Record<string, unknown>> = [];

vi.mock('@objectstack/plugin-auth', () => ({
  AuthPlugin: class {
    name = 'com.objectstack.auth';
    constructor(options: Record<string, unknown>) {
      constructed.push(options);
    }
    async init() {}
    async start() {}
  },
}));
vi.mock('@objectstack/objectql', () => { throw Object.assign(new Error("Cannot find package '@objectstack/objectql'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/runtime', () => { throw Object.assign(new Error("Cannot find package '@objectstack/runtime'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/service-i18n', () => { throw Object.assign(new Error("Cannot find package '@objectstack/service-i18n'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/service-storage', () => { throw Object.assign(new Error("Cannot find package '@objectstack/service-storage'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/service-realtime', () => { throw Object.assign(new Error("Cannot find package '@objectstack/service-realtime'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/plugin-security', () => { throw Object.assign(new Error("Cannot find package '@objectstack/plugin-security'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/plugin-hono-server', () => { throw Object.assign(new Error("Cannot find package '@objectstack/plugin-hono-server'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/rest', () => { throw Object.assign(new Error("Cannot find package '@objectstack/rest'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/setup', () => { throw Object.assign(new Error("Cannot find package '@objectstack/setup'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/account', () => { throw Object.assign(new Error("Cannot find package '@objectstack/account'"), { code: 'ERR_MODULE_NOT_FOUND' }); });

function mockCtx(): any {
  const services = new Map<string, unknown>();
  return {
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getService: vi.fn().mockImplementation((name: string) => {
      if (services.has(name)) return services.get(name);
      throw new Error('not found');
    }),
    getServices: vi.fn().mockReturnValue(new Map()),
    registerService: vi.fn().mockImplementation((name: string, svc: unknown) => services.set(name, svc)),
    hook: vi.fn(),
    trigger: vi.fn(),
    getKernel: vi.fn(),
  };
}

const manifest = { id: 'com.example.tenant', name: 'tenant', version: '1.0.0', type: 'app' };
const organizationPage = (isDefault: boolean) => ({
  name: 'tenant_organization_detail',
  label: 'Organization',
  type: 'record',
  object: 'sys_organization',
  isDefault,
  regions: [],
});

/** The options `DevPlugin` constructed `AuthPlugin` with, for one stack. */
async function authOptionsFor(stack: Record<string, unknown> | undefined) {
  constructed.length = 0;
  await new DevPlugin({ seedAdminUser: false, ...(stack ? { stack } : {}) }).init(mockCtx());
  expect(constructed, 'DevPlugin constructs AuthPlugin exactly once').toHaveLength(1);
  return constructed[0];
}

describe('DevPlugin leaves out plugin-auth\'s organization page exactly when the stack declares its own', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('the stack declares its own sys_organization default record page: registerOrganizationRecordPage is false', async () => {
    const options = await authOptionsFor({ manifest, pages: [organizationPage(true)] });
    expect(options.registerOrganizationRecordPage).toBe(false);
  });

  it('control: the same page with isDefault: false keeps plugin-auth\'s page', async () => {
    const options = await authOptionsFor({ manifest, pages: [organizationPage(false)] });
    expect(options.registerOrganizationRecordPage).toBe(true);
  });

  it('control: a stack with no pages, and no stack at all, keep plugin-auth\'s page', async () => {
    expect((await authOptionsFor({ manifest })).registerOrganizationRecordPage).toBe(true);
    expect((await authOptionsFor(undefined)).registerOrganizationRecordPage).toBe(true);
  });
});

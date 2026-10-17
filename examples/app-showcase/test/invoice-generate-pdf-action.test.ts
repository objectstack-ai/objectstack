// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrintServicePlugin } from '@objectstack/service-print';

import stack from '../objectstack.config.js';
import { GenerateInvoicePdfAction } from '../src/ui/actions/index.js';
import { Invoice } from '../src/data/objects/invoice.object.js';

/**
 * The invoice's Generate PDF action reaches a door the showcase composes.
 *
 * The action is a `type: 'api'` action: the console POSTs its body to its
 * `target`. That only works if something mounts the target, and the showcase
 * mounts it by composing `PrintServicePlugin`. These pins hold the three
 * together: the composition, the path the plugin mounts, and the body the
 * console builds from the declaration (the clicked record's id under
 * `recordIdParam`, then `bodyExtra`).
 *
 * The last pin sends that body to the mounted door, signed in, on a
 * composition with no print engine configured (the showcase's default): the
 * print is refused `SERVICE_UNAVAILABLE` / `503`, which the console shows as
 * the action's error. The action reports the missing engine; it does not
 * fail silently, and the body is accepted as the door's request (a field
 * outside its set would be a `400`).
 */

const PRINT_ENV = ['OS_PRINT_CHROMIUM_PATH', 'OS_PRINT_BROWSER_ENDPOINT', 'OS_PRINT_CONSOLE_URL'];
const PRINT_PLUGIN = 'com.objectstack.service.print';

type Handler = (req: unknown, res: unknown) => Promise<void>;

const composed = ((stack.plugins ?? []) as Array<{ name?: unknown }>).filter((p) => p?.name === PRINT_PLUGIN);
const pages = (stack.pages ?? []) as Array<Record<string, unknown>>;

describe('showcase — the invoice Generate PDF action and the print door', () => {
  const saved: Record<string, string | undefined> = {};
  const mounted = new Map<string, Handler>();

  beforeAll(async () => {
    for (const k of PRINT_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    const services = new Map<string, unknown>();
    const hooks: Array<() => Promise<void>> = [];
    const http = {
      get: () => undefined,
      put: () => undefined,
      patch: () => undefined,
      delete: () => undefined,
      use: () => undefined,
      post: (path: string, handler: Handler) => mounted.set(`POST ${path}`, handler),
    };
    services.set('http-server', http);
    // A signed-in user: the auth service's session read, by bearer.
    services.set('auth', {
      api: {
        getSession: async ({ headers }: { headers: Headers }) =>
          headers.get('authorization') === 'Bearer member'
            ? { user: { id: 'usr_member', email: 'member@example.test' }, session: { id: 'ses_1', userId: 'usr_member' } }
            : null,
      },
    });
    services.set('objectql', { find: async () => [] });
    const silent = () => undefined;
    const ctx = {
      logger: { info: silent, warn: silent, error: silent, debug: silent },
      registerService: (name: string, service: unknown) => services.set(name, service),
      getService: (name: string) => {
        if (!services.has(name)) throw new Error(`service ${name} not found`);
        return services.get(name);
      },
      hook: (event: string, fn: () => Promise<void>) => {
        if (event === 'kernel:ready') hooks.push(fn);
      },
    };
    const plugin = composed[0] as PrintServicePlugin;
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    for (const hook of hooks) await hook();
  });

  afterAll(async () => {
    await (composed[0] as PrintServicePlugin | undefined)?.destroy();
    for (const k of PRINT_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('the showcase composes the print service plugin, once', () => {
    expect(composed).toHaveLength(1);
    expect(composed[0]).toBeInstanceOf(PrintServicePlugin);
  });

  it('the action is an api action on the invoice whose target is the route the plugin mounts', () => {
    expect(GenerateInvoicePdfAction).toMatchObject({ type: 'api', objectName: Invoice.name, method: 'POST' });
    expect([...mounted.keys()]).toEqual([`POST ${GenerateInvoicePdfAction.target}`]);
    const declared = ((stack.actions ?? []) as Array<{ name?: unknown }>).filter((a) => a.name === GenerateInvoicePdfAction.name);
    expect(declared).toHaveLength(1);
  });

  it('it prints the invoice on its default record page, which declares print, in this app', () => {
    const extra = GenerateInvoicePdfAction.bodyExtra as Record<string, unknown>;
    expect(extra.object).toBe(Invoice.name);
    expect(extra.app).toBe(stack.manifest?.id);
    const defaults = pages.filter((p) => p.type === 'record' && p.object === Invoice.name && p.isDefault === true);
    expect(defaults.map((p) => p.name)).toEqual([extra.page]);
    expect(typeof defaults[0]?.print).toBe('object');
    expect(Invoice.enable?.files).toBe(true);
  });

  it('the body the console builds is the door\'s request; with no engine configured the print is refused 503', async () => {
    const handler = mounted.get(`POST ${GenerateInvoicePdfAction.target}`);
    expect(handler).toBeDefined();
    const body = { [GenerateInvoicePdfAction.recordIdParam as string]: 'inv_1', ...(GenerateInvoicePdfAction.bodyExtra ?? {}) };
    const answer: { status?: number; body?: any } = {};
    const res = {
      status: (code: number) => {
        answer.status = code;
        return res;
      },
      json: (b: unknown) => {
        answer.body = b;
      },
      header: () => res,
      send: () => undefined,
    };
    await handler!(
      { params: {}, query: {}, body, headers: { authorization: 'Bearer member' }, method: 'POST', path: GenerateInvoicePdfAction.target },
      res,
    );
    expect([answer.body?.error?.code, answer.status]).toEqual(['SERVICE_UNAVAILABLE', 503]);
    expect(answer.body?.success).toBe(false);
  });
});

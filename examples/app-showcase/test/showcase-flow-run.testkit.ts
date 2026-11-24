// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One harness for running a real showcase flow in a test: a real kernel with
 * ObjectQL over sqlite, the automation plugin, the app's real objects and real
 * flows. Messaging is a recorder of the audience each `notify` hands over, and
 * an `http` node answers without leaving the process: its url is pointed at a
 * receiver on loopback, which the suite allowlists through the environment the
 * way an operator lists an internal target. The outbound-request guard judges
 * every connection itself, so a stubbed global fetch would not stand in for it.
 *
 * The record-change trigger package is not a dependency of this app, so a
 * `data.update` here fires no flow. A test runs the flow itself with
 * `automation.execute(FLOW, { record, previous, object, event, organizationId })`,
 * handing it the row read back with `data.findOne`: that row carries every
 * declared column, so an optional field the case left out reads `null`, the
 * way the trigger hands it.
 *
 * Call `closeShowcaseFlowKernels()` from `afterEach`.
 */

import { vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';

import { installDefaultOrganization } from './default-organization.testkit.js';

export const SYS = { context: { isSystem: true, positions: [], permissions: [] } as any };
/** A user the directory holds: an inbox-only notify delivers an address only to its holder. */
export const OWNER_EMAIL = 'admin@objectos.ai';

export interface Emitted { audience: string[]; title: string }

export interface ShowcaseFlowKernel {
  automation: AutomationEngine & Record<string, any>;
  data: any;
  objectql: any;
  emitted: Emitted[];
}

const openKernels: Array<{ shutdown?: () => Promise<void> }> = [];
const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];
const openReceivers: Server[] = [];

export async function closeShowcaseFlowKernels(): Promise<void> {
  vi.unstubAllEnvs();
  while (openKernels.length) {
    try { await openKernels.pop()?.shutdown?.(); } catch { /* noop */ }
  }
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
  while (openReceivers.length) {
    const receiver = openReceivers.pop()!;
    receiver.closeAllConnections?.();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
}

/** A loopback receiver answering every request `201 {}`; its base url. */
async function startReceiver(): Promise<string> {
  const receiver = createServer((_req, res) => {
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  openReceivers.push(receiver);
  return `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
}

/** A copy of `value` with every `http` node's literal url moved onto `base`, path kept. */
function pointHttpNodesAt<T>(value: T, base: string): T {
  if (Array.isArray(value)) return value.map((v) => pointHttpNodesAt(v, base)) as T;
  if (!value || typeof value !== 'object') return value;
  const copy: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) copy[key] = pointHttpNodesAt(v, base);
  const config = copy.config as Record<string, unknown> | undefined;
  if (copy.type === 'http' && config && typeof config.url === 'string') {
    copy.config = { ...config, url: config.url.replace(/^https?:\/\/[^/]+/, base) };
  }
  return copy as T;
}

export async function bootShowcaseFlowKernel(
  objects: readonly unknown[],
  flows: readonly unknown[],
): Promise<ShowcaseFlowKernel> {
  const receiver = await startReceiver();
  vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '127.0.0.1');

  const emitted: Emitted[] = [];
  const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AutomationServicePlugin());
  await kernel.use({
    name: 'test.messaging-recorder', type: 'standard', version: '1.0.0', dependencies: [],
    async init(ctx: any) {
      ctx.registerService('messaging', {
        async emit(n: any) {
          emitted.push({ audience: [...(n.audience ?? [])], title: String(n.payload?.title ?? '') });
          return { delivered: 1, failed: 0 };
        },
      });
    },
    async start() {},
  } as any);
  await kernel.bootstrap();
  openKernels.push(kernel as any);

  const objectql: any = kernel.getService('objectql');
  const data: any = kernel.getService('data');
  const automation = kernel.getService<AutomationEngine>('automation') as AutomationEngine & Record<string, any>;

  const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await driver.connect();
  objectql.registerDriver(driver, true);
  openDrivers.push(driver);

  for (const obj of objects) objectql.registry.registerObject(obj, 'showcase', 'showcase');
  objectql.registry.registerObject(
    { name: 'sys_user', label: 'User', managedBy: 'better-auth', fields: { email: { type: 'email', label: 'Email' }, name: { type: 'text', label: 'Name' } } },
    '@objectstack/example-showcase',
  );
  await objectql.syncSchemas();
  await installDefaultOrganization(objectql);
  await objectql.getDriverForObject('sys_user')!.create('sys_user', { id: 'usr_admin', email: OWNER_EMAIL, name: 'Admin' });

  for (const flow of flows) automation.registerFlow((flow as any).name, pointHttpNodesAt(flow, receiver) as any);

  return { automation, data, objectql, emitted };
}

/** The id of a row `data.insert` answered with (one row or a one-row array). */
export function insertedId(created: any): string {
  return (Array.isArray(created) ? created[0] : created).id;
}

/** The newest run of `flowName` and its steps. */
export async function latestRun(booted: ShowcaseFlowKernel, flowName: string): Promise<{ run: any; steps: any[] }> {
  const runs: any[] = (await booted.automation.listRuns(flowName)) ?? [];
  const run = runs[0] ?? {};
  return { run, steps: run.steps ?? [] };
}

/** `nodeId → status` for the steps that ran or were passed over. */
export function stepStatus(steps: any[]): Record<string, string> {
  return Object.fromEntries(steps.map((s) => [s.nodeId, s.status]));
}

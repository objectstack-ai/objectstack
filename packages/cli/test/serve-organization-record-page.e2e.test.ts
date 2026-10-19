// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A REAL `os serve` boot of an app that ships its own default record page for
 * `sys_organization`, read back through the metadata door.
 *
 * ## The rule
 *
 * At most one `isDefault: true` record page per object per deployment, and a
 * second is refused at registration with `DEFAULT_RECORD_PAGE_CONFLICT`
 * (maintainer ruling A on objectstack#23015, record 6134056653). `plugin-auth`
 * ships `sys_organization_detail` unless it is constructed with
 * `registerOrganizationRecordPage: false`. `os serve` constructs `AuthPlugin`
 * itself, so it passes that option from the app's own declaration
 * (`stackDeclaresOrganizationRecordPage`, `@objectstack/core`): an app that
 * declares its own `sys_organization` default needs no second switch.
 *
 * ## What each boot is asked
 *
 *  - THE CARD'S BOOT: the app declares `orgpage_organization_detail` as the
 *    default record page of `sys_organization`. The boot reaches its banner
 *    with no conflict, and the served `sys_organization` defaults are exactly
 *    that one page, of the app's package.
 *  - CONTROL: the same app without that page. `plugin-auth`'s
 *    `sys_organization_detail` serves as before — which is also what makes the
 *    first reading non-vacuous: the door does list plugin-auth's page when it
 *    registers.
 *
 * Both read `sys_user_detail` too: the option removes exactly one page.
 *
 * Signed in as the dev admin that `bin/run-dev.js` seeds (`admin@objectos.ai`).
 */

import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLI,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  TSX,
  childEnv,
  probeThroughChild,
  readKernelAssignedPort,
} from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const READY = /Press Ctrl\+C to stop/;

const config = (withOrganizationPage: boolean) => `
import { defineStack } from '@objectstack/spec';
export default defineStack({
  manifest: { id: 'com.example.orgpage', name: 'orgpage', namespace: 'orgpage', version: '1.0.0', type: 'app' },
  objects: [{ name: 'orgpage_task', label: 'Task', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
  pages: [${withOrganizationPage
    ? "{ name: 'orgpage_organization_detail', label: 'Organization', type: 'record', object: 'sys_organization', isDefault: true, regions: [] }"
    : ''}],
}, { strict: false });
`;

const dirs: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

function project(withOrganizationPage: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-org-record-page-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'objectstack.config.ts'), config(withOrganizationPage), 'utf8');
  linkSpec(dir);
  return dir;
}

interface LiveServe {
  child: ChildProcessWithoutNullStreams;
  /** The port the child bound: kernel-assigned, read back off its own banner (#24342). */
  port: number;
  output: () => string;
}

function bootServe(dir: string): Promise<LiveServe> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(TSX, [CLI, 'serve', 'objectstack.config.ts', '-p', KERNEL_ASSIGNED_PORT], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      // `childEnv`, never a bare `...process.env` — see its header (commit 1ddda1d00).
      env: childEnv({
        NO_COLOR: '1',
        OS_DATABASE_URL: ':memory:',
        OS_LOG_LEVEL: 'warn',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
      }),
    }) as ChildProcessWithoutNullStreams;
    children.push(child);
    const what = `os serve in ${dir}`;
    let out = '';
    let settled = false;
    const settle = (verdict: Error | number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (verdict instanceof Error) rejectBoot(verdict);
      else resolveBoot({ child, port: verdict, output: () => out });
    };
    const timer = setTimeout(
      () => settle(new Error(`${what} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      180_000,
    );
    const onData = (d: unknown) => {
      out += String(d);
      // The child is the authority on the port it bound (#12525).
      if (READY.test(out)) settle(readKernelAssignedPort(out, what));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) =>
      settle(new Error(`${what} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
    );
  });
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      done();
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(give);
      done();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(give);
      done();
    }
  });
}

/** One HTTP exchange, attributed to the child if the transport fails (#15653). ⛔ No assertion inside. */
async function request(serve: LiveServe, what: string, url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  return probeThroughChild(
    {
      child: serve.child,
      transcript: () => `\n--- child output ---\n${serve.output().slice(-4000)}`,
      label: 'serve-organization-record-page',
      what,
    },
    async () => {
      const r = await fetch(url, init);
      const text = await r.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep the text */ }
      return { status: r.status, body };
    },
  );
}

/** Every default record page the booted deployment serves for `object`, as `page of package`. */
type Defaults = Record<string, string[]>;

async function servedDefaults(withOrganizationPage: boolean): Promise<{ defaults: Defaults; output: string }> {
  const serve = await bootServe(project(withOrganizationPage));
  const base = `http://localhost:${serve.port}/api/v1`;
  try {
    const signIn = await request(serve, 'the sign-in probe', `${base}/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
    });
    const token = signIn.body?.token;
    if (signIn.status !== 200 || typeof token !== 'string') {
      throw new Error(`sign-in answered ${signIn.status}: ${JSON.stringify(signIn.body)}\n--- output ---\n${serve.output().slice(-3000)}`);
    }
    const pages = await request(serve, 'the page list', `${base}/meta/page`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (pages.status !== 200 || !Array.isArray(pages.body?.items)) {
      throw new Error(`GET /meta/page answered ${pages.status}: ${JSON.stringify(pages.body).slice(0, 500)}`);
    }
    const defaults: Defaults = {};
    for (const page of pages.body.items) {
      const isRecord = page?.type === undefined || page?.type === 'record';
      if (page?.isDefault !== true || !isRecord || typeof page?.object !== 'string') continue;
      (defaults[page.object] ??= []).push(`${page.name} of ${page._packageId}`);
    }
    return { defaults, output: serve.output() };
  } finally {
    await stop(serve.child);
  }
}

afterAll(async () => {
  for (const child of children) await stop(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('os serve — one default record page for sys_organization (ruling A on #23015)', () => {
  it(
    'an app with its own sys_organization default boots, and its page is the single default',
    async () => {
      const { defaults, output } = await servedDefaults(true);
      expect(output, 'the boot was refused').not.toMatch(/DEFAULT_RECORD_PAGE_CONFLICT|Default record page conflict/);
      expect(defaults.sys_organization).toEqual(['orgpage_organization_detail of com.example.orgpage']);
      expect(defaults.sys_user).toEqual(['sys_user_detail of com.objectstack.plugin-auth']);
    },
    300_000,
  );

  it(
    'control: without the app page, plugin-auth\'s page serves as before',
    async () => {
      const { defaults } = await servedDefaults(false);
      expect(defaults.sys_organization).toEqual(['sys_organization_detail of com.objectstack.plugin-auth']);
      expect(defaults.sys_user).toEqual(['sys_user_detail of com.objectstack.plugin-auth']);
    },
    300_000,
  );
});

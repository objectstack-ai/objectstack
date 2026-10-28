// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.security-catalog-one-holder-and-boot-report`,
// acceptance[1], acceptance[2] and acceptance[4], on a booted showcase.
//
// The item's pins stop below the oracle: install-local's refusal is driven on
// the route handler with a stubbed cloud fetch, the owner binding at
// `ObjectQL.registerApp`, and the boot report on a `vi.fn` logger. This file
// drives each at the layer the clause names:
//
//   - acceptance[1] (`api`): `POST /marketplace/install-local` with an inline
//     manifest redeclaring a showcase permission set answers 422
//     PLUGIN_REGISTER_FAILED naming the set and its holder, and
//     `GET /packages` lists the same packages before and after;
//   - acceptance[2] (`api`): a permission-set save whose body `packageId`
//     names another package than the target is 400 VALIDATION_ERROR at
//     `packageId`;
//   - acceptance[4] (`log`): a clean boot logs the one info line; a reboot of
//     the same database holding 51 grants that name no catalog set logs the
//     `[security]` error line, its per-organization list capped at 50.
//
// acceptance[3] (the CLI migration) is pinned in-process by the cli's
// integration test, which the `build` oracle accepts.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const SHOWCASE_PKG = 'com.example.showcase';
const TAKEN = 'showcase_auditor';
const FOREIGN_PKG = 'com.example.qa-one-holder';
const UNDEFINED_SETS = 51;

/** Every line the process writes while `run` is in flight (sys-migration-boot-ledger-once's instrument). */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const chunks: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const warn = console.warn;
  const error = console.error;
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stdout(chunk as any, ...rest); };
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stderr(chunk as any, ...rest); };
  console.warn = (...args: unknown[]) => { chunks.push(`WARN ${args.map(String).join(' ')}\n`); warn(...args); };
  console.error = (...args: unknown[]) => { chunks.push(`ERROR ${args.map(String).join(' ')}\n`); error(...args); };
  try {
    const value = await run();
    return { value, lines: chunks.join('').split('\n') };
  } finally {
    (process.stdout as any).write = stdout;
    (process.stderr as any).write = stderr;
    console.warn = warn;
    console.error = error;
  }
}

/** The level of one kernel-logger line (`<ISO time> <LEVEL> <message> …`), or `undefined`. */
function levelOf(line: string): string | undefined {
  return /^(?:\S+Z\s+)?(DEBUG|INFO|WARN|ERROR|FATAL)\b/.exec(line.trim())?.[1];
}

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;

describe('one holder per catalog name, at the HTTP doors', () => {
  let stack: VerifyStack;
  let admin: string;
  let storageDir: string;

  const packageIds = async () => {
    const r = await stack.apiAs(admin, 'GET', '/packages');
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    const rows = (body?.data?.packages ?? body?.packages ?? body?.data ?? body ?? []) as any[];
    return rows.map((p: any) => p?.manifest?.id ?? p?.id ?? p?.packageId).filter(Boolean).sort();
  };

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-one-holder-ledger-'));
    stack = await bootShowcase({ extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })] });
    admin = await stack.signIn();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('acceptance[1]: install-local of a package redeclaring a showcase permission set is 422 PLUGIN_REGISTER_FAILED naming the name and its holder; nothing is installed', async () => {
    const before = await packageIds();
    expect(before, 'the showcase holds the name').toContain(SHOWCASE_PKG);
    const res = await stack.apiAs(admin, 'POST', '/marketplace/install-local', {
      manifest: {
        id: FOREIGN_PKG, name: 'qa_one_holder', version: '1.0.0', type: 'app', scope: 'project',
        engines: { protocol: `^${PROTOCOL_MAJOR}` },
        permissions: [{ name: TAKEN, label: 'Redeclared auditor', objects: {} }],
      },
    });
    const body = (await res.json()) as any;
    expect([res.status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message, 'the message names the redeclared name').toContain(`"${TAKEN}"`);
    expect(message, 'and the package that already holds it').toContain(SHOWCASE_PKG);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
  });

  it('acceptance[2]: a permission-set save whose body packageId names another package is 400 VALIDATION_ERROR at packageId', async () => {
    const res = await stack.apiAs(admin, 'PUT', `/meta/permission/qa_owner_binding_set?package=${SHOWCASE_PKG}`, {
      name: 'qa_owner_binding_set', label: 'Owner binding', objects: {}, packageId: FOREIGN_PKG,
    });
    const body = (await res.json()) as any;
    expect([res.status, codeOf(body)], JSON.stringify(body)).toEqual([400, 'VALIDATION_ERROR']);
    expect(JSON.stringify(body?.error ?? body), 'the refusal is located at packageId').toContain('packageId');
  });
});

describe('the [security] catalog reference report at boot', () => {
  let dir: string;
  let stack: VerifyStack | undefined;
  let clean: string[] = [];
  let planted: string[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-catalog-report-'));
    const databaseFile = join(dir, 'report.db');

    const first = await captureOutput(() => bootShowcase({ databaseFile }));
    stack = first.value;
    clean = first.lines;
    await stack.signIn();
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    const userId = (await ql.find('sys_user', { fields: ['id'], limit: 1, context: SYS }))?.[0]?.id;
    expect(userId, 'a user to hold the planted grants').toBeTruthy();
    for (let i = 0; i < UNDEFINED_SETS; i++) {
      await ql.insert('sys_user_permission_set', { user_id: userId, permission_set: `qa_undefined_set_${String(i).padStart(2, '0')}` }, { context: SYS });
    }
    await stack.stop();
    stack = undefined;

    const second = await captureOutput(() => bootShowcase({ databaseFile }));
    stack = second.value;
    planted = second.lines;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('a clean boot logs the one info line', () => {
    const info = clean.filter((l) => l.includes('[security] catalog reference report: every position assignment'));
    expect(info, 'one info line').toHaveLength(1);
    expect(levelOf(info[0]!)).toBe('INFO');
    expect(clean.filter((l) => /\[security\] \d+ sys_user_permission_set grant\(s\)/.test(l))).toEqual([]);
  });

  it(`a reboot holding ${UNDEFINED_SETS} grants that name no catalog set logs the [security] error line, its list capped at 50`, () => {
    const lines = planted.filter((l) => l.includes(`[security] ${UNDEFINED_SETS} sys_user_permission_set grant(s) name a permission set the security catalog does not resolve`));
    expect(lines, 'one error line for the category').toHaveLength(1);
    expect(levelOf(lines[0]!)).toBe('ERROR');
    const line = lines[0]!;
    expect(line, 'the names are listed').toContain('qa_undefined_set_00');
    expect(line, 'the grant ids are capped at 50, with the rest counted').toMatch(/"more":\s*1\b/);
    expect(planted.filter((l) => l.includes('[security] catalog reference report: every position assignment'))).toEqual([]);
  });
});

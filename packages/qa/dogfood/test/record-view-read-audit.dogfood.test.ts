// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.record-view-read-audit`, acceptance[0] to
// acceptance[4], through the mounted server.
//
// Record-view auditing (#8992) is the `read` half of `sys_audit_log`, and it
// is opt-in where `AuditPlugin` is constructed, per object, and nowhere else
// (packages/plugins/plugin-audit/src/read-audit.ts). `objectstack serve`
// auto-registers an `AuditPlugin` with NO options; the docs' opt-in
// (content/docs/permissions/record-view-auditing.mdx) is an app's own
// `new AuditPlugin({ readAudit: { objects: [...] } })`, which supersedes it.
// `bootStack` constructs no `AuditPlugin` of its own, so each boot here adds
// the instance `serve` would end up running:
//
//   - STOCK: `new AuditPlugin()` — the honest default. A member's detail read
//     answers 200 and, past the flush window, the ledger holds no `read` row;
//     the boot log carries INFO lines and no install line;
//   - CONFIGURED: `readAudit.objects` = `showcase_account` plus `sys_job`, the
//     exclusion-list probe. The install line names `showcase_account` alone and
//     the exclusion warning names `sys_job`; one detail read lands one row
//     recording who, which and when (no field values, `created_at` the view's
//     instant); a list read and an un-opted object's detail read land none.
//
// Rows are read through `GET /data/sys_audit_log` as the admin, the way the
// item says to read them. The default flush interval (2 s) is kept.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const AUDITED = 'showcase_account';
const EXCLUDED = 'sys_job';
const UNOPTED = 'showcase_project';
const INSTALL_LINE = 'record-view auditing installed';
const FLUSH_MS = 2_000;

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

const pastFlush = () => new Promise((resolve) => setTimeout(resolve, FLUSH_MS + 750));
const filterOf = (where: Record<string, unknown>) => encodeURIComponent(JSON.stringify(where));
const timeOf = (v: unknown) => (typeof v === 'number' ? v : Date.parse(String(v)));

/** A boot with one `AuditPlugin`, an admin, a member M, and the boot's log lines. */
async function boot(plugin: AuditPlugin) {
  const run = await captureOutput(() => bootShowcase({ extraPlugins: [plugin] }));
  const stack = run.value;
  const admin = await stack.signIn();
  const member = await stack.signUp(`read-audit-m-${Math.random().toString(36).slice(2, 8)}@verify.test`);
  const session = (await (await stack.apiAs(member, 'GET', '/auth/get-session')).json()) as any;
  const memberId = String(session?.user?.id ?? '');
  expect(memberId, 'M has an id to be named by').toBeTruthy();
  const ql: any = await stack.kernel.getServiceAsync('objectql');
  const firstId = async (object: string) =>
    (await ql.find(object, { fields: ['id'], limit: 1, context: SYS }))?.[0]?.id as string;
  return { stack, admin, member, memberId, lines: run.lines, firstId };
}

/** The ledger's `read` rows, read as the admin through the data door. */
async function readRows(stack: VerifyStack, admin: string, where: Record<string, unknown> = {}) {
  const r = await stack.apiAs(admin, 'GET', `/data/sys_audit_log?$filter=${filterOf({ action: 'read', ...where })}`);
  expect(r.status, 'the admin reads the ledger').toBe(200);
  const body = (await r.json()) as any;
  return (body?.records ?? body?.data ?? []) as Array<Record<string, unknown>>;
}

describe('stock boot: the option-less AuditPlugin audits no record view (acceptance[0])', () => {
  let s: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    s = await boot(new AuditPlugin());
  }, 120_000);

  afterAll(async () => {
    await s?.stack.stop();
  });

  it('the boot log carries INFO lines (the positive control) and no install line', () => {
    expect(s.lines.some((l) => levelOf(l) === 'INFO'), 'INFO lines are logged, so an absent INFO line means something').toBe(true);
    expect(s.lines.some((l) => l.includes('AuditPlugin:')), 'the AuditPlugin itself logged its install').toBe(true);
    expect(s.lines.filter((l) => l.includes(INSTALL_LINE))).toEqual([]);
  });

  it('a member\'s detail read answers 200 and, past the flush window, lands no read row', async () => {
    const id = await s.firstId(AUDITED);
    expect(id, `the showcase seeds a ${AUDITED}`).toBeTruthy();
    const r = await s.stack.apiAs(s.member, 'GET', `/data/${AUDITED}/${id}`);
    expect(r.status, 'the read is a real one, so the zero is not vacuous').toBe(200);
    await pastFlush();
    expect(await readRows(s.stack, s.admin)).toEqual([]);
  }, 30_000);
});

describe('configured boot: readAudit names showcase_account and the excluded sys_job (acceptance[1] to [4])', () => {
  let s: Awaited<ReturnType<typeof boot>>;
  let accountId: string;

  beforeAll(async () => {
    s = await boot(new AuditPlugin({ readAudit: { objects: [AUDITED, EXCLUDED] } }));
    accountId = await s.firstId(AUDITED);
    expect(accountId, `the showcase seeds a ${AUDITED}`).toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await s?.stack.stop();
  });

  it('acceptance[1] / [4]: the install line names exactly the surviving set, without sys_job', () => {
    const installs = s.lines.filter((l) => l.includes(INSTALL_LINE));
    expect(installs, 'one install line').toHaveLength(1);
    expect(installs[0]).toContain(`AuditPlugin: ${INSTALL_LINE} on 1 object(s) — ${AUDITED}`);
    expect(installs[0]).not.toContain(EXCLUDED);
  });

  it('acceptance[4]: sys_job draws the exclusion warning, by name', () => {
    const warned = s.lines.filter((l) => l.includes(`Read audit: '${EXCLUDED}' is on the audit exclusion list`));
    expect(warned, 'the exclusion is refused loudly').toHaveLength(1);
    expect(warned[0]).toContain('will NOT have its record views recorded');
    expect(levelOf(warned[0]!) ?? 'WARN').toBe('WARN');
  });

  it('acceptance[1] / [2]: one detail read lands one row recording who, which and when — and no values', async () => {
    const before = Date.now();
    const r = await s.stack.apiAs(s.member, 'GET', `/data/${AUDITED}/${accountId}`);
    const after = Date.now();
    expect(r.status).toBe(200);

    let rows: Array<Record<string, unknown>> = [];
    await vi.waitFor(async () => {
      rows = await readRows(s.stack, s.admin, { object_name: AUDITED, record_id: accountId });
      expect(rows.length).toBeGreaterThanOrEqual(1);
    }, { timeout: FLUSH_MS + 5_000, interval: 250 });
    expect(rows, 'exactly one row for the one view').toHaveLength(1);

    const [row] = rows;
    expect(row).toMatchObject({ action: 'read', user_id: s.memberId, object_name: AUDITED, record_id: accountId });
    expect(row.old_value ?? null, 'no pre-image').toBeNull();
    expect(row.new_value ?? null, 'no field values copied from the pre-mask read').toBeNull();
    // The VIEW instant, not the flush's: the flush is at least FLUSH_MS after `after`.
    const at = timeOf(row.created_at);
    expect(at, 'created_at is a time').not.toBeNaN();
    expect(at).toBeGreaterThanOrEqual(before - 1_000);
    expect(at, 'created_at is the view, not the flush').toBeLessThan(after + FLUSH_MS / 2);
  }, 30_000);

  it('acceptance[3]: a LIST read of the audited object lands no row', async () => {
    const countBefore = (await readRows(s.stack, s.admin)).length;
    const r = await s.stack.apiAs(s.member, 'GET', `/data/${AUDITED}?$filter=${filterOf({ id: accountId })}`);
    expect(r.status).toBe(200);
    const listed = (await r.json()) as any;
    expect((listed?.records ?? listed?.data ?? []).map((x: any) => x.id), 'the list served the record').toContain(accountId);
    await pastFlush();
    expect((await readRows(s.stack, s.admin)).length, 'the ledger count is unchanged').toBe(countBefore);
  }, 30_000);

  it('acceptance[1]: a detail read of an object OFF the list lands no row', async () => {
    const projectId = await s.firstId(UNOPTED);
    expect(projectId, `the showcase seeds a ${UNOPTED}`).toBeTruthy();
    const r = await s.stack.apiAs(s.member, 'GET', `/data/${UNOPTED}/${projectId}`);
    expect(r.status, 'the un-opted read is a real one').toBe(200);
    await pastFlush();
    expect(await readRows(s.stack, s.admin, { object_name: UNOPTED })).toEqual([]);
  }, 30_000);
});

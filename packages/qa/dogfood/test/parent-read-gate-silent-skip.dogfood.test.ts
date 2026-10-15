// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The parent-record read gates skip the objects a caller cannot read WITHOUT
// logging a denial for each one.
//
// `sys_activity` and `sys_audit_log` serve a row only when the caller can read
// the record it is about (`activity-parent-read-gate.dogfood.test.ts`,
// `audit-log-parent-read-gate.dogfood.test.ts`). The gate decides that per
// parent OBJECT, and the streams name many: every platform object the boot
// writes. The gate used to read each of them as the caller and let
// plugin-security refuse the ones the caller holds no object-level read on —
// and plugin-security logs every refusal at WARN, once per engine read. So the
// console header's activity feed (`GET /data/sys_activity?top=20&sort=-timestamp`,
// on every page view) logged a `[Security] Access denied` line per platform
// object, for its rows and again for its `total`, for every non-admin, and
// buried the real denials.
//
// The gate now asks the security service's `canReadObject` first — the
// middleware's own object-level read gate, arm for arm, which answers without
// logging or throwing — and reads as the caller only the objects it admits.
// What this file holds, on a real org-bound boot with the real SecurityPlugin
// and the real AuditPlugin:
//
//   - a member's read of each gated object logs NO denial;
//   - it returns exactly the rows the gate returns when the security service
//     offers no `canReadObject` (a defined state of the contract, where the
//     gate reads every parent as the caller, as it did before) — asked of the
//     same boot, so the comparison is about the probe and nothing else;
//   - that no-probe read still logs the denials, so the comparison is armed;
//   - a direct read of a skipped object by the same member is still refused,
//     and still logs its denial exactly once, on both arms (CRUD, capability).
//
// `@objectstack/plugin-audit` resolves through its BUILT output here (a
// ledgered pair in `scripts/check-test-source-alias.mjs`), so a verdict on a
// change to it is a verdict on its last build.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { commentsFixtureStack } from './fixtures/comments-fixture.js';
import { armedWhen, assertArmed, principalArmed } from './armed.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const MEMBER_EMAIL = 'gate-silent-skip-member@verify.test';
const ACTIVITY = 'sys_activity';
const LEDGER = 'sys_audit_log';

/**
 * The member's app grant, with NO wildcard: the fixture's two record objects
 * and nothing else, so the platform objects the boot writes rows about are
 * refused by the CRUD arm (no `allowRead`) or the capability arm
 * (`requiredPermissions`) — the two arms a console member meets.
 */
const memberBaselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'gss_member_baseline',
  label: 'Silent-skip fixture — the member app grant, no wildcard',
  objects: {
    cmt_open: { allowRead: true, allowCreate: true, allowEdit: true },
    cmt_private: { allowRead: true },
  },
});

/** The grant under test: object-level read on both gated objects, nothing more. */
const streamReaderSet: PermissionSet = PermissionSetSchema.parse({
  name: 'gss_stream_reader',
  label: 'Silent-skip fixture — object-level sys_activity and sys_audit_log read',
  objects: { [ACTIVITY]: { allowRead: true }, [LEDGER]: { allowRead: true } },
});

/** The denial plugin-security logs, as a matcher (its developer sentence's opener). */
const DENIAL = '[Security] Access denied';

type Arm = 'crud' | 'capability' | 'other';
type Row = Record<string, any>;
const rowsOf = async (res: Response): Promise<Row[]> => ((await res.json()) as any).records ?? [];
const ids = (rows: Row[]) => rows.map((r) => String(r.id)).sort();
/** The object a denial line names — `on object 'X'` (CRUD arm) or `denied: 'X'` (capability arm). */
const deniedObject = (line: string) => {
  const m = /on object '([^']+)'|Access denied: '([^']+)'/.exec(line);
  return m?.[1] ?? m?.[2];
};

describe('parent-record read gates: a skipped object is an expected scope, not an access attempt', () => {
  let stack: VerifyStack;
  let ql: any;
  let memberTok: string;
  /** The kernel logger every plugin context shares — plugin-security's `ctx.logger`. */
  let logger: { warn: (...args: unknown[]) => void };
  /** The registered `security` service, the object the gates resolve on every read. */
  let security: { canReadObject?: unknown };
  /** The refused parents of each gated object, by arm (the boot writes no new parent after `beforeAll`). */
  const refused: Record<string, Map<string, Arm>> = {};

  /** Every WARN the stack logs while `run` is in flight, as message strings. */
  const warnsDuring = async <T>(run: () => Promise<T>): Promise<{ value: T; denials: string[] }> => {
    const spy = vi.spyOn(logger, 'warn');
    try {
      const value = await run();
      return { value, denials: spy.mock.calls.map((args) => String(args[0])).filter((w) => w.includes(DENIAL)) };
    } finally {
      spy.mockRestore();
    }
  };

  /** `run`, with the security service offering no `canReadObject` — the contract's optional-method state. */
  const withoutReadAdmission = async <T>(run: () => Promise<T>): Promise<T> => {
    const own = Object.getOwnPropertyDescriptor(security, 'canReadObject');
    expect(own, 'the registered service carries canReadObject as its own member').toBeTruthy();
    delete security.canReadObject;
    try {
      return await run();
    } finally {
      Object.defineProperty(security, 'canReadObject', own!);
    }
  };

  /** One member read of `path`, its rows and the denials it logged. */
  const read = async (path: string) => {
    const { value: res, denials } = await warnsDuring(() => stack.apiAs(memberTok, 'GET', path));
    expect(res.status, path).toBe(200);
    return { ids: ids(await rowsOf(res)), denials };
  };

  /**
   * Parent objects named by the stored rows of `object` that are about a
   * record (the rows the gate judges by their record) and that the member's
   * own direct read refuses, each with the arm that refused it — read off the
   * one denial line that read logs (`crud`: no `allowRead`; `capability`: a
   * `requiredPermissions` AND-gate).
   */
  const refusedParents = async (object: string): Promise<Map<string, Arm>> => {
    const stored: Row[] = await ql.find(object, { context: { ...SYS }, limit: 5000 });
    const aboutRecords = stored.filter((r) => r.record_id != null && String(r.record_id) !== '');
    const parents = [...new Set(aboutRecords.map((r) => r.object_name).filter((n): n is string => typeof n === 'string'))];
    const out = new Map<string, Arm>();
    for (const parent of parents.sort()) {
      if (parent === object) continue;
      const { value: res, denials } = await warnsDuring(() => stack.apiAs(memberTok, 'GET', `/data/${parent}?limit=1`));
      if (res.status !== 403) continue;
      const line = denials[0] ?? '';
      out.set(parent, line.includes('requires capability') ? 'capability' : line.includes('is not permitted') ? 'crud' : 'other');
    }
    return out;
  };

  beforeAll(async () => {
    stack = await bootStack(commentsFixtureStack as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, memberBaselineSet, streamReaderSet],
        fallbackPermissionSet: memberBaselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
      // Org-bound: the member holds `org_member`, the position the platform's
      // member floors are domained to.
      orgContext: true,
    });
    const adminTok = await stack.signIn();
    memberTok = await stack.signUp(MEMBER_EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');
    security = await stack.kernel.getServiceAsync('security');
    logger = (stack.kernel as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger;

    const memberId = (await ql.findOne('sys_user', { where: { email: MEMBER_EMAIL }, context: SYS }))?.id;
    const set = await catalogPermissionSet(ql, streamReaderSet.name);
    expect(set, 'fixture permission set served by the security catalog').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: memberId, permission_set: set.name }, { context: { ...SYS } });

    // A record the member cannot read (row scope: it holds the object), and
    // one it can — so the gate also drops rows inside a readable object.
    const idOf = async (res: Response) => {
      expect(res.status, 'fixture write').toBeLessThan(300);
      const j = (await res.json()) as any;
      return String(j.id ?? j.record?.id ?? j.data?.id);
    };
    const privateId = await idOf(await stack.apiAs(adminTok, 'POST', '/data/cmt_private', { name: 'admin only' }));
    const openId = await idOf(await stack.apiAs(memberTok, 'POST', '/data/cmt_open', { name: 'shared board' }));

    await assertArmed([
      principalArmed({
        stack,
        token: memberTok,
        who: 'the member holding object-level sys_activity and sys_audit_log read',
        positions: ['org_member'],
        permissions: [streamReaderSet.name],
        control: 'object-level read on both gated objects, granted by an explicit permission set',
        disarmedBy: 'a member that never resolved the grant would be refused the gated object itself, and log that denial instead',
      }),
      armedWhen({
        control:
          'each gated object at rest names parent objects the member holds no object-level read on, ' +
          'refused by the CRUD arm and by the capability arm',
        disarmedBy:
          'a boot whose rows named only readable objects would leave the gate nothing to skip, and the no-denial ' +
          'cases would pass on nothing; one that met a single arm would leave the other unmeasured',
        observe: async () => {
          refused[ACTIVITY] = await refusedParents(ACTIVITY);
          refused[LEDGER] = await refusedParents(LEDGER);
          const arms = (m: Map<string, Arm>) => [...new Set(m.values())].sort();
          return { activity: arms(refused[ACTIVITY]), ledger: arms(refused[LEDGER]) };
        },
        armed: (o) => o.activity.includes('crud') && o.activity.includes('capability') && o.ledger.length > 0,
      }),
      armedWhen({
        control: 'row scope narrows inside a readable object: the member reads its own record and not the admin’s',
        disarmedBy: 'a member that read every record would make the row comparisons below about an unnarrowed gate',
        observe: async () => ({
          private: (await stack.apiAs(memberTok, 'GET', `/data/cmt_private/${privateId}`)).status,
          open: (await stack.apiAs(memberTok, 'GET', `/data/cmt_open/${openId}`)).status,
        }),
        armed: (o) => o.private === 404 && o.open === 200,
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  for (const [object, path] of [
    [ACTIVITY, `/data/${ACTIVITY}?top=20&sort=-timestamp`],
    [ACTIVITY, `/data/${ACTIVITY}?limit=1000`],
    [LEDGER, `/data/${LEDGER}?limit=1000`],
  ] as const) {
    it(`${path}: logs no denial, and serves exactly the rows the no-probe read serves`, async () => {
      const before = await withoutReadAdmission(() => read(path));
      // The comparison is armed: the no-probe read meets the skipped objects
      // and logs their denials, and it serves rows.
      expect(before.ids.length).toBeGreaterThan(0);
      expect(new Set(before.denials.map(deniedObject))).toEqual(new Set(refused[object].keys()));

      const after = await read(path);
      expect(after.ids).toEqual(before.ids);
      expect(after.denials).toEqual([]);
    }, 60_000);
  }

  it('a direct read of a skipped object is still refused, and logs its denial exactly once, on either arm', async () => {
    for (const arm of ['crud', 'capability'] as const) {
      const skipped = [...refused[ACTIVITY]].find(([, a]) => a === arm)?.[0];
      expect(skipped, `a parent object the gate skips, refused by the ${arm} arm`).toBeTruthy();
      const { value: res, denials } = await warnsDuring(() => stack.apiAs(memberTok, 'GET', `/data/${skipped}`));
      expect(res.status).toBe(403);
      expect(denials).toHaveLength(1);
      expect(denials[0]).toContain(`'${skipped}'`);
    }
  });
});

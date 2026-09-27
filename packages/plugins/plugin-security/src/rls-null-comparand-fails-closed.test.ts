// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20212] A row-level policy whose compiled filter carries a comparand the
 * platform's shared comparand faces refuse (a `null` list member, a `null`
 * ordering bound) fails closed on BOTH clauses, through the real plugin and
 * engine. It answers exactly as the TYPE family (a list under `==` / `!=`)
 * already does in the same position.
 *
 * The faces run on the caller's `where` inside the engine's lowering seam,
 * before the middleware chain composes the RLS filter onto it. So the compiled
 * policy filter reached the driver unjudged, while the `check` clause of the
 * same policy was judged in-process by `matchesFilterCondition`. Measured at
 * `805af4f290` (`origin/main`), rows `r_open` / `r_closed` / `r_none` (status
 * NULL), caller `usr_member`:
 *
 * | predicate                             | `using` read, SqlDriver | `using` read, InMemoryDriver | `check` insert closed / open |
 * |:--------------------------------------|:------------------------|:-----------------------------|:-----------------------------|
 * | `!(record.status in ['open', null])`  | `r_none`, no WARN       | `r_closed`, no WARN          | admitted / 403               |
 * | `record.status in ['open', null]`     | `r_open`                | `r_none`, `r_open`           | 403 / admitted               |
 * | `record.status > null`                | nothing, no WARN        | nothing, no WARN             | 403 / 403                    |
 * | `record.status <= null`               | nothing, no WARN        | `r_none`                     | 403 / 403                    |
 * | `record.status in [null]`             | nothing, no WARN        | `r_none`                     | 403 / 403                    |
 *
 * The first row is the card's defect: on SqlDriver the read hides `r_closed`,
 * which the same policy's write check admits, and the two drivers answer the
 * read differently. `RLSCompiler.compileFilter` now runs the two faces on every
 * compiled policy filter, so each row here answers `DENY (fail closed)`: zero
 * rows and the per-request WARN on read, the row-level CHECK 403 on write.
 *
 * The TYPE-family rows are the control: they answered this way before the
 * change and must still. The caller's OWN `where` keeps the engine's refusal
 * (`INVALID_FILTER` / 400), and the null CHECKS (`== null` / `!= null`) are not
 * refused comparands at all.
 *
 * Why the matrix here is `SqlDriver` alone: the refusal happens in the compile
 * step, before any driver is asked, so no driver can answer the refused filter
 * (`rls-compiled-comparand-faces.test.ts` pins that step on its own). The
 * `InMemoryDriver` column above, and the same five shapes on PostgreSQL, were
 * measured once, before and after, and are recorded on the PR. A new test
 * consumer of `@objectstack/driver-memory` is a ledgered decision
 * (`pnpm check:driver-memory-census`), not one this file makes.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OBJ = 'qa_ticket';
const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const DRIVERS = [
  [
    'SqlDriver',
    () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
  ],
] as const;

/** The five shapes of the card: each lowers, and each is refused by a shared face. */
const NULL_FAMILY = [
  "!(record.status in ['open', null])",
  "record.status in ['open', null]",
  'record.status > null',
  'record.status <= null',
  'record.status in [null]',
] as const;

/** The control: a membership set compared with `==` / `!=`, refused per request by the compiler. */
const TYPE_FAMILY = [
  'record.status == current_user.positions',
  'record.status != current_user.positions',
] as const;

/** Every row a refused policy is expected to deny, each with the WARN reason it is dropped for. */
const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ...NULL_FAMILY.map((p) => [p, 'refused-comparand'] as const),
  ...TYPE_FAMILY.map((p) => [p, 'unsupported'] as const),
];

/** A granting sibling, for the OR-combined position. */
const SIBLING = "record.status == 'open'";

const ROWS = [
  { id: 'r_open', status: 'open' },
  { id: 'r_closed', status: 'closed' },
  { id: 'r_none', status: null },
];

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

type WarnMeta = { clause?: string; reason?: string };

async function boot(makeDriver: () => unknown, clause: 'using' | 'check', predicates: readonly string[]) {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.rls-null-comparand-20212',
    name: 'RLS null comparand',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [{
      name: OBJ,
      label: 'Ticket',
      sharingModel: 'public_read_write',
      fields: {
        id: { name: 'id', type: 'text', primaryKey: true },
        status: { name: 'status', type: 'text' },
      },
    }],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const set = PermissionSetSchema.parse({
    name: 'qa_ticket_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true } },
    rowLevelSecurity: predicates.map((predicate, i) => ({
      name: `status_scope_${i}`,
      object: OBJ,
      operation: 'all',
      [clause]: predicate,
    })),
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const warn = vi.fn();
  const ctx = {
    logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const caller = { userId: 'usr_member', positions: ['qa_pos'], permissions: [set.name], posture: 'MEMBER' };
  /** The structured half of every `DENY (fail closed)` line the RLS compiler emitted. */
  const denials = (): WarnMeta[] =>
    warn.mock.calls
      .filter(([line]) => String(line).startsWith('[RLS] DENY (fail closed)'))
      .map(([, meta]) => (meta ?? {}) as WarnMeta);
  const stored = async () =>
    ((await engine.find(OBJ, { context: SYS_CTX } as never)) as Array<{ id: string; status: string | null }>)
      .map((r) => `${r.id}:${r.status}`)
      .sort();
  return { engine, caller, denials, stored };
}

type Envelope = { code?: string; status?: number; statusCode?: number };
const refusalOf = (p: Promise<unknown>) => p.then(() => null, (e: Envelope) => e);
const ids = (rows: unknown) => (rows as Array<{ id: string }>).map((r) => r.id).sort();

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#20212] ${driverName} — a refused comparand fails closed on the \`using\` read`, () => {
    for (const [predicate, reason] of REFUSED) {
      it(`\`${predicate}\`: zero rows on find / findOne / count, with the ${reason} DENY WARN`, async () => {
        const { engine, caller, denials, stored } = await boot(makeDriver, 'using', [predicate]);
        await engine.insert(OBJ, ROWS, { context: SYS_CTX } as never);

        expect(await engine.find(OBJ, { context: caller } as never)).toEqual([]);
        expect(await engine.findOne(OBJ, { where: { id: 'r_closed' }, context: caller } as never)).toBeNull();
        expect(await engine.count(OBJ, { context: caller } as never)).toBe(0);
        expect(denials().length).toBeGreaterThan(0);
        for (const meta of denials()) expect(meta).toMatchObject({ clause: 'using', reason });
        // Ground truth, read past every scope: the rows exist, the policy refused them.
        expect(await stored()).toEqual(['r_closed:closed', 'r_none:null', 'r_open:open']);
      });
    }
  });

  describe(`[#20212] ${driverName} — a refused comparand fails closed on the \`check\` write`, () => {
    for (const [predicate, reason] of REFUSED) {
      it(`\`${predicate}\`: inserts and the by-id update answer PERMISSION_DENIED / 403, nothing is stored`, async () => {
        const { engine, caller, denials, stored } = await boot(makeDriver, 'check', [predicate]);
        await engine.insert(OBJ, { id: 'u1', status: 'open' }, { context: SYS_CTX } as never);

        for (const row of [{ id: 'i_open', status: 'open' }, { id: 'i_closed', status: 'closed' }]) {
          const err = await refusalOf(engine.insert(OBJ, row, { context: caller } as never));
          expect(err?.code, row.id).toBe('PERMISSION_DENIED');
          expect(err?.statusCode ?? err?.status, row.id).toBe(403);
        }
        const upd = await refusalOf(engine.update(OBJ, { id: 'u1', status: 'closed' } as never, { context: caller } as never));
        expect(upd?.code).toBe('PERMISSION_DENIED');
        expect(upd?.statusCode ?? upd?.status).toBe(403);

        expect(denials().length).toBeGreaterThan(0);
        for (const meta of denials()) expect(meta).toMatchObject({ clause: 'check', reason });
        expect(await stored()).toEqual(['u1:open']);
      });
    }
  });

  describe(`[#20212] ${driverName} — beside a granting sibling, a refused comparand behaves as the type family does`, () => {
    it('the read serves the sibling alone, with no DENY WARN, for either family', async () => {
      const answers: unknown[] = [];
      for (const refused of [NULL_FAMILY[0], TYPE_FAMILY[0]]) {
        const { engine, caller, denials } = await boot(makeDriver, 'using', [refused, SIBLING]);
        await engine.insert(OBJ, ROWS, { context: SYS_CTX } as never);
        answers.push({ rows: ids(await engine.find(OBJ, { context: caller } as never)), denials: denials().length });
      }
      expect(answers).toEqual([{ rows: ['r_open'], denials: 0 }, { rows: ['r_open'], denials: 0 }]);
    });

    it('the check admits what the sibling admits and refuses the rest, for either family', async () => {
      const answers: unknown[] = [];
      for (const refused of [NULL_FAMILY[0], TYPE_FAMILY[0]]) {
        const { engine, caller } = await boot(makeDriver, 'check', [refused, SIBLING]);
        const open = await refusalOf(engine.insert(OBJ, { id: 'i_open', status: 'open' }, { context: caller } as never));
        const closed = await refusalOf(engine.insert(OBJ, { id: 'i_closed', status: 'closed' }, { context: caller } as never));
        answers.push({ open: open?.code ?? 'admitted', closed: closed?.code ?? 'admitted' });
      }
      expect(answers).toEqual([
        { open: 'admitted', closed: 'PERMISSION_DENIED' },
        { open: 'admitted', closed: 'PERMISSION_DENIED' },
      ]);
    });
  });

  describe(`[#20212] ${driverName} — what the change leaves alone`, () => {
    it('CONTROL — the null CHECKS and a list without null read exactly the rows they name', async () => {
      for (const [predicate, expected] of [
        ['record.status == null', ['r_none']],
        ['record.status != null', ['r_closed', 'r_open']],
        ["record.status in ['open', 'pending']", ['r_open']],
      ] as const) {
        const { engine, caller, denials } = await boot(makeDriver, 'using', [predicate]);
        await engine.insert(OBJ, ROWS, { context: SYS_CTX } as never);
        expect(ids(await engine.find(OBJ, { context: caller } as never)), predicate).toEqual(expected);
        expect(denials(), predicate).toEqual([]);
      }
    });

    it("CONTROL — the caller's own `where` carrying a null member is still refused INVALID_FILTER / 400", async () => {
      const { engine, caller } = await boot(makeDriver, 'using', ["record.status in ['open', 'closed']"]);
      for (const where of [{ status: { $in: ['open', null] } }, { status: { $gt: null } }]) {
        const err = await refusalOf(engine.find(OBJ, { where, context: caller } as never));
        expect(err?.code).toBe('INVALID_FILTER');
        expect(err?.status).toBe(400);
      }
    });
  });
}

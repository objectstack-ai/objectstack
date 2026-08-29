// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The END USER's half of the sharing middleware's by-id WRITE refusal (#12260).
 *
 * The report, on `@objectstack/*@17.2.0`: an object declaring
 * `sharingModel: 'public_read'` with `access: { default: 'private' }`; a user
 * holding object-level allowRead + allowEdit and NO `modifyAllRecords`; a by-id
 * PATCH against a record they do not own. The middleware refuses — correctly —
 * and the client (an H5 / in-house front end) shows the server's `message`
 * verbatim to the end user. That message was one hardcoded English sentence
 * naming an API name and an opaque row id.
 *
 * The comparison the reporter drew is exact: `plugin-security`'s record-level
 * denial already renders localized copy through the catalog
 * (`userFacingDenialMessage`), so the SAME user situation — "I can't write this
 * record" — showed human language or raw English depending on which layer
 * refused.
 *
 * The refusal now renders through the shared Operation Message Catalog
 * (`@objectstack/spec/system`, key `record_write_denied`, landed ahead of this
 * consumer half by #12493) instead of a package-local string.
 *
 * ⚠️ These tests assert the SENTENCE A USER READS, in zh-CN specifically, as a
 * LITERAL. Asserting only that a catalog key was passed — or comparing the
 * render against the catalog it came from — would pass against a message that
 * still renders in English, which is the entire reported defect.
 *
 * They also pin the three things the conversion must NOT move:
 *   - the `FORBIDDEN:` code prefix. It is not user copy: it is the ADR-0111
 *     `CODE: message` idiom the share routes read and strip, and it rides
 *     beside the `code`/`status` the `/data` door classifies 403 on;
 *   - the ADR-0111 D10 `delete`-verb diagnostic breadcrumb, which is a
 *     developer-facing greppable reason for the D3 tightening and is
 *     deliberately separate from user copy;
 *   - WHO may write. The gate is byte-identical; only its sentence changed.
 *
 * ⭐ Why `record_write_denied` and not `record_access_denied`, quoted from the
 * catalog's own header because it is the reason this key exists:
 *
 *   > the sharing middleware's by-id write gate fires on a row the READ path
 *   > already admitted — the user is typically looking at the record it
 *   > refuses — so "You do not have access to this record" would be false the
 *   > moment it rendered. The situation is read-yes/write-no.
 *
 * The read-yes half is measured here too (§4), so the claim is a fact about
 * this fixture rather than a quotation about it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  assertEngineFindOnePredicate,
} from '@objectstack/objectql';
import { SharingService } from './sharing-service.js';
import { buildSharingMiddleware } from './sharing-plugin.js';

// ── the reported fixture ────────────────────────────────────────────────────

/**
 * The reporter's object, restated: `public_read` OWD (everyone reads, the owner
 * writes) plus an `owner_id` column, so record sharing really enforces and
 * `checkEdit` / `checkDelete` can answer `deny`.
 *
 * `access: { default: 'private' }` is carried for fidelity to the report; it is
 * `plugin-security`'s object-CRUD axis and this middleware never reads it. The
 * user's allowRead + allowEdit live on that same axis — they are what makes the
 * READ succeed and the WRITE reach this gate at all.
 */
const INQUIRY_SCHEMA = {
  name: 'os_inquiry',
  sharingModel: 'public_read',
  access: { default: 'private' },
  fields: {
    id: { name: 'id' },
    subject: { name: 'subject' },
    owner_id: { name: 'owner_id' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

const SCHEMAS: Record<string, any> = { os_inquiry: INQUIRY_SCHEMA };

const U_OWNER = 'u_owner';
/** The reporting deployment's user: allowRead + allowEdit, no modifyAllRecords. */
const U_AGENT = 'u_agent';

/** The row the report PATCHes: owned by someone else. */
const INQUIRY_THEIRS = {
  id: 'inq_theirs', subject: 'shipping delay',
  owner_id: U_OWNER, created_by: U_OWNER, organization_id: 'org1',
};
/** The agent's own row — the positive control ownership must keep admitting. */
const INQUIRY_MINE = {
  id: 'inq_mine', subject: 'refund',
  owner_id: U_AGENT, created_by: U_AGENT, organization_id: 'org1',
};

// ── in-memory engine ────────────────────────────────────────────────────────

/**
 * Both write verbs open with the PRODUCER's own dispatch predicate
 * (#4550 / #5480), never a hand-mirrored guard: a double looser than the engine
 * it replaces converts a green suite into no suite at all.
 */
function makeEngine() {
  const tables: Record<string, any[]> = {
    os_inquiry: [{ ...INQUIRY_THEIRS }, { ...INQUIRY_MINE }],
    sys_record_share: [],
  };
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    if (Array.isArray(filter.$or) && !filter.$or.some((f: any) => matches(row, f))) return false;
    if (Array.isArray(filter.$and) && !filter.$and.every((f: any) => matches(row, f))) return false;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or' || k === '$and') continue;
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
  return {
    _tables: tables,
    getSchema: (name: string) => SCHEMAS[name],
    async find(object: string, options: any = {}) {
      const rows = (tables[object] ??= []);
      return rows.filter((r) => matches(r, options.filter ?? options.where)).slice(0, options.limit ?? 1000);
    },
    async findOne(object: string, options: any = {}) {
      assertEngineFindOnePredicate(object, options);
      const rows = await this.find(object, { ...options, limit: 1 });
      return rows[0] ?? null;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      tables[object] = rows.filter((r) => !targets.includes(r));
      return dispatch.kind === 'by-id' ? targets.length > 0 : targets.length;
    },
  };
}

// ── the stack ───────────────────────────────────────────────────────────────

interface WriteOutcome {
  ok: boolean;
  /** ADR-0112 envelope of the refusal — asserted, never a bare `toThrow()`. */
  code?: string;
  status?: number;
  message: string;
  developerMessage?: string;
  details?: any;
}

function makeStack(messageTranslator?: () => any) {
  const engine = makeEngine();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const sharing = new SharingService({ engine: engine as any, logger });
  const mw = buildSharingMiddleware(sharing, logger, messageTranslator) as any;

  return {
    engine,
    logger,
    rows: (object: string) => (engine._tables[object] ??= []),
    /** Drive a by-id write through the middleware and report its ENVELOPE. */
    async write(
      operation: 'update' | 'delete',
      recordId: string,
      context: any,
    ): Promise<WriteOutcome> {
      const opCtx: any = {
        object: 'os_inquiry',
        operation,
        context: { ...context },
        ...(operation === 'update'
          ? { data: { id: recordId, subject: 'edited' } }
          : { options: { where: { id: recordId } } }),
      };
      let reached = false;
      try {
        await mw(opCtx, async () => {
          if (operation === 'delete') await engine.delete(opCtx.object, opCtx.options);
          else await engine.update(opCtx.object, opCtx.data, opCtx.options);
          reached = true;
        });
      } catch (e: any) {
        return {
          ok: false,
          code: e?.code,
          status: e?.status,
          message: String(e?.message ?? e),
          developerMessage: e?.developerMessage,
          details: e?.details,
        };
      }
      return reached
        ? { ok: true, message: 'written' }
        : { ok: false, message: 'middleware swallowed the write' };
    },
    /** The READ half of read-yes/write-no, through the same middleware. */
    async read(context: any) {
      const opCtx: any = { object: 'os_inquiry', operation: 'find', context: { ...context }, ast: {} };
      await mw(opCtx, async () => {});
      return engine.find('os_inquiry', { filter: opCtx.ast?.where ?? opCtx.ast?.filter });
    },
  };
}

/** The execution-context shape `resolveAuthzContext` hands the middleware. */
const ctxFor = (userId: string, locale?: string) => ({
  userId, tenantId: 'org1', positions: ['org_member'], permissions: [],
  ...(locale ? { locale } : {}),
});

/** The reporting deployment: Console and the H5 client both set zh-CN. */
const AGENT_ZH = ctxFor(U_AGENT, 'zh-CN');
const AGENT_EN = ctxFor(U_AGENT, 'en');
const OWNER_ZH = ctxFor(U_OWNER, 'zh-CN');

/**
 * The zh-CN copy a user actually reads, pinned as a LITERAL rather than read
 * back out of the catalog — a test that renders the catalog against itself
 * cannot tell Chinese from English, which is the whole defect. Its twin lives
 * in `packages/spec/src/system/operation-message.test.ts`; the two move
 * together.
 */
const ZH_SENTENCE = '您无权修改或删除这条记录，如需修改请联系该记录的负责人或管理员。';

/** The legacy hardcoded reason, kept as a literal so its ABSENCE is pinned. */
const LEGACY_EN = 'insufficient privileges to';

/** What the REST layer does with an ADR-0111 `CODE: message` throw. */
const WIRE_CODE = (msg: string) => /^FORBIDDEN/.test(msg);
const WIRE_ERROR = (msg: string) => msg.replace(/^[A-Z_]+:\s*/, '');

// ───────────────────────────────────────────────────────────────────────────

describe('[#12260] the by-id write denial renders through the operation catalog', () => {
  let stack: ReturnType<typeof makeStack>;
  beforeEach(() => { stack = makeStack(); });

  // ── §1 the reported symptom ──────────────────────────────────────────────

  it('the report, reproduced: a zh-CN user PATCHing a row they do not own reads Chinese', async () => {
    const out = await stack.write('update', INQUIRY_THEIRS.id, AGENT_ZH);

    expect(out.ok, 'the gate must still refuse — this card moves copy, not authority').toBe(false);
    expect(out.message).toBe(`FORBIDDEN: ${ZH_SENTENCE}`);
    // The half a client shows its end user carries no Latin prose. Before this
    // conversion it was an entire English sentence naming an API name and a row id.
    expect(WIRE_ERROR(out.message)).toBe(ZH_SENTENCE);
    expect(WIRE_ERROR(out.message)).not.toMatch(/[A-Za-z]/);
  });

  it('the DELETE verb reads the same sentence — one key serves both write verbs', async () => {
    const out = await stack.write('delete', INQUIRY_THEIRS.id, AGENT_ZH);

    expect(out.ok).toBe(false);
    expect(out.message).toBe(`FORBIDDEN: ${ZH_SENTENCE}`);
    expect(WIRE_ERROR(out.message)).not.toMatch(/[A-Za-z]/);
    expect(stack.rows('os_inquiry').map((r) => r.id), 'the row survives').toContain(INQUIRY_THEIRS.id);
  });

  it('no longer emits the legacy hardcoded English reason, on either verb', async () => {
    for (const verb of ['update', 'delete'] as const) {
      const out = await stack.write(verb, INQUIRY_THEIRS.id, AGENT_EN);
      expect(out.message, verb).not.toContain(LEGACY_EN);
      expect(out.message, verb).not.toContain(INQUIRY_THEIRS.id);
      expect(out.message, verb).not.toContain('os_inquiry');
    }
  });

  // ── §2 the wire contract the sentence must not shadow ────────────────────

  it('the `FORBIDDEN:` prefix survives the conversion and still strips clean', async () => {
    const out = await stack.write('update', INQUIRY_THEIRS.id, AGENT_ZH);

    // The prefix is wire contract, not copy. `FORBIDDEN: 您无权…` still matches
    // the ADR-0111 prefix idiom, and stripping it leaves the sentence alone —
    // no second prefix, no residue.
    expect(WIRE_CODE(out.message)).toBe(true);
    expect(WIRE_ERROR(out.message).startsWith('FORBIDDEN')).toBe(false);
    expect(WIRE_ERROR(out.message)).toBe(ZH_SENTENCE);
  });

  it('the ADR-0112 envelope is unchanged — REST still answers 403 FORBIDDEN', async () => {
    for (const verb of ['update', 'delete'] as const) {
      const out = await stack.write(verb, INQUIRY_THEIRS.id, AGENT_ZH);
      expect(out.code, `${verb}: ADR-0112 error code`).toBe('FORBIDDEN');
      expect(out.status, `${verb}: ADR-0112 HTTP status`).toBe(403);
    }
  });

  // ── §3 the catalog mechanism ─────────────────────────────────────────────

  it('renders each platform locale from the catalog, not one hardcoded sentence', async () => {
    for (const locale of ['en', 'ja-JP', 'es-ES'] as const) {
      const out = await stack.write('update', INQUIRY_THEIRS.id, ctxFor(U_AGENT, locale));
      expect(WIRE_ERROR(out.message), locale)
        .toBe(BUILTIN_OPERATION_MESSAGES[locale].record_write_denied);
    }
  });

  it('an unknown locale falls back to English rather than to the bare key', async () => {
    const out = await stack.write('update', INQUIRY_THEIRS.id, ctxFor(U_AGENT, 'kl-GL'));
    expect(WIRE_ERROR(out.message)).toBe(BUILTIN_OPERATION_MESSAGES.en.record_write_denied);
    expect(WIRE_ERROR(out.message)).not.toBe('record_write_denied');
  });

  it('a context carrying NO locale still renders English copy, not the old sentence', async () => {
    const out = await stack.write('update', INQUIRY_THEIRS.id, ctxFor(U_AGENT));
    expect(WIRE_ERROR(out.message)).toBe(BUILTIN_OPERATION_MESSAGES.en.record_write_denied);
  });

  it('a deployment `translation` for `errors.record_write_denied` wins', async () => {
    const seen: string[] = [];
    const s = makeStack(() => (key: string, locale: string) => {
      seen.push(`${key}@${locale}`);
      return key === 'errors.record_write_denied' && locale === 'zh-CN'
        ? '这条工单不归你负责,请联系负责人。'
        : key; // II18nService echoes the key back on a miss.
    });

    const out = await s.write('update', INQUIRY_THEIRS.id, AGENT_ZH);
    expect(seen).toContain('errors.record_write_denied@zh-CN');
    expect(WIRE_ERROR(out.message)).toBe('这条工单不归你负责,请联系负责人。');
    expect(out.status, 'still a refusal, still 403').toBe(403);
  });

  it('a misbehaving i18n service degrades to the built-in copy, never to a 500', async () => {
    const s = makeStack(() => { throw new Error('i18n exploded'); });
    const out = await s.write('update', INQUIRY_THEIRS.id, AGENT_ZH);

    // Still the refusal, still 403-shaped — not the i18n service's error.
    expect(out.message).toBe(`FORBIDDEN: ${ZH_SENTENCE}`);
    expect(out.code).toBe('FORBIDDEN');
    expect(out.status).toBe(403);
  });

  // ── §4 the developer's half, and read-yes/write-no ───────────────────────

  it('the developer facts move to `developerMessage`, `details` and the log', async () => {
    const out = await stack.write('update', INQUIRY_THEIRS.id, AGENT_ZH);

    // Everything the sentence deliberately does not name is still legible —
    // just nowhere a user can read it.
    expect(out.developerMessage).toContain('os_inquiry');
    expect(out.developerMessage).toContain(INQUIRY_THEIRS.id);
    expect(out.developerMessage).toContain('update');
    expect(out.details).toMatchObject({
      operation: 'update', object: 'os_inquiry', recordId: INQUIRY_THEIRS.id,
    });
    expect(stack.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('update denied on os_inquiry'),
      expect.objectContaining({ operation: 'update', object: 'os_inquiry', userId: U_AGENT }),
    );
  });

  it('the ADR-0111 D10 delete breadcrumb still fires, in its own words', async () => {
    await stack.write('delete', INQUIRY_THEIRS.id, AGENT_ZH);

    // The D3 tightening's greppable reason is developer copy and is deliberately
    // separate from the user's sentence — it must survive this conversion intact.
    expect(stack.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('an edit-level share does not grant delete'),
      expect.anything(),
    );
  });

  it('read-yes/write-no: the same user reads the very row the write refuses', async () => {
    // This is why the key is `record_write_denied` and not `record_access_denied`
    // — "You do not have access to this record" would be false the moment it
    // rendered, because the user is looking at the record.
    const visible = await stack.read(AGENT_ZH);
    expect(visible.map((r: any) => r.id)).toContain(INQUIRY_THEIRS.id);

    const out = await stack.write('update', INQUIRY_THEIRS.id, AGENT_ZH);
    expect(out.ok).toBe(false);
  });

  // ── §5 WHO may write is unchanged (the permission boundary) ──────────────

  it('the owner still updates their own row', async () => {
    const out = await stack.write('update', INQUIRY_MINE.id, ctxFor(U_AGENT, 'zh-CN'));
    expect(out, out.message).toMatchObject({ ok: true });
    expect(stack.rows('os_inquiry').find((r) => r.id === INQUIRY_MINE.id)?.subject).toBe('edited');
  });

  it('the owner still deletes their own row', async () => {
    const out = await stack.write('delete', INQUIRY_MINE.id, ctxFor(U_AGENT, 'zh-CN'));
    expect(out, out.message).toMatchObject({ ok: true });
    expect(stack.rows('os_inquiry').map((r) => r.id)).not.toContain(INQUIRY_MINE.id);
  });

  it("a non-owner is still refused on the OWNER's row, and the row is untouched", async () => {
    const out = await stack.write('update', INQUIRY_MINE.id, OWNER_ZH);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(stack.rows('os_inquiry').find((r) => r.id === INQUIRY_MINE.id)?.subject).toBe('refund');
  });
});

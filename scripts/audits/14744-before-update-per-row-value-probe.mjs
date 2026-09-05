// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14744] Census instrument B — the RUNTIME behavioural probe, and the
 * cross-check on instrument A's static predicate.
 *
 * Instrument A reasons about handler source. This one runs the REAL engine
 * (`packages/objectql/src/engine.ts`) against a stub driver, dispatches REAL
 * production handlers per row of a genuine `multi: true` update, and reads what
 * actually reaches `driver.updateMany` — the one `SET` clause ADR-0058
 * Addendum II D3 gives N rows. Where a subject is a replica rather than the
 * shipped handler it says so in its own `real` flag; the replica convention
 * (and the audit stamp as the thing replicated) is the pin suite's own —
 * `multi-update-hook-key-divergence.test.ts` §3 uses `perRowClockStamp()`
 * rather than booting the plugin.
 *
 * ## How a subject is classified, and why it takes TWO scenarios
 *
 * Each subject runs twice over two rows:
 *
 *   - **divergent** — the rows DISAGREE on the pre-image field the handler
 *     reads;
 *   - **uniform**  — the rows AGREE on it.
 *
 * Two scenarios are needed because one cannot separate the residue from the
 * clock. A single divergent run showing "same keys, different values" is
 * equally consistent with (a) a value derived from the row's pre-image — the
 * residue — and (b) a value that simply differs every time it is computed, like
 * `sys_stamp_audit_update`'s `updated_at`. The uniform run settles it: with the
 * pre-images equal, any remaining value difference is NOT attributable to the
 * row, and the subject is nondeterministic rather than row-derived. That is the
 * same discrimination #14099 made when it rejected a value comparison twice,
 * arrived at from the other side.
 *
 *   INSTANCE            divergent: same key set, values differ
 *                       AND uniform: values agree            ⇒ the residue
 *   NONDETERMINISTIC    uniform: values differ               ⇒ the clock class
 *   CAUGHT_BY_14099     divergent: key sets differ           ⇒ already refused
 *   ROW_INVARIANT       divergent: same keys, same values
 *   NOT_A_PAYLOAD_WRITER
 *
 * ## The candidate guard, measured rather than modelled
 *
 * The instrument #14744 asks about — "refuse when a per-row dispatch READS the
 * pre-image and WRITES the payload" — is evaluated here as an OBSERVER, never
 * as an enforcement: each dispatch gets a read-recording `Proxy` over its
 * context, so a `ctx.previous` / `ctx.input.id` read is recorded as it happens,
 * and the payload is diffed around the call. `guardWouldFire` is therefore a
 * measured property of the shipped handler's execution, not a reading of its
 * source. ⛔ Nothing here is registered on, or changes, the engine's behaviour:
 * the guard is not implemented, per the card's terminal scope.
 */

import { writeFileSync } from 'node:fs';
import { ObjectQL } from '../../packages/objectql/src/engine.ts';
import { MultiUpdateHookKeyDivergenceError } from '../../packages/objectql/src/multi-update-hook-key-divergence.ts';
import { bindEmailTemplateProvenanceStamp } from '../../packages/plugins/plugin-email/src/email-template-provenance.ts';
import { bindRuleProvenanceStamp } from '../../packages/plugins/plugin-sharing/src/sharing-rule-provenance.ts';
import { bindWebhookProvenanceStamp } from '../../packages/plugins/plugin-webhooks/src/webhook-provenance.ts';
import taskHookImported from '../../examples/app-todo/src/objects/task.hook.ts';
// tsx's interop can hand back the module namespace rather than the default
// binding; resolve it by SHAPE so the probe fails loudly if neither carries a
// handler, instead of dispatching nothing and scoring the hook as clean.
const taskHook = typeof taskHookImported?.handler === 'function'
  ? taskHookImported
  : typeof taskHookImported?.default?.handler === 'function' ? taskHookImported.default : null;
if (!taskHook) throw new Error('probe: could not resolve examples/app-todo task hook handler');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const field = (name) => ({ name, label: name, type: 'text' });

function makeStubDriver() {
  const store = new Map();
  const matches = (row, where) => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && Array.isArray(v.$in)) {
        if (!v.$in.some((x) => x === row[k])) return false;
        continue;
      }
      const expected = v && typeof v === 'object' && '$eq' in v ? v.$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const d = {
    name: 'memory', version: '0.0.0', supports: {}, store,
    updateCalls: 0, updateManyPayloads: [],
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(_o, ast, opts) {
      const rows = [...store.values()].filter((r) => matches(r, ast?.where));
      const limit = typeof ast?.limit === 'number' ? ast.limit
        : typeof opts?.limit === 'number' ? opts.limit : undefined;
      return typeof limit === 'number' ? rows.slice(0, limit) : rows;
    },
    async findOne(_o, ast) { for (const r of store.values()) if (matches(r, ast?.where)) return r; return null; },
    async create(_o, data) { const id = data.id ?? `r_${store.size + 1}`; const row = { ...data, id }; store.set(id, row); return row; },
    async update(_o, id, data) { d.updateCalls += 1; const cur = store.get(id); if (!cur) return null; const u = { ...cur, ...data, id }; store.set(id, u); return u; },
    async updateMany(_o, ast, data) {
      d.updateManyPayloads.push({ ...data });
      const rows = [...store.values()].filter((r) => matches(r, ast?.where));
      for (const r of rows) store.set(r.id, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async delete(_o, id) { return store.delete(id); },
    async deleteMany(_o, ast) { const rows = [...store.values()].filter((r) => matches(r, ast?.where)); for (const r of rows) store.delete(r.id); return rows.length; },
    async count() { return store.size; },
    async bulkCreate(_o, rows) { return Promise.all(rows.map((r) => d.create(_o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async upsert(_o, data) { return d.create(_o, data); },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return d;
}

/**
 * Wrap a handler so each per-row dispatch reports what it READ (pre-image) and
 * what it WROTE (payload keys and values), without altering either.
 */
function observed(handler, log) {
  return async (ctx) => {
    const rec = { preImageRead: new Set(), assigned: {} };
    const data = ctx?.input?.data;
    const proxy = new Proxy(ctx, {
      get(t, p) {
        if (p === 'previous' || p === 'previousRecord' || p === 'record') {
          if (t[p] !== undefined) rec.preImageRead.add(`ctx.${String(p)}`);
          return t[p];
        }
        if (p === 'input') {
          const input = t[p];
          if (!input || typeof input !== 'object') return input;
          return new Proxy(input, {
            get(it, ip) {
              if (ip === 'id' || ip === 'ids') { if (it[ip] !== undefined) rec.preImageRead.add(`ctx.input.${String(ip)}`); }
              // ⚠️ The payload is handed back behind a WRITE-RECORDING proxy, and
              // what it records is ASSIGNMENT, not value change. Recording a
              // change instead is a measurement artifact that silently rewrites
              // the verdict: the payload is ONE object shared by every row's
              // dispatch (D3), so the second row assigning the SAME value it
              // found there produces no diff, and a change-based observer scores
              // that row as "wrote nothing" — turning a row-invariant handler
              // into a fabricated key-set divergence. Measured here on the
              // pinyin replica before the fix. Assignment is also exactly what
              // #14099's own recorder counts ("the set of payload keys the hook
              // chain assigned"), so this keeps the two instruments comparable.
              if (ip === 'data' && it[ip] && typeof it[ip] === 'object') {
                const real = it[ip];
                return new Proxy(real, {
                  set(dt, dp, dv) { rec.assigned[String(dp)] = dv; dt[dp] = dv; return true; },
                  deleteProperty(dt, dp) { rec.assigned[String(dp)] = '(deleted)'; delete dt[dp]; return true; },
                  defineProperty(dt, dp, desc) {
                    if ('value' in desc) rec.assigned[String(dp)] = desc.value;
                    Object.defineProperty(dt, dp, desc); return true;
                  },
                });
              }
              return it[ip];
            },
            set(it, ip, v) { it[ip] = v; return true; },
          });
        }
        return t[p];
      },
    });
    try {
      await handler(proxy);
    } finally {
      log.push({
        rowId: ctx?.input?.id ?? null,
        preImageRead: [...rec.preImageRead],
        writtenKeys: Object.keys(rec.assigned).sort(),
        writtenValues: rec.assigned,
        payloadAfter: data && typeof data === 'object' ? { ...data } : null,
      });
    }
  };
}

async function runScenario(subject, scenario) {
  const engine = new ObjectQL();
  const driver = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: subject.object, label: subject.object,
    fields: Object.fromEntries([['id', { ...field('id'), primaryKey: true }],
      ...subject.fields.map((f) => [f, field(f)])]),
  });

  const log = [];
  // A stub of the MinimalEngine face the provenance binders expect, forwarding
  // registration to the real engine with the observer in between.
  const bindTarget = {
    registerHook: (event, handler, options) => engine.registerHook(event, observed(handler, log), options),
    unregisterHooksByPackage: (pkg) => engine.unregisterHooksByPackage?.(pkg) ?? 0,
    find: async (object, opts) => driver.find(object, opts, opts),
    update: async () => ({}),
    registry: engine.registry,
  };
  subject.bind(bindTarget, engine, log);

  await engine.insert(subject.object, scenario.rows);
  driver.updateManyPayloads.length = 0;
  log.length = 0;

  let refusedWith = null;
  try {
    await engine.update(subject.object, { ...subject.payload }, {
      multi: true, where: { id: { $in: scenario.rows.map((r) => r.id) } },
    });
  } catch (err) {
    // ⚠️ Read the envelope by FIELD, not only through `instanceof`. Under tsx
    // this probe's import of the divergence module and the engine's own can be
    // two module instances, so `instanceof` is false against a genuine refusal;
    // the ADR-0112 `code` is the identity that survives that, which is exactly
    // the reason the code is a registered one (see the module's own note).
    refusedWith = {
      code: err?.code ?? null, status: err?.status ?? null,
      keys: err?.keys ?? null, object: err?.object ?? null, rows: err?.rows ?? null,
      name: err?.name, instanceofModule: err instanceof MultiUpdateHookKeyDivergenceError,
      message: String(err?.message ?? err).slice(0, 200),
    };
  }
  return {
    refusedWith,
    dispatches: log,
    updateManyPayloads: driver.updateManyPayloads.map((p) => ({ ...p })),
    stored: [...driver.store.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

const sameKeys = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const valuesAgree = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function classify(divergent, uniform) {
  const writers = (r) => r.dispatches.filter((d) => d.writtenKeys.length > 0);
  const guardFires = [...divergent.dispatches, ...uniform.dispatches]
    .some((d) => d.preImageRead.length > 0 && d.writtenKeys.length > 0);

  if (divergent.refusedWith?.code === 'MULTI_UPDATE_HOOK_KEY_DIVERGENCE') {
    return { verdict: 'CAUGHT_BY_14099', guardFires };
  }
  const dWriters = writers(divergent);
  if (dWriters.length === 0) return { verdict: 'NOT_A_PAYLOAD_WRITER', guardFires };

  const uWriters = writers(uniform);
  if (uWriters.length >= 2 && sameKeys(uWriters[0].writtenKeys, uWriters[1].writtenKeys)
      && !valuesAgree(uWriters[0].writtenValues, uWriters[1].writtenValues)) {
    return { verdict: 'NONDETERMINISTIC', guardFires };
  }
  if (dWriters.length >= 2) {
    if (!sameKeys(dWriters[0].writtenKeys, dWriters[1].writtenKeys)) {
      return { verdict: 'KEY_SET_DIVERGENCE_UNREFUSED', guardFires };
    }
    if (!valuesAgree(dWriters[0].writtenValues, dWriters[1].writtenValues)) {
      return { verdict: 'INSTANCE', guardFires };
    }
  }
  if (dWriters.length === 1 && divergent.dispatches.length > 1) {
    return { verdict: 'CAUGHT_BY_14099', guardFires };
  }
  return { verdict: 'ROW_INVARIANT', guardFires };
}

/* ── Subjects ───────────────────────────────────────────────────────────── */

const SUBJECTS = [
  {
    id: 'POSITIVE-CONTROL: the card\'s pinned residue',
    real: false, note: 'The exact handler pinned in multi-update-hook-key-divergence.test.ts §4.',
    object: 'task', fields: ['status', 'priority', 'title'],
    payload: { title: 'renamed' },
    bind: (t) => t.registerHook('beforeUpdate', (ctx) => {
      const prev = ctx.previous;
      ctx.input.data.priority = prev?.status === 'blocked' ? 'high' : 'low';
    }, {}),
    divergent: [{ id: 'a', status: 'blocked', priority: 'x', title: 't' }, { id: 'b', status: 'todo', priority: 'x', title: 't' }],
    uniform: [{ id: 'a', status: 'todo', priority: 'x', title: 't' }, { id: 'b', status: 'todo', priority: 'x', title: 't' }],
  },
  {
    id: 'REPLICA: sys_stamp_audit_update (clock inside the per-record stamp)',
    real: false, note: 'Shape of objectql plugin.ts:1137, replicated as the pin suite §3 does.',
    object: 'task', fields: ['status', 'updated_at', 'title'],
    payload: { title: 'renamed' },
    bind: (t) => { let tick = 0; t.registerHook('beforeUpdate', (ctx) => {
      tick += 1;
      ctx.input.data.updated_at = `2026-09-04T10:00:00.00${tick}Z`;
    }, {}); },
    divergent: [{ id: 'a', status: 'blocked', updated_at: 'old', title: 't' }, { id: 'b', status: 'todo', updated_at: 'old', title: 't' }],
    uniform: [{ id: 'a', status: 'todo', updated_at: 'old', title: 't' }, { id: 'b', status: 'todo', updated_at: 'old', title: 't' }],
  },
  {
    id: 'REAL: examples/app-todo task_logic',
    real: true, note: 'The shipped example hook, imported and dispatched unmodified.',
    object: 'todo_task', fields: ['status', 'completed_date', 'subject', 'priority'],
    payload: { status: 'completed' },
    bind: (t) => t.registerHook('beforeUpdate', (ctx) => taskHook.handler(ctx), {}),
    divergent: [{ id: 'a', status: 'in_progress', completed_date: null, subject: 's', priority: 'normal' },
                { id: 'b', status: 'completed', completed_date: '2026-01-01', subject: 's', priority: 'normal' }],
    uniform: [{ id: 'a', status: 'in_progress', completed_date: null, subject: 's', priority: 'normal' },
              { id: 'b', status: 'in_progress', completed_date: null, subject: 's', priority: 'normal' }],
  },
  {
    id: 'REAL: plugin-email template provenance stamp',
    real: true, note: 'bindEmailTemplateProvenanceStamp, unmodified.',
    object: 'sys_email_template', fields: ['managed_by', 'customized', 'subject'],
    payload: { subject: 'edited' },
    bind: (t) => bindEmailTemplateProvenanceStamp(t, silentLogger, 'sys_email_template'),
    divergent: [{ id: 'a', managed_by: 'package', customized: false, subject: 's' },
                { id: 'b', managed_by: 'user', customized: false, subject: 's' }],
    uniform: [{ id: 'a', managed_by: 'package', customized: false, subject: 's' },
              { id: 'b', managed_by: 'package', customized: false, subject: 's' }],
  },
  {
    id: 'REAL: plugin-sharing rule provenance stamp',
    real: true, note: 'bindRuleProvenanceStamp, unmodified.',
    object: 'sys_sharing_rule', fields: ['managed_by', 'customized', 'label'],
    payload: { label: 'edited' },
    bind: (t) => bindRuleProvenanceStamp(t, silentLogger),
    divergent: [{ id: 'a', managed_by: 'package', customized: false, label: 'l' },
                { id: 'b', managed_by: 'user', customized: false, label: 'l' }],
    uniform: [{ id: 'a', managed_by: 'package', customized: false, label: 'l' },
              { id: 'b', managed_by: 'package', customized: false, label: 'l' }],
  },
  {
    id: 'REAL: plugin-webhooks provenance stamp',
    real: true, note: 'bindWebhookProvenanceStamp, unmodified.',
    object: 'sys_webhook', fields: ['managed_by', 'customized', 'label'],
    payload: { label: 'edited' },
    bind: (t) => bindWebhookProvenanceStamp(t, silentLogger),
    divergent: [{ id: 'a', managed_by: 'package', customized: false, label: 'l' },
                { id: 'b', managed_by: 'user', customized: false, label: 'l' }],
    uniform: [{ id: 'a', managed_by: 'package', customized: false, label: 'l' },
              { id: 'b', managed_by: 'package', customized: false, label: 'l' }],
  },
  {
    id: 'REPLICA: pinyin companion projection (value from the PAYLOAD)',
    real: false, note: 'Shape of plugin-pinyin-search companion-projection.ts:97.',
    object: 'task', fields: ['title', '__search'],
    payload: { title: 'Zhang San' },
    bind: (t) => t.registerHook('beforeUpdate', (ctx) => {
      const data = ctx.input.data;
      if ('title' in data) data.__search = String(data.title).toLowerCase();
    }, {}),
    divergent: [{ id: 'a', title: 'A', __search: 'a' }, { id: 'b', title: 'B', __search: 'b' }],
    uniform: [{ id: 'a', title: 'A', __search: 'a' }, { id: 'b', title: 'A', __search: 'a' }],
  },
  {
    id: 'NEGATIVE-CONTROL: reads the pre-image, never writes',
    real: false, note: 'A pure guard — the guard predicate must NOT fire on it.',
    object: 'task', fields: ['status', 'title'],
    payload: { title: 'renamed' },
    bind: (t) => t.registerHook('beforeUpdate', (ctx) => { void ctx.previous?.status; }, {}),
    divergent: [{ id: 'a', status: 'blocked', title: 't' }, { id: 'b', status: 'todo', title: 't' }],
    uniform: [{ id: 'a', status: 'todo', title: 't' }, { id: 'b', status: 'todo', title: 't' }],
  },
];

const results = [];
for (const s of SUBJECTS) {
  let divergent, uniform, error = null;
  try {
    divergent = await runScenario(s, { rows: s.divergent });
    uniform = await runScenario(s, { rows: s.uniform });
  } catch (err) {
    error = String(err?.stack ?? err).slice(0, 400);
  }
  const cls = error ? { verdict: 'NOT_EVALUABLE', guardFires: null } : classify(divergent, uniform);
  results.push({ subject: s.id, real: s.real, note: s.note, ...cls, error, divergent, uniform });
}

const out = {
  generatedAt: new Date().toISOString(),
  base: process.env.CENSUS_BASE ?? null,
  verdicts: Object.fromEntries(results.map((r) => [r.subject, { verdict: r.verdict, guardFires: r.guardFires }])),
  instanceCount: results.filter((r) => r.verdict === 'INSTANCE').length,
  guardFiresCount: results.filter((r) => r.guardFires).length,
  results,
};
// ⚠️ The engine and the registry both log to stdout on boot, so the report is
// written to a file rather than piped: a JSON document interleaved with engine
// INFO lines parses as nothing, and a caller reading exit codes would never
// notice. `--out` is required for that reason.
const outIdx = process.argv.indexOf('--out');
if (outIdx === -1 || !process.argv[outIdx + 1]) {
  console.error('usage: tsx 14744-before-update-per-row-value-probe.mjs --out <path.json>');
  process.exit(2);
}
writeFileSync(process.argv[outIdx + 1], JSON.stringify(out, null, 2));
console.error(`probe: ${results.length} subjects · INSTANCE=${out.instanceCount} · guardFires=${out.guardFiresCount} · written to ${process.argv[outIdx + 1]}`);

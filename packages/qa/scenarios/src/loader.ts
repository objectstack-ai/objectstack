// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Scenario loader — reads every card in a directory, validates it, computes
 * each question's truth, and REFUSES loudly with the file and the field path.
 *
 * Two passes, one refusal shape:
 *   1. the zod schema (`schema.ts`) — is each field well-formed?
 *   2. the semantic pass below — do the fields agree with each other and with
 *      the tree? (a lookup names a listed object; a question reads a field a
 *      seed row carries; a capability area is a checklist area; …)
 *
 * One judgement needs the whole directory: an app `code` is unique across the
 * library, because each card's app gets a namespace of its own (`demo` + code,
 * `scenarioNamespace` in `schema.ts`). So {@link loadScenarios} refuses every card that
 * shares a code; {@link loadScenarioFile}, handed one file, cannot judge it.
 *
 * A card with any refusal is not returned at all: a half-valid card would let
 * a runner score against a scenario that does not mean what it says.
 *
 * Nothing here calls a model, the network, or anything outside the two
 * directories it is handed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  AppCodeSchema,
  GUARDRAIL_CHECKS,
  ScenarioCardSchema,
  type ScenarioCard,
  type ScenarioExpect,
  type SeedRow,
} from './schema.js';
import { evaluateTruth, TruthError, type Truth } from './truth.js';

export type IssuePath = ReadonlyArray<string | number>;

/** One located refusal. */
export interface Refusal {
  /** The card file, as handed to the loader. */
  file: string;
  /** The field path inside the card, e.g. `run.questions[2].truth.kind`. */
  path: string;
  message: string;
}

export interface LoadedScenario {
  file: string;
  card: ScenarioCard;
  /** Question id → its computed truth over every row. */
  truths: Record<string, Truth>;
  /** Question id → persona id → the truth AS that persona, for questions that list personas. */
  personaTruths: Record<string, Record<string, Truth>>;
}

export interface LoadResult {
  cards: LoadedScenario[];
  refusals: Refusal[];
}

export interface LoadOptions {
  /** The closed set of capability areas; see {@link readCapabilityAreas}. */
  areas: ReadonlySet<string>;
}

/** `['run', 'questions', 2, 'truth']` → `run.questions[2].truth`. */
export function formatPath(path: IssuePath): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out === '' ? seg : `.${seg}`;
  }
  return out === '' ? '(card)' : out;
}

export function formatRefusal(r: Refusal): string {
  return `${r.file}: ${r.path}: ${r.message}`;
}

/**
 * The capability-area closed set: the basenames of
 * `docs/qa/platform-checklist/areas/*.json`, read from the tree.
 */
export function readCapabilityAreas(areasDir: string): Set<string> {
  const areas = new Set<string>();
  for (const name of readdirSync(areasDir)) {
    if (name.endsWith('.json')) areas.add(name.slice(0, -'.json'.length));
  }
  if (areas.size === 0) {
    throw new Error(`no capability areas under ${areasDir}: the closed set would refuse every card`);
  }
  return areas;
}

/** Load every `*.json` card in `dir` (non-recursive; other files are ignored). */
export function loadScenarios(dir: string, options: LoadOptions): LoadResult {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(dir, name));
  const loaded = files.map((file) => ({ file, ...loadOne(file, options) }));

  // ── app codes: one card per code across the library ──
  // A card refused for another fault still holds its code, so the clash is
  // named now rather than after the other fault is fixed.
  const holders = new Map<string, string[]>();
  for (const one of loaded) if (one.code !== undefined) holders.set(one.code, [...(holders.get(one.code) ?? []), one.file]);

  const result: LoadResult = { cards: [], refusals: [] };
  for (const one of loaded) {
    const others = one.code === undefined ? [] : holders.get(one.code)!.filter((f) => f !== one.file);
    if (others.length > 0) {
      one.refusals.push({
        file: one.file,
        path: 'code',
        message: `duplicate app code \`${one.code}\`, also the code of ${others.map((f) => basename(f)).join(', ')}: each card's app needs a namespace of its own`,
      });
    } else if (one.card) {
      result.cards.push(one.card);
    }
    result.refusals.push(...one.refusals);
  }
  return result;
}

/** Load one card file. Code uniqueness is a library judgement: see {@link loadScenarios}. */
export function loadScenarioFile(
  file: string,
  options: LoadOptions,
): { card?: LoadedScenario; refusals: Refusal[] } {
  const { card, refusals } = loadOne(file, options);
  return card ? { card, refusals } : { refusals };
}

/** One file, plus its well-formed app code (read even when the card is refused for another fault). */
function loadOne(file: string, options: LoadOptions): { card?: LoadedScenario; refusals: Refusal[]; code?: string } {
  const refusals: Refusal[] = [];
  const refuse = (path: IssuePath, message: string) =>
    refusals.push({ file, path: formatPath(path), message });

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    refuse([], `not valid JSON: ${(e as Error).message}`);
    return { refusals };
  }
  const rawCode = (raw as { code?: unknown } | null)?.code;
  const code = AppCodeSchema.safeParse(rawCode).success ? (rawCode as string) : undefined;

  const parsed = ScenarioCardSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        // Locate each unknown key itself, not just the object holding it.
        for (const key of issue.keys) refuse([...(issue.path as IssuePath), key], `unknown key \`${key}\``);
      } else {
        refuse(issue.path as IssuePath, issue.message);
      }
    }
    return { refusals, ...(code !== undefined ? { code } : {}) };
  }

  const card = parsed.data;
  const computed = checkCard(card, basename(file, '.json'), options, refuse);
  if (refusals.length > 0) return { refusals, code: card.code };
  return { card: { file, card, ...computed }, refusals, code: card.code };
}

type Refuse = (path: IssuePath, message: string) => void;

function duplicates<T>(items: readonly T[], keyOf: (t: T) => string, at: IssuePath, what: string, refuse: Refuse) {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const k = keyOf(item);
    if (seen.has(k)) refuse([...at, i], `duplicate ${what} \`${k}\``);
    seen.add(k);
  });
}

/** The field names an object's seed rows carry (the union across rows). */
function fieldsOf(rows: readonly SeedRow[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const row of rows ?? []) for (const k of Object.keys(row)) out.add(k);
  return out;
}

function checkExpectRefs(
  expect: Pick<ScenarioExpect, 'selectFields' | 'lookups' | 'appNavTargets'>,
  objects: ReadonlySet<string>,
  dashboards: ReadonlySet<string>,
  at: IssuePath,
  refuse: Refuse,
) {
  (expect.selectFields ?? []).forEach((s, i) => {
    if (!objects.has(s.object)) refuse([...at, 'selectFields', i, 'object'], `\`${s.object}\` is not in expect.objects`);
  });
  (expect.lookups ?? []).forEach((l, i) => {
    if (!objects.has(l.object)) refuse([...at, 'lookups', i, 'object'], `\`${l.object}\` is not in expect.objects`);
    if (!objects.has(l.to)) refuse([...at, 'lookups', i, 'to'], `lookup target \`${l.to}\` is not in expect.objects`);
  });
  (expect.appNavTargets ?? []).forEach((t, i) => {
    if (!objects.has(t) && !dashboards.has(t)) {
      refuse([...at, 'appNavTargets', i], `nav target \`${t}\` is neither an expected object nor an expected dashboard (a dangling nav entry)`);
    }
  });
}

function checkCard(
  card: ScenarioCard,
  stem: string,
  options: LoadOptions,
  refuse: Refuse,
): Pick<LoadedScenario, 'truths' | 'personaTruths'> {
  const { expect, run } = card;

  // ── identity ──
  if (card.id !== stem) refuse(['id'], `\`${card.id}\` must equal the file's basename \`${stem}\``);

  // ── expect: internal consistency ──
  const objects = new Set(expect.objects);
  const dashboards = new Set(expect.dashboards ?? []);
  duplicates(expect.objects, (o) => o, ['expect', 'objects'], 'object', refuse);
  duplicates(expect.selectFields ?? [], (s) => `${s.object}.${s.field}`, ['expect', 'selectFields'], 'select field', refuse);
  duplicates(expect.lookups ?? [], (l) => `${l.object}.${l.field}`, ['expect', 'lookups'], 'lookup', refuse);
  checkExpectRefs(expect, objects, dashboards, ['expect'], refuse);

  // ── capabilities: the area half is a closed set read from the tree ──
  duplicates(card.capabilities, (c) => c, ['capabilities'], 'capability', refuse);
  card.capabilities.forEach((tag, i) => {
    const area = tag.slice(0, tag.indexOf('.'));
    if (!options.areas.has(area)) {
      refuse(
        ['capabilities', i],
        `unknown capability area \`${area}\` — the closed set is the docs/qa/platform-checklist/areas/*.json basenames: ${[...options.areas].sort().join(', ')}`,
      );
    }
  });

  // ── seed: every expected object is seeded, and the seed models the shape ──
  const seed = run.seed;
  for (const name of Object.keys(seed)) {
    if (!objects.has(name)) refuse(['run', 'seed', name], `seeded object \`${name}\` is not in expect.objects`);
  }
  for (const name of expect.objects) {
    if (seed[name] === undefined) refuse(['run', 'seed'], `expected object \`${name}\` has no seed rows`);
  }
  const ids = new Map<string, Set<string>>();
  for (const [name, rows] of Object.entries(seed)) {
    const set = new Set<string>();
    rows.forEach((row, i) => {
      if (set.has(row.id)) refuse(['run', 'seed', name, i, 'id'], `duplicate row id \`${row.id}\``);
      set.add(row.id);
    });
    ids.set(name, set);
    const fieldCount = [...fieldsOf(rows)].filter((f) => f !== 'id').length;
    if (expect.minFieldsPerObject !== undefined && objects.has(name) && fieldCount < expect.minFieldsPerObject) {
      refuse(
        ['run', 'seed', name],
        `the seed rows carry ${fieldCount} field(s), fewer than expect.minFieldsPerObject = ${expect.minFieldsPerObject}`,
      );
    }
  }
  const known = (object: string) => fieldsOf(seed[object]);
  (expect.selectFields ?? []).forEach((s, i) => {
    if (seed[s.object] && !known(s.object).has(s.field)) {
      refuse(['expect', 'selectFields', i, 'field'], `no seed row of \`${s.object}\` carries \`${s.field}\``);
    }
  });
  const lookupFields = new Map<string, string>(); // `object.field` → target object
  (expect.lookups ?? []).forEach((l, i) => {
    // A lookup to an unexpected object is refused above; checking every
    // value against it would only repeat that one fault per row.
    if (objects.has(l.to)) lookupFields.set(`${l.object}.${l.field}`, l.to);
    if (seed[l.object] && !known(l.object).has(l.field)) {
      refuse(['expect', 'lookups', i, 'field'], `no seed row of \`${l.object}\` carries \`${l.field}\``);
    }
  });
  // Referential integrity: a lookup value names a seeded row of its target.
  const checkRef = (object: string, field: string, value: unknown, at: IssuePath) => {
    const to = lookupFields.get(`${object}.${field}`);
    if (to === undefined || value === null) return;
    if (typeof value !== 'string' || !(ids.get(to)?.has(value) ?? false)) {
      refuse(at, `lookup \`${object}.${field}\` = ${JSON.stringify(value)} names no seeded \`${to}\` row`);
    }
  };
  for (const [name, rows] of Object.entries(seed)) {
    rows.forEach((row, i) => {
      for (const [field, value] of Object.entries(row)) checkRef(name, field, value, ['run', 'seed', name, i, field]);
    });
  }

  /** Refuses a field no seed row of `object` carries; answers whether it resolved. */
  const checkField = (object: string, field: string, at: IssuePath): boolean => {
    if (seed[object] && !known(object).has(field)) {
      refuse(at, `no seed row of \`${object}\` carries \`${field}\``);
      return false;
    }
    return true;
  };

  // Relation paths: every hop but the last is a lookup declared in
  // `expect.lookups`; the last is a field the reached object's seed carries.
  // Answers the (object, field) pairs the path reads, or null once refused.
  const checkPath = (object: string, path: string, at: IssuePath): Array<[string, string]> | null => {
    const segs = path.split('.');
    const read: Array<[string, string]> = [];
    let cur = object;
    for (const seg of segs.slice(0, -1)) {
      const to = lookupFields.get(`${cur}.${seg}`);
      if (to === undefined) {
        refuse(at, `\`${seg}\` is not a lookup of \`${cur}\` in expect.lookups, so \`${path}\` does not resolve`);
        return null;
      }
      read.push([cur, seg]);
      cur = to;
    }
    const last = segs[segs.length - 1];
    if (!checkField(cur, last, at)) return null;
    read.push([cur, last]);
    return read;
  };
  const rowById = new Map(Object.entries(seed).map(([name, rows]) => [name, new Map(rows.map((r) => [r.id, r]))]));
  const resolverFor = (object: string) => (row: SeedRow, path: string) => {
    let cur = object;
    let r: SeedRow | undefined = row;
    const segs = path.split('.');
    for (const seg of segs.slice(0, -1)) {
      const to = lookupFields.get(`${cur}.${seg}`) as string;
      const id: unknown = r[seg];
      r = typeof id === 'string' ? rowById.get(to)?.get(id) : undefined;
      if (r === undefined) return null;
      cur = to;
    }
    const v = r[segs[segs.length - 1]];
    return v === undefined ? null : v;
  };

  // ── personas: hidden refs and row scope resolve ──
  duplicates(run.personas, (p) => p.id, ['run', 'personas'], 'persona id', refuse);
  const personas = new Set(run.personas.map((p) => p.id));
  const unscoped = new Set<string>(); // personas whose row scope was refused: no per-persona truth from them
  run.personas.forEach((p, i) => {
    (p.hidden.objects ?? []).forEach((o, j) => {
      if (!objects.has(o)) refuse(['run', 'personas', i, 'hidden', 'objects', j], `\`${o}\` is not in expect.objects`);
    });
    (p.hidden.fields ?? []).forEach((f, j) => {
      const at: IssuePath = ['run', 'personas', i, 'hidden', 'fields', j];
      if (!objects.has(f.object)) refuse([...at, 'object'], `\`${f.object}\` is not in expect.objects`);
      else checkField(f.object, f.field, [...at, 'field']);
    });
    (p.scope ?? []).forEach((sc, j) => {
      const at: IssuePath = ['run', 'personas', i, 'scope', j];
      if (!objects.has(sc.object) || seed[sc.object] === undefined) {
        refuse([...at, 'object'], `\`${sc.object}\` is not a seeded expected object`);
        unscoped.add(p.id);
      } else if (checkPath(sc.object, sc.field, [...at, 'field']) === null) unscoped.add(p.id);
    });
  });

  // ── questions: refs resolve, then the truth is computed (and per persona) ──
  const truths: Record<string, Truth> = {};
  const personaTruths: Record<string, Record<string, Truth>> = {};
  duplicates(run.questions, (q) => q.id, ['run', 'questions'], 'question id', refuse);
  run.questions.forEach((q, i) => {
    const at: IssuePath = ['run', 'questions', i];
    const rows = seed[q.object];
    if (!objects.has(q.object) || rows === undefined) {
      refuse([...at, 'object'], `\`${q.object}\` is not a seeded expected object`);
      return;
    }
    const t = q.truth;
    // Evaluate only once every field resolves: a misspelt field would
    // otherwise read as all-null and compute a confident wrong truth.
    const read: Array<[string, string]> = [];
    let ok = true;
    const path = (field: string, p: IssuePath) => {
      const r = checkPath(q.object, field, p);
      if (r) read.push(...r);
      else ok = false;
    };
    if (t.kind !== 'unanswerable') {
      (t.filter ?? []).forEach((f, j) => path(f.field, [...at, 'truth', 'filter', j, 'field']));
      if (t.groupBy !== undefined) path(t.groupBy, [...at, 'truth', 'groupBy']);
      if ('field' in t && t.field !== undefined) path(t.field, [...at, 'truth', 'field']);
      if (t.kind === 'topN' && t.measure && 'field' in t.measure) path(t.measure.field, [...at, 'truth', 'measure', 'field']);
    }
    (q.personas ?? []).forEach((id, j) => {
      if (!personas.has(id)) {
        refuse([...at, 'personas', j], `no persona \`${id}\``);
        ok = false;
      }
    });
    if (!ok) return;
    const ctx = { resolve: resolverFor(q.object), asOf: card.asOf };
    const evaluate = (scoped: readonly SeedRow[], p: IssuePath): Truth | undefined => {
      try {
        return evaluateTruth(t, scoped, ctx);
      } catch (e) {
        if (!(e instanceof TruthError)) throw e;
        refuse([...p, ...e.path], e.message);
        return undefined;
      }
    };
    const all = evaluate(rows, [...at, 'truth']);
    if (all) truths[q.id] = all;
    if (q.personas === undefined) return;
    personaTruths[q.id] = {};
    q.personas.forEach((id, j) => {
      if (unscoped.has(id)) return;
      const p = run.personas.find((x) => x.id === id)!;
      const hiddenFields = new Set((p.hidden.fields ?? []).map((f) => `${f.object}.${f.field}`));
      const hiddenObjects = new Set(p.hidden.objects ?? []);
      const withheld =
        hiddenObjects.has(q.object) || read.some(([o, f]) => hiddenObjects.has(o) || hiddenFields.has(`${o}.${f}`));
      if (withheld && t.kind !== 'unanswerable') {
        personaTruths[q.id][id] = { kind: 'withheld' };
        return;
      }
      const rules = (p.scope ?? []).filter((sc) => sc.object === q.object);
      const scoped = rows.filter((r) => rules.every((sc) => ctx.resolve(r, sc.field) === sc.value));
      const truth = evaluate(scoped, [...at, 'personas', j]);
      if (truth) personaTruths[q.id][id] = truth;
    });
  });

  // ── operations ──
  duplicates(run.operations, (o) => o.id, ['run', 'operations'], 'operation id', refuse);
  const operations = new Map(run.operations.map((o) => [o.id, o]));
  if (!run.operations.some((o) => o.kind === 'create' || o.kind === 'update')) {
    refuse(['run', 'operations'], 'needs at least one create or update through the app');
  }
  run.operations.forEach((op, i) => {
    const at: IssuePath = ['run', 'operations', i];
    if (!objects.has(op.object) || seed[op.object] === undefined) {
      refuse([...at, 'object'], `\`${op.object}\` is not a seeded expected object`);
      return;
    }
    if (op.target !== undefined && !(ids.get(op.object)?.has(op.target) ?? false)) {
      refuse([...at, 'target'], `no seeded \`${op.object}\` row has id \`${op.target}\``);
    }
    for (const [field, value] of Object.entries(op.values ?? {})) {
      checkField(op.object, field, [...at, 'values', field]);
      checkRef(op.object, field, value, [...at, 'values', field]);
    }
    if (!personas.has(op.actingAs)) refuse([...at, 'actingAs'], `no persona \`${op.actingAs}\``);
    const out = op.outcome;
    if (out.kind !== 'applied') return;
    if (out.auditActor !== undefined && !personas.has(out.auditActor)) {
      refuse([...at, 'outcome', 'auditActor'], `no persona \`${out.auditActor}\``);
    }
    out.state.forEach((st, j) => {
      const sat: IssuePath = [...at, 'outcome', 'state', j];
      if (!objects.has(st.object) || seed[st.object] === undefined) {
        refuse([...sat, 'object'], `\`${st.object}\` is not a seeded expected object`);
        return;
      }
      if (st.id !== undefined && !(ids.get(st.object)?.has(st.id) ?? false)) {
        refuse([...sat, 'id'], `no seeded \`${st.object}\` row has id \`${st.id}\` (a created row is matched by \`where\`)`);
      }
      for (const key of ['where', 'values'] as const) {
        for (const field of Object.keys(st[key] ?? {})) checkField(st.object, field, [...sat, key, field]);
      }
    });
  });

  // ── read/write counts: below the default band needs a stated reason ──
  if ((run.questions.length < 8 || run.operations.length < 4) && run.countsReason === undefined) {
    refuse(['run', 'countsReason'], `${run.questions.length} questions / ${run.operations.length} operations is below the default 8 / 4: state why in \`countsReason\``);
  }

  // ── agent actions: resolvable, unique, at least one confirm-gated ──
  if (run.agentActions !== undefined) {
    duplicates(run.agentActions, (a) => a.name, ['run', 'agentActions'], 'agent action', refuse);
    run.agentActions.forEach((a, i) => {
      if (!objects.has(a.object)) refuse(['run', 'agentActions', i, 'object'], `\`${a.object}\` is not in expect.objects`);
    });
    if (!run.agentActions.some((a) => a.confirm)) refuse(['run', 'agentActions'], 'needs at least one confirm-gated action');
  }

  // ── guardrails: all five, once each, every reference resolving ──
  duplicates(run.guardrails, (g) => g.check, ['run', 'guardrails'], 'guardrail check', refuse);
  for (const check of GUARDRAIL_CHECKS) {
    if (!run.guardrails.some((g) => g.check === check)) refuse(['run', 'guardrails'], `missing the \`${check}\` check`);
  }
  run.guardrails.forEach((g, i) => {
    const at: IssuePath = ['run', 'guardrails', i];
    const needs = {
      persona: g.check === 'permission_parity',
      operation: g.check === 'write_validation' || g.check === 'confirm_irreversible' || g.check === 'audit_actor',
      cell: g.check === 'injection_as_data',
    };
    for (const key of ['persona', 'operation', 'cell'] as const) {
      if (needs[key] && g[key] === undefined) refuse([...at, key], `a \`${g.check}\` check names its ${key}`);
      if (!needs[key] && g[key] !== undefined) refuse([...at, key], `a \`${g.check}\` check takes no ${key}`);
    }
    if (g.persona !== undefined && !personas.has(g.persona)) refuse([...at, 'persona'], `no persona \`${g.persona}\``);
    if (g.operation !== undefined) {
      const op = operations.get(g.operation);
      // Each check is graded by the operation's declared outcome, so the
      // outcome must be the one the check asserts.
      const wants = { write_validation: 'refused', confirm_irreversible: 'pending_confirmation', audit_actor: 'applied' } as const;
      const want = wants[g.check as keyof typeof wants];
      if (op === undefined) refuse([...at, 'operation'], `no operation \`${g.operation}\``);
      else if (g.check === 'write_validation' && op.kind === 'delete') {
        refuse([...at, 'operation'], 'write validation is asserted on a create or update, not a delete');
      } else if (op.outcome.kind !== want) {
        refuse([...at, 'operation'], `a \`${g.check}\` check needs an operation whose outcome is \`${want}\`, not \`${op.outcome.kind}\``);
      } else if (g.check === 'audit_actor' && op.outcome.kind === 'applied' && op.outcome.auditActor === undefined) {
        refuse([...at, 'operation'], 'an `audit_actor` check needs the operation to declare `outcome.auditActor`');
      }
    }
    if (g.cell !== undefined) {
      const row = seed[g.cell.object]?.find((r) => r.id === g.cell!.id);
      if (row === undefined) refuse([...at, 'cell'], `no seeded \`${g.cell.object}\` row has id \`${g.cell.id}\``);
      else if (typeof row[g.cell.field] !== 'string') {
        refuse([...at, 'cell', 'field'], `\`${g.cell.object}.${g.cell.field}\` of row \`${g.cell.id}\` is not a text cell carrying the injected text`);
      }
    }
  });

  // ── iterate: the delta is additive and lands in a consistent expect ──
  const delta = card.iterate.expectDelta;
  const at: IssuePath = ['iterate', 'expectDelta'];
  (delta.objects ?? []).forEach((o, i) => {
    if (objects.has(o)) refuse([...at, 'objects', i], `\`${o}\` is already in expect.objects — a delta adds`);
  });
  const existing = (list: ReadonlyArray<{ object: string; field: string }> | undefined) =>
    new Set((list ?? []).map((x) => `${x.object}.${x.field}`));
  const selects = existing(expect.selectFields);
  (delta.selectFields ?? []).forEach((s, i) => {
    if (selects.has(`${s.object}.${s.field}`)) refuse([...at, 'selectFields', i], `\`${s.object}.${s.field}\` is already expected`);
  });
  const lookups = existing(expect.lookups);
  (delta.lookups ?? []).forEach((l, i) => {
    if (lookups.has(`${l.object}.${l.field}`)) refuse([...at, 'lookups', i], `\`${l.object}.${l.field}\` is already expected`);
  });
  (delta.dashboards ?? []).forEach((d, i) => {
    if (dashboards.has(d)) refuse([...at, 'dashboards', i], `\`${d}\` is already expected`);
  });
  const after = applyExpectDelta(expect, delta);
  checkExpectRefs(delta, new Set(after.objects), new Set(after.dashboards ?? []), at, refuse);

  return { truths, personaTruths };
}

/** `expect` after an iteration's delta is applied (additive). */
export function applyExpectDelta(expect: ScenarioExpect, delta: ScenarioCard['iterate']['expectDelta']): ScenarioExpect {
  const cat = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined): T[] | undefined =>
    a === undefined && b === undefined ? undefined : [...(a ?? []), ...(b ?? [])];
  return {
    ...expect,
    objects: [...expect.objects, ...(delta.objects ?? [])],
    selectFields: cat(expect.selectFields, delta.selectFields),
    lookups: cat(expect.lookups, delta.lookups),
    dashboards: cat(expect.dashboards, delta.dashboards),
    appNavTargets: cat(expect.appNavTargets, delta.appNavTargets),
  };
}

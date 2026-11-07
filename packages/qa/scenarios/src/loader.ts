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
 * Which library a directory is, the loader cannot tell from the directory: a
 * card file carries nothing that says where it lives. So the caller says it
 * ({@link LoadOptions.library}; the CLIs answer with {@link libraryOf}), and the
 * loader refuses a `generic` card in the private overlay and a
 * `customer-derived` or `held-out` card in the open library — each belongs in
 * the other, and a card on the wrong side is mislabelled or misplaced either
 * way (in the open library, it is also a leak).
 *
 * Nothing here calls a model, the network, or anything outside the two
 * directories it is handed.
 */

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';

import { ErrorCode } from '@objectstack/spec/api';

import {
  AppCodeSchema,
  GUARDRAIL_CHECKS,
  isGalleryTier,
  ROW_SCOPE_TAG,
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
  /**
   * Question id → persona id → every figure computable from the rows of the
   * question's object that persona may read, ascending, for questions that
   * list personas: over its rows in the persona's `scope`, with its fields but
   * the hidden ones and the fields one lookup away on a row the persona also
   * sees, the row count, the count of each value of each field, and each
   * number field's values, sum, mean, least and greatest (none when the
   * object is hidden). The leak grader flags an all-rows figure only when none
   * of these equals it (`gradePersonaRun`'s `inScopeFigures`).
   */
  scopeFigures: Record<string, Record<string, number[]>>;
}

export interface LoadResult {
  cards: LoadedScenario[];
  refusals: Refusal[];
}

/**
 * Which library a directory of cards is: the `open` one (`docs/qa/scenarios/`
 * in this repository, every card `generic`) or the private `overlay` outside
 * it (customer-derived and held-out cards).
 */
export type ScenarioLibrary = 'open' | 'overlay';

/** The open library, relative to the repository root. */
export const OPEN_LIBRARY_DIR = 'docs/qa/scenarios';

export interface LoadOptions {
  /** The closed set of capability areas; see {@link readCapabilityAreas}. */
  areas: ReadonlySet<string>;
  /**
   * The library the cards are loaded as — stated by the caller, because the
   * directory says nothing the loader could read. A `generic` card in the
   * `overlay` is refused, and so is a `customer-derived` or `held-out` card in
   * the `open` library.
   */
  library: ScenarioLibrary;
}

/**
 * The library `dir` is: `open` when it is the repository's open library
 * (`<repo>/docs/qa/scenarios`, compared by real path), else `overlay` — a card
 * directory anywhere else is not the open library.
 */
export function libraryOf(dir: string, repoRoot: string): ScenarioLibrary {
  return realpathSync(dir) === realpathSync(join(repoRoot, OPEN_LIBRARY_DIR)) ? 'open' : 'overlay';
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
type Persona = ScenarioCard['run']['personas'][number];

/**
 * The two codes a faithful build answers an operation its acting persona
 * cannot reach with. Spelled as literals, because `check:dispatcher-error-vocabulary`
 * judges the `code` these feed into `want` below and reads a constant only when
 * it resolves to a literal. Held to the spec's catalogue (`ErrorCode`, ADR-0112)
 * twice: typed, so the typecheck refuses a code the platform stops answering,
 * and parsed once at load, so a test run (which does not typecheck) refuses it
 * too, instead of drifting.
 *
 *   NOT_REACHABLE_ROW_CODE  a by-id write on a row the caller cannot READ is
 *                           answered not-found, indistinguishable from a
 *                           missing row, before any field or validation gate.
 *   HIDDEN_WRITE_CODE       a write on an object the caller must not read, or
 *                           to a field it must not read, is refused by the
 *                           security gate before the object's validation runs.
 */
const NOT_REACHABLE_ROW_CODE: ErrorCode = 'RECORD_NOT_FOUND';
const HIDDEN_WRITE_CODE: ErrorCode = 'PERMISSION_DENIED';
ErrorCode.parse(NOT_REACHABLE_ROW_CODE);
ErrorCode.parse(HIDDEN_WRITE_CODE);

/**
 * The floor a `starter` or `delivery` card meets: the countable lines of the
 * library's mid-tier floor (docs/qa/scenarios/README.md, "The library"). A
 * gallery card is an app someone installs as a template, so a two-object,
 * eight-row check never passes as one. `delivery` holds the same floor until
 * the delivery-grade list sets its own. The floor's other lines (an approval
 * or automation flow, a seed spanning three months, the question and
 * operation mix, declarative first) cannot be counted from the card; each
 * mid-tier card's own test pins them.
 */
export const GALLERY_FLOOR = {
  /** `expect.objects`. */
  objects: 5,
  /** `expect.dashboards`. */
  dashboards: 1,
  /** The rows of the card's largest seeded object (the main object's, on a mid-tier card). */
  rowsOnOneObject: 100,
  /** Personas that declare a row `scope`. */
  scopedPersonas: 2,
  /** `run.questions`: the default band's lower edge, which a `countsReason` does not lower here. */
  questions: 8,
  /** `run.operations`: likewise. */
  operations: 4,
  /** `run.agentActions`. */
  agentActions: 3,
} as const;

/** Refuses every line of {@link GALLERY_FLOOR} a gallery-tier card falls below, at the field that falls short. */
function checkGalleryFloor(card: ScenarioCard, refuse: Refuse) {
  const { expect, run } = card;
  const f = GALLERY_FLOOR;
  const short = (at: IssuePath, floor: string, has: string) =>
    refuse(
      at,
      `a \`${card.tier}\` card ${floor} (the gallery floor); this one ${has}: raise it to the floor, or declare it \`control\`, an internal check that is never exported`,
    );
  if (expect.objects.length < f.objects) {
    short(['expect', 'objects'], `expects at least ${f.objects} objects`, `expects ${expect.objects.length}`);
  }
  const dashboards = expect.dashboards?.length ?? 0;
  if (dashboards < f.dashboards) {
    short(['expect', 'dashboards'], `expects at least ${f.dashboards} dashboard`, `expects ${dashboards}`);
  }
  let largest: [string, number] | undefined;
  for (const [name, rows] of Object.entries(run.seed)) if (largest === undefined || rows.length > largest[1]) largest = [name, rows.length];
  if ((largest?.[1] ?? 0) < f.rowsOnOneObject) {
    short(
      ['run', 'seed'],
      `seeds at least ${f.rowsOnOneObject} rows on one object`,
      largest === undefined ? 'seeds none' : `seeds at most ${largest[1]}, on \`${largest[0]}\``,
    );
  }
  const scoped = run.personas.filter((p) => p.scope !== undefined).length;
  if (scoped < f.scopedPersonas) {
    short(['run', 'personas'], `has at least ${f.scopedPersonas} personas with a row \`scope\``, `has ${scoped}`);
  }
  const reason = run.countsReason === undefined ? '' : ' (a `countsReason` does not lower the floor)';
  if (run.questions.length < f.questions) {
    short(['run', 'questions'], `asks at least ${f.questions} questions`, `asks ${run.questions.length}${reason}`);
  }
  if (run.operations.length < f.operations) {
    short(['run', 'operations'], `performs at least ${f.operations} operations`, `performs ${run.operations.length}${reason}`);
  }
  const actions = run.agentActions?.length ?? 0;
  if (actions < f.agentActions) {
    short(['run', 'agentActions'], `declares at least ${f.agentActions} agent actions`, `declares ${actions}`);
  }
}

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
): Pick<LoadedScenario, 'truths' | 'personaTruths' | 'scopeFigures'> {
  const { expect, run } = card;

  // ── identity ──
  if (card.id !== stem) refuse(['id'], `\`${card.id}\` must equal the file's basename \`${stem}\``);

  // ── origin: each library holds its own origins, never the other's ──
  if (options.library === 'overlay' && card.origin === 'generic') {
    refuse(
      ['origin'],
      `a \`generic\` card does not belong in the private overlay, which holds only \`customer-derived\` and \`held-out\` cards: move it to the open library (${OPEN_LIBRARY_DIR}), or mark the origin it really has`,
    );
  }
  if (options.library === 'open' && card.origin !== 'generic') {
    refuse(
      ['origin'],
      `a \`${card.origin}\` card does not belong in the open library, which is public and holds only \`generic\` cards: move it to the private overlay, or mark it \`generic\` only if it was written from the domain alone`,
    );
  }

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

  /** Whether `p` sees `row` of `object`: every row-scope rule it declares on that object holds. */
  const inScope = (p: Persona, object: string, row: SeedRow): boolean => {
    const resolve = resolverFor(object);
    return (p.scope ?? []).filter((sc) => sc.object === object).every((sc) => resolve(row, sc.field) === sc.value);
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

  // ── row scope is judged in the build: a scoped persona needs the row-scope tag ──
  // A persona's `scope` is a requirement of the app (it sees only those rows).
  // The Build half judges a requirement only through the card's capability
  // tags, so without the tag a build that shows the persona every row scores
  // as if the card never asked (the reach rule on operations, below, is the
  // same idea).
  const scopedPersonas = run.personas.filter((p) => p.scope !== undefined).map((p) => `\`${p.id}\``);
  if (scopedPersonas.length > 0 && !card.capabilities.includes(ROW_SCOPE_TAG)) {
    refuse(
      ['capabilities'],
      `the persona(s) ${scopedPersonas.join(', ')} declare a row \`scope\`, so the card must carry \`${ROW_SCOPE_TAG}\`: without it the Build half never judges whether the build keeps the other rows from them`,
    );
  }

  // ── questions: refs resolve, then the truth is computed (and per persona) ──
  const truths: Record<string, Truth> = {};
  const personaTruths: Record<string, Record<string, Truth>> = {};
  const scopeFigures: Record<string, Record<string, number[]>> = {};
  /** {@link LoadedScenario.scopeFigures} for one persona over one object. */
  const figuresInScope = (p: Persona, object: string): number[] => {
    const hiddenObjects = new Set(p.hidden.objects ?? []);
    if (hiddenObjects.has(object)) return [];
    const visible = (o: string) => {
      const hidden = new Set((p.hidden.fields ?? []).filter((f) => f.object === o).map((f) => f.field));
      return [...fieldsOf(seed[o])].filter((f) => f !== 'id' && !hidden.has(f));
    };
    const mine = (seed[object] ?? []).filter((r) => inScope(p, object, r));
    const columns: Array<(r: SeedRow) => unknown> = [];
    for (const f of visible(object)) {
      columns.push((r) => r[f]);
      const to = lookupFields.get(`${object}.${f}`);
      if (to === undefined || hiddenObjects.has(to)) continue;
      const target = (r: SeedRow): SeedRow | undefined => {
        const t = typeof r[f] === 'string' ? rowById.get(to)?.get(r[f] as string) : undefined;
        return t !== undefined && inScope(p, to, t) ? t : undefined;
      };
      for (const g of visible(to)) columns.push((r) => target(r)?.[g]);
    }
    const figures = new Set<number>([mine.length]);
    for (const read of columns) {
      const counts = new Map<unknown, number>();
      const numbers: number[] = [];
      for (const r of mine) {
        const v = read(r) ?? null;
        counts.set(v, (counts.get(v) ?? 0) + 1);
        if (typeof v === 'number') numbers.push(v);
      }
      for (const n of counts.values()) figures.add(n);
      if (numbers.length === 0) continue;
      const sum = numbers.reduce((a, b) => a + b, 0);
      for (const n of [...numbers, sum, sum / numbers.length, Math.min(...numbers), Math.max(...numbers)]) figures.add(n);
    }
    return [...figures].sort((a, b) => a - b);
  };
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
    scopeFigures[q.id] = {};
    q.personas.forEach((id, j) => {
      if (unscoped.has(id)) return;
      const p = run.personas.find((x) => x.id === id)!;
      scopeFigures[q.id][id] = figuresInScope(p, q.object);
      const hiddenFields = new Set((p.hidden.fields ?? []).map((f) => `${f.object}.${f.field}`));
      const hiddenObjects = new Set(p.hidden.objects ?? []);
      const withheld =
        hiddenObjects.has(q.object) || read.some(([o, f]) => hiddenObjects.has(o) || hiddenFields.has(`${o}.${f}`));
      if (withheld && t.kind !== 'unanswerable') {
        personaTruths[q.id][id] = { kind: 'withheld' };
        return;
      }
      const scoped = rows.filter((r) => inScope(p, q.object, r));
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
  // Reach: a persona is a requirement of the app (`hidden` = must not read,
  // `scope` = sees only those rows), so an operation its acting persona cannot
  // reach has exactly one outcome a faithful build gives, decided from the card
  // alone — the object hidden, then the target row out of scope (the row gate
  // runs before the field gate), then a written field hidden. Declaring anything
  // else (`applied`, `pending_confirmation`, another refusal code) is the card
  // contradicting its own persona: graded against a faithful build it fails, and
  // it passes only a build that leaks what the persona must not see.
  const checkReach = (op: ScenarioCard['run']['operations'][number], actor: Persona, at: IssuePath) => {
    const row = op.target === undefined ? undefined : rowById.get(op.object)?.get(op.target);
    const hiddenField = Object.keys(op.values ?? {}).find((field) =>
      (actor.hidden.fields ?? []).some((f) => f.object === op.object && f.field === field),
    );
    let want: { code: ErrorCode; why: string } | undefined;
    if ((actor.hidden.objects ?? []).includes(op.object)) {
      want = { code: HIDDEN_WRITE_CODE, why: `\`${actor.id}\` must not read \`${op.object}\`` };
    } else if (row !== undefined && !unscoped.has(actor.id) && !inScope(actor, op.object, row)) {
      want = { code: NOT_REACHABLE_ROW_CODE, why: `row \`${op.target}\` is outside \`${actor.id}\`'s row scope on \`${op.object}\`` };
    } else if (hiddenField !== undefined) {
      want = { code: HIDDEN_WRITE_CODE, why: `\`${actor.id}\` must not read \`${op.object}.${hiddenField}\`, which this ${op.kind} writes` };
    }
    if (want === undefined || (op.outcome.kind === 'refused' && op.outcome.code === want.code)) return;
    refuse(
      [...at, 'outcome', ...(op.outcome.kind === 'refused' ? ['code'] : [])],
      `${want.why}, so a faithful build refuses this ${op.kind} with \`${want.code}\` — declare that refusal, or change the target, the values or \`actingAs\` so the persona can reach what the operation writes`,
    );
  };
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
    const actor = run.personas.find((p) => p.id === op.actingAs);
    if (actor !== undefined) checkReach(op, actor, at);
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
  // A gallery card has no such excuse: the floor below holds it to the band,
  // so it is never told to state a reason that could not lift the refusal.
  const gallery = isGalleryTier(card.tier);
  if (!gallery && (run.questions.length < 8 || run.operations.length < 4) && run.countsReason === undefined) {
    refuse(['run', 'countsReason'], `${run.questions.length} questions / ${run.operations.length} operations is below the default 8 / 4: state why in \`countsReason\``);
  }

  // ── tier: a gallery card meets the gallery floor; a control card has none ──
  if (gallery) checkGalleryFloor(card, refuse);

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

  return { truths, personaTruths, scopeFigures };
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

#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-write/validate — the closed-schema gate every relay payload passes,
 * on BOTH sides of the boundary.
 *
 *   node scripts/pm/fleet-write/validate.mjs --file payload.json          # judge a payload on disk
 *   node scripts/pm/fleet-write/validate.mjs --from-env                   # judge $FLEET_WRITE_PAYLOAD (the runner)
 *   node scripts/pm/fleet-write/validate.mjs --from-env --github-output   # …and write repo_name / request_id / action_count to $GITHUB_OUTPUT
 *   node scripts/pm/fleet-write/validate.mjs --self-test                  # offline, no network
 *
 * ## One validator, imported by both ends
 *
 * The seat-side packer (`dispatch.mjs`) refuses a payload here BEFORE the
 * dispatch leaves, and the relay workflow's first step runs this same file
 * against `github.event.client_payload` BEFORE any token is minted. Two copies
 * of a schema drift; one file cannot. The op table it reads is `ops.mjs`, so
 * "is this op allowed, with these keys, at these caps" has one spelling.
 *
 * ## What "closed" means here, key by key
 *
 *   - the envelope is exactly `request_id`, `repo`, `session`, `actions` —
 *     an unknown top-level key is a refusal, not an ignored extra;
 *   - `repo` is `objectstack-ai/<name>` — the App is installed on that one
 *     organization, and a target outside it is refused before any read;
 *   - `session` is `session_…` — the attribution the protocol carries INSIDE
 *     the text is also carried on the envelope, so the run's summary names it;
 *   - each action is exactly `op` + that op's required keys + a subset of its
 *     optional keys; an unknown per-action key is a refusal; a number is an
 *     integer (`"17"` is refused); a string is capped in BYTES; a list is
 *     capped in length and per item; an enum is one of its values;
 *   - the whole payload respects the platform's own `client_payload` limits
 *     (ten top-level properties, under 64KB — the header of `ops.mjs` quotes
 *     the source), so what this file accepts the platform accepts.
 *
 * A refusal is the WHOLE list of reasons, not the first one: a seat fixing a
 * payload reads every problem in one pass, and the runner's step summary
 * carries them all.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0  valid.
 *   2  refused (the reasons are printed), or usage.
 *   3  PREREQUISITE NOT MET — no payload to read (`--file` unreadable, the
 *      environment variable absent or not JSON). Nothing was judged.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../../invoked-as.mjs';
import {
  ALLOWED_MUTATIONS,
  CLIENT_PAYLOAD_MAX_BYTES,
  CLIENT_PAYLOAD_MAX_TOP_LEVEL,
  EVENT_TYPE_MAX_CHARS,
  FIELDS,
  MAX_ACTIONS,
  MAX_REQUEST_ID_CHARS,
  OPS,
  OP_NAMES,
  PAYLOAD_KEYS,
  PERMISSIONS,
  REFUSED_PATH_FAMILIES,
  RELAY_EVENT_TYPE,
  REQUEST_ID_SHAPE,
  SESSION_SHAPE,
  TARGET_OWNER,
  TARGET_REPO_SHAPE,
} from './ops.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);

export const EXIT_OK = 0;
export const EXIT_REFUSED = 2;
export const EXIT_PREREQUISITE = 3;

/** The environment variable the runner hands the payload through (`toJSON(github.event.client_payload)`). */
export const PAYLOAD_ENV = 'FLEET_WRITE_PAYLOAD';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bytes = (s) => Buffer.byteLength(String(s), 'utf8');
const quote = (v) => JSON.stringify(v);

/** One field against its declared kind. Returns the error sentence, or null. */
export function validateField(name, value, spec, where) {
  const at = `${where}.${name}`;
  if (spec.kind === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return `${at} must be a positive integer (a JSON number), got ${quote(value)}`;
    return null;
  }
  if (spec.kind === 'str') {
    if (typeof value !== 'string') return `${at} must be a string, got ${typeof value}`;
    if (value.length === 0) return `${at} must not be empty`;
    if (bytes(value) > spec.max) return `${at} is ${bytes(value)} bytes, over its cap of ${spec.max}`;
    return null;
  }
  if (spec.kind === 'list') {
    if (!Array.isArray(value)) return `${at} must be an array of strings, got ${isPlainObject(value) ? 'an object' : typeof value}`;
    if (value.length === 0) return `${at} must name at least one item`;
    if (value.length > spec.max) return `${at} names ${value.length} items, over its cap of ${spec.max}`;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item !== 'string' || item.length === 0) return `${at}[${i}] must be a non-empty string, got ${quote(item)}`;
      if (bytes(item) > spec.itemMax) return `${at}[${i}] is ${bytes(item)} bytes, over the per-item cap of ${spec.itemMax}`;
    }
    if (new Set(value).size !== value.length) return `${at} names an item twice`;
    return null;
  }
  if (spec.kind === 'enum') {
    if (!spec.values.includes(value)) return `${at} must be one of ${spec.values.map(quote).join(', ')}, got ${quote(value)}`;
    return null;
  }
  return `${at}: unknown field kind ${quote(spec.kind)} — a bug in ops.mjs, not in the payload`;
}

/** One action against the op table. Returns the errors for it (possibly none). */
export function validateAction(action, index) {
  const where = `actions[${index}]`;
  const errors = [];
  if (!isPlainObject(action)) return [`${where} must be an object, got ${Array.isArray(action) ? 'an array' : typeof action}`];
  const op = action.op;
  if (typeof op !== 'string' || !(op in OPS)) {
    return [`${where}.op ${quote(op ?? null)} is not an op the relay executes — the closed list is ${OP_NAMES.join(', ')}`];
  }
  const spec = OPS[op];
  const allowed = new Set(['op', ...spec.required, ...spec.optional]);
  for (const key of Object.keys(action)) {
    if (!allowed.has(key)) errors.push(`${where}.${key} is not a key \`${op}\` takes (it takes ${[...spec.required, ...spec.optional].join(', ')})`);
  }
  for (const key of spec.required) {
    if (!(key in action)) errors.push(`${where}.${key} is required by \`${op}\``);
  }
  if (spec.atLeastOne && !spec.atLeastOne.some((k) => k in action)) {
    errors.push(`${where}: \`${op}\` needs at least one of ${spec.atLeastOne.join(', ')}`);
  }
  for (const key of Object.keys(action)) {
    if (key === 'op' || !allowed.has(key)) continue;
    const e = validateField(key, action[key], FIELDS[key], where);
    if (e) errors.push(e);
  }
  return errors;
}

/**
 * The whole payload. Pure. Returns `{ ok, errors, payload }` where `payload`
 * is a normalised copy carrying ONLY the keys this file admitted (so a caller
 * that sends `payload` sends nothing it did not judge); `payload` is `null`
 * on a refusal.
 */
export function validatePayload(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [`the payload must be a JSON object, got ${input === null ? 'null' : Array.isArray(input) ? 'an array' : typeof input}`], payload: null };
  }
  const keys = Object.keys(input);
  for (const key of keys) {
    if (!PAYLOAD_KEYS.includes(key)) errors.push(`top-level key ${quote(key)} is not part of the envelope (${PAYLOAD_KEYS.join(', ')})`);
  }
  for (const key of PAYLOAD_KEYS) {
    if (!(key in input)) errors.push(`top-level key ${quote(key)} is required`);
  }
  if (keys.length > CLIENT_PAYLOAD_MAX_TOP_LEVEL) {
    errors.push(`${keys.length} top-level properties; the platform caps client_payload at ${CLIENT_PAYLOAD_MAX_TOP_LEVEL}`);
  }

  const { request_id: requestId, repo, session, actions } = input;
  if (typeof requestId !== 'string' || requestId.length === 0) errors.push('request_id must be a non-empty string');
  else if (requestId.length > MAX_REQUEST_ID_CHARS) errors.push(`request_id is ${requestId.length} characters, over its cap of ${MAX_REQUEST_ID_CHARS}`);
  else if (!REQUEST_ID_SHAPE.test(requestId)) errors.push(`request_id ${quote(requestId)} must match ${REQUEST_ID_SHAPE} — letters, digits, dot, underscore, hyphen`);

  if (typeof repo !== 'string' || !TARGET_REPO_SHAPE.test(repo) || repo.includes('..')) {
    errors.push(`repo ${quote(repo ?? null)} must be \`${TARGET_OWNER}/<name>\` — the App is installed on that organization and nowhere else`);
  }

  if (typeof session !== 'string' || !SESSION_SHAPE.test(session)) {
    errors.push(`session ${quote(session ?? null)} must be the dispatching seat's \`session_…\` id`);
  }

  if (!Array.isArray(actions)) errors.push(`actions must be an array, got ${actions === undefined ? 'nothing' : isPlainObject(actions) ? 'an object' : typeof actions}`);
  else if (actions.length === 0) errors.push('actions must carry at least one action');
  else if (actions.length > MAX_ACTIONS) errors.push(`actions carries ${actions.length} actions, over the cap of ${MAX_ACTIONS}`);
  else for (let i = 0; i < actions.length; i++) errors.push(...validateAction(actions[i], i));

  if (errors.length) return { ok: false, errors, payload: null };

  const payload = {
    request_id: requestId,
    repo,
    session,
    actions: actions.map((a) => {
      const spec = OPS[a.op];
      const out = { op: a.op };
      for (const key of [...spec.required, ...spec.optional]) if (key in a) out[key] = Array.isArray(a[key]) ? [...a[key]] : a[key];
      return out;
    }),
  };
  const size = bytes(JSON.stringify(payload));
  if (size >= CLIENT_PAYLOAD_MAX_BYTES) {
    return { ok: false, errors: [`the payload serialises to ${size} bytes; the platform requires client_payload under ${CLIENT_PAYLOAD_MAX_BYTES} — split the actions across more than one dispatch`], payload: null };
  }
  return { ok: true, errors: [], payload };
}

/** The refusal, as the lines a seat or a step summary prints. */
export function refusalText(errors) {
  return [`fleet-write: payload REFUSED — ${errors.length} problem(s), ⛔ zero writes:`, ...errors.map((e) => `  - ${e}`)].join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = Object.freeze(['--file', '--from-env', '--github-output', '--self-test', '--help', '-h', '--json']);

export function parseArgs(argv) {
  const opts = { file: null, fromEnv: false, githubOutput: false, selfTest: false, help: false, json: false, errors: [] };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--from-env') opts.fromEnv = true;
    else if (a === '--github-output') opts.githubOutput = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--file') {
      const v = args.shift();
      if (v === undefined || v.startsWith('--')) opts.errors.push('--file needs a path');
      else opts.file = v;
    } else if (a.startsWith('--file=')) opts.file = a.slice('--file='.length);
    else opts.errors.push(`unrecognised argument ${quote(a)}`);
  }
  if (!opts.selfTest && !opts.help && opts.file === null && !opts.fromEnv) opts.errors.push('name the payload: --file <path> or --from-env');
  if (opts.file !== null && opts.fromEnv) opts.errors.push('--file and --from-env name two sources; pass one');
  return opts;
}

/** Read the payload text from the source the options name. Throws with a prerequisite message. */
export function readPayloadSource(opts, { env = process.env, read = (p) => readFileSync(p, 'utf8') } = {}) {
  let text;
  if (opts.fromEnv) {
    text = env[PAYLOAD_ENV];
    if (typeof text !== 'string' || text.trim() === '' || text.trim() === 'null') throw new Error(`${PAYLOAD_ENV} is absent or empty — the runner passes \`toJSON(github.event.client_payload)\` through it`);
  } else {
    try {
      text = read(opts.file);
    } catch (e) {
      throw new Error(`--file ${opts.file} cannot be read (${e?.message ?? 'unreadable'})`);
    }
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`the payload is not JSON (${e?.message ?? 'parse failed'})`);
  }
}

/** The `$GITHUB_OUTPUT` lines the workflow's later steps read. Values are single-line by construction of the validator. */
export function githubOutputLines(payload) {
  return [`repo_name=${payload.repo.split('/')[1]}`, `request_id=${payload.request_id}`, `action_count=${payload.actions.length}`, `session=${payload.session}`].join('\n') + '\n';
}

const USAGE = [
  'usage:',
  '  node scripts/pm/fleet-write/validate.mjs --file <payload.json> [--json]',
  `  node scripts/pm/fleet-write/validate.mjs --from-env [--github-output]     # reads $${PAYLOAD_ENV}`,
  '  node scripts/pm/fleet-write/validate.mjs --self-test',
  `  Exits: ${EXIT_OK} valid · ${EXIT_REFUSED} refused or usage · ${EXIT_PREREQUISITE} no payload to judge`,
].join('\n');

export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const out = deps.stdout ?? ((l) => console.log(l));
  const err = deps.stderr ?? ((l) => console.error(l));
  const opts = parseArgs(argv);
  if (opts.help) {
    out(USAGE);
    return EXIT_OK;
  }
  if (opts.selfTest) return selfTest();
  if (opts.errors.length) {
    for (const e of opts.errors) err(`fleet-write/validate: ${e}`);
    err(USAGE);
    return EXIT_REFUSED;
  }
  let input;
  try {
    input = readPayloadSource(opts, { env, read: deps.read });
  } catch (e) {
    err(`fleet-write/validate: PREREQUISITE NOT MET — ${e.message}. ⛔ NOT MEASURED: nothing was judged.`);
    return EXIT_PREREQUISITE;
  }
  const verdict = validatePayload(input);
  const summary = env.GITHUB_STEP_SUMMARY;
  const append = deps.append ?? ((file, text) => appendFileSync(file, text, 'utf8'));
  if (!verdict.ok) {
    err(refusalText(verdict.errors));
    if (summary) append(summary, `### fleet-write: payload refused, zero writes\n\n${verdict.errors.map((e) => `- ${e}`).join('\n')}\n`);
    return EXIT_REFUSED;
  }
  const p = verdict.payload;
  out(`fleet-write/validate: OK — request ${p.request_id} · target ${p.repo} · session ${p.session} · ${p.actions.length} action(s): ${p.actions.map((a) => a.op).join(', ')}`);
  if (opts.json) out(JSON.stringify(p));
  if (opts.githubOutput) {
    const file = env.GITHUB_OUTPUT;
    if (!file) {
      err('fleet-write/validate: --github-output was asked for but GITHUB_OUTPUT is not set — not on a runner?');
      return EXIT_PREREQUISITE;
    }
    append(file, githubOutputLines(p));
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Self-test — offline. The battery roster is the floor (AGENTS.md, "Writing a --self-test").
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the envelope: four keys, every one required, nothing else admitted': 9,
  'the fields: request_id shape and cap, the one organization, the session id': 8,
  'the actions: count, the closed op list, closed keys per op, typed values': 22,
  'the platform ceilings: ten top-level properties and under 64KB, pinned with their source': 6,
  'refused by construction: no row reaches a merge, a review, a ref, contents, a workflow, a release or an org endpoint': 8,
  'the normalised payload: only judged keys travel': 3,
  'the CLI: a file, the environment, GitHub outputs, and the exit ladder': 10,
});
const SELF_TEST_BATTERY_FLOOR = 7;
const UNATTRIBUTED_BATTERY = '(unattributed)';

const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

/** A payload every case starts from; each case mutates a copy. */
export function fixturePayload(overrides = {}) {
  return {
    request_id: 'fw-20260922T090000Z-abc123',
    repo: 'objectstack-ai/objectstack',
    session: 'session_01ABCDEFGHJKMNPQRSTVWXYZ',
    actions: [{ op: 'comment', issue: 19701, body: 'Hello from the relay.' }],
    ...overrides,
  };
}

export async function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true, detail) => {
    const bucket = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(bucket, (batteryCases.get(bucket) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `${detail ? `${detail} — ` : ''}got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const refuses = (payload, needle) => {
    const v = validatePayload(payload);
    return !v.ok && v.errors.some((e) => e.includes(needle));
  };

  // ── the envelope ──────────────────────────────────────────────────────────
  battery('the envelope: four keys, every one required, nothing else admitted');
  {
    t('the fixture is valid', validatePayload(fixturePayload()).ok, true, validatePayload(fixturePayload()).errors.join(' | '));
    t('null is refused', refuses(null, 'must be a JSON object'));
    t('an array is refused', refuses([], 'must be a JSON object'));
    t('a string is refused', refuses('x', 'must be a JSON object'));
    t('an unknown top-level key is refused BY NAME', refuses(fixturePayload({ extra: 1 }), '"extra" is not part of the envelope'));
    t('a missing request_id is refused', refuses((() => { const p = fixturePayload(); delete p.request_id; return p; })(), '"request_id" is required'));
    t('a missing session is refused', refuses((() => { const p = fixturePayload(); delete p.session; return p; })(), '"session" is required'));
    t('a missing actions is refused', refuses((() => { const p = fixturePayload(); delete p.actions; return p; })(), '"actions" is required'));
    t('every refusal reason is reported, not only the first', validatePayload({ extra: 1 }).errors.length >= 5);
  }

  // ── the fields ────────────────────────────────────────────────────────────
  battery('the fields: request_id shape and cap, the one organization, the session id');
  {
    t('an empty request_id is refused', refuses(fixturePayload({ request_id: '' }), 'non-empty'));
    t('a request_id over 64 characters is refused', refuses(fixturePayload({ request_id: 'a'.repeat(65) }), 'over its cap of 64'));
    t('a request_id with a space or slash is refused', refuses(fixturePayload({ request_id: 'a b/c' }), 'must match'));
    t('a repo in another organization is refused', refuses(fixturePayload({ repo: 'someone-else/objectstack' }), 'objectstack-ai/<name>'));
    t('a repo with a path segment is refused', refuses(fixturePayload({ repo: 'objectstack-ai/a/b' }), 'objectstack-ai/<name>'));
    t('…and so is a dot-dot name', refuses(fixturePayload({ repo: 'objectstack-ai/..' }), 'objectstack-ai/<name>'));
    t('a session that is not session_… is refused', refuses(fixturePayload({ session: 'd589e4b7-cc75' }), 'session_'));
    t('another organization repo of the org passes the shape', validatePayload(fixturePayload({ repo: 'objectstack-ai/objectui' })).ok);
  }

  // ── the actions ───────────────────────────────────────────────────────────
  battery('the actions: count, the closed op list, closed keys per op, typed values');
  {
    const one = (action) => fixturePayload({ actions: [action] });
    t('zero actions is refused', refuses(fixturePayload({ actions: [] }), 'at least one'));
    t('twenty-one actions is refused', refuses(fixturePayload({ actions: Array.from({ length: 21 }, () => ({ op: 'comment', issue: 1, body: 'x' })) }), 'over the cap of 20'));
    t('twenty actions is accepted', validatePayload(fixturePayload({ actions: Array.from({ length: 20 }, () => ({ op: 'comment', issue: 1, body: 'x' })) })).ok);
    t('an action that is not an object is refused', refuses(fixturePayload({ actions: ['comment'] }), 'must be an object'));
    t('an op outside the closed list is refused, naming the list', refuses(one({ op: 'merge', pull: 1 }), 'not an op the relay executes'));
    t('…and a review op does not exist either', refuses(one({ op: 'review', pull: 1 }), 'not an op the relay executes'));
    t('a missing required key is refused', refuses(one({ op: 'comment', issue: 1 }), 'actions[0].body is required'));
    t('an unknown per-action key is refused BY NAME', refuses(one({ op: 'comment', issue: 1, body: 'x', title: 'no' }), 'actions[0].title is not a key `comment` takes'));
    t('a numeric string is refused where an integer is required', refuses(one({ op: 'comment', issue: '17', body: 'x' }), 'positive integer'));
    t('a float is refused too', refuses(one({ op: 'comment', issue: 1.5, body: 'x' }), 'positive integer'));
    t('zero is refused', refuses(one({ op: 'comment', issue: 0, body: 'x' }), 'positive integer'));
    t('a body over 60000 bytes is refused, in bytes', refuses(one({ op: 'comment', issue: 1, body: 'é'.repeat(30_001) }), 'over its cap of 60000'));
    t('a title over 256 bytes is refused', refuses(one({ op: 'issue_create', title: 'x'.repeat(257), body: 'b' }), 'over its cap of 256'));
    t('an empty string is refused', refuses(one({ op: 'comment', issue: 1, body: '' }), 'must not be empty'));
    t('labels must be an array of strings', refuses(one({ op: 'labels_add', issue: 1, labels: 'a,b' }), 'array of strings'));
    t('an empty labels list is refused', refuses(one({ op: 'labels_add', issue: 1, labels: [] }), 'at least one item'));
    t('a label over 50 bytes is refused', refuses(one({ op: 'labels_add', issue: 1, labels: ['x'.repeat(51)] }), 'per-item cap of 50'));
    t('a label named twice is refused', refuses(one({ op: 'labels_add', issue: 1, labels: ['a', 'a'] }), 'twice'));
    t('eleven assignees is refused', refuses(one({ op: 'assign', issue: 1, assignees: Array.from({ length: 11 }, (_, i) => `u${i}`) }), 'over its cap of 10'));
    t('an unknown state is refused', refuses(one({ op: 'issue_patch', issue: 1, state: 'archived' }), 'must be one of "open", "closed"'));
    t('issue_patch with nothing to change is refused', refuses(one({ op: 'issue_patch', issue: 1 }), 'at least one of title, body, state, state_reason'));
    t('pr_request_reviewers with neither list is refused', refuses(one({ op: 'pr_request_reviewers', pull: 1 }), 'at least one of reviewers, team_reviewers'));
    // Every op's minimal valid shape is accepted — the table and the validator agree.
    const minimal = {
      comment: { issue: 1, body: 'b' },
      comment_edit: { comment_id: 1, body: 'b' },
      labels_add: { issue: 1, labels: ['a'] },
      labels_remove: { issue: 1, labels: ['a'] },
      assign: { issue: 1, assignees: ['u'] },
      unassign: { issue: 1, assignees: ['u'] },
      issue_patch: { issue: 1, state: 'closed', state_reason: 'completed' },
      issue_create: { title: 't', body: 'b', labels: ['l'], assignees: ['u'] },
      pr_create: { title: 't', head: 'h', base: 'main', body: 'b' },
      pr_request_reviewers: { pull: 1, reviewers: ['u'] },
      pr_ready: { pull: 1 },
      pr_draft: { pull: 1 },
      automerge_enable: { pull: 1 },
      automerge_disable: { pull: 1 },
    };
    t('every op in the table has a minimal shape this validator accepts', OP_NAMES.filter((op) => !validatePayload(one({ op, ...minimal[op] })).ok), []);
    t('…and the minimal-shape ledger names every op, no more and no less', Object.keys(minimal).sort(), [...OP_NAMES].sort());
  }

  // ── the platform ceilings ─────────────────────────────────────────────────
  battery('the platform ceilings: ten top-level properties and under 64KB, pinned with their source');
  {
    t('the top-level cap is the platform\'s ten', CLIENT_PAYLOAD_MAX_TOP_LEVEL, 10);
    t('the byte cap is the platform\'s 64KB', CLIENT_PAYLOAD_MAX_BYTES, 65536);
    t('the event_type cap is the platform\'s 100 characters, and ours is under it', [EVENT_TYPE_MAX_CHARS, RELAY_EVENT_TYPE.length <= EVENT_TYPE_MAX_CHARS], [100, true]);
    const opsSource = readFileSync(new URL('./ops.mjs', import.meta.url), 'utf8');
    t('the source of the ceilings is cited beside them', opsSource.includes('create-a-repository-dispatch-event') && opsSource.includes('rest-api-description'));
    // Two 60000-byte bodies fit one action's cap each and exceed the platform's payload cap together.
    const big = fixturePayload({ actions: [{ op: 'comment', issue: 1, body: 'x'.repeat(60_000) }, { op: 'comment', issue: 1, body: 'x'.repeat(60_000) }] });
    t('a payload at or over 64KB is refused with the split prescription', refuses(big, 'split the actions'));
    t('…while one 60000-byte body is accepted', validatePayload(fixturePayload({ actions: [{ op: 'comment', issue: 1, body: 'x'.repeat(60_000) }] })).ok);
  }

  // ── refused by construction ───────────────────────────────────────────────
  battery('refused by construction: no row reaches a merge, a review, a ref, contents, a workflow, a release or an org endpoint');
  {
    const sample = {
      issue: 7, pull: 7, comment_id: 7, body: 'b', title: 't', head: 'h', base: 'main', labels: ['a b'], assignees: ['u'], reviewers: ['u'], team_reviewers: ['t'], state: 'closed', state_reason: 'completed',
    };
    const everyRequest = OP_NAMES.flatMap((op) => {
      const spec = OPS[op];
      const a = { op };
      for (const k of [...spec.required, ...spec.optional]) a[k] = sample[k];
      return spec.requests(a, 'objectstack-ai/objectstack').map((r) => ({ op, ...r }));
    });
    t('every op produces at least one request', everyRequest.length >= OP_NAMES.length);
    t('⛔ no request path reaches a refused family', everyRequest.filter((r) => REFUSED_PATH_FAMILIES.some((re) => re.test(r.path))).map((r) => `${r.op} ${r.path}`), []);
    t('⛔ no row issues PUT — the whole-set verbs are absent by construction', everyRequest.filter((r) => r.verb === 'PUT').map((r) => r.op), []);
    t('every verb is one of POST, PATCH, DELETE', everyRequest.every((r) => ['POST', 'PATCH', 'DELETE'].includes(r.verb)));
    t('every GraphQL descriptor names an allowed mutation and its query spells that name', everyRequest.filter((r) => r.graphql).every((r) => ALLOWED_MUTATIONS.includes(r.graphql.mutation) && r.graphql.query.includes(r.graphql.mutation)));
    t('pr_create forces draft: true whatever the action said', OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b' }, 'o/r')[0].body.draft, true);
    t('labels_remove is one directed DELETE per name, URL-encoded, idempotent on 404', OPS.labels_remove.requests({ op: 'labels_remove', issue: 1, labels: ['a b', 'c'] }, 'o/r').map((r) => [r.verb, r.path, r.idempotent404]), [['DELETE', '/repos/o/r/issues/1/labels/a%20b', true], ['DELETE', '/repos/o/r/issues/1/labels/c', true]]);
    t('every op names a permission the token is narrowed to', OP_NAMES.every((op) => OPS[op].permission in PERMISSIONS));
  }

  // ── the normalised payload ────────────────────────────────────────────────
  battery('the normalised payload: only judged keys travel');
  {
    const v = validatePayload(fixturePayload({ actions: [{ op: 'issue_patch', issue: 3, state: 'closed' }] }));
    t('the normalised action carries op and the judged keys only', v.payload.actions[0], { op: 'issue_patch', issue: 3, state: 'closed' });
    t('the envelope order is fixed', Object.keys(v.payload), [...PAYLOAD_KEYS]);
    const p = fixturePayload({ actions: [{ op: 'labels_add', issue: 1, labels: ['a'] }] });
    const out = validatePayload(p).payload;
    out.actions[0].labels.push('b');
    t('the normalised copy shares no array with the input', p.actions[0].labels, ['a']);
  }

  // ── the CLI ───────────────────────────────────────────────────────────────
  battery('the CLI: a file, the environment, GitHub outputs, and the exit ladder');
  {
    const good = JSON.stringify(fixturePayload());
    const files = { 'good.json': good, 'bad.json': JSON.stringify(fixturePayload({ repo: 'x/y' })), 'notjson.json': '{' };
    const read = (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    };
    const drive = async (argv, env = {}) => {
      const out = [];
      const err = [];
      const appended = [];
      const code = await main(argv, { env, read, stdout: (l) => out.push(l), stderr: (l) => err.push(l), append: (file, text) => appended.push({ file, text }) });
      return { code, out: out.join('\n'), err: err.join('\n'), appended };
    };
    t('no source is usage', (await drive([])).code, EXIT_REFUSED);
    t('an unknown flag is usage, never ignored', (await drive(['--file', 'good.json', '--verbose'])).code, EXIT_REFUSED);
    const ok = await drive(['--file', 'good.json']);
    t('a valid file is exit 0 and the OK line names request, target, session and the ops', [ok.code, ok.out.includes('fw-20260922T090000Z-abc123') && ok.out.includes('objectstack-ai/objectstack') && ok.out.includes('comment')], [EXIT_OK, true]);
    const bad = await drive(['--file', 'bad.json'], { GITHUB_STEP_SUMMARY: '/summary.md' });
    t('a refused file is exit 2, the reasons on stderr, and the step summary says zero writes', [bad.code, bad.err.includes('REFUSED'), bad.appended[0]?.file, bad.appended[0]?.text.includes('zero writes')], [EXIT_REFUSED, true, '/summary.md', true]);
    t('an unreadable file is exit 3, NOT MEASURED', (await drive(['--file', 'missing.json'])).code, EXIT_PREREQUISITE);
    t('a file that is not JSON is exit 3', (await drive(['--file', 'notjson.json'])).code, EXIT_PREREQUISITE);
    t('--from-env with the variable absent is exit 3 naming the variable', (await drive(['--from-env'], {})).err.includes(PAYLOAD_ENV) && (await drive(['--from-env'], {})).code === EXIT_PREREQUISITE);
    const env = await drive(['--from-env', '--github-output'], { [PAYLOAD_ENV]: good, GITHUB_OUTPUT: '/out.txt' });
    t('--from-env --github-output writes repo_name, request_id, action_count and session to $GITHUB_OUTPUT', [env.code, env.appended[0]?.file, env.appended[0]?.text], [EXIT_OK, '/out.txt', 'repo_name=objectstack\nrequest_id=fw-20260922T090000Z-abc123\naction_count=1\nsession=session_01ABCDEFGHJKMNPQRSTVWXYZ\n']);
    t('--github-output without GITHUB_OUTPUT is exit 3', (await drive(['--from-env', '--github-output'], { [PAYLOAD_ENV]: good })).code, EXIT_PREREQUISITE);
    t('--json prints the normalised payload as one line after the OK line', JSON.parse((await drive(['--file', 'good.json', '--json'])).out.split('\n')[1]).request_id, 'fw-20260922T090000Z-abc123');
  }

  // ── the floor, BEFORE the verdict ─────────────────────────────────────────
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floor.push(`the battery ledger declares ${declared.length} batteries, below its floor of ${SELF_TEST_BATTERY_FLOOR} — a section that stopped being declared is a section nothing floors.`);
  }
  for (const [name, count] of batteryCases) {
    if (name in SELF_TEST_BATTERIES) continue;
    floor.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floor.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  for (const message of floor) cases.push({ name: message, ok: false, detail: '' });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ fleet-write/validate self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ fleet-write/validate self-test: ${cases.length} cases pass across ${declared.length} batteries — a closed envelope, one organization, ` +
      'closed keys per op with typed values, the platform\'s own client_payload ceilings pinned with their source, and no row that can reach a refused family.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ fleet-write/validate self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}

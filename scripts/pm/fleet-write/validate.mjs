#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-write/validate — the closed-schema gate every relay payload passes,
 * on BOTH sides of the boundary.
 *
 *   node scripts/pm/fleet-write/validate.mjs --file payload.json          # judge a payload on disk
 *   node scripts/pm/fleet-write/validate.mjs --from-env                   # judge $FLEET_WRITE_PAYLOAD (the runner)
 *   node scripts/pm/fleet-write/validate.mjs --from-env --github-output   # …and write repositories / request_id / action_count to $GITHUB_OUTPUT
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
 *     capped in length and per item; an enum is one of its values; a sha is
 *     exactly 40 lowercase hex characters — a short one is refused HERE,
 *     before the dispatch, never left to the platform's 422;
 *   - the whole payload respects the platform's own `client_payload` limits
 *     (ten top-level properties, under 64KB — the header of `ops.mjs` quotes
 *     the source), so what this file accepts the platform accepts;
 *   - a stroke carrying a `transfer` carries transfers alone, to ONE target
 *     from `TRANSFER_TARGETS` that is not `repo`, each card once — so the
 *     token list below is `repo` alone for every other stroke and exactly
 *     `repo` + that target for a transfer stroke;
 *   - a stroke carrying a `workflow_dispatch` carries exactly that one action
 *     (the row's `alone`): its token carries `actions: write`, and that grant
 *     serves one request and nothing beside it. `workflow` is judged against
 *     the closed allowlist and `ref` against the one ref, as enums — an
 *     off-list file, a path, a glob or another ref is refused by name — and
 *     `inputs` against the file's closed entry (the row's `closedInputs`,
 *     `WORKFLOW_DISPATCH_INPUTS` in `ops.mjs`): exactly that object, every key
 *     and value, or no `inputs` key where the entry is `null`. A missing
 *     input, another value (`refresh_version_pr: false` on `release.yml`, the
 *     publish-repair lane) or any other input (`force`) is refused by name;
 *   - a stroke carrying a `run_rerun_failed` carries exactly that one action
 *     too (the row's `alone`), for the same reason: its token carries
 *     `actions: write`. Its one key is `run_id`, a positive integer; a
 *     workflow, an attempt, a job, an event or the platform's debug-logging
 *     flag beside it is refused by name. The five fences on the RUN and its
 *     pull — the workflow, the event, once, failed, the head
 *     (`RERUN_FAILED_FENCES` in `ops.mjs`) — are facts this file cannot see:
 *     the executor judges them on the run and the pull's own answer, read
 *     immediately before its POST;
 *   - a `sub_issue_add` or `sub_issue_remove` names two issue NUMBERS,
 *     `issue` the parent and `sub_issue` the child, each a positive integer,
 *     and never the same one twice (the row's `distinct`); a `sub_issue_id`,
 *     a `replace_parent` or any other key beside them is refused by name. The
 *     fences on the two CARDS — each an issue on the repository, the child
 *     free of any other parent (add) or listed by this one (remove) — are
 *     facts this file cannot see: the executor judges them on its own reads
 *     before the write (`SUB_ISSUE_FENCES` in `ops.mjs`). Both spend
 *     `issues: write`, so they ride any stroke with the other issue ops;
 *   - a `pr_create` may carry `assignees` and `labels`, the typed lists
 *     `assign` and `labels_add` take — judged here as every list is — and the
 *     op table turns each into a later request of the SAME action, sent by
 *     the executor at the number the create answered (`ops.mjs`, its header),
 *     so no separate assign or label write exists for anything to refuse.
 *
 * ## The token list and the token's grants — where a stroke widens either
 *
 * `--github-output` writes `repositories=<name>[,<name>]`, the list the
 * workflow's mint step narrows the App token to (`tokenRepositoriesOf`): the
 * payload's repository, plus the `secondRepo` a row declares — `transfer`'s
 * target, the only such row. It also writes one `permission_<name>=` line per
 * grant in `STROKE_SCOPED_PERMISSIONS` (`tokenPermissionsOf`): the level when
 * an action in the stroke spends it, empty otherwise — `permission_actions=write`
 * for a `workflow_dispatch` or `run_rerun_failed` stroke, `permission_actions=`
 * for every other. So the second row rides the workflow's existing input and
 * the workflow names neither op. The
 * workflow reads those outputs and never the payload, and `--self-test` pins
 * the list to ONE name for every other op, two for a transfer, the grant to
 * the one row, and the workflow lines that read both.
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

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../../invoked-as.mjs';
import { GOVERNED_REPOS } from '../check-governed-merges.mjs';
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
  RELAY_FILES,
  REQUEST_ID_SHAPE,
  RERUN_FAILED_ATTEMPT,
  RERUN_FAILED_CONCLUSION,
  RERUN_FAILED_EVENT,
  RERUN_FAILED_FENCES,
  RERUN_FAILED_PATH_SHAPE,
  RERUN_FAILED_RERUN_STATES,
  RERUN_FAILED_STATUS,
  RERUN_FAILED_WORKFLOWS,
  SESSION_SHAPE,
  SHA_SHAPE,
  STROKE_SCOPED_PERMISSIONS,
  SUB_ISSUE_FENCES,
  SUB_ISSUE_MODES,
  TARGET_OWNER,
  TARGET_REPO_SHAPE,
  TRANSFER_TARGETS,
  WORKFLOW_DISPATCH_ALLOWLIST,
  WORKFLOW_DISPATCH_INPUTS,
  WORKFLOW_DISPATCH_PATH_SHAPE,
  WORKFLOW_DISPATCH_REF,
  GOVERNED_REVIEW_OPS,
  answerPlaceholder,
  dispatchInputsOnTheWire,
  failedJobNames,
  governedReviewRequests,
  rerunFailedFenceFailures,
  rerunFailedFenceText,
  rerunFailedLandedText,
  rerunFailedPullNumber,
  rerunFailedReadBack,
  subIssueAlreadyHere,
  subIssueCardFailure,
  subIssueFenceFailures,
  subIssueFenceText,
  subIssueLandedText,
  subIssueReadBack,
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
  if (spec.kind === 'sha') {
    if (typeof value !== 'string' || !SHA_SHAPE.test(value)) return `${at} must be the full 40-hex commit sha (lowercase), got ${quote(value)} — a short or hand-typed sha is refused here, before the dispatch, not by the platform's 422`;
    return null;
  }
  if (spec.kind === 'inputs') {
    if (!isPlainObject(value)) return `${at} must be a JSON object of input name → boolean, got ${Array.isArray(value) ? 'an array' : quote(value)}`;
    const names = Object.keys(value);
    if (names.length === 0) return `${at} must name at least one input — a workflow started with none carries no inputs key`;
    for (const name of names) {
      if (typeof value[name] !== 'boolean') return `${at}.${name} must be a JSON boolean, got ${quote(value[name])}`;
    }
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
  const refusedKeys = new Set();
  for (const key of Object.keys(action)) {
    if (key === 'op' || !allowed.has(key)) continue;
    const e = validateField(key, action[key], FIELDS[key], where);
    if (e) {
      errors.push(e);
      refusedKeys.add(key);
    }
  }
  if (spec.closedInputs && !refusedKeys.has('inputs') && typeof action.workflow === 'string' && Object.hasOwn(spec.closedInputs, action.workflow)) {
    errors.push(...closedInputsErrors(action, spec.closedInputs[action.workflow], where));
  }
  // Two keys the row needs DIFFERENT (`distinct`, ops.mjs): judged only on values the field kinds admitted.
  if (spec.distinct) {
    const [a, b] = spec.distinct;
    if (a in action && b in action && !refusedKeys.has(a) && !refusedKeys.has(b) && action[a] === action[b]) {
      errors.push(`${where}.${b} is ${quote(action[b])}, the same as ${a} — \`${op}\` links two different issues, and an issue is never its own sub-issue`);
    }
  }
  return errors;
}

/**
 * The action's `inputs` against its workflow's closed entry (`closedInputs`,
 * `WORKFLOW_DISPATCH_INPUTS` in `ops.mjs`): `null` admits no `inputs` key; an
 * object admits exactly itself — each missing input, each other value and
 * each other input is a reason of its own. `validateAction` calls it only on
 * an `inputs` the field kind admitted (or none), so a shape refused there is
 * not judged twice. Pure.
 */
export function closedInputsErrors(action, declared, where) {
  const workflow = action.workflow;
  const has = 'inputs' in action;
  if (declared === null) {
    return has ? [`${where}.inputs: ${workflow} declares no inputs and the relay sends none — an action naming it carries no inputs key`] : [];
  }
  const exactly = `exactly ${quote(declared)}`;
  if (!has) return [`${where}.inputs is required when workflow is ${quote(workflow)}: ${exactly} — the one lane the relay may start there`];
  const sent = action.inputs;
  const errors = [];
  for (const name of Object.keys(sent)) {
    if (!Object.hasOwn(declared, name)) errors.push(`${where}.inputs.${name} is not an input the relay sends to ${workflow} — it sends ${exactly}`);
  }
  for (const [name, value] of Object.entries(declared)) {
    if (!Object.hasOwn(sent, name)) errors.push(`${where}.inputs.${name} is required when workflow is ${quote(workflow)}: ${exactly}`);
    else if (sent[name] !== value) errors.push(`${where}.inputs.${name} must be ${quote(value)} when workflow is ${quote(workflow)}, got ${quote(sent[name])} — the relay sends ${exactly}`);
  }
  return errors;
}

/**
 * The rules that span actions — the two rows that widen the token. The one
 * whose token reaches a second repository (`secondRepo`, `transfer`'s alone):
 * such a stroke carries that op alone, names ONE second repository, never
 * `repo` itself, and each card once. The ones whose token carries a grant no
 * other row spends (`alone`, `workflow_dispatch`'s and `run_rerun_failed`'s,
 * the two that spend `actions: write`): such a stroke carries exactly that
 * one action. Runs only over actions that passed
 * `validateAction`. Pure.
 */
export function strokeErrors(repo, actions) {
  const errors = [];
  const solo = actions.map((a, i) => ({ a, i })).filter(({ a }) => OPS[a.op].alone);
  if (solo.length && actions.length > 1) {
    const op = solo[0].a.op;
    for (const [i, a] of actions.entries()) {
      errors.push(
        a.op === op
          ? `actions[${i}]: a stroke carries exactly ONE \`${op}\` and nothing else (this stroke carries ${actions.length} actions) — its token carries ${OPS[op].permission} write for that one request; send each in its own dispatch`
          : `actions[${i}] is \`${a.op}\` in a stroke that carries a \`${op}\` — its token carries ${OPS[op].permission} write, so that stroke carries the \`${op}\` alone; send \`${a.op}\` in its own dispatch`,
      );
    }
  }
  const widening = actions.map((a, i) => ({ a, i })).filter(({ a }) => OPS[a.op].secondRepo);
  if (widening.length === 0) return errors;
  const op = widening[0].a.op;
  const key = OPS[op].secondRepo;
  for (const [i, a] of actions.entries()) {
    if (a.op !== op) errors.push(`actions[${i}] is \`${a.op}\` in a stroke that carries a \`${op}\` — its token reaches a second repository, so that stroke carries \`${op}\` alone; send \`${a.op}\` in its own dispatch`);
  }
  const seconds = [...new Set(widening.map(({ a }) => a[key]))];
  if (seconds.length > 1) errors.push(`the \`${op}\` actions name ${seconds.length} ${key} values (${seconds.join(', ')}) — one stroke reaches ONE second repository; split them into one dispatch per ${key}`);
  for (const { a, i } of widening) {
    if (a[key] === repo) errors.push(`actions[${i}].${key} is ${repo}, the stroke's own repository — a \`${op}\` moves a card to ANOTHER repository`);
  }
  const seen = new Set();
  for (const { a, i } of widening) {
    if (seen.has(a.issue)) errors.push(`actions[${i}].issue #${a.issue} is named twice in one \`${op}\` stroke`);
    seen.add(a.issue);
  }
  return errors;
}

/**
 * Every action, then the rules that span them — the stroke without its
 * envelope, for a door that plans one before it knows its transport.
 */
export function validateStroke(repo, actions) {
  const errors = actions.flatMap((a, i) => validateAction(a, i));
  return errors.length ? errors : strokeErrors(repo, actions);
}

/**
 * The repositories the relay's token must reach for a JUDGED payload: its
 * `repo`, then the one second repository a `secondRepo` row names. One entry
 * for every stroke but a transfer; two for a transfer stroke.
 */
export function tokenRepositoriesOf(payload) {
  const out = [payload.repo];
  for (const a of payload.actions) {
    const key = OPS[a.op].secondRepo;
    if (key && !out.includes(a[key])) out.push(a[key]);
  }
  return out;
}

/**
 * The grants the relay's token must carry for a JUDGED payload: every entry of
 * `PERMISSIONS` but the stroke-scoped ones, plus each stroke-scoped grant some
 * action's op spends. `{ …five grants }` for every stroke but a
 * `workflow_dispatch` or `run_rerun_failed` one, which adds `actions: write`. Pure.
 */
export function tokenPermissionsOf(payload) {
  const spent = new Set(payload.actions.map((a) => OPS[a.op].permission));
  const out = {};
  for (const [name, level] of Object.entries(PERMISSIONS)) {
    if (!STROKE_SCOPED_PERMISSIONS.includes(name) || spent.has(name)) out[name] = level;
  }
  return out;
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
  else errors.push(...validateStroke(typeof repo === 'string' ? repo : '', actions));

  if (errors.length) return { ok: false, errors, payload: null };

  const payload = {
    request_id: requestId,
    repo,
    session,
    actions: actions.map((a) => {
      const spec = OPS[a.op];
      const out = { op: a.op };
      for (const key of [...spec.required, ...spec.optional]) if (key in a) out[key] = Array.isArray(a[key]) ? [...a[key]] : isPlainObject(a[key]) ? { ...a[key] } : a[key];
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

/**
 * The `$GITHUB_OUTPUT` lines the workflow's later steps read. Values are
 * single-line by construction of the validator. One `permission_<name>=` line
 * per stroke-scoped grant: its level when this stroke spends it, EMPTY
 * otherwise — the mint action skips an empty `permission-*` input.
 */
export function githubOutputLines(payload) {
  const repositories = tokenRepositoriesOf(payload).map((r) => r.split('/')[1]).join(',');
  const grants = tokenPermissionsOf(payload);
  const scoped = STROKE_SCOPED_PERMISSIONS.map((name) => `permission_${name.replace(/-/g, '_')}=${grants[name] ?? ''}`);
  return [`repositories=${repositories}`, `request_id=${payload.request_id}`, `action_count=${payload.actions.length}`, `session=${payload.session}`, ...scoped].join('\n') + '\n';
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
// A dispatched workflow, read from disk — what the self-test holds an allowlisted entry to.
//
// An entry's inputs pick a lane of another file, so the claim "the relay starts that lane alone" is a claim
// about THAT file. Two readers keep it measured, not recalled: `declaredDispatchInputs` reads the inputs the
// file declares under its `workflow_dispatch` trigger, and `jobsStartedBy` evaluates every job's `if:` for a
// given event and inputs — job by job in `needs` order, with three values (true, false, UNKNOWN), so a guard
// this reading cannot decide (a running job's result or outputs, a function it does not model) reads as a
// job that MAY run, never as one that skips. Both are text readings of the workflow's own shape (two-space
// YAML, a job's `if:` at four spaces), not a YAML library — a file they cannot read yields no inputs or no
// jobs, and every case that uses them first pins that they read something.
// ---------------------------------------------------------------------------

/**
 * The inputs a workflow declares under its `workflow_dispatch` trigger, as
 * `{ name: { type, default } }` — `{}` for a trigger declaring none, `null`
 * for a file with no such trigger. Pure.
 */
export function declaredDispatchInputs(text) {
  const lines = String(text).split('\n');
  const at = lines.findIndex((l) => /^ {2}workflow_dispatch:\s*(\{\s*\})?\s*(#.*)?$/.test(l));
  if (at < 0) return null;
  const out = {};
  let inInputs = false;
  let current = null;
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^ {0,2}\S/.test(line)) break;
    if (!inInputs) {
      inInputs = /^ {4}inputs:\s*$/.test(line);
      continue;
    }
    if (/^ {0,4}\S/.test(line)) break;
    const name = /^ {6}([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (name) {
      current = name[1];
      out[current] = { type: null, default: null };
      continue;
    }
    const field = /^ {8}(type|default):\s*'?([^'#\s]+)'?\s*(#.*)?$/.exec(line);
    if (field && current) out[current][field[1]] = field[2];
  }
  return out;
}

/** Every job of a workflow: `{ name: { guard, needs } }`, the guard's text unwrapped or `null`. Pure. */
export function workflowJobs(text) {
  const lines = String(text).split('\n');
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs = {};
  if (at < 0) return jobs;
  let job = null;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[^\s#]/.test(line)) break;
    const head = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (head) {
      job = jobs[head[1]] = { guard: null, needs: [] };
      continue;
    }
    if (!job) continue;
    const guard = /^ {4}if:\s*(.*)$/.exec(line);
    if (guard) {
      const parts = [guard[1]];
      for (let j = i + 1; j < lines.length && /^ {6,}[^\s#]/.test(lines[j]); j++) parts.push(lines[j].trim());
      job.guard = parts.join(' ').replace(/^[>|]-?\s*/, '').replace(/\s+/g, ' ').trim();
      continue;
    }
    const needs = /^ {4}needs:\s*\[([^\]]*)\]\s*$/.exec(line) ?? /^ {4}needs:\s*([A-Za-z0-9_-]+)\s*$/.exec(line);
    if (needs) job.needs = needs[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return jobs;
}

const UNKNOWN = Symbol('unknown');
const truth = (v) => (v === UNKNOWN ? UNKNOWN : !(v === false || v === null || v === '' || v === 0 || Number.isNaN(v)));
const all = (vs) => (vs.some((v) => v === false) ? false : vs.some((v) => v === UNKNOWN) ? UNKNOWN : true);
const any = (vs) => (vs.some((v) => v === true) ? true : vs.some((v) => v === UNKNOWN) ? UNKNOWN : false);
const loosely = (a, b) => {
  if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a === typeof b) return a === b;
  return Number(a ?? 0) === Number(b ?? 0);
};

/**
 * One guard, evaluated: `true`, `false` or UNKNOWN. `lookup(path)` answers a
 * context path, `status(fn)` a status function. Throws on a token it cannot read.
 */
function evaluateGuard(expr, { lookup, status }) {
  const tokens = [];
  const re = /\s*(?:(\$\{\{|\}\})|'((?:[^']|'')*)'|(&&|\|\||==|!=|!|\(|\)|,)|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_.*-]*))/y;
  const src = String(expr);
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1]) continue;
    if (m[2] !== undefined) tokens.push({ kind: 'value', value: m[2].replace(/''/g, "'") });
    else if (m[3]) tokens.push({ kind: m[3] });
    else if (m[4]) tokens.push({ kind: 'value', value: Number(m[4]) });
    else if (m[5]) tokens.push({ kind: 'name', value: m[5] });
  }
  if (src.slice(re.lastIndex).trim() !== '') throw new Error(`cannot read the guard at ${JSON.stringify(src.slice(re.lastIndex, re.lastIndex + 20))}`);
  let i = 0;
  const peek = (k) => tokens[i]?.kind === k;
  const take = (k) => {
    if (!peek(k)) throw new Error(`expected ${k} at token ${i} of ${JSON.stringify(src)}`);
    return tokens[i++];
  };
  const primary = () => {
    if (peek('(')) {
      take('(');
      const v = or();
      take(')');
      return v;
    }
    if (peek('value')) return take('value').value;
    const name = take('name').value;
    if (peek('(')) {
      take('(');
      const args = [];
      while (!peek(')')) {
        args.push(or());
        if (peek(',')) take(',');
      }
      take(')');
      return status(name, args);
    }
    if (name === 'true') return true;
    if (name === 'false') return false;
    if (name === 'null') return null;
    return lookup(name);
  };
  const unary = () => {
    if (peek('!')) {
      take('!');
      const v = truth(unary());
      return v === UNKNOWN ? UNKNOWN : !v;
    }
    return primary();
  };
  const eq = () => {
    const left = unary();
    if (peek('==') || peek('!=')) {
      const op = tokens[i++].kind;
      const r = loosely(left, unary());
      return op === '==' || r === UNKNOWN ? r : !r;
    }
    return left;
  };
  const and = () => {
    let v = truth(eq());
    while (peek('&&')) {
      take('&&');
      v = all([v, truth(eq())]);
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (peek('||')) {
      take('||');
      v = any([v, and()]);
    }
    return v;
  };
  const v = or();
  if (i !== tokens.length) throw new Error(`unread tokens after ${i} in ${JSON.stringify(src)}`);
  return v;
}

/**
 * Which jobs of a workflow a run with `event` and `inputs` starts: `{ runs,
 * mayRun, skipped, unread }`, each a list of job names. A job's guard without a
 * status function is read as GitHub reads it, `success() && (guard)`; a job
 * with no guard is `success()`. A skipped job's outputs are empty; a job that
 * runs answers UNKNOWN for its result and its outputs, so a job downstream of
 * one is decided only when its guard does not depend on them. Pure.
 */
export function jobsStartedBy(text, { event, inputs = {} }) {
  const jobs = workflowJobs(text);
  const state = {};
  const out = { runs: [], mayRun: [], skipped: [], unread: [] };
  const pending = new Set(Object.keys(jobs));
  while (pending.size) {
    const ready = [...pending].filter((name) => jobs[name].needs.every((n) => n in state || !(n in jobs)));
    if (!ready.length) {
      for (const name of pending) out.unread.push(`${name}: its needs never resolve`);
      break;
    }
    for (const name of ready) {
      pending.delete(name);
      const needs = jobs[name].needs.map((n) => state[n] ?? 'skipped');
      const lookup = (path) => {
        if (path === 'github.event_name') return event;
        if (path === 'github.ref') return `refs/heads/${WORKFLOW_DISPATCH_REF}`;
        if (path.startsWith('inputs.')) return event === 'workflow_dispatch' ? (inputs[path.slice('inputs.'.length)] ?? null) : null;
        const need = /^needs\.([A-Za-z0-9_-]+)\.(outputs\.|result$)/.exec(path);
        if (need) {
          const s = state[need[1]] ?? 'skipped';
          if (s === 'skipped') return need[2] === 'result' ? 'skipped' : '';
          return UNKNOWN;
        }
        return UNKNOWN;
      };
      const status = (fn) => {
        if (fn === 'always') return true;
        if (fn === 'cancelled') return false;
        if (fn === 'success') return needs.some((s) => s === 'skipped') ? false : needs.length === 0 ? true : UNKNOWN;
        if (fn === 'failure') return needs.every((s) => s === 'skipped') ? false : UNKNOWN;
        return UNKNOWN;
      };
      const guard = jobs[name].guard;
      const explicit = guard !== null && /\b(success|failure|always|cancelled)\s*\(/.test(guard);
      let verdict;
      try {
        verdict = guard === null ? status('success') : explicit ? truth(evaluateGuard(guard, { lookup, status })) : all([status('success'), truth(evaluateGuard(guard, { lookup, status }))]);
      } catch (e) {
        out.unread.push(`${name}: ${e.message}`);
        verdict = UNKNOWN;
      }
      state[name] = verdict === true ? 'runs' : verdict === false ? 'skipped' : 'may-run';
      out[verdict === true ? 'runs' : verdict === false ? 'skipped' : 'mayRun'].push(name);
    }
  }
  return out;
}

/**
 * The inputs a dispatch carrying `sent` runs with: every declared input at its
 * declared default (a boolean's spelled `true` / `false` read as one), then
 * what was sent. Pure.
 */
export function dispatchRunInputs(declared, sent) {
  const out = {};
  for (const [name, { type, default: d }] of Object.entries(declared ?? {})) out[name] = type === 'boolean' ? d === 'true' : (d ?? null);
  return { ...out, ...(sent ?? {}) };
}

// ---------------------------------------------------------------------------
// Self-test — offline. The battery roster is the floor (AGENTS.md, "Writing a --self-test").
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the envelope: four keys, every one required, nothing else admitted': 9,
  'the fields: request_id shape and cap, the one organization, the session id': 8,
  'the actions: count, the closed op list, closed keys per op, typed values': 30,
  'the platform ceilings: ten top-level properties and under 64KB, pinned with their source': 6,
  'refused by construction: no row reaches a merge, a review, a ref, contents, a workflow, a release or an org endpoint': 22,
  'the normalised payload: only judged keys travel': 3,
  'the CLI: a file, the environment, GitHub outputs, and the exit ladder': 10,
  'the transfer row: an issue never a pull, a target from the governed roster never the source, a stroke of its own to one target, labels never created': 12,
  'the token scope: ONE repository for every op but transfer, source + target for a transfer stroke, and the workflow mints from that list': 8,
  'the workflow_dispatch row: a closed allowlist of files matched whole, each with its closed inputs, ref main alone, a stroke of exactly that one action, actions write minted for that stroke alone, and the dispatch call and the failed-jobs re-run the ONLY actions paths any row reaches': 18,
  "the release.yml entry: refresh_version_pr true and nothing beside it — force, false, absent, a string or any other input refused by name; the wire spells the table's value as a string; every entry's inputs declared on disk; and the file's own guards, evaluated, start the bookkeeping lane alone": 22,
  "the run_rerun_failed row: run_id alone, a positive integer, nothing that widens it; one bodiless POST to the run's rerun-failed-jobs; a stroke of exactly that one action; actions write minted for that stroke and EMPTY for every other, through the workflow's existing input; the five fences on the run and its pull, each accepted and refused — the head by the pull's own answer, never the run's embedded copy, and a run naming no pull refused by name; the read-back's judgment; and every other actions path still refused": 33,
  "the hierarchy rows: sub_issue_add and sub_issue_remove name a parent and a child by NUMBER — two different positive integers and nothing that widens them; one POST to the parent's sub_issues and one DELETE to its sub_issue, the body left to the executor; issues write, riding any stroke on the literal grants; the fences on the two cards, each accepted and refused — an issue on the repository, never a pull or a transferred card, the child free of any other parent or listed by this one; and the read-back's judgment by the child's id": 23,
});
// Raised 11 → 12 with the run_rerun_failed battery, 12 → 13 with the hierarchy rows' battery: one battery, one row.
const SELF_TEST_BATTERY_FLOOR = 13;
const UNATTRIBUTED_BATTERY = '(unattributed)';

const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

/**
 * A payload every case starts from; each case mutates a copy.
 *
 * The target is spelled from `TARGET_OWNER`, not as one quoted slug: the
 * dispatch derivation reads every separator-bearing literal in this module's
 * body as a path this gate declares, and a slug names no tracked file, so a
 * bare `owner/name` here is a dead declaration `check:declared-population-live`
 * refuses. This gate's real population is the relay's four files, inherited
 * from `RELAY_FILES` in `ops.mjs` and checked on disk by the self-test below.
 */
export function fixturePayload(overrides = {}) {
  return {
    request_id: 'fw-20260922T090000Z-abc123',
    repo: `${TARGET_OWNER}/objectstack`,
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
  /** A full sha, as a seat reads one off `GET /pulls/{n}` — the only spelling `expected_head_sha` takes. */
  const SHA = '0123456789abcdef0123456789abcdef01234567';

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
    // pr_update_branch: the sha is judged HERE, before the dispatch — a short one never reaches the platform's 422.
    t('pr_update_branch: a short sha is refused before the dispatch, naming the full shape', refuses(one({ op: 'pr_update_branch', pull: 1, expected_head_sha: SHA.slice(0, 7) }), 'full 40-hex commit sha'));
    t('…and so are an uppercase, a non-hex and a 41-character spelling', [SHA.toUpperCase(), 'g'.repeat(40), `${SHA}0`].map((sha) => refuses(one({ op: 'pr_update_branch', pull: 1, expected_head_sha: sha }), 'full 40-hex commit sha')), [true, true, true]);
    t('…a missing expected_head_sha is refused — required, never defaulted to the current head', refuses(one({ op: 'pr_update_branch', pull: 1 }), 'actions[0].expected_head_sha is required'));
    t('…and the accepted shape is pull plus the full sha and nothing else', [validatePayload(one({ op: 'pr_update_branch', pull: 22002, expected_head_sha: SHA })).ok, refuses(one({ op: 'pr_update_branch', pull: 1, expected_head_sha: SHA, body: 'x' }), 'actions[0].body is not a key `pr_update_branch` takes')], [true, true]);
    // pr_create with assignees: the same typed list `assign` takes, judged HERE — never left to the platform.
    const opened = (assignees) => one({ op: 'pr_create', title: 't', head: 'h', base: 'main', assignees });
    t('pr_create: assignees that is not an array of strings is refused, naming the shape', [refuses(opened('u'), 'actions[0].assignees must be an array of strings'), refuses(opened({ login: 'u' }), 'actions[0].assignees must be an array of strings')], [true, true]);
    t('…and so is one carrying a non-string login, an empty list, a login named twice, or eleven logins', [[1], [], ['u', 'u'], Array.from({ length: 11 }, (_, i) => `u${i}`)].map((assignees) => refuses(opened(assignees), 'actions[0].assignees')), [true, true, true, true]);
    t('…a login over 39 characters is refused per item, at the platform\'s own cap', refuses(opened(['x'.repeat(40)]), 'per-item cap of 39'));
    t('…and the accepted shape is the create plus a list of logins, body optional either way', [validatePayload(opened(['marchtian'])).ok, validatePayload(one({ op: 'pr_create', title: 't', head: 'h', base: 'main', body: 'b', assignees: ['a', 'b'] })).ok], [true, true]);
    // pr_create with labels: the same typed list `labels_add` takes, judged HERE — a dev's `skip-changeset` rides the create.
    const labelled = (labels) => one({ op: 'pr_create', title: 't', head: 'h', base: 'main', labels });
    t('pr_create: labels that is not an array of strings is refused, naming the shape', [refuses(labelled('skip-changeset'), 'actions[0].labels must be an array of strings'), refuses(labelled({ name: 'skip-changeset' }), 'actions[0].labels must be an array of strings')], [true, true]);
    t('…and so is one carrying a non-string name, an empty list, a name named twice, or twenty-one names', [[1], [], ['a', 'a'], Array.from({ length: 21 }, (_, i) => `l${i}`)].map((labels) => refuses(labelled(labels), 'actions[0].labels')), [true, true, true, true]);
    t("…a name over 50 bytes is refused per item, at the platform's own cap", refuses(labelled(['x'.repeat(51)]), 'per-item cap of 50'));
    t('…and the accepted shape is the create plus a list of names, with or without assignees and body', [validatePayload(labelled(['skip-changeset'])).ok, validatePayload(one({ op: 'pr_create', title: 't', head: 'h', base: 'main', body: 'b', assignees: ['a'], labels: ['skip-changeset', 'documentation'] })).ok], [true, true]);
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
      pr_create: { title: 't', head: 'h', base: 'main', body: 'b', assignees: ['u'], labels: ['l'] },
      pr_request_reviewers: { pull: 1, reviewers: ['u'] },
      pr_update_branch: { pull: 1, expected_head_sha: SHA },
      pr_ready: { pull: 1 },
      pr_draft: { pull: 1 },
      automerge_enable: { pull: 1 },
      automerge_disable: { pull: 1 },
      transfer: { issue: 1, target_repo: `${TARGET_OWNER}/objectui` },
      sub_issue_add: { issue: 1, sub_issue: 2 },
      sub_issue_remove: { issue: 1, sub_issue: 2 },
      workflow_dispatch: { workflow: WORKFLOW_DISPATCH_ALLOWLIST[0], ref: WORKFLOW_DISPATCH_REF },
      run_rerun_failed: { run_id: 1 },
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
      issue: 7, pull: 7, comment_id: 7, body: 'b', title: 't', head: 'h', base: 'main', labels: ['a b'], assignees: ['u'], reviewers: ['u'], team_reviewers: ['t'], state: 'closed', state_reason: 'completed', expected_head_sha: SHA, target_repo: `${TARGET_OWNER}/objectui`,
      workflow: WORKFLOW_DISPATCH_ALLOWLIST[0], ref: WORKFLOW_DISPATCH_REF, run_id: 7, sub_issue: 8,
    };
    const everyRequest = OP_NAMES.flatMap((op) => {
      const spec = OPS[op];
      const a = { op };
      for (const k of [...spec.required, ...spec.optional]) a[k] = sample[k];
      return [
        ...spec.requests(a, 'objectstack-ai/objectstack').map((r) => ({ op, ...r })),
        // The governed-review follow-up's conditional writes (the ops.mjs header) — spelled by the table, sent by the executor after the row lands.
        ...(spec.governedReview ? governedReviewRequests('objectstack-ai/objectstack', 7, { reviewers: ['u'], assignees: ['u'] }).map((r) => ({ op, ...r, governedReview: true })) : []),
      ];
    });
    t('every op produces at least one request', everyRequest.length >= OP_NAMES.length);
    t('the governed-review follow-up runs after exactly pr_create and pr_ready — derived from the rows, never listed — and its two writes are a POST to requested_reviewers carrying requested and a POST to the additive issue-assignees endpoint carrying assigned, both in the family pin above', [GOVERNED_REVIEW_OPS, everyRequest.filter((r) => r.governedReview).map((r) => [r.op, r.verb, r.path, r.requested ?? null, r.assigned ?? null])], [['pr_create', 'pr_ready'], [['pr_create', 'POST', `/repos/${TARGET_OWNER}/objectstack/pulls/7/requested_reviewers`, ['u'], null], ['pr_create', 'POST', `/repos/${TARGET_OWNER}/objectstack/issues/7/assignees`, null, ['u']], ['pr_ready', 'POST', `/repos/${TARGET_OWNER}/objectstack/pulls/7/requested_reviewers`, ['u'], null], ['pr_ready', 'POST', `/repos/${TARGET_OWNER}/objectstack/issues/7/assignees`, null, ['u']]]]);
    t('…an empty list spells no request, and a governedReview row is never a row whose spelled requests change: pr_create and pr_ready keep the request lists they always had', [governedReviewRequests('o/r', 7), OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b' }, 'o/r').length, OPS.pr_ready.requests({ op: 'pr_ready', pull: 7 }, 'o/r').length], [[], 1, 1]);
    t('⛔ no request path reaches a refused family', everyRequest.filter((r) => REFUSED_PATH_FAMILIES.some((re) => re.test(r.path))).map((r) => `${r.op} ${r.path}`), []);
    t('⛔ the table\'s one PUT is pr_update_branch\'s update-branch, an action endpoint — no PUT reaches /labels or /assignees, the whole-set replaces', [everyRequest.filter((r) => r.verb === 'PUT').map((r) => `${r.op} ${r.path}`), everyRequest.some((r) => r.verb === 'PUT' && /\/(labels|assignees)$/.test(r.path))], [[`pr_update_branch /repos/${TARGET_OWNER}/objectstack/pulls/7/update-branch`], false]);
    t('every verb is one of POST, PATCH, PUT, DELETE', everyRequest.every((r) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.verb)));
    t('pr_update_branch spends pull-requests — where GitHub\'s ledger lists update-branch, server-to-server, no additional permission — and carries the sha in its body', [OPS.pr_update_branch.permission, OPS.pr_update_branch.requests({ op: 'pr_update_branch', pull: 7, expected_head_sha: SHA }, 'o/r')[0].body], ['pull-requests', { expected_head_sha: SHA }]);
    t('every GraphQL descriptor names an allowed mutation and its query spells that name', everyRequest.filter((r) => r.graphql).every((r) => ALLOWED_MUTATIONS.includes(r.graphql.mutation) && r.graphql.query.includes(r.graphql.mutation)));
    t('pr_create forces draft: true whatever the action said', OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b' }, 'o/r')[0].body.draft, true);
    // The legs that read an earlier answer — pr_create's assignees and labels (the ops.mjs header): pinned to those two descriptors.
    const legs = everyRequest.filter((r) => r.fromAnswer !== undefined);
    t("⛔ exactly TWO descriptors read an earlier answer — pr_create's assignees leg, then its labels leg: a POST to the created pull's issue-assignees path and one to its issue-labels path, each at the placeholder the executor fills from the create's number, each carrying what its answer must list", legs.map((r) => [r.op, r.verb, r.path, r.fromAnswer, r.body, r.assigned ?? null, r.labelled ?? null]), [['pr_create', 'POST', `/repos/${TARGET_OWNER}/objectstack/issues/${answerPlaceholder('number')}/assignees`, 'number', { assignees: ['u'] }, ['u'], null], ['pr_create', 'POST', `/repos/${TARGET_OWNER}/objectstack/issues/${answerPlaceholder('number')}/labels`, 'number', { labels: ['a b'] }, null, ['a b']]]);
    t('…and neither is the FIRST request of its action — the answer they read exists before either is sent', OP_NAMES.filter((op) => { const a = { op }; for (const k of [...OPS[op].required, ...OPS[op].optional]) a[k] = sample[k]; return OPS[op].requests(a, 'o/r')[0].fromAnswer !== undefined; }), []);
    t('…every such leg is a POST to the one additive issue endpoint for its list — never a PATCH or PUT, the whole-set replaces', legs.map((r) => [r.verb, /\/(assignees|labels)$/.test(r.path)]), [['POST', true], ['POST', true]]);
    t('…their placeholder is the one spelling the executor fills, spelled once, and no path without fromAnswer carries a brace', [answerPlaceholder('number'), everyRequest.filter((r) => r.fromAnswer === undefined && /[{}]/.test(r.path)).map((r) => `${r.op} ${r.path}`)], ['{number}', []]);
    t('every grant a row ALSO spends is a literal mint input of PERMISSIONS, never a stroke-scoped one — so the mint widens nothing for it; pr_create\'s and pr_ready\'s issues write (the legs and the governed-review assignee fallback) and automerge_enable\'s workflows write are the three such rows', [OP_NAMES.flatMap((op) => OPS[op].alsoSpends ?? []).every((name) => name in PERMISSIONS && !STROKE_SCOPED_PERMISSIONS.includes(name)), OP_NAMES.filter((op) => OPS[op].alsoSpends).map((op) => [op, [...OPS[op].alsoSpends]])], [true, [['pr_create', ['issues']], ['pr_ready', ['issues']], ['automerge_enable', ['workflows']]]]);
    t('pr_create without assignees or labels is the one create request it always was — no later leg', OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b' }, 'o/r').length, 1);
    t('…with labels alone, the create then the labels leg; with assignees alone, the create then the assignees leg', [OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b', labels: ['skip-changeset'] }, 'o/r').map((r) => r.labelled ?? r.assigned ?? 'create'), OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b', assignees: ['u'] }, 'o/r').map((r) => r.labelled ?? r.assigned ?? 'create')], [['create', ['skip-changeset']], ['create', ['u']]]);
    t('labels_remove is one directed DELETE per name, URL-encoded, idempotent on 404', OPS.labels_remove.requests({ op: 'labels_remove', issue: 1, labels: ['a b', 'c'] }, 'o/r').map((r) => [r.verb, r.path, r.idempotent404]), [['DELETE', '/repos/o/r/issues/1/labels/a%20b', true], ['DELETE', '/repos/o/r/issues/1/labels/c', true]]);
    t('every op names a permission the token is narrowed to', OP_NAMES.every((op) => OPS[op].permission in PERMISSIONS));
    // The permission map, pinned entry by entry: the auto-merge mutations need `contents: write` on the
    // App token (measured live: without it, "Resource not accessible by integration"), and NOTHING else may
    // spend it — the table has no contents op, so the grant reaches exactly two mutations. `workflows: write`
    // is the maintainer's ruling (comment 6104822731): a literal grant on every stroke, spent by the
    // `automerge_enable` row alone (`alsoSpends`) when the pull it arms changes a workflow file.
    t('the map is exactly issues/pull-requests/contents/workflows/actions write and metadata read', PERMISSIONS, { issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read', actions: 'write' });
    t('workflows is spent by automerge_enable alone, as alsoSpends, and is no row\'s permission', [OP_NAMES.filter((op) => (OPS[op].alsoSpends ?? []).includes('workflows')), OP_NAMES.filter((op) => OPS[op].permission === 'workflows')], [['automerge_enable'], []]);
    t('nothing wider: every PERMISSIONS key but metadata (the sender gate\'s read) is spent by some row as its permission or an alsoSpends, and the two sets are exactly actions/contents/issues/pull-requests/workflows', [Object.keys(PERMISSIONS).filter((name) => name !== 'metadata').sort(), [...new Set(OP_NAMES.flatMap((op) => [OPS[op].permission, ...(OPS[op].alsoSpends ?? [])]))].sort()], [['actions', 'contents', 'issues', 'pull-requests', 'workflows'], ['actions', 'contents', 'issues', 'pull-requests', 'workflows']]);
    t('the two auto-merge rows spend contents', [OPS.automerge_enable.permission, OPS.automerge_disable.permission], ['contents', 'contents']);
    t('⛔ …and no other row does: contents reaches the two auto-merge mutations and nothing else', OP_NAMES.filter((op) => OPS[op].permission === 'contents').sort(), ['automerge_disable', 'automerge_enable']);
    t('every row spending contents is a GraphQL auto-merge mutation, never a REST path', OP_NAMES.filter((op) => OPS[op].permission === 'contents').every((op) => OPS[op].requests({ op, pull: 1 }).every((r) => r.graphql && /PullRequestAutoMerge$/.test(r.graphql.mutation))));
    const repoRoot = resolve(SELF_PATH, '../../../..');
    t('the relay files the table declares are on disk, repo-relative, and this file is one of them', [RELAY_FILES.filter((f) => !existsSync(resolve(repoRoot, f))), RELAY_FILES.includes('scripts/pm/fleet-write/validate.mjs')], [[], true]);
    // The workflow's mint step declares the SAME map: every grant outside `STROKE_SCOPED_PERMISSIONS` as a literal
    // `permission-<name>: <level>` input, and every stroke-scoped grant as an input reading the validator's
    // `permission_<name>` output — both read from the file on disk, so a grant added on one side without the
    // other, or a scoped grant spelled as a literal (minted for every stroke), reds here.
    const workflowPath = resolve(repoRoot, '.github/workflows/fleet-write.yml');
    const workflowText = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : '';
    const declared = existsSync(workflowPath) ? Object.fromEntries([...workflowText.matchAll(/^\s+permission-([a-z-]+):\s*(read|write)\s*$/gm)].map((m) => [m[1], m[2]])) : null;
    const literal = Object.fromEntries(Object.entries(PERMISSIONS).filter(([name]) => !STROKE_SCOPED_PERMISSIONS.includes(name)));
    t('the workflow mint step declares exactly the non-scoped grants of PERMISSIONS as literal permission-* inputs', declared, literal);
    const scopedInputs = [...workflowText.matchAll(/^\s+permission-([a-z-]+):\s*\$\{\{\s*steps\.validate\.outputs\.permission_([a-z_]+)\s*\}\}\s*$/gm)].map((m) => [m[1], m[2]]);
    t('…and each stroke-scoped grant as an input reading the validator\'s permission_<name> output, and nothing else that way', scopedInputs, STROKE_SCOPED_PERMISSIONS.map((name) => [name, name.replace(/-/g, '_')]));
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
    t('--from-env --github-output writes repositories, request_id, action_count, session and an EMPTY permission_actions to $GITHUB_OUTPUT for a comment', [env.code, env.appended[0]?.file, env.appended[0]?.text], [EXIT_OK, '/out.txt', 'repositories=objectstack\nrequest_id=fw-20260922T090000Z-abc123\naction_count=1\nsession=session_01ABCDEFGHJKMNPQRSTVWXYZ\npermission_actions=\n']);
    t('--github-output without GITHUB_OUTPUT is exit 3', (await drive(['--from-env', '--github-output'], { [PAYLOAD_ENV]: good })).code, EXIT_PREREQUISITE);
    t('--json prints the normalised payload as one line after the OK line', JSON.parse((await drive(['--file', 'good.json', '--json'])).out.split('\n')[1]).request_id, 'fw-20260922T090000Z-abc123');
  }

  // ── the transfer row ──────────────────────────────────────────────────────
  battery('the transfer row: an issue never a pull, a target from the governed roster never the source, a stroke of its own to one target, labels never created');
  {
    const UI = `${TARGET_OWNER}/objectui`;
    const move = (issue, target = UI) => ({ op: 'transfer', issue, target_repo: target });
    const spec = OPS.transfer;
    t('the transfer row: issue and target_repo required, nothing optional, spending issues, reaching a second repository through target_repo', [spec.required, spec.optional, spec.permission, spec.secondRepo], [['issue', 'target_repo'], [], 'issues', 'target_repo']);
    const req = spec.requests(move(7), 'objectstack-ai/objectstack');
    t('…and its one request is the transferIssue mutation, carrying the issue and the target the executor resolves to node ids', [req.length, req[0].verb, req[0].path, req[0].graphql.mutation, req[0].graphql.issue, req[0].graphql.target_repo], [1, 'POST', '/graphql', 'transferIssue', 7, UI]);
    t('the query takes both node ids as variables and asks for the new number, url and repository', ['$issueId: ID!', '$repositoryId: ID!', 'issueId: $issueId', 'repositoryId: $repositoryId', 'number url repository { nameWithOwner }'].every((needle) => req[0].graphql.query.includes(needle)));
    t('⛔ the mutation never sets createLabelsIfMissing — a label the target lacks is dropped, never created there', req[0].graphql.query.includes('createLabelsIfMissing'), false);
    t('the target roster IS the governed-repository roster — reused, never a second list', [...TRANSFER_TARGETS], GOVERNED_REPOS.map((r) => r.slug));
    t('…every entry of which is in the one organization', TRANSFER_TARGETS.every((r) => TARGET_REPO_SHAPE.test(r)) && TRANSFER_TARGETS.length >= 2);
    t('a target outside the roster is refused, naming the roster', refuses(fixturePayload({ actions: [move(7, `${TARGET_OWNER}/not-a-fleet-repo`)] }), `actions[0].target_repo must be one of "${TRANSFER_TARGETS[0]}"`));
    t('…and so is one in another organization', refuses(fixturePayload({ actions: [move(7, 'someone-else/objectui')] }), 'target_repo must be one of'));
    t('the source itself is refused as a target', refuses(fixturePayload({ actions: [move(7, `${TARGET_OWNER}/objectstack`)] }), 'the stroke\'s own repository'));
    const pull = validatePayload(fixturePayload({ actions: [{ op: 'transfer', pull: 7, target_repo: UI }] }));
    t('⛔ a pull is refused: transfer takes no pull key, and its issue is required', [pull.ok, pull.errors.some((e) => e.includes('actions[0].pull is not a key `transfer` takes')), pull.errors.some((e) => e.includes('actions[0].issue is required'))], [false, true, true]);
    t('a transfer beside any other op is refused — the stroke carries transfers alone', refuses(fixturePayload({ actions: [move(7), { op: 'comment', issue: 7, body: 'x' }] }), 'actions[1] is `comment` in a stroke that carries a `transfer`'));
    t('two targets in one stroke are refused, as is one card named twice; four cards to one target (the consumer\'s shape) pass', [
      refuses(fixturePayload({ actions: [move(7), move(8, `${TARGET_OWNER}/cloud`)] }), 'one stroke reaches ONE second repository'),
      refuses(fixturePayload({ actions: [move(7), move(7)] }), 'named twice'),
      validatePayload(fixturePayload({ actions: [move(1), move(2), move(3), move(4)] })).ok,
    ], [true, true, true]);
  }

  // ── the token scope ───────────────────────────────────────────────────────
  battery('the token scope: ONE repository for every op but transfer, source + target for a transfer stroke, and the workflow mints from that list');
  {
    const one = (action) => fixturePayload({ actions: [action] });
    const minimal = {
      comment: { issue: 1, body: 'b' }, comment_edit: { comment_id: 1, body: 'b' }, labels_add: { issue: 1, labels: ['a'] }, labels_remove: { issue: 1, labels: ['a'] },
      assign: { issue: 1, assignees: ['u'] }, unassign: { issue: 1, assignees: ['u'] }, issue_patch: { issue: 1, state: 'closed' }, issue_create: { title: 't', body: 'b' },
      pr_create: { title: 't', head: 'h', base: 'main' }, pr_request_reviewers: { pull: 1, reviewers: ['u'] }, pr_update_branch: { pull: 1, expected_head_sha: SHA }, pr_ready: { pull: 1 }, pr_draft: { pull: 1 },
      automerge_enable: { pull: 1 }, automerge_disable: { pull: 1 }, workflow_dispatch: { workflow: WORKFLOW_DISPATCH_ALLOWLIST[0], ref: WORKFLOW_DISPATCH_REF },
      run_rerun_failed: { run_id: 1 }, sub_issue_add: { issue: 1, sub_issue: 2 }, sub_issue_remove: { issue: 1, sub_issue: 2 },
    };
    const narrow = OP_NAMES.filter((op) => !OPS[op].secondRepo);
    t('transfer is the ONLY row that reaches a second repository', OP_NAMES.filter((op) => OPS[op].secondRepo), ['transfer']);
    t('…and every other op is exercised here, no more and no less', Object.keys(minimal).sort(), [...narrow].sort());
    t('⛔ every other op\'s stroke mints for exactly ONE repository — the payload\'s own', narrow.map((op) => tokenRepositoriesOf(validatePayload(one({ op, ...minimal[op] })).payload)).filter((list) => list.length !== 1 || list[0] !== `${TARGET_OWNER}/objectstack`), []);
    t('…and so does a mixed stroke of them all (but the one row that travels alone)', tokenRepositoriesOf(validatePayload(fixturePayload({ actions: narrow.filter((op) => !OPS[op].alone).map((op) => ({ op, ...minimal[op] })) })).payload), [`${TARGET_OWNER}/objectstack`]);
    const moves = validatePayload(fixturePayload({ actions: [{ op: 'transfer', issue: 1, target_repo: `${TARGET_OWNER}/objectui` }, { op: 'transfer', issue: 2, target_repo: `${TARGET_OWNER}/objectui` }] })).payload;
    t('a transfer stroke mints for its source and its one target — two, never more', tokenRepositoriesOf(moves), [`${TARGET_OWNER}/objectstack`, `${TARGET_OWNER}/objectui`]);
    t('the GitHub output spells that list as names: one for a comment, two for a transfer', [githubOutputLines(fixturePayload()).split('\n')[0], githubOutputLines(moves).split('\n')[0]], ['repositories=objectstack', 'repositories=objectstack,objectui']);
    const workflow = readFileSync(resolve(SELF_PATH, '../../../..', '.github/workflows/fleet-write.yml'), 'utf8');
    const repoInputs = [...workflow.matchAll(/^\s+repositories:\s*(.*?)\s*$/gm)].map((m) => m[1]);
    t('the workflow\'s mint reads that list — the validate step\'s output, never the payload — and nothing else names one', repoInputs, ['${{ steps.validate.outputs.repositories }}']);
    t('…under the one organization, as owner', /^\s+owner:\s*objectstack-ai\s*$/m.test(workflow) && TARGET_OWNER === 'objectstack-ai');
  }

  // ── the workflow_dispatch row ─────────────────────────────────────────────
  battery('the workflow_dispatch row: a closed allowlist of files matched whole, each with its closed inputs, ref main alone, a stroke of exactly that one action, actions write minted for that stroke alone, and the dispatch call and the failed-jobs re-run the ONLY actions paths any row reaches');
  {
    const REPO = `${TARGET_OWNER}/objectstack`;
    const FILE = WORKFLOW_DISPATCH_ALLOWLIST[0];
    const start = (extra = {}) => ({ op: 'workflow_dispatch', workflow: FILE, ref: WORKFLOW_DISPATCH_REF, ...extra });
    const one = (action) => fixturePayload({ actions: [action] });
    const spec = OPS.workflow_dispatch;
    t('the row: workflow and ref required, inputs the one optional key and judged against the closed table, spending actions, travelling alone, reaching no second repository', [spec.required, spec.optional, spec.closedInputs === WORKFLOW_DISPATCH_INPUTS, spec.permission, spec.alone, spec.secondRepo ?? null], [['workflow', 'ref'], ['inputs'], true, 'actions', true, null]);
    t('the allowlist is exactly the keys of WORKFLOW_DISPATCH_INPUTS — the shard-timings refresh and the release workflow — and the ref is exactly main', [[...WORKFLOW_DISPATCH_ALLOWLIST], Object.keys(WORKFLOW_DISPATCH_INPUTS), WORKFLOW_DISPATCH_REF, FIELDS.workflow.values, FIELDS.ref.values], [['shard-timings-refresh.yml', 'release.yml'], ['shard-timings-refresh.yml', 'release.yml'], 'main', ['shard-timings-refresh.yml', 'release.yml'], ['main']]);
    const repoRoot = resolve(SELF_PATH, '../../../..');
    const onDisk = WORKFLOW_DISPATCH_ALLOWLIST.map((f) => {
      const p = resolve(repoRoot, '.github/workflows', f);
      return [f, existsSync(p) && /^\s*workflow_dispatch:/m.test(readFileSync(p, 'utf8')), /^[A-Za-z0-9._-]+\.ya?ml$/.test(f)];
    });
    t('every allowlisted entry is a bare file name of a workflow on disk under .github/workflows/ that declares a workflow_dispatch trigger', onDisk, WORKFLOW_DISPATCH_ALLOWLIST.map((f) => [f, true, true]));
    const req = spec.requests(start(), REPO);
    t('its one request is POST /repos/{repo}/actions/workflows/{file}/dispatches with the body { ref: main } and NO inputs for a file whose entry is null', [WORKFLOW_DISPATCH_INPUTS[FILE], req.length, req[0].verb, req[0].path, req[0].body, 'inputs' in req[0].body], [null, 1, 'POST', `/repos/${REPO}/actions/workflows/${FILE}/dispatches`, { ref: 'main' }, false]);
    t('…a path the dispatch shape names, and the only actions path the whole table reaches', [WORKFLOW_DISPATCH_PATH_SHAPE.test(req[0].path), REFUSED_PATH_FAMILIES.some((re) => re.test(req[0].path))], [true, false]);
    t('the minimal stroke is accepted', validatePayload(one(start())).ok, true, validatePayload(one(start())).errors.join(' | '));
    t('a workflow outside the allowlist is refused, naming the list — the docker publish lane among them', refuses(one(start({ workflow: 'docker-publish.yml' })), `actions[0].workflow must be one of "${FILE}"`));
    t('…and so are a path, a dot-dot path and a glob that would name the same file', [`.github/workflows/${FILE}`, `../${FILE}`, 'shard-timings-*.yml'].every((workflow) => refuses(one(start({ workflow })), 'actions[0].workflow must be one of')));
    t('a ref other than main is refused, naming main', [refuses(one(start({ ref: 'develop' })), 'actions[0].ref must be one of "main"'), refuses(one(start({ ref: 'refs/heads/main' })), 'actions[0].ref must be one of "main"')], [true, true]);
    t('a missing ref is refused — the ref is spelled on every request, never defaulted', refuses(one({ op: 'workflow_dispatch', workflow: FILE }), 'actions[0].ref is required'));
    t('an inputs key on a file whose entry is null is refused BY NAME — the relay sends none there', refuses(one(start({ inputs: { reason: true } })), `actions[0].inputs: ${FILE} declares no inputs`));
    t('⛔ a workflow_dispatch beside any other op is refused — the stroke carries that one action alone', refuses(fixturePayload({ actions: [start(), { op: 'comment', issue: 7, body: 'x' }] }), 'actions[1] is `comment` in a stroke that carries a `workflow_dispatch`'));
    t('⛔ two workflow_dispatch in one stroke are refused too', refuses(fixturePayload({ actions: [start(), start()] }), 'a stroke carries exactly ONE `workflow_dispatch` and nothing else'));
    t('the only rows that travel alone or widen the token: workflow_dispatch and run_rerun_failed (alone) and transfer (second repository)', [OP_NAMES.filter((op) => OPS[op].alone), OP_NAMES.filter((op) => OPS[op].secondRepo)], [['workflow_dispatch', 'run_rerun_failed'], ['transfer']]);
    t('…and actions is spent by the workflow_dispatch and run_rerun_failed rows and NOTHING else — each of them alone in its stroke', [OP_NAMES.filter((op) => OPS[op].permission === 'actions'), OP_NAMES.filter((op) => OPS[op].permission === 'actions').every((op) => OPS[op].alone === true)], [['workflow_dispatch', 'run_rerun_failed'], true]);
    const plain = validatePayload(fixturePayload()).payload;
    const run = validatePayload(one(start())).payload;
    t('the token grants: a comment stroke carries the five literal grants and no actions; a workflow_dispatch stroke adds actions write', [tokenPermissionsOf(plain), tokenPermissionsOf(run)], [{ issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read' }, { issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read', actions: 'write' }]);
    t('…and the GitHub output spells that as permission_actions=write for the run stroke, EMPTY for every other — the mint action skips an empty input', [githubOutputLines(run).split('\n').at(-2), githubOutputLines(plain).split('\n').at(-2), [...STROKE_SCOPED_PERMISSIONS]], ['permission_actions=write', 'permission_actions=', ['actions']]);
    // The fence on the grant: every path every row can spell, against the actions families — the dispatch call is the ONE
    // actions path reached; and a POSITIVE CONTROL that the families would catch what actions: write otherwise reaches.
    const filled = { issue: 7, pull: 7, comment_id: 7, body: 'b', title: 't', head: 'h', base: 'main', labels: ['a'], assignees: ['u'], reviewers: ['u'], team_reviewers: ['t'], state: 'closed', state_reason: 'completed', expected_head_sha: SHA, target_repo: `${TARGET_OWNER}/objectui`, workflow: FILE, ref: WORKFLOW_DISPATCH_REF, run_id: 7 };
    const everyPath = OP_NAMES.flatMap((op) => {
      const a = { op };
      for (const k of [...OPS[op].required, ...OPS[op].optional]) a[k] = filled[k];
      return OPS[op].requests(a, REPO).map((r) => r.path);
    });
    const actionsPaths = everyPath.filter((p) => p.includes('/actions/'));
    t('⛔ the ONLY actions/* paths any row reaches are the dispatch call on an allowlisted file and the failed-jobs re-run of a run named by its id', [actionsPaths, actionsPaths.every((p) => WORKFLOW_DISPATCH_PATH_SHAPE.test(p) || RERUN_FAILED_PATH_SHAPE.test(p))], [[`/repos/${REPO}/actions/workflows/${FILE}/dispatches`, `/repos/${REPO}/actions/runs/7/rerun-failed-jobs`], true]);
    const forbidden = ['runs/1/cancel', 'runs/1/force-cancel', 'runs/1/rerun', 'runs/1/rerun-failed-jobs/x', 'runs/x/rerun-failed-jobs', 'runs/1/attempts/1/rerun-failed-jobs', 'runs/1', 'runs/1/logs', 'runs/1/approve', 'runs/1/pending_deployments', 'jobs/1/rerun', 'caches', 'caches/1', 'artifacts/1', `workflows/${FILE}/enable`, `workflows/${FILE}/disable`, `workflows/${FILE}`, 'secrets/X', 'variables/X', 'permissions', 'runners/1', `workflows/${FILE}/dispatches/x`];
    t('positive control: every cancel / whole-run or job re-run / delete / log / approve / cache / artifact / enable / disable / secret / variable / runner path under actions/* — and a re-run path with anything around its run id — is caught by a refused family', forbidden.filter((tail) => !REFUSED_PATH_FAMILIES.some((re) => re.test(`/repos/${REPO}/actions/${tail}`))), []);
  }

  // ── the release.yml entry ────────────────────────────────────────────────
  battery("the release.yml entry: refresh_version_pr true and nothing beside it — force, false, absent, a string or any other input refused by name; the wire spells the table's value as a string; every entry's inputs declared on disk; and the file's own guards, evaluated, start the bookkeeping lane alone");
  {
    const REPO = `${TARGET_OWNER}/objectstack`;
    const RELEASE = 'release.yml';
    const REFRESH = { refresh_version_pr: true };
    const refresh = (inputs) => ({ op: 'workflow_dispatch', workflow: RELEASE, ref: WORKFLOW_DISPATCH_REF, ...(inputs === undefined ? {} : { inputs }) });
    const one = (action) => fixturePayload({ actions: [action] });
    const reasons = (action) => validatePayload(one(action)).errors;
    t('the closed table: the shard-timings refresh carries no inputs, the release workflow exactly refresh_version_pr true', JSON.parse(JSON.stringify(WORKFLOW_DISPATCH_INPUTS)), { 'shard-timings-refresh.yml': null, 'release.yml': { refresh_version_pr: true } });
    t('the release refresh is accepted, and its normalised action carries the inputs as a copy, never the caller\'s object', (() => {
      const action = refresh({ ...REFRESH });
      const v = validatePayload(one(action));
      return [v.ok, v.payload?.actions[0], v.payload?.actions[0].inputs !== action.inputs];
    })(), [true, { op: 'workflow_dispatch', workflow: RELEASE, ref: 'main', inputs: { refresh_version_pr: true } }, true]);
    const req = OPS.workflow_dispatch.requests(refresh(REFRESH), REPO);
    t('its one request is the dispatch call on release.yml with { ref: main, inputs: { refresh_version_pr: "true" } } — the value a STRING on the wire, the measured spelling', [req.length, req[0].verb, req[0].path, req[0].body], [1, 'POST', `/repos/${REPO}/actions/workflows/${RELEASE}/dispatches`, { ref: 'main', inputs: { refresh_version_pr: 'true' } }]);
    t('…a path the dispatch shape names and no refused family reaches — release.yml is not caught by the releases family, and is not a release', [WORKFLOW_DISPATCH_PATH_SHAPE.test(req[0].path), REFUSED_PATH_FAMILIES.filter((re) => re.test(req[0].path)).map(String)], [true, []]);
    t('⛔ the wire is built from the TABLE, never from the action: an unjudged action naming force and false still sends refresh_version_pr "true" alone', OPS.workflow_dispatch.requests(refresh({ refresh_version_pr: false, force: true }), REPO)[0].body, { ref: 'main', inputs: { refresh_version_pr: 'true' } });
    t('dispatchInputsOnTheWire spells every value as a string and a null entry as no inputs', [dispatchInputsOnTheWire({ a: true, b: false }), dispatchInputsOnTheWire(null)], [{ a: 'true', b: 'false' }, null]);
    t('⛔ absent inputs on release.yml are refused, naming the one object the relay sends — the publish-repair lane is a dispatch WITHOUT the input', reasons(refresh()), [`actions[0].inputs is required when workflow is "release.yml": exactly {"refresh_version_pr":true} — the one lane the relay may start there`]);
    t('⛔ refresh_version_pr false is refused by name, naming the value it must be', reasons(refresh({ refresh_version_pr: false })), ['actions[0].inputs.refresh_version_pr must be true when workflow is "release.yml", got false — the relay sends exactly {"refresh_version_pr":true}']);
    t('⛔ force beside the refresh is refused by name — true or false, it is not an input the relay sends', [true, false].map((force) => reasons(refresh({ refresh_version_pr: true, force }))), [true, false].map(() => ['actions[0].inputs.force is not an input the relay sends to release.yml — it sends exactly {"refresh_version_pr":true}']));
    t('⛔ force alone is refused for both reasons in one pass: force is not sent, and refresh_version_pr is required', reasons(refresh({ force: true })), ['actions[0].inputs.force is not an input the relay sends to release.yml — it sends exactly {"refresh_version_pr":true}', 'actions[0].inputs.refresh_version_pr is required when workflow is "release.yml": exactly {"refresh_version_pr":true}']);
    t('⛔ any other input is refused by name, beside the refresh or instead of it', [reasons(refresh({ refresh_version_pr: true, dry_run: true })).some((e) => e.includes('actions[0].inputs.dry_run is not an input the relay sends to release.yml')), refuses(one(refresh({ version: true })), 'actions[0].inputs.version is not an input')], [true, true]);
    t('⛔ the string "true" is refused ONCE, naming the JSON boolean — one spelling in the payload, the string only on the wire', reasons(refresh({ refresh_version_pr: 'true' })), ['actions[0].inputs.refresh_version_pr must be a JSON boolean, got "true"']);
    t('⛔ an empty object, an array, null and a string are refused as the inputs kind, each once', [{}, [], null, 'refresh_version_pr'].map((inputs) => reasons(refresh(inputs)).length === 1 && reasons(refresh(inputs))[0].startsWith('actions[0].inputs must')), [true, true, true, true]);
    t('⛔ a release refresh beside any other op is refused — the stroke carries that one action alone, its token carrying actions write', refuses(fixturePayload({ actions: [refresh(REFRESH), { op: 'comment', issue: 7, body: 'x' }] }), 'actions[1] is `comment` in a stroke that carries a `workflow_dispatch`'));
    const run = validatePayload(one(refresh(REFRESH))).payload;
    t('…and its stroke mints actions write for ONE repository, as the shard-timings stroke does', run ? [tokenRepositoriesOf(run), tokenPermissionsOf(run).actions, githubOutputLines(run).split('\n').at(-2)] : 'the refresh stroke was refused', [[REPO], 'write', 'permission_actions=write']);
    // The entries against their files on disk: every key declared under the file's `workflow_dispatch` trigger, with the type
    // its value has; a null entry's file declares none (the platform refuses inputs there). The reader is pinned first.
    const repoRoot = resolve(SELF_PATH, '../../../..');
    const releaseText = readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8');
    const declared = declaredDispatchInputs(releaseText);
    t('the reader reads release.yml\'s dispatch inputs off disk — force and refresh_version_pr, both boolean, both defaulting to false — so force is declared there and left out here on purpose', declared, { force: { type: 'boolean', default: 'false' }, refresh_version_pr: { type: 'boolean', default: 'false' } });
    t('every input an entry names is declared by its file with the type its value has, and a null entry\'s file declares none', WORKFLOW_DISPATCH_ALLOWLIST.map((file) => {
      const onDisk = declaredDispatchInputs(readFileSync(resolve(repoRoot, '.github/workflows', file), 'utf8'));
      const entry = WORKFLOW_DISPATCH_INPUTS[file];
      if (entry === null) return [file, onDisk !== null && Object.keys(onDisk).length === 0];
      return [file, onDisk !== null && Object.entries(entry).every(([name, value]) => onDisk[name]?.type === typeof value)];
    }), WORKFLOW_DISPATCH_ALLOWLIST.map((file) => [file, true]));
    // The lane claim, measured: release.yml's own job guards evaluated for the relay's dispatch. The reader is pinned to
    // read all six jobs and to tell the lanes apart (schedule, push and the repair dispatch are its controls), and a
    // guard mutated in memory must change the answer — so the pin can fail, and a job added there is judged by its guard.
    const started = (text, event, sent) => jobsStartedBy(text, { event, inputs: dispatchRunInputs(declaredDispatchInputs(text), sent) });
    const relayRun = started(releaseText, 'workflow_dispatch', WORKFLOW_DISPATCH_INPUTS[RELEASE]);
    t('the reader reads every job of release.yml, each with a guard it can evaluate', [Object.keys(workflowJobs(releaseText)).sort(), relayRun.unread], [['docker', 'full-battery', 'publish', 'release-integrity', 'stale-prompts', 'version-pr'], []]);
    t('⭐ the relay\'s dispatch starts version-pr ALONE — release-integrity, stale-prompts, full-battery, publish and docker are skipped, none undecided (measured live: runs 38351525685 and 38357219168)', [relayRun.runs, relayRun.mayRun, [...relayRun.skipped].sort()], [['version-pr'], [], ['docker', 'full-battery', 'publish', 'release-integrity', 'stale-prompts']]);
    const repair = started(releaseText, 'workflow_dispatch', { refresh_version_pr: false });
    t('control: the repair dispatch the entry refuses (refresh_version_pr false) starts the audit and MAY reach publish — the reader tells the lanes apart', [repair.runs.includes('release-integrity'), repair.runs.includes('version-pr'), repair.mayRun.includes('publish')], [true, false, true]);
    t('control: schedule starts version-pr alone, push starts the audit and never version-pr', [started(releaseText, 'schedule', {}).runs, started(releaseText, 'push', {}).runs.includes('release-integrity'), started(releaseText, 'push', {}).runs.includes('version-pr')], [['version-pr'], true, false]);
    const unguarded = releaseText.replace("(github.event_name == 'workflow_dispatch' && !inputs.refresh_version_pr)", "(github.event_name == 'workflow_dispatch' && inputs.refresh_version_pr)");
    const added = `${releaseText.replace(/\n+$/u, '')}\n\n  extra-lane:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`;
    t('⛔ the pin can fail: a release-integrity guard that lost its negation, or a seventh job with no guard, is started by the relay\'s dispatch', [unguarded !== releaseText && started(unguarded, 'workflow_dispatch', REFRESH).runs.includes('release-integrity'), started(added, 'workflow_dispatch', REFRESH).runs.includes('extra-lane')], [true, true]);
  }

  // ── the run_rerun_failed row ──────────────────────────────────────────────
  battery("the run_rerun_failed row: run_id alone, a positive integer, nothing that widens it; one bodiless POST to the run's rerun-failed-jobs; a stroke of exactly that one action; actions write minted for that stroke and EMPTY for every other, through the workflow's existing input; the five fences on the run and its pull, each accepted and refused — the head by the pull's own answer, never the run's embedded copy, and a run naming no pull refused by name; the read-back's judgment; and every other actions path still refused");
  {
    const REPO = `${TARGET_OWNER}/objectstack`;
    const RUN = 39713789453;
    const spec = OPS.run_rerun_failed;
    const rerun = (extra = {}) => ({ op: 'run_rerun_failed', run_id: RUN, ...extra });
    const one = (action) => fixturePayload({ actions: [action] });
    // The row and its one request.
    t('the row: run_id required and nothing optional, an integer field, spending actions, travelling alone, reaching no second repository, with no closed inputs', [spec.required, spec.optional, FIELDS.run_id, spec.permission, spec.alone, spec.secondRepo ?? null, spec.closedInputs ?? null], [['run_id'], [], { kind: 'int' }, 'actions', true, null, null]);
    const req = spec.requests(rerun(), REPO);
    t("its one request is POST /repos/{repo}/actions/runs/{run_id}/rerun-failed-jobs with NO body — the platform's debug-logging flag is never sent — carrying the run the executor fences and reads back", [req.length, req[0].verb, req[0].path, 'body' in req[0], req[0].rerunFailed], [1, 'POST', `/repos/${REPO}/actions/runs/${RUN}/rerun-failed-jobs`, false, { runId: RUN }]);
    t('…a path the re-run shape names and no refused family reaches', [RERUN_FAILED_PATH_SHAPE.test(req[0].path), REFUSED_PATH_FAMILIES.filter((re) => re.test(req[0].path)).map(String)], [true, []]);
    // Accepted, and refused by value and by key — the validator's half of "nothing widens it".
    const ok = validatePayload(one(rerun()));
    t('accepted: the minimal stroke, whose normalised action is op and run_id alone', [ok.ok, ok.payload?.actions[0]], [true, { op: 'run_rerun_failed', run_id: RUN }], ok.errors.join(' | '));
    t('⛔ refused: run_id as a numeric string, zero, a negative, a float or an object — the integer kind, judged here', [String(RUN), 0, -1, 1.5, { id: 1 }].map((run_id) => refuses(one(rerun({ run_id })), 'actions[0].run_id must be a positive integer')), [true, true, true, true, true]);
    t('⛔ refused: a missing run_id — the run is named on every request, never defaulted', refuses(one({ op: 'run_rerun_failed' }), 'actions[0].run_id is required by `run_rerun_failed`'));
    t('⛔ refused BY NAME: a workflow, an attempt, a job, an event, a ref or the debug-logging flag beside run_id — no request-time key widens the fences', ['workflow', 'run_attempt', 'job_id', 'event', 'ref', 'enable_debug_logging'].map((key) => refuses(one(rerun({ [key]: key === 'workflow' ? 'ci.yml' : 1 })), `actions[0].${key} is not a key \`run_rerun_failed\` takes (it takes run_id)`)), [true, true, true, true, true, true]);
    // Fence: alone in its stroke.
    t('⛔ fence alone, refused: beside a comment, beside a workflow_dispatch, and two of them — each stroke refused naming the action that does not belong', [
      refuses(fixturePayload({ actions: [rerun(), { op: 'comment', issue: 7, body: 'x' }] }), 'actions[1] is `comment` in a stroke that carries a `run_rerun_failed`'),
      refuses(fixturePayload({ actions: [rerun(), { op: 'workflow_dispatch', workflow: WORKFLOW_DISPATCH_ALLOWLIST[0], ref: WORKFLOW_DISPATCH_REF }] }), 'actions[1] is `workflow_dispatch` in a stroke that carries a `run_rerun_failed`'),
      refuses(fixturePayload({ actions: [rerun(), rerun({ run_id: 2 })] }), 'a stroke carries exactly ONE `run_rerun_failed` and nothing else'),
    ], [true, true, true]);
    t('fence alone, accepted: the stroke of that one action passes the stroke rules', strokeErrors(REPO, [rerun()]), []);
    // Fence: the stroke-scoped grant — ruling 3, carried by the existing input with no workflow edit.
    const stroke = ok.payload;
    t('fence grant, accepted side: its stroke mints the five literal grants plus actions write, for ONE repository', stroke ? [tokenPermissionsOf(stroke), tokenRepositoriesOf(stroke)] : 'refused', [{ issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read', actions: 'write' }, [REPO]]);
    t('⭐ …and the GitHub output spells permission_actions=write for its stroke, exactly as for a workflow_dispatch stroke', stroke ? [githubOutputLines(stroke).split('\n').at(-2), githubOutputLines(validatePayload(one({ op: 'workflow_dispatch', workflow: WORKFLOW_DISPATCH_ALLOWLIST[0], ref: WORKFLOW_DISPATCH_REF })).payload).split('\n').at(-2)] : 'refused', ['permission_actions=write', 'permission_actions=write']);
    const minimalOf = {
      comment: { issue: 1, body: 'b' }, comment_edit: { comment_id: 1, body: 'b' }, labels_add: { issue: 1, labels: ['a'] }, labels_remove: { issue: 1, labels: ['a'] },
      assign: { issue: 1, assignees: ['u'] }, unassign: { issue: 1, assignees: ['u'] }, issue_patch: { issue: 1, state: 'closed' }, issue_create: { title: 't', body: 'b' },
      pr_create: { title: 't', head: 'h', base: 'main' }, pr_request_reviewers: { pull: 1, reviewers: ['u'] }, pr_update_branch: { pull: 1, expected_head_sha: SHA }, pr_ready: { pull: 1 }, pr_draft: { pull: 1 },
      automerge_enable: { pull: 1 }, automerge_disable: { pull: 1 }, transfer: { issue: 1, target_repo: `${TARGET_OWNER}/objectui` },
      sub_issue_add: { issue: 1, sub_issue: 2 }, sub_issue_remove: { issue: 1, sub_issue: 2 },
    };
    const spendsNoActions = OP_NAMES.filter((op) => OPS[op].permission !== 'actions');
    t('…the ledger of ops spending no actions grant is every op but the two that do, no more and no less', [Object.keys(minimalOf).sort(), [...spendsNoActions].sort()], [[...spendsNoActions].sort(), [...spendsNoActions].sort()]);
    const scopedLine = (actions) => {
      const v = validatePayload(fixturePayload({ actions }));
      return v.ok ? githubOutputLines(v.payload).split('\n').at(-2) : `refused: ${v.errors.join(' | ')}`;
    };
    t('⛔ fence grant, refused side: every op spending no actions grant writes an EMPTY permission_actions — each alone in its stroke, and the stroke of them all that shares one token', [spendsNoActions.filter((op) => scopedLine([{ op, ...minimalOf[op] }]) !== 'permission_actions='), scopedLine(spendsNoActions.filter((op) => !OPS[op].secondRepo).map((op) => ({ op, ...minimalOf[op] })))], [[], 'permission_actions=']);
    const repoRoot = resolve(SELF_PATH, '../../../..');
    const workflowText = readFileSync(resolve(repoRoot, '.github/workflows/fleet-write.yml'), 'utf8');
    const mintsFromOutput = [...workflowText.matchAll(/^\s+permission-actions:\s*\$\{\{\s*steps\.validate\.outputs\.permission_actions\s*\}\}\s*$/gm)].length;
    t('⭐ ruling 3, no workflow edit: fleet-write.yml mints permission-actions from the validator\'s permission_actions output — the one input this row rides — and names neither this op nor its path', [mintsFromOutput, workflowText.includes('run_rerun_failed'), workflowText.includes('rerun-failed-jobs')], [1, false, false]);
    // The five fences on the run and its pull — the closed values, then each accepted and refused on the run's and the pull's own answers.
    t('the fences on the run: the closed workflow list is exactly ci.yml, frozen; the event pull_request; the attempt 1; completed with failure; and the read-back accepts queued and in_progress alone', [[...RERUN_FAILED_WORKFLOWS], Object.isFrozen(RERUN_FAILED_WORKFLOWS), RERUN_FAILED_EVENT, RERUN_FAILED_ATTEMPT, RERUN_FAILED_STATUS, RERUN_FAILED_CONCLUSION, [...RERUN_FAILED_RERUN_STATES], RERUN_FAILED_FENCES.map((f) => f.fence)], [['.github/workflows/ci.yml'], true, 'pull_request', 1, 'completed', 'failure', ['queued', 'in_progress'], ['workflow', 'event', 'once', 'failed', 'head']]);
    t('every listed workflow is a file on disk that runs on pull_request — so the list names a run the fences can accept', RERUN_FAILED_WORKFLOWS.map((p) => [p, existsSync(resolve(repoRoot, p)) && /^ {2}pull_request:/m.test(readFileSync(resolve(repoRoot, p), 'utf8'))]), RERUN_FAILED_WORKFLOWS.map((p) => [p, true]));
    // The measured run as its attempt 1 read before the maintainer re-ran it (run 39713789453; fields as the run endpoint answers them).
    // It ran on pull #25155's head; PULL is that pull's OWN answer (GET /pulls/25155), which the head fence reads — never the copy the run embeds.
    const HEAD = '25b3a6c4bff905d462d4ff44030e5465c342254a';
    const MOVED = '9f0e1d2c3b4a59687766554433221100ffeeddcc';
    const MEASURED = { id: RUN, name: 'CI', path: '.github/workflows/ci.yml', event: 'pull_request', run_attempt: 1, status: 'completed', conclusion: 'failure', head_sha: HEAD, pull_requests: [{ number: 25155, head: { sha: HEAD } }] };
    const PULL = { number: 25155, state: 'open', head: { sha: HEAD } };
    // `fenced` takes ONE argument — it is passed to Array.map, whose index would otherwise land in the pull's place.
    const fencedWith = (patch, pull) => rerunFailedFenceFailures({ ...MEASURED, ...patch }, pull).map((f) => f.fence);
    const fenced = (patch) => fencedWith(patch, PULL);
    t('accepted: the measured run passes all five fences — its head_sha is the current head of the pull it names, by that pull\'s own answer', [rerunFailedPullNumber(MEASURED), rerunFailedFenceFailures(MEASURED, PULL)], [25155, []]);
    t('⛔ fence head, refused: a stale head (the pull was pushed to since), an answer for another pull, a run with no head_sha, and no pull answer at all — each naming the head fence alone', [fencedWith({}, { ...PULL, head: { sha: MOVED } }), fencedWith({}, { ...PULL, number: 25156 }), fenced({ head_sha: undefined }), fencedWith({}, null)], [['head'], ['head'], ['head'], ['head']]);
    t("⛔ fence head, refused: the run's EMBEDDED copy of the pull is never read — it agrees with head_sha, and the pull's own answer that moved on still refuses", [MEASURED.pull_requests[0].head.sha === MEASURED.head_sha, fencedWith({}, { ...PULL, head: { sha: MOVED } })], [true, ['head']]);
    t("⛔ fence head, refused by name: a run naming no pull request — pull_requests empty (a fork pull request's run), absent, or an entry with no number — and the sentence says so", [[], undefined, [{ head: { sha: HEAD } }]].map((pull_requests) => [rerunFailedPullNumber({ ...MEASURED, pull_requests }), fencedWith({ pull_requests }, null)]).concat([rerunFailedFenceText(rerunFailedFenceFailures({ ...MEASURED, pull_requests: [] }, null)).includes('fence `head`: the run reads "no pull_requests entry')]), [[null, ['head']], [null, ['head']], [null, ['head']], true]);
    t('⛔ fence workflow, refused: another workflow, the bare file name, a ref-suffixed path, a missing path — each naming the workflow fence alone', [{ path: '.github/workflows/lint.yml' }, { path: 'ci.yml' }, { path: '.github/workflows/ci.yml@refs/heads/main' }, { path: undefined }].map(fenced), [['workflow'], ['workflow'], ['workflow'], ['workflow']]);
    t('⛔ fence event, refused: push, merge_group, schedule, release, workflow_dispatch and pull_request_target runs — each naming the event fence alone', ['push', 'merge_group', 'schedule', 'release', 'workflow_dispatch', 'pull_request_target'].map((event) => fenced({ event })), [['event'], ['event'], ['event'], ['event'], ['event'], ['event']]);
    t('⛔ fence once, refused: attempt 2, attempt 3, the string "1" and a missing attempt — each naming the once fence alone', [{ run_attempt: 2 }, { run_attempt: 3 }, { run_attempt: '1' }, { run_attempt: undefined }].map(fenced), [['once'], ['once'], ['once'], ['once']]);
    t('⛔ fence failed, refused: still in progress, completed with success, completed cancelled, completed with no conclusion — each naming the failed fence alone', [{ status: 'in_progress', conclusion: null }, { conclusion: 'success' }, { conclusion: 'cancelled' }, { conclusion: null }].map(fenced), [['failed'], ['failed'], ['failed'], ['failed']]);
    const all = rerunFailedFenceFailures({ path: '.github/workflows/release.yml', event: 'push', run_attempt: 2, status: 'completed', conclusion: 'success' });
    t('every failing fence is named in ONE pass, and the sentence quotes what the run read beside what the relay re-runs', [all.map((f) => f.fence), rerunFailedFenceText(all).includes('fence `once`: the run reads 2'), rerunFailedFenceText(all).includes('"push"'), rerunFailedFenceText(all).split('; ').length], [['workflow', 'event', 'once', 'failed', 'head'], true, true, 5]);
    // The read-back's judgment, on the measured attempts (jobs by name and state, as the attempts endpoint lists them).
    const attempt1 = [
      { id: 119611140808, name: 'Test Core (3/6)', run_attempt: 1, status: 'completed', conclusion: 'failure' },
      { id: 119611140839, name: 'Test Core (1/6)', run_attempt: 1, status: 'completed', conclusion: 'success' },
      { id: 119611142366, name: 'Console Pin Gate', run_attempt: 1, status: 'completed', conclusion: 'skipped' },
      { id: 119617410962, name: 'Test Core', run_attempt: 1, status: 'completed', conclusion: 'failure' },
    ];
    const failed = failedJobNames(attempt1);
    t('the baseline: the jobs attempt 1 failed, by name — the shard and the aggregate that needs it; a pass or a skip is not one', failed, ['Test Core (3/6)', 'Test Core']);
    const rerunMoment = [
      { id: 119642047246, name: 'Test Core (3/6)', run_attempt: 2, status: 'queued', conclusion: null },
      { id: 119642048282, name: 'Test Core (1/6)', run_attempt: 2, status: 'completed', conclusion: 'success' },
    ];
    const landed = rerunFailedReadBack({ failed, run: { run_attempt: 2 }, jobs: rerunMoment });
    t('⭐ lands: attempt 2, the failed shard queued, the aggregate not listed yet — NAMED, never failed; the line names the new attempt and its job id', [landed.ok, landed.pending, landed.notListed, rerunFailedLandedText(landed)], [true, false, ['Test Core'], 'attempt 2 · re-run: `Test Core (3/6)` job 119642047246 queued · not listed yet: `Test Core` (a job is listed when its needs finish)']);
    t('…and in_progress lands as queued does', rerunFailedReadBack({ failed, run: { run_attempt: 2 }, jobs: [{ ...rerunMoment[0], status: 'in_progress' }] }).ok, true);
    const notYet = rerunFailedReadBack({ failed, run: { run_attempt: 1 }, jobs: rerunMoment });
    t('⛔ a read that does not see attempt 2 is not a landing — pending inside the window, and its reason names the attempt read', [notYet.ok, notYet.pending, notYet.why.includes('run_attempt 1, not 2')], [false, true, true]);
    const carried = rerunFailedReadBack({ failed, run: { run_attempt: 2 }, jobs: [{ ...rerunMoment[0], status: 'completed', conclusion: 'failure' }] });
    t('⛔ a failed job listed completed in attempt 2 was not re-run as asked — not a landing and not pending: a FAILED action naming the job', [carried.ok, carried.pending, carried.why.includes('`Test Core (3/6)` (job 119642047246) completed failure')], [false, false, true]);
    t('…a failed job still waiting, or none of them listed yet, is pending — re-read, never landed early', [rerunFailedReadBack({ failed, run: { run_attempt: 2 }, jobs: [{ ...rerunMoment[0], status: 'waiting' }] }), rerunFailedReadBack({ failed, run: { run_attempt: 2 }, jobs: [rerunMoment[1]] })].map((v) => [v.ok, v.pending]), [[false, true], [false, true]]);
    // Every other actions path stays refused, by no row reachable, and a payload naming one as an op writes nothing.
    const others = ['runs/7/rerun', 'jobs/7/rerun', 'runs/7/cancel', 'runs/7/force-cancel', 'runs/7', 'runs/7/logs', 'runs/7/attempts/1/logs', 'runs/7/rerun-failed-jobs/x', 'runs/x/rerun-failed-jobs', 'caches', 'caches/7', 'artifacts', 'artifacts/7', 'secrets/X', 'secrets/public-key', 'variables', 'variables/X'];
    t('⛔ still refused: the whole-run re-run, a job re-run, cancel, force-cancel, delete, logs, caches, artifacts, secrets and variables — each caught by a refused family', others.filter((tail) => !REFUSED_PATH_FAMILIES.some((re) => re.test(`/repos/${REPO}/actions/${tail}`))), []);
    t('⛔ …with zero writes: a payload naming any of them as an op is refused as no op the relay executes', ['run_rerun', 'job_rerun', 'run_cancel', 'run_delete', 'cache_delete', 'artifact_delete', 'secret_set', 'variable_set'].map((op) => refuses(one({ op, run_id: 7 }), 'is not an op the relay executes')), [true, true, true, true, true, true, true, true]);
  }

  // ── the hierarchy rows ────────────────────────────────────────────────────
  battery("the hierarchy rows: sub_issue_add and sub_issue_remove name a parent and a child by NUMBER — two different positive integers and nothing that widens them; one POST to the parent's sub_issues and one DELETE to its sub_issue, the body left to the executor; issues write, riding any stroke on the literal grants; the fences on the two cards, each accepted and refused — an issue on the repository, never a pull or a transferred card, the child free of any other parent or listed by this one; and the read-back's judgment by the child's id");
  {
    const REPO = `${TARGET_OWNER}/objectstack`;
    const one = (action) => fixturePayload({ actions: [action] });
    // The measured parent and child (2026-10-29, read-only): #26709 answered to #27293, which listed it by its REST id.
    const PARENT = 27293;
    const CHILD = 26709;
    const CHILD_ID = 6060227467;
    const add = (extra = {}) => ({ op: 'sub_issue_add', issue: PARENT, sub_issue: CHILD, ...extra });
    const remove = (extra = {}) => ({ op: 'sub_issue_remove', issue: PARENT, sub_issue: CHILD, ...extra });
    // The row and its one request, for each of the two.
    t('the rows: issue and sub_issue required and nothing optional, both integer fields, distinct, spending issues as their permission and nothing beside it, never alone, reaching no second repository, with no closed inputs', ['sub_issue_add', 'sub_issue_remove'].map((op) => [OPS[op].required, OPS[op].optional, OPS[op].distinct, OPS[op].permission, OPS[op].alsoSpends ?? null, OPS[op].alone ?? false, OPS[op].secondRepo ?? null, OPS[op].closedInputs ?? null]).concat([[FIELDS.issue, FIELDS.sub_issue]]), [[['issue', 'sub_issue'], [], ['issue', 'sub_issue'], 'issues', null, false, null, null], [['issue', 'sub_issue'], [], ['issue', 'sub_issue'], 'issues', null, false, null, null], [{ kind: 'int' }, { kind: 'int' }]]);
    const addReq = OPS.sub_issue_add.requests(add(), REPO);
    const removeReq = OPS.sub_issue_remove.requests(remove(), REPO);
    t("sub_issue_add's one request is POST /repos/{repo}/issues/{parent}/sub_issues carrying NO body of the payload's — the executor sends { sub_issue_id } from the child's own answer — and the parent and child it fences and reads back", [addReq.length, addReq[0].verb, addReq[0].path, 'body' in addReq[0], addReq[0].subIssue], [1, 'POST', `/repos/${REPO}/issues/${PARENT}/sub_issues`, false, { mode: 'add', parent: PARENT, child: CHILD }]);
    t("sub_issue_remove's one request is DELETE /repos/{repo}/issues/{parent}/sub_issue — the platform's singular path — the same way", [removeReq.length, removeReq[0].verb, removeReq[0].path, 'body' in removeReq[0], removeReq[0].subIssue], [1, 'DELETE', `/repos/${REPO}/issues/${PARENT}/sub_issue`, false, { mode: 'remove', parent: PARENT, child: CHILD }]);
    t('…neither path reaches a refused family, reads an earlier answer or carries a placeholder brace, and the two modes are exactly add and remove', [[...addReq, ...removeReq].filter((r) => REFUSED_PATH_FAMILIES.some((re) => re.test(r.path)) || r.fromAnswer !== undefined || /[{}]/.test(r.path)).map((r) => r.path), [...SUB_ISSUE_MODES]], [[], ['add', 'remove']]);
    // Accepted, and refused by value and by key.
    const ok = [validatePayload(one(add())), validatePayload(one(remove()))];
    t('accepted: the minimal strokes, whose normalised actions are op, issue and sub_issue alone', ok.map((v) => [v.ok, v.payload?.actions[0]]), [[true, add()], [true, remove()]], ok.flatMap((v) => v.errors).join(' | '));
    t('⛔ refused: sub_issue as a numeric string, zero, a negative, a float or an object — the integer kind, judged here', [String(CHILD), 0, -1, 1.5, { number: CHILD }].map((sub_issue) => refuses(one(add({ sub_issue })), 'actions[0].sub_issue must be a positive integer')), [true, true, true, true, true]);
    t('⛔ refused: a missing sub_issue or a missing issue, on either row — both are named on every request, never defaulted', [refuses(one({ op: 'sub_issue_add', issue: PARENT }), 'actions[0].sub_issue is required by `sub_issue_add`'), refuses(one({ op: 'sub_issue_remove', sub_issue: CHILD }), 'actions[0].issue is required by `sub_issue_remove`')], [true, true]);
    t('⛔ refused BY NAME: a sub_issue_id, the replace_parent flag, a pull or a body beside the two numbers — no request-time key carries an id or moves a child', ['sub_issue_id', 'replace_parent', 'pull', 'body'].map((key) => refuses(one(add({ [key]: key === 'replace_parent' ? true : key === 'body' ? 'b' : 1 })), `actions[0].${key} is not a key \`sub_issue_add\` takes (it takes issue, sub_issue)`)), [true, true, true, true]);
    t('⛔ refused: one issue as both parent and child, on either row, naming the two keys', [refuses(one(add({ sub_issue: PARENT })), 'actions[0].sub_issue is 27293, the same as issue — `sub_issue_add` links two different issues'), refuses(one(remove({ sub_issue: PARENT })), 'actions[0].sub_issue is 27293, the same as issue — `sub_issue_remove` links two different issues')], [true, true]);
    t('…and a pair the field kind already refused is not judged twice: "7" and "7" read as two kind errors, no sameness sentence', validatePayload(one(add({ issue: '7', sub_issue: '7' }))).errors.map((e) => e.includes('the same as')), [false, false]);
    // The grant: issues write, the literal one — the rows ride any stroke, and the mint widens nothing.
    const mixed = validatePayload(fixturePayload({ actions: [{ op: 'comment', issue: PARENT, body: 'b' }, add(), remove({ sub_issue: 26702 }), { op: 'labels_add', issue: PARENT, labels: ['epic'] }] }));
    t('a stroke carrying both rows beside a comment and a label is accepted — no alone — and mints the five literal grants for ONE repository, permission_actions EMPTY', [mixed.ok, mixed.payload ? tokenPermissionsOf(mixed.payload) : null, mixed.payload ? tokenRepositoriesOf(mixed.payload) : null, mixed.payload ? githubOutputLines(mixed.payload).split('\n').at(-2) : null], [true, { issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read' }, [REPO], 'permission_actions='], mixed.errors.join(' | '));
    // The fences on the two cards — the roster, then each accepted and refused on the executor's reads.
    t('the fences: parent and child on both rows, free on the add alone, listed on the remove alone', SUB_ISSUE_FENCES.map((f) => [f.fence, [...f.modes]]), [['parent', ['add', 'remove']], ['child', ['add', 'remove']], ['free', ['add']], ['listed', ['remove']]]);
    const card = (number, extra = {}) => ({ status: 200, json: { id: number === CHILD ? CHILD_ID : 6081407279, number, repository_url: `https://api.github.com/repos/${REPO}`, ...extra } });
    const NO_PARENT = { status: 404, json: { message: 'No parent issue found' } };
    const listOf = (...ids) => ({ items: ids.map((id) => ({ id })) });
    const ctx = (mode, patch = {}) => ({ mode, repo: REPO, parentNumber: PARENT, childNumber: CHILD, parent: card(PARENT), child: card(CHILD), ...(mode === 'add' ? { childParent: NO_PARENT } : { list: listOf(6060051871, CHILD_ID) }), ...patch });
    const fenced = (c) => subIssueFenceFailures(c).map((f) => f.fence);
    t('accepted: an add whose child answers 404 to its parent read, and a remove whose child the parent lists by id — every fence holds', [fenced(ctx('add')), fenced(ctx('remove'))], [[], []]);
    t('⛔ fence parent and child, refused: a pull request, a transferred card and an unread one — each naming its own fence alone', [fenced(ctx('add', { parent: card(PARENT, { pull_request: { url: 'x' } }) })), fenced(ctx('add', { parent: card(PARENT, { repository_url: `https://api.github.com/repos/${TARGET_OWNER}/cloud` }) })), fenced(ctx('add', { child: { status: 404, json: { message: 'Not Found' } } })), fenced(ctx('add', { child: card(CHILD, { id: '6060227467' }) }))], [['parent'], ['parent'], ['child'], ['child']]);
    t('…and the sentences say why: a pull request, the repository it answers from now, an id that cannot be sent', [subIssueCardFailure(card(PARENT, { pull_request: {} }), REPO, PARENT), subIssueCardFailure(card(PARENT, { repository_url: `https://api.github.com/repos/${TARGET_OWNER}/cloud`, number: 41 }), REPO, PARENT), subIssueCardFailure(card(CHILD, { id: null }), REPO, CHILD)], [`#${PARENT} is a pull request — only an issue is a parent or a sub-issue`, `#${PARENT} no longer answers from ${REPO}: it answers from ${TARGET_OWNER}/cloud as #41 — transferred`, `#${CHILD} answers with no integer id, so no sub_issue_id can be sent for it`]);
    const here = { status: 200, json: { id: 6081407279, number: PARENT, repository_url: `https://api.github.com/repos/${REPO}` } };
    const elsewhere = { status: 200, json: { id: 1, number: 27000, repository_url: `https://api.github.com/repos/${REPO}` } };
    t('fence free: a child already under THIS parent holds — the measured no-op — and is the one shape subIssueAlreadyHere answers true', [fenced(ctx('add', { childParent: here })), subIssueAlreadyHere(ctx('add', { childParent: here })), subIssueAlreadyHere(ctx('add')), subIssueAlreadyHere(ctx('add', { childParent: elsewhere }))], [[], true, false, false]);
    t('⛔ fence free, refused: a child under ANOTHER parent (named, never moved), a parent read that answers neither a parent nor 404, and one not taken', [subIssueFenceFailures(ctx('add', { childParent: elsewhere }))[0]?.got, fenced(ctx('add', { childParent: { status: 503, json: { message: 'down' } } })), fenced(ctx('add', { childParent: undefined }))], [`#${CHILD} is already a sub-issue of ${REPO}#27000 — remove it there first (a sub_issue_remove), the relay never moves it`, ['free'], ['free']]);
    t('⛔ fence listed, refused: a child the parent does not list, a list that could not be read whole, and a list not taken', [subIssueFenceFailures(ctx('remove', { list: listOf(6060051871) }))[0]?.got, subIssueFenceFailures(ctx('remove', { list: { fail: 'the list hit its cap' } }))[0]?.got, fenced(ctx('remove', { list: undefined }))], [`#${PARENT}'s sub-issue list (1) does not list #${CHILD} (id ${CHILD_ID})`, 'the list hit its cap', ['listed']]);
    t('each mode judges its own fence alone: an add never reads the list, a remove never reads the parent of its child', [fenced({ ...ctx('add'), list: { fail: 'x' } }), fenced({ ...ctx('remove'), childParent: elsewhere })], [[], []]);
    const all = subIssueFenceFailures(ctx('add', { parent: card(PARENT, { pull_request: {} }), child: { status: 404, json: {} }, childParent: undefined }));
    t('every failing fence is named in ONE pass, and the sentence quotes what was read beside what the relay links', [all.map((f) => f.fence), subIssueFenceText(all).split('; ').length, subIssueFenceText(all).startsWith(`fence \`parent\`: #${PARENT} is a pull request`)], [['parent', 'child', 'free'], 3, true]);
    // The read-back's judgment, on the measured list.
    const listed = listOf(6060227467, 6060051871, 6060244604).items;
    t('⭐ the read-back: an add lands when the list lists the child\'s id, a remove when it no longer does — and each is pending otherwise, naming the id', [subIssueReadBack({ mode: 'add', childId: CHILD_ID, items: listed }).ok, subIssueReadBack({ mode: 'add', childId: CHILD_ID, items: listed.slice(1) }), subIssueReadBack({ mode: 'remove', childId: CHILD_ID, items: listed.slice(1) }).ok, subIssueReadBack({ mode: 'remove', childId: CHILD_ID, items: listed }).why], [true, { ok: false, listed: false, count: 2, why: `the parent's sub-issue list (2) does not list the child's id ${CHILD_ID}` }, true, `the parent's sub-issue list (3) still lists the child's id ${CHILD_ID}`]);
    t('…judged by the REST id, never the number, and never for a mode it does not know', [subIssueReadBack({ mode: 'add', childId: CHILD_ID, items: [{ id: 1, number: CHILD }] }).ok, subIssueReadBack({ mode: 'move', childId: CHILD_ID, items: listed }).ok], [false, false]);
    t('the landed rows name the link as the list reads it back, a no-op saying nothing was sent', [subIssueLandedText({ mode: 'add', parentNumber: PARENT, childNumber: CHILD, childId: CHILD_ID, count: 3 }), subIssueLandedText({ mode: 'add', parentNumber: PARENT, childNumber: CHILD, childId: CHILD_ID, count: 3, noop: true }).startsWith('no-op, nothing sent: '), subIssueLandedText({ mode: 'remove', parentNumber: PARENT, childNumber: CHILD, childId: CHILD_ID, count: 2 })], [`#${CHILD} (id ${CHILD_ID}) is a sub-issue of #${PARENT} · its list reads 3 sub-issue(s)`, true, `#${CHILD} (id ${CHILD_ID}) is no longer a sub-issue of #${PARENT} · its list reads 2 sub-issue(s)`]);
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
      'closed keys per op with typed values, the platform\'s own client_payload ceilings pinned with their source, no row that can reach a refused family, ' +
      'a token list of ONE repository for every op but transfer, whose second is one governed target, and actions write reaching one dispatch call on one allowlisted file ' +
      "with that file's closed inputs — release.yml's bookkeeping lane and no other, read from its own guards — or one failed-jobs re-run of a run named by its id alone, " +
      'each minted for its stroke alone, every other actions path still refused, and an issue-hierarchy link named by two different issue numbers, ' +
      'fenced on its two cards and landed only when the parent\'s list reads the child back.',
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

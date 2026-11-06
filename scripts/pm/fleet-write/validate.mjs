#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-write/validate — the closed-schema gate every relay payload passes,
 * on BOTH sides of the boundary.
 *
 *   node scripts/pm/fleet-write/validate.mjs --file payload.json          # judge a payload on disk
 *   node scripts/pm/fleet-write/validate.mjs --from-event                 # judge client_payload in $GITHUB_EVENT_PATH (the runner)
 *   node scripts/pm/fleet-write/validate.mjs --from-event --github-output # …and write repositories / request_id / action_count to $GITHUB_OUTPUT
 *   node scripts/pm/fleet-write/validate.mjs --self-test                  # offline, no network
 *
 * ## One validator, imported by both ends
 *
 * The seat-side packer (`dispatch.mjs`) refuses a payload here BEFORE the
 * dispatch leaves, and the relay workflow's first step runs this same file
 * against `github.event.client_payload` BEFORE any token is minted, reading it
 * from the event file (`$GITHUB_EVENT_PATH`) — never from a step's `env:`,
 * which GitHub prints into the public run log (`ops.mjs`, the advisory rows'
 * section: a report's prose rides the payload and is printed nowhere). Two copies
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
 *   - a stroke carrying `advisory_report`, `advisory_create`,
 *     `advisory_collaborators_add`, `advisory_versions` or `advisory_state`
 *     carries exactly that one action (each row's `alone`) — so a publish
 *     carries one advisory alone: its token carries
 *     `repository-advisories: write`. A report is `summary` and
 *     `description`, byte-capped, with an optional `severity` from GitHub's
 *     enum and `cwe_ids`, a capped list of `CWE-` ids; a draft is the same
 *     keys plus `packages`, a capped list of npm package names
 *     (`NPM_PACKAGE_SHAPE`), each one `vulnerabilities` entry; the other three
 *     name `ghsa_id` — one advisory's id, `GHSA_ID_SHAPE` exactly — and either
 *     `collaborators`, a capped list of logins; `versions`, a capped list of
 *     closed entries, each exactly an npm `package`, a
 *     `vulnerable_version_range` and its `patched_versions` in the one
 *     spelling `advisoryVersionEntryFailure` admits; or `advisory_state`,
 *     exactly `draft`, `closed` or `published` — `published` a value since the
 *     maintainer's ruling that the relay publishes, its move the executor's to
 *     fence. ⛔ A refusal names the key and the byte count and never echoes the
 *     value: a payload's text reaches a public run log, and a value in the
 *     wrong key may be an advisory's prose (`FIELDS`' `quiet`). Any other key —
 *     a `vulnerabilities`, a `state`, a `credits`, a `collaborating_users`, a
 *     `summary` beside the versions — is refused by name. The fences on the
 *     ADVISORY — readable, the one named, a state the action may act in, a
 *     list the versions may replace, versions set before a publish — are
 *     facts this file cannot see: the executor judges them on its own read
 *     before the PATCH (`ADVISORY_FENCES` in `ops.mjs`);
 *   - a stroke carrying `advisory_read` carries exactly that one action too,
 *     and its token carries `repository-advisories: read` — the row's `grant`
 *     — never write. It names `ghsa_id` and `public_key`, the seat's one-time
 *     X25519 key, its own kind: base64 SPKI DER of exactly 60 characters in
 *     its one spelling, a key a secret can be derived with
 *     (`advisoryReadKeyFailure` in `ops.mjs`), refused here before any
 *     request; a refusal names the key, the byte count and what the value
 *     failed to be, ⛔ never the value. Any other key — a `summary`, a
 *     `private_key`, a `state` — is refused by name. The fences on the READ —
 *     readable, the one named, a sender the gate admits — are the executor's,
 *     on its own GET (`ADVISORY_READ_FENCES` in `ops.mjs`);
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
 * the workflow names neither op. The advisory rows' grant is the second such
 * line, `permission_repository_advisories=write` for a stroke carrying one of
 * them and empty for every other — and `permission_repository_advisories=read`
 * for an `advisory_read` stroke, the one row whose `grant` is lower than
 * `PERMISSIONS` holds. The
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
 *      event file absent, unreadable, not JSON or carrying no
 *      `client_payload`). Nothing was judged.
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
  MAILBOX_BRANCH_SHAPE,
  MAILBOX_LABEL,
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
  ADVISORY_CREATE_ECOSYSTEM,
  ADVISORY_CREATE_PATH_SHAPE,
  ADVISORY_CREATED_STATE,
  ADVISORY_FENCES,
  ADVISORY_OPEN_STATES,
  ADVISORY_PATH_SHAPE,
  ADVISORY_PLATFORM_MESSAGES,
  ADVISORY_REFUSED_STATES,
  ADVISORY_REPORTS_PATH_SHAPE,
  ADVISORY_SETTABLE_STATES,
  ADVISORY_SEVERITIES,
  ADVISORY_TRANSITIONS,
  ADVISORY_PATCHED_VERSIONS_SHAPE,
  ADVISORY_PUBLISHED_STATE,
  ADVISORY_VERSION_KEYS,
  ADVISORY_VERSION_RANGE_SHAPE,
  ADVISORY_VERSIONS_STATES,
  MAX_ADVISORY_PATCHED_VERSIONS,
  MAX_ADVISORY_VERSION_ENTRIES,
  advisoryVersionEntryFailure,
  advisoryVersionsDiff,
  advisoryVersionsLandedText,
  advisoryVersionsOf,
  advisoryVersionsOnTheWire,
  advisoryVersionsReadBack,
  compareReleaseVersions,
  inAdvisoryRange,
  advisoryRangeComparators,
  CWE_ID_SHAPE,
  GHSA_ID_SHAPE,
  LOGIN_SHAPE,
  MAX_ADVISORY_DESCRIPTION_BYTES,
  MAX_ADVISORY_PACKAGES,
  MAX_ADVISORY_SUMMARY_BYTES,
  MAX_NPM_PACKAGE_CHARS,
  NPM_PACKAGE_SHAPE,
  ADVISORY_READ_FENCES,
  ADVISORY_READ_FIELDS,
  ADVISORY_READ_KEY_TYPE,
  ADVISORY_READ_MAX_PARTS,
  ADVISORY_READ_MAX_SEALED_CHARS,
  ADVISORY_READ_OPEN_FAILED,
  ADVISORY_READ_PART_CHARS,
  ADVISORY_READ_PUBLIC_KEY_CHARS,
  ADVISORY_READ_PUBLIC_KEY_SHAPE,
  ADVISORY_READ_SEAL_OVERHEAD,
  ADVISORY_READ_SEAL_VERSION,
  ADVISORY_READ_SENDER_GATES,
  advisoryReadAad,
  advisoryReadCall,
  advisoryReadFenceFailures,
  advisoryReadFenceText,
  advisoryReadKeyFailure,
  advisoryReadLandedText,
  advisoryReadOverCapText,
  advisoryReadParts,
  advisoryReadPlaintext,
  openAdvisoryRead,
  sealAdvisoryRead,
  advisoryCollaboratorPlan,
  advisoryCreateLandedText,
  advisoryCreateReadBack,
  advisoryFenceFailures,
  advisoryFenceText,
  advisoryLandedText,
  advisoryPlatformText,
  advisoryPrintable,
  advisoryReadBack,
  advisoryReportLandedText,
  advisoryReportReadBack,
  advisoryStateLandedText,
  advisoryStateReadBack,
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

/**
 * The runner's path to the event that started the run — the payload is its `client_payload`. ⛔ Never a step's
 * `env:`: GitHub prints a step's environment into the run log, and the repository is public (header).
 */
export const EVENT_PATH_ENV = 'GITHUB_EVENT_PATH';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bytes = (s) => Buffer.byteLength(String(s), 'utf8');
const quote = (v) => JSON.stringify(v);
/** A value a `quiet` field refused, described by its type and size alone — ⛔ never echoed (`FIELDS` in `ops.mjs`). */
export const describeQuietly = (v) =>
  typeof v === 'string' ? `a string of ${bytes(v)} byte(s)` : Array.isArray(v) ? `an array of ${v.length} item(s)` : v === null ? 'null' : isPlainObject(v) ? 'an object' : typeof v;

/**
 * The payload in the event file the runner wrote — its `client_payload`, parsed. Throws a prerequisite sentence
 * for a path that is absent, a file that cannot be read or parsed, or an event carrying no object there; the
 * sentence never quotes the file's text. Shared with `execute.mjs`, so both read one way.
 */
export function readEventPayload(env = process.env, read = (p) => readFileSync(p, 'utf8')) {
  const path = env[EVENT_PATH_ENV];
  if (typeof path !== 'string' || path.trim() === '') throw new Error(`${EVENT_PATH_ENV} is absent or empty — the runner names the event file through it`);
  let text;
  try {
    text = read(path);
  } catch (e) {
    throw new Error(`the event file ${EVENT_PATH_ENV} names cannot be read (${e?.code ?? 'unreadable'})`);
  }
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    throw new Error(`the event file ${EVENT_PATH_ENV} names is not JSON`);
  }
  if (!isPlainObject(event) || !isPlainObject(event.client_payload)) throw new Error(`the event file ${EVENT_PATH_ENV} names carries no client_payload object — not a repository_dispatch?`);
  return event.client_payload;
}

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
    if (spec.shape && !spec.shape.test(value)) return `${at} must be ${spec.what}, got a string of ${value.length} character(s) that is not one — not echoed`;
    return null;
  }
  if (spec.kind === 'list') {
    if (!Array.isArray(value)) return `${at} must be an array of strings, got ${isPlainObject(value) ? 'an object' : typeof value}`;
    if (value.length === 0) return `${at} must name at least one item`;
    if (value.length > spec.max) return `${at} names ${value.length} items, over its cap of ${spec.max}`;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      // ⛔ A quiet list never echoes an item (`FIELDS`): it is described by its type and size.
      if (typeof item !== 'string' || item.length === 0) return `${at}[${i}] must be a non-empty string, got ${spec.quiet ? describeQuietly(item) : quote(item)}`;
      if (bytes(item) > spec.itemMax) return `${at}[${i}] is ${bytes(item)} bytes, over the per-item cap of ${spec.itemMax}`;
      if (spec.shape && !spec.shape.test(item)) return `${at}[${i}] must be ${spec.itemWhat ?? `in the shape ${spec.shape}`}, got ${spec.quiet ? `${describeQuietly(item)} that is not one — not echoed` : quote(item)}`;
    }
    if (new Set(value).size !== value.length) return `${at} names an item twice`;
    return null;
  }
  if (spec.kind === 'enum') {
    if (spec.named && typeof value === 'string' && Object.hasOwn(spec.named, value)) return `${at} is ${quote(value)}, refused by name: ${spec.named[value]}`;
    // ⛔ A quiet enum never echoes the value (`FIELDS`): it is described by its type and size.
    if (!spec.values.includes(value)) return `${at} must be one of ${spec.values.map(quote).join(', ')}, got ${spec.quiet ? `${describeQuietly(value)} that is not one of them — not echoed` : quote(value)}`;
    return null;
  }
  if (spec.kind === 'sha') {
    if (typeof value !== 'string' || !SHA_SHAPE.test(value)) return `${at} must be the full 40-hex commit sha (lowercase), got ${quote(value)} — a short or hand-typed sha is refused here, before the dispatch, not by the platform's 422`;
    return null;
  }
  if (spec.kind === 'ghsa') {
    // ⛔ The value is never echoed: a payload's text reaches a public run log, and a refused id may be prose put in the wrong key.
    if (typeof value !== 'string' || !GHSA_ID_SHAPE.test(value)) return `${at} must be one repository advisory's id — GHSA and three groups of four lowercase letters or digits — got ${typeof value === 'string' ? `a string of ${value.length} character(s)` : Array.isArray(value) ? 'an array' : value === null ? 'null' : typeof value} that is not one; it is spelled into a path, so it is refused here, before the dispatch, and never echoed`;
    return null;
  }
  if (spec.kind === 'x25519') {
    // ⛔ Never echoed: a refusal reaches a public run log, and a value in this key may be prose put in the wrong one.
    const why = advisoryReadKeyFailure(value);
    if (why) return `${at} must be one X25519 public key, base64 SPKI DER of exactly ${ADVISORY_READ_PUBLIC_KEY_CHARS} characters — got ${describeQuietly(value)} that ${why}; it is refused here, before any request, and never echoed`;
    return null;
  }
  if (spec.kind === 'versions') {
    // ⛔ Never echoed (`FIELDS`' `quiet`): before the publish a package and its versions are the unpublished advisory's.
    if (!Array.isArray(value)) return `${at} must be an array of version entries, got ${describeQuietly(value)}`;
    if (value.length === 0) return `${at} must name at least one entry`;
    if (value.length > spec.max) return `${at} names ${value.length} entries, over its cap of ${spec.max}`;
    for (let i = 0; i < value.length; i++) {
      const why = advisoryVersionEntryFailure(value[i], `${at}[${i}]`);
      if (why) return why;
    }
    const keys = value.map((v) => JSON.stringify(ADVISORY_VERSION_KEYS.map((k) => v[k])));
    if (new Set(keys).size !== keys.length) return `${at} names an entry twice`;
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
 * the two that spend `actions: write`, and the six advisory rows', which
 * spend `repository-advisories`): such a stroke carries exactly that one
 * action. Runs only over actions that passed
 * `validateAction`. Pure.
 */
const levelOf = (op) => OPS[op].grant ?? PERMISSIONS[OPS[op].permission];
const grantOf = (op) => `${OPS[op].permission} ${levelOf(op)}`;

export function strokeErrors(repo, actions) {
  const errors = [];
  const solo = actions.map((a, i) => ({ a, i })).filter(({ a }) => OPS[a.op].alone);
  if (solo.length && actions.length > 1) {
    const op = solo[0].a.op;
    for (const [i, a] of actions.entries()) {
      errors.push(
        a.op === op
          ? `actions[${i}]: a stroke carries exactly ONE \`${op}\` and nothing else (this stroke carries ${actions.length} actions) — its token carries ${grantOf(op)} for that one request; send each in its own dispatch`
          : `actions[${i}] is \`${a.op}\` in a stroke that carries a \`${op}\` — its token carries ${grantOf(op)}, so that stroke carries the \`${op}\` alone; send \`${a.op}\` in its own dispatch`,
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
 * action's op spends, at the level its row spends it — the row's `grant`
 * when it names one, else `PERMISSIONS`' level; the higher of two. `{ …five
 * grants }` for every stroke but a `workflow_dispatch` or `run_rerun_failed`
 * one, which adds `actions: write`; an advisory row that writes
 * (`advisory_report`, `advisory_create`, `advisory_collaborators_add`,
 * `advisory_versions`, `advisory_state`), which adds
 * `repository-advisories: write`; and
 * `advisory_read`, which adds `repository-advisories: read`. Pure.
 */
export function tokenPermissionsOf(payload) {
  const spent = new Map();
  for (const a of payload.actions) {
    const { permission } = OPS[a.op];
    spent.set(permission, spent.get(permission) === 'write' ? 'write' : levelOf(a.op));
  }
  const out = {};
  for (const [name, level] of Object.entries(PERMISSIONS)) {
    if (!STROKE_SCOPED_PERMISSIONS.includes(name)) out[name] = level;
    else if (spent.has(name)) out[name] = spent.get(name);
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
      for (const key of [...spec.required, ...spec.optional]) if (key in a) out[key] = Array.isArray(a[key]) ? a[key].map((x) => (isPlainObject(x) ? { ...x } : x)) : isPlainObject(a[key]) ? { ...a[key] } : a[key];
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

export const KNOWN_FLAGS = Object.freeze(['--file', '--from-event', '--github-output', '--self-test', '--help', '-h', '--json']);

export function parseArgs(argv) {
  const opts = { file: null, fromEvent: false, githubOutput: false, selfTest: false, help: false, json: false, errors: [] };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--from-event') opts.fromEvent = true;
    else if (a === '--github-output') opts.githubOutput = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--file') {
      const v = args.shift();
      if (v === undefined || v.startsWith('--')) opts.errors.push('--file needs a path');
      else opts.file = v;
    } else if (a.startsWith('--file=')) opts.file = a.slice('--file='.length);
    else opts.errors.push(`unrecognised argument ${quote(a)}`);
  }
  if (!opts.selfTest && !opts.help && opts.file === null && !opts.fromEvent) opts.errors.push('name the payload: --file <path> or --from-event');
  if (opts.file !== null && opts.fromEvent) opts.errors.push('--file and --from-event name two sources; pass one');
  return opts;
}

/** Read the payload text from the source the options name. Throws with a prerequisite message. */
export function readPayloadSource(opts, { env = process.env, read = (p) => readFileSync(p, 'utf8') } = {}) {
  if (opts.fromEvent) return readEventPayload(env, read);
  let text;
  try {
    text = read(opts.file);
  } catch (e) {
    throw new Error(`--file ${opts.file} cannot be read (${e?.message ?? 'unreadable'})`);
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
  `  node scripts/pm/fleet-write/validate.mjs --from-event [--github-output]   # reads client_payload from $${EVENT_PATH_ENV}`,
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

/**
 * The lines of a workflow that hand `client_payload` to an `env:` — a block `env:` and every line indented under
 * it, or an inline `env: { … }`. GitHub prints a step's environment into the run log, so this is the route that
 * put a whole payload in a public log; `[]` is what `.github/workflows/fleet-write.yml` must read (header). A text
 * reading of the workflow's own shape, like the two readers above. Pure.
 */
export function payloadInStepEnv(text) {
  const hits = [];
  let block = null;
  for (const line of String(text).split('\n')) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (block !== null && indent <= block) block = null;
    const env = /^\s*(?:-\s+)?env:\s*(.*)$/.exec(line);
    if (env) {
      if (env[1] === '' || env[1].startsWith('#')) block = indent;
      else if (env[1].includes('client_payload')) hits.push(line);
      continue;
    }
    if (block !== null && line.includes('client_payload')) hits.push(line);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Self-test — offline. The battery roster is the floor (AGENTS.md, "Writing a --self-test").
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the envelope: four keys, every one required, nothing else admitted': 9,
  'the fields: request_id shape and cap, the one organization, the session id': 8,
  'the actions: count, the closed op list, closed keys per op, typed values': 30,
  'the platform ceilings: ten top-level properties and under 64KB, pinned with their source': 6,
  'refused by construction: no row reaches a merge, a review, a ref, contents, a workflow, a release or an org endpoint': 24,
  "the mailbox_branch_delete row: pull and a claude/mailbox-* branch and nothing else, any other name refused before the dispatch and never echoed; ONE bodiless DELETE of that one ref, carrying the pull and the branch to the executor's fences; contents write, a literal grant, so the mint widens nothing; and it rides the close stroke": 6,
  'the normalised payload: only judged keys travel': 3,
  'the CLI: a file, the event file, GitHub outputs, and the exit ladder': 12,
  'the transfer row: an issue never a pull, a target from the governed roster never the source, a stroke of its own to one target, labels never created': 12,
  'the token scope: ONE repository for every op but transfer, source + target for a transfer stroke, and the workflow mints from that list': 8,
  'the workflow_dispatch row: a closed allowlist of files matched whole, each with its closed inputs, ref main alone, a stroke of exactly that one action, actions write minted for that stroke alone, and the dispatch call and the failed-jobs re-run the ONLY actions paths any row reaches': 18,
  "the release.yml entry: refresh_version_pr true and nothing beside it — force, false, absent, a string or any other input refused by name; the wire spells the table's value as a string; every entry's inputs declared on disk; and the file's own guards, evaluated, start the bookkeeping lane alone": 22,
  "the run_rerun_failed row: run_id alone, a positive integer, nothing that widens it; one bodiless POST to the run's rerun-failed-jobs; a stroke of exactly that one action; actions write minted for that stroke and EMPTY for every other, through the workflow's existing input; the five fences on the run and its pull, each accepted and refused — the head by the pull's own answer, never the run's embedded copy, and a run naming no pull refused by name; the read-back's judgment; and every other actions path still refused": 33,
  "the hierarchy rows: sub_issue_add and sub_issue_remove name a parent and a child by NUMBER — two different positive integers and nothing that widens them; one POST to the parent's sub_issues and one DELETE to its sub_issue, the body left to the executor; issues write, riding any stroke on the literal grants; the fences on the two cards, each accepted and refused — an issue on the repository, never a pull or a transferred card, the child free of any other parent or listed by this one; and the read-back's judgment by the child's id": 23,
  "the event file: the workflow carries client_payload in no step's env, and the payload is read from GITHUB_EVENT_PATH": 6,
  "the advisory rows: advisory_report, advisory_create, advisory_collaborators_add, advisory_versions and advisory_state — closed keys, a malformed id, package or versions entry refused before any request, a refusal that names the key and the byte count and never echoes a value, published reached by advisory_state alone, from draft alone and through the versions fence; one request each, the draft's and the versions' bodies naming no state and the two other PATCH bodies left to the executor; each a stroke of its own, repository-advisories write minted for it and EMPTY for every other; the bare collection reached by the draft's POST alone and every other security-advisories path refused; the fences, the transitions, the merge and the five read-backs, printing nothing of an answer but the id, the state, the logins and counts": 77,
  "advisory_read: ghsa_id and public_key alone — the key its own kind, an X25519 key in base64 SPKI DER; a malformed key or id refused before any request and never echoed; ONE GET of one advisory; a stroke of its own whose token alone carries repository-advisories READ; the seal opening byte for byte for its own read and key alone, the parts inside the runner's caps, the sender gate's one setting with every other closed, and the fences, printing no id, state or field": 28,
});
// Raised 11 → 12 with the run_rerun_failed battery, 12 → 13 with the hierarchy rows' battery, 13 → 15 with the event
// file's battery and the advisory rows' battery, 15 → 16 with advisory_read's, 16 → 17 with mailbox_branch_delete's: one
// battery, one row.
const SELF_TEST_BATTERY_FLOOR = 17;
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
  /** An advisory id in the shape GitHub spells one — a fixture, naming no real advisory. */
  const GHSA = 'GHSA-abcd-2345-wxyz';
  /** One versions entry in the row's spelling — a fixture, naming no real advisory's versions. */
  const VERSION = Object.freeze({ package: '@objectstack/rest', vulnerable_version_range: '<= 18.2.0', patched_versions: '18.3.0' });
  const { generateKeyPairSync } = await import('node:crypto');
  /** A one-time X25519 key pair as the seat makes one per read; `spki` is the public half `public_key` carries. */
  const keyPair = () => {
    const k = generateKeyPairSync('x25519');
    return { publicKey: k.publicKey, privateKey: k.privateKey, spki: k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
  };
  const READER = keyPair();
  /** One `$GITHUB_OUTPUT` line of a judged payload, by its name — the scoped grants are two lines, so none is read by position. */
  const outputLine = (payload, name) => githubOutputLines(payload).split('\n').find((l) => l.startsWith(`${name}=`)) ?? null;

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
      mailbox_branch_delete: { pull: 1, branch: 'claude/mailbox-ui-3' },
      transfer: { issue: 1, target_repo: `${TARGET_OWNER}/objectui` },
      sub_issue_add: { issue: 1, sub_issue: 2 },
      sub_issue_remove: { issue: 1, sub_issue: 2 },
      workflow_dispatch: { workflow: WORKFLOW_DISPATCH_ALLOWLIST[0], ref: WORKFLOW_DISPATCH_REF },
      run_rerun_failed: { run_id: 1 },
      advisory_report: { summary: 's', description: 'd' },
      advisory_create: { summary: 's', description: 'd', packages: ['p'] },
      advisory_collaborators_add: { ghsa_id: GHSA, collaborators: ['u'] },
      advisory_versions: { ghsa_id: GHSA, versions: [VERSION] },
      advisory_state: { ghsa_id: GHSA, advisory_state: 'draft' },
      advisory_read: { ghsa_id: GHSA, public_key: READER.spki },
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
      issue: 7, pull: 7, comment_id: 7, body: 'b', title: 't', head: 'h', base: 'main', branch: 'claude/mailbox-ui-3', labels: ['a b'], assignees: ['u'], reviewers: ['u'], team_reviewers: ['t'], state: 'closed', state_reason: 'completed', expected_head_sha: SHA, target_repo: `${TARGET_OWNER}/objectui`,
      workflow: WORKFLOW_DISPATCH_ALLOWLIST[0], ref: WORKFLOW_DISPATCH_REF, run_id: 7, sub_issue: 8, ghsa_id: GHSA, collaborators: ['u'],
      summary: 's', description: 'd', severity: 'low', cwe_ids: ['CWE-79'], advisory_state: 'closed', packages: ['p'], versions: [VERSION], public_key: READER.spki,
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
    t("the governed-review follow-up runs after exactly pr_ready — derived from the rows, never listed; ⛔ pr_create is OFF it, the draft open summons nobody and a human is asked at the seat's hand-off (pr_request_reviewers after ACCEPT + a same-head PASS) — and its two writes are a POST to requested_reviewers carrying requested and a POST to the additive issue-assignees endpoint carrying assigned, both in the family pin above", [GOVERNED_REVIEW_OPS, OPS.pr_create.governedReview ?? null, everyRequest.filter((r) => r.governedReview).map((r) => [r.op, r.verb, r.path, r.requested ?? null, r.assigned ?? null])], [['pr_ready'], null, [['pr_ready', 'POST', `/repos/${TARGET_OWNER}/objectstack/pulls/7/requested_reviewers`, ['u'], null], ['pr_ready', 'POST', `/repos/${TARGET_OWNER}/objectstack/issues/7/assignees`, null, ['u']]]]);
    t('…an empty list spells no request, and a governedReview row is never a row whose spelled requests change: pr_create and pr_ready keep the request lists they always had', [governedReviewRequests('o/r', 7), OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b' }, 'o/r').length, OPS.pr_ready.requests({ op: 'pr_ready', pull: 7 }, 'o/r').length], [[], 1, 1]);
    t('⛔ no request path reaches a refused family', everyRequest.filter((r) => REFUSED_PATH_FAMILIES.some((re) => re.test(r.path))).map((r) => `${r.op} ${r.path}`), []);
    t("⛔ the ONE request any row sends under /git/ is mailbox_branch_delete's DELETE of one claude/mailbox-* ref — no create, no move, no other ref", everyRequest.filter((r) => r.path.includes('/git/')).map((r) => [r.op, r.verb, r.path]), [['mailbox_branch_delete', 'DELETE', `/repos/${TARGET_OWNER}/objectstack/git/refs/heads/claude/mailbox-ui-3`]]);
    const gitTails = ['refs', 'refs/heads/main', 'refs/heads/claude/project-thread-x', 'refs/heads/mailbox/os-zhuang/triage-1', 'refs/heads/claude/mailbox-ui-3/x', 'refs/heads/claude/mailbox-', 'refs/heads/claude/mailbox-UI-3', 'refs/heads/claude/mailbox-a..b', 'refs/tags/claude/mailbox-ui-3', 'ref/heads/claude/mailbox-ui-3', 'matching-refs/heads/claude', 'trees', 'blobs', 'commits', 'tags'];
    t('positive control: every other /git/ path — a ref create, another or a nested ref, a tag, a tree, blob or commit — and /contents/ are still caught, while the one mailbox ref is caught by none', [gitTails.filter((tail) => !REFUSED_PATH_FAMILIES.some((re) => re.test(`/repos/o/r/git/${tail}`))), REFUSED_PATH_FAMILIES.some((re) => re.test('/repos/o/r/contents/a')), REFUSED_PATH_FAMILIES.filter((re) => re.test('/repos/o/r/git/refs/heads/claude/mailbox-ui-3')).length], [[], true, 0]);
    t('⛔ the table\'s one PUT is pr_update_branch\'s update-branch, an action endpoint — no PUT reaches /labels or /assignees, the whole-set replaces', [everyRequest.filter((r) => r.verb === 'PUT').map((r) => `${r.op} ${r.path}`), everyRequest.some((r) => r.verb === 'PUT' && /\/(labels|assignees)$/.test(r.path))], [[`pr_update_branch /repos/${TARGET_OWNER}/objectstack/pulls/7/update-branch`], false]);
    t("every verb is one of POST, PATCH, PUT, DELETE — but advisory_read's GET of one advisory, the one GET any row sends, which writes nothing", [everyRequest.filter((r) => r.verb !== 'GET').every((r) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.verb)), everyRequest.filter((r) => r.verb === 'GET').map((r) => `${r.op} ${r.path}`)], [true, [`advisory_read /repos/${TARGET_OWNER}/objectstack/security-advisories/${GHSA}`]]);
    t('pr_update_branch spends pull-requests — where GitHub\'s ledger lists update-branch, server-to-server, no additional permission — and carries the sha in its body', [OPS.pr_update_branch.permission, OPS.pr_update_branch.requests({ op: 'pr_update_branch', pull: 7, expected_head_sha: SHA }, 'o/r')[0].body], ['pull-requests', { expected_head_sha: SHA }]);
    t('every GraphQL descriptor names an allowed mutation and its query spells that name', everyRequest.filter((r) => r.graphql).every((r) => ALLOWED_MUTATIONS.includes(r.graphql.mutation) && r.graphql.query.includes(r.graphql.mutation)));
    t('pr_create forces draft: true whatever the action said', OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b' }, 'o/r')[0].body.draft, true);
    // The legs that read an earlier answer — pr_create's assignees and labels (the ops.mjs header): pinned to those two descriptors.
    const legs = everyRequest.filter((r) => r.fromAnswer !== undefined);
    t("⛔ exactly TWO descriptors read an earlier answer — pr_create's assignees leg, then its labels leg: a POST to the created pull's issue-assignees path and one to its issue-labels path, each at the placeholder the executor fills from the create's number, each carrying what its answer must list", legs.map((r) => [r.op, r.verb, r.path, r.fromAnswer, r.body, r.assigned ?? null, r.labelled ?? null]), [['pr_create', 'POST', `/repos/${TARGET_OWNER}/objectstack/issues/${answerPlaceholder('number')}/assignees`, 'number', { assignees: ['u'] }, ['u'], null], ['pr_create', 'POST', `/repos/${TARGET_OWNER}/objectstack/issues/${answerPlaceholder('number')}/labels`, 'number', { labels: ['a b'] }, null, ['a b']]]);
    t('…and neither is the FIRST request of its action — the answer they read exists before either is sent', OP_NAMES.filter((op) => { const a = { op }; for (const k of [...OPS[op].required, ...OPS[op].optional]) a[k] = sample[k]; return OPS[op].requests(a, 'o/r')[0].fromAnswer !== undefined; }), []);
    t('…every such leg is a POST to the one additive issue endpoint for its list — never a PATCH or PUT, the whole-set replaces', legs.map((r) => [r.verb, /\/(assignees|labels)$/.test(r.path)]), [['POST', true], ['POST', true]]);
    t('…their placeholder is the one spelling the executor fills, spelled once, and no path without fromAnswer carries a brace', [answerPlaceholder('number'), everyRequest.filter((r) => r.fromAnswer === undefined && /[{}]/.test(r.path)).map((r) => `${r.op} ${r.path}`)], ['{number}', []]);
    t('every grant a row ALSO spends is a literal mint input of PERMISSIONS, never a stroke-scoped one — so the mint widens nothing for it; pr_create\'s issues write (its assignees and labels legs), pr_ready\'s (the governed-review assignee fallback) and automerge_enable\'s workflows write are the three such rows', [OP_NAMES.flatMap((op) => OPS[op].alsoSpends ?? []).every((name) => name in PERMISSIONS && !STROKE_SCOPED_PERMISSIONS.includes(name)), OP_NAMES.filter((op) => OPS[op].alsoSpends).map((op) => [op, [...OPS[op].alsoSpends]])], [true, [['pr_create', ['issues']], ['pr_ready', ['issues']], ['automerge_enable', ['workflows']]]]);
    t('pr_create without assignees or labels is the one create request it always was — no later leg', OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b' }, 'o/r').length, 1);
    t('…with labels alone, the create then the labels leg; with assignees alone, the create then the assignees leg', [OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b', labels: ['skip-changeset'] }, 'o/r').map((r) => r.labelled ?? r.assigned ?? 'create'), OPS.pr_create.requests({ op: 'pr_create', title: 't', head: 'h', base: 'b', assignees: ['u'] }, 'o/r').map((r) => r.labelled ?? r.assigned ?? 'create')], [['create', ['skip-changeset']], ['create', ['u']]]);
    t('labels_remove is one directed DELETE per name, URL-encoded, idempotent on 404', OPS.labels_remove.requests({ op: 'labels_remove', issue: 1, labels: ['a b', 'c'] }, 'o/r').map((r) => [r.verb, r.path, r.idempotent404]), [['DELETE', '/repos/o/r/issues/1/labels/a%20b', true], ['DELETE', '/repos/o/r/issues/1/labels/c', true]]);
    t('every op names a permission the token is narrowed to', OP_NAMES.every((op) => OPS[op].permission in PERMISSIONS));
    // The permission map, pinned entry by entry: the auto-merge mutations need `contents: write` on the
    // App token (measured live: without it, "Resource not accessible by integration"), and beside them only
    // mailbox_branch_delete's one ref DELETE spends it (comment 6674408912) — no file write. `workflows: write`
    // is the maintainer's ruling (comment 6104822731): a literal grant on every stroke, spent by the
    // `automerge_enable` row alone (`alsoSpends`) when the pull it arms changes a workflow file.
    t('the map is exactly issues/pull-requests/contents/workflows/actions/repository-advisories write and metadata read', PERMISSIONS, { issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read', actions: 'write', 'repository-advisories': 'write' });
    t('workflows is spent by automerge_enable alone, as alsoSpends, and is no row\'s permission', [OP_NAMES.filter((op) => (OPS[op].alsoSpends ?? []).includes('workflows')), OP_NAMES.filter((op) => OPS[op].permission === 'workflows')], [['automerge_enable'], []]);
    t('nothing wider: every PERMISSIONS key but metadata (the sender gate\'s read) is spent by some row as its permission or an alsoSpends, and the two sets are exactly actions/contents/issues/pull-requests/repository-advisories/workflows', [Object.keys(PERMISSIONS).filter((name) => name !== 'metadata').sort(), [...new Set(OP_NAMES.flatMap((op) => [OPS[op].permission, ...(OPS[op].alsoSpends ?? [])]))].sort()], [['actions', 'contents', 'issues', 'pull-requests', 'repository-advisories', 'workflows'], ['actions', 'contents', 'issues', 'pull-requests', 'repository-advisories', 'workflows']]);
    t('the two auto-merge rows spend contents', [OPS.automerge_enable.permission, OPS.automerge_disable.permission], ['contents', 'contents']);
    t('⛔ …and beside them mailbox_branch_delete alone: contents reaches the two auto-merge mutations and one ref DELETE', OP_NAMES.filter((op) => OPS[op].permission === 'contents').sort(), ['automerge_disable', 'automerge_enable', 'mailbox_branch_delete']);
    t('every row spending contents is a GraphQL auto-merge mutation but mailbox_branch_delete, whose one REST request is a DELETE of a head ref', OP_NAMES.filter((op) => OPS[op].permission === 'contents').map((op) => OPS[op].requests({ op, pull: 1, branch: 'claude/mailbox-x' }, 'o/r').map((r) => (r.graphql ? /PullRequestAutoMerge$/.test(r.graphql.mutation) : `${r.verb} ${r.path}`))), [[true], [true], ['DELETE /repos/o/r/git/refs/heads/claude/mailbox-x']]);
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

  // ── the mailbox_branch_delete row ─────────────────────────────────────────
  battery("the mailbox_branch_delete row: pull and a claude/mailbox-* branch and nothing else, any other name refused before the dispatch and never echoed; ONE bodiless DELETE of that one ref, carrying the pull and the branch to the executor's fences; contents write, a literal grant, so the mint widens nothing; and it rides the close stroke");
  {
    const REPO = `${TARGET_OWNER}/objectstack`;
    const drop = (branch, extra = {}) => fixturePayload({ actions: [{ op: 'mailbox_branch_delete', pull: 30141, branch, ...extra }] });
    t('the shape is claude/mailbox- and a lower-case slug, and the label is pm:mailbox', [MAILBOX_BRANCH_SHAPE.source, MAILBOX_LABEL], ['^claude\\/mailbox-[a-z0-9]+(?:[._-][a-z0-9]+)*$', 'pm:mailbox']);
    t('a claude/mailbox-* branch is accepted — a seat slug with a dot among them', [validatePayload(drop('claude/mailbox-ui-3')).ok, validatePayload(drop('claude/mailbox-repo-www.objectos.ai-2')).ok], [true, true]);
    const outside = ['claude/project-thread-mvsts5', 'mailbox/os-zhuang/triage-1', 'claude/mailbox-', 'claude/mailbox-UI-3', 'claude/mailbox-ui/3', 'claude/mailbox-a..b', 'claude/mailbox-ui-3/', 'claude/mailbox-ui-3.', ' claude/mailbox-ui-3', 'main', 'refs/heads/claude/mailbox-ui-3', 'claude/mailbox-x/../../contents/a'];
    t("⛔ every other name is refused before the dispatch, naming the shape and never echoing the value: another thread's branch, a local seat's mailbox/ branch, an empty slug, upper case, a slash, a dot pair, a trailing slash or dot, a space, main, a qualified ref, a path escape", outside.filter((b) => validatePayload(drop(b)).errors?.join() !== `actions[0].branch must be ${FIELDS.branch.what}, got a string of ${b.length} character(s) that is not one — not echoed`), []);
    t('closed keys: pull and branch both required, a non-integer pull and any other key refused', [refuses(fixturePayload({ actions: [{ op: 'mailbox_branch_delete', branch: 'claude/mailbox-ui-3' }] }), 'pull'), refuses(fixturePayload({ actions: [{ op: 'mailbox_branch_delete', pull: 1 }] }), 'branch'), refuses(drop('claude/mailbox-ui-3', { pull: '1' }), 'positive integer'), refuses(drop('claude/mailbox-ui-3', { sha: SHA }), 'actions[0].sha is not a key `mailbox_branch_delete` takes')], [true, true, true, true]);
    const req = OPS.mailbox_branch_delete.requests({ op: 'mailbox_branch_delete', pull: 30141, branch: 'claude/mailbox-ui-3' }, REPO);
    t("ONE DELETE of that one ref, no body, carrying the pull and the branch to the executor's fences — and no refused family reaches it", [req.length, req[0].verb, req[0].path, 'body' in req[0], req[0].mailboxBranch, REFUSED_PATH_FAMILIES.filter((re) => re.test(req[0].path)).length], [1, 'DELETE', `/repos/${REPO}/git/refs/heads/claude/mailbox-ui-3`, false, { pull: 30141, branch: 'claude/mailbox-ui-3' }, 0]);
    const close = validatePayload(fixturePayload({ actions: [{ op: 'comment', issue: 30141, body: 'b' }, { op: 'issue_patch', issue: 30141, state: 'closed' }, { op: 'mailbox_branch_delete', pull: 30141, branch: 'claude/mailbox-ui-3' }] }));
    t('contents write, a literal grant, no alsoSpends, not alone: the close stroke — comment, close, delete — is accepted and its token is the five literal grants, nothing stroke-scoped', [OPS.mailbox_branch_delete.permission, STROKE_SCOPED_PERMISSIONS.includes('contents'), OPS.mailbox_branch_delete.alsoSpends ?? null, OPS.mailbox_branch_delete.alone ?? false, close.ok, close.ok ? tokenPermissionsOf(close.payload) : null, close.ok ? outputLine(close.payload, 'permission_actions') : null], ['contents', false, null, false, true, { issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read' }, 'permission_actions=']);
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
  battery('the CLI: a file, the event file, GitHub outputs, and the exit ladder');
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
    // The runner's event file: the payload is its client_payload, never a step's env (header).
    files['event.json'] = JSON.stringify({ action: 'fleet-write', client_payload: fixturePayload(), sender: { login: 'os-dev-a' } });
    files['event-no-payload.json'] = JSON.stringify({ action: 'fleet-write' });
    files['event-list.json'] = JSON.stringify({ client_payload: [] });
    const absent = await drive(['--from-event'], {});
    t('--from-event with GITHUB_EVENT_PATH absent is exit 3 naming the variable', [absent.code, absent.err.includes(EVENT_PATH_ENV)], [EXIT_PREREQUISITE, true]);
    const unfit = [];
    for (const f of ['missing.json', 'notjson.json', 'event-no-payload.json', 'event-list.json']) unfit.push((await drive(['--from-event'], { [EVENT_PATH_ENV]: f })).code);
    t('--from-event on an unreadable event file, one that is not JSON, one with no client_payload and one whose client_payload is not an object: each exit 3', unfit, [EXIT_PREREQUISITE, EXIT_PREREQUISITE, EXIT_PREREQUISITE, EXIT_PREREQUISITE]);
    const env = await drive(['--from-event', '--github-output'], { [EVENT_PATH_ENV]: 'event.json', GITHUB_OUTPUT: '/out.txt' });
    t('--from-event --github-output judges the event file\'s client_payload and writes repositories, request_id, action_count, session and an EMPTY permission_actions and permission_repository_advisories to $GITHUB_OUTPUT for a comment', [env.code, env.appended[0]?.file, env.appended[0]?.text], [EXIT_OK, '/out.txt', 'repositories=objectstack\nrequest_id=fw-20260922T090000Z-abc123\naction_count=1\nsession=session_01ABCDEFGHJKMNPQRSTVWXYZ\npermission_actions=\npermission_repository_advisories=\n']);
    t('--github-output without GITHUB_OUTPUT is exit 3', (await drive(['--from-event', '--github-output'], { [EVENT_PATH_ENV]: 'event.json' })).code, EXIT_PREREQUISITE);
    t('⛔ --from-env, the old route through a step\'s logged env, is gone: an unknown flag, usage, nothing judged', [(await drive(['--from-env'], { FLEET_WRITE_PAYLOAD: good })).code, KNOWN_FLAGS.includes('--from-env')], [EXIT_REFUSED, false]);
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
      automerge_enable: { pull: 1 }, automerge_disable: { pull: 1 }, mailbox_branch_delete: { pull: 1, branch: 'claude/mailbox-ui-3' }, workflow_dispatch: { workflow: WORKFLOW_DISPATCH_ALLOWLIST[0], ref: WORKFLOW_DISPATCH_REF },
      run_rerun_failed: { run_id: 1 }, sub_issue_add: { issue: 1, sub_issue: 2 }, sub_issue_remove: { issue: 1, sub_issue: 2 },
      advisory_report: { summary: 's', description: 'd' }, advisory_create: { summary: 's', description: 'd', packages: ['p'] }, advisory_collaborators_add: { ghsa_id: GHSA, collaborators: ['u'] }, advisory_versions: { ghsa_id: GHSA, versions: [VERSION] }, advisory_state: { ghsa_id: GHSA, advisory_state: 'draft' },
      advisory_read: { ghsa_id: GHSA, public_key: READER.spki },
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
    t('the only rows that travel alone or widen the token: workflow_dispatch, run_rerun_failed and the six advisory rows (alone) and transfer (second repository)', [OP_NAMES.filter((op) => OPS[op].alone), OP_NAMES.filter((op) => OPS[op].secondRepo)], [['workflow_dispatch', 'run_rerun_failed', 'advisory_report', 'advisory_create', 'advisory_collaborators_add', 'advisory_versions', 'advisory_state', 'advisory_read'], ['transfer']]);
    t('…and actions is spent by the workflow_dispatch and run_rerun_failed rows and NOTHING else — each of them alone in its stroke', [OP_NAMES.filter((op) => OPS[op].permission === 'actions'), OP_NAMES.filter((op) => OPS[op].permission === 'actions').every((op) => OPS[op].alone === true)], [['workflow_dispatch', 'run_rerun_failed'], true]);
    const plain = validatePayload(fixturePayload()).payload;
    const run = validatePayload(one(start())).payload;
    t('the token grants: a comment stroke carries the five literal grants and no actions; a workflow_dispatch stroke adds actions write', [tokenPermissionsOf(plain), tokenPermissionsOf(run)], [{ issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read' }, { issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read', actions: 'write' }]);
    t('…and the GitHub output spells that as permission_actions=write for the run stroke, EMPTY for every other — the mint action skips an empty input', [outputLine(run, 'permission_actions'), outputLine(plain, 'permission_actions'), [...STROKE_SCOPED_PERMISSIONS]], ['permission_actions=write', 'permission_actions=', ['actions', 'repository-advisories']]);
    // The fence on the grant: every path every row can spell, against the actions families — the dispatch call is the ONE
    // actions path reached; and a POSITIVE CONTROL that the families would catch what actions: write otherwise reaches.
    const filled = { issue: 7, pull: 7, comment_id: 7, body: 'b', title: 't', head: 'h', base: 'main', labels: ['a'], assignees: ['u'], reviewers: ['u'], team_reviewers: ['t'], state: 'closed', state_reason: 'completed', expected_head_sha: SHA, target_repo: `${TARGET_OWNER}/objectui`, workflow: FILE, ref: WORKFLOW_DISPATCH_REF, run_id: 7, sub_issue: 8, ghsa_id: GHSA, collaborators: ['u'], summary: 's', description: 'd', severity: 'low', cwe_ids: ['CWE-79'], advisory_state: 'closed', packages: ['p'], versions: [VERSION] };
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
    t('…and its stroke mints actions write for ONE repository, as the shard-timings stroke does', run ? [tokenRepositoriesOf(run), tokenPermissionsOf(run).actions, outputLine(run, 'permission_actions')] : 'the refresh stroke was refused', [[REPO], 'write', 'permission_actions=write']);
    // The entries against their files on disk: every key declared under the file's `workflow_dispatch` trigger, with the type
    // its value has; a null entry's file declares none (the platform refuses inputs there). The reader is pinned first.
    const repoRoot = resolve(SELF_PATH, '../../../..');
    const releaseText = readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8');
    const declared = declaredDispatchInputs(releaseText);
    t('the reader reads release.yml\'s dispatch inputs off disk — force, refresh_version_pr and snapshot_next, all boolean, all defaulting to false — so force and snapshot_next are declared there and left out here on purpose', declared, { force: { type: 'boolean', default: 'false' }, refresh_version_pr: { type: 'boolean', default: 'false' }, snapshot_next: { type: 'boolean', default: 'false' } });
    t('every input an entry names is declared by its file with the type its value has, and a null entry\'s file declares none', WORKFLOW_DISPATCH_ALLOWLIST.map((file) => {
      const onDisk = declaredDispatchInputs(readFileSync(resolve(repoRoot, '.github/workflows', file), 'utf8'));
      const entry = WORKFLOW_DISPATCH_INPUTS[file];
      if (entry === null) return [file, onDisk !== null && Object.keys(onDisk).length === 0];
      return [file, onDisk !== null && Object.entries(entry).every(([name, value]) => onDisk[name]?.type === typeof value)];
    }), WORKFLOW_DISPATCH_ALLOWLIST.map((file) => [file, true]));
    // The lane claim, measured: release.yml's own job guards evaluated for the relay's dispatch. The reader is pinned to
    // read all eight jobs and to tell the lanes apart (schedule, push and the repair dispatch are its controls), and a
    // guard mutated in memory must change the answer — so the pin can fail, and a job added there is judged by its guard.
    const started = (text, event, sent) => jobsStartedBy(text, { event, inputs: dispatchRunInputs(declaredDispatchInputs(text), sent) });
    const relayRun = started(releaseText, 'workflow_dispatch', WORKFLOW_DISPATCH_INPUTS[RELEASE]);
    t('the reader reads every job of release.yml, each with a guard it can evaluate', [Object.keys(workflowJobs(releaseText)).sort(), relayRun.unread], [['docker', 'full-battery', 'publish', 'release-integrity', 'snapshot-next', 'snapshot-next-preflight', 'stale-prompts', 'version-pr'], []]);
    t('⭐ the relay\'s dispatch starts version-pr ALONE — release-integrity, stale-prompts, full-battery, publish, docker and both snapshot jobs are skipped, none undecided (measured live: runs 38351525685 and 38357219168, before the snapshot lane existed)', [relayRun.runs, relayRun.mayRun, [...relayRun.skipped].sort()], [['version-pr'], [], ['docker', 'full-battery', 'publish', 'release-integrity', 'snapshot-next', 'snapshot-next-preflight', 'stale-prompts']]);
    const repair = started(releaseText, 'workflow_dispatch', { refresh_version_pr: false });
    t('control: the repair dispatch the entry refuses (refresh_version_pr false) starts the audit and MAY reach publish — the reader tells the lanes apart', [repair.runs.includes('release-integrity'), repair.runs.includes('version-pr'), repair.mayRun.includes('publish')], [true, false, true]);
    t('control: schedule starts version-pr alone, push starts the audit and never version-pr', [started(releaseText, 'schedule', {}).runs, started(releaseText, 'push', {}).runs.includes('release-integrity'), started(releaseText, 'push', {}).runs.includes('version-pr')], [['version-pr'], true, false]);
    const unguarded = releaseText.replace("(github.event_name == 'workflow_dispatch' && !inputs.refresh_version_pr && !inputs.snapshot_next)", "(github.event_name == 'workflow_dispatch' && inputs.refresh_version_pr && !inputs.snapshot_next)");
    const added = `${releaseText.replace(/\n+$/u, '')}\n\n  extra-lane:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`;
    t('⛔ the pin can fail: a release-integrity guard that lost its negation, or a ninth job with no guard, is started by the relay\'s dispatch', [unguarded !== releaseText && started(unguarded, 'workflow_dispatch', REFRESH).runs.includes('release-integrity'), started(added, 'workflow_dispatch', REFRESH).runs.includes('extra-lane')], [true, true]);
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
    t('⭐ …and the GitHub output spells permission_actions=write for its stroke, exactly as for a workflow_dispatch stroke', stroke ? [outputLine(stroke, 'permission_actions'), outputLine(validatePayload(one({ op: 'workflow_dispatch', workflow: WORKFLOW_DISPATCH_ALLOWLIST[0], ref: WORKFLOW_DISPATCH_REF })).payload, 'permission_actions')] : 'refused', ['permission_actions=write', 'permission_actions=write']);
    const minimalOf = {
      comment: { issue: 1, body: 'b' }, comment_edit: { comment_id: 1, body: 'b' }, labels_add: { issue: 1, labels: ['a'] }, labels_remove: { issue: 1, labels: ['a'] },
      assign: { issue: 1, assignees: ['u'] }, unassign: { issue: 1, assignees: ['u'] }, issue_patch: { issue: 1, state: 'closed' }, issue_create: { title: 't', body: 'b' },
      pr_create: { title: 't', head: 'h', base: 'main' }, pr_request_reviewers: { pull: 1, reviewers: ['u'] }, pr_update_branch: { pull: 1, expected_head_sha: SHA }, pr_ready: { pull: 1 }, pr_draft: { pull: 1 },
      automerge_enable: { pull: 1 }, automerge_disable: { pull: 1 }, mailbox_branch_delete: { pull: 1, branch: 'claude/mailbox-ui-3' }, transfer: { issue: 1, target_repo: `${TARGET_OWNER}/objectui` },
      sub_issue_add: { issue: 1, sub_issue: 2 }, sub_issue_remove: { issue: 1, sub_issue: 2 },
      advisory_report: { summary: 's', description: 'd' }, advisory_create: { summary: 's', description: 'd', packages: ['p'] }, advisory_collaborators_add: { ghsa_id: GHSA, collaborators: ['u'] }, advisory_versions: { ghsa_id: GHSA, versions: [VERSION] }, advisory_state: { ghsa_id: GHSA, advisory_state: 'draft' },
      advisory_read: { ghsa_id: GHSA, public_key: READER.spki },
    };
    const spendsNoActions = OP_NAMES.filter((op) => OPS[op].permission !== 'actions');
    t('…the ledger of ops spending no actions grant is every op but the two that do, no more and no less', [Object.keys(minimalOf).sort(), [...spendsNoActions].sort()], [[...spendsNoActions].sort(), [...spendsNoActions].sort()]);
    const scopedLine = (actions) => {
      const v = validatePayload(fixturePayload({ actions }));
      return v.ok ? outputLine(v.payload, 'permission_actions') : `refused: ${v.errors.join(' | ')}`;
    };
    t('⛔ fence grant, refused side: every op spending no actions grant writes an EMPTY permission_actions — each alone in its stroke, and the stroke of them all that shares one token', [spendsNoActions.filter((op) => scopedLine([{ op, ...minimalOf[op] }]) !== 'permission_actions='), scopedLine(spendsNoActions.filter((op) => !OPS[op].secondRepo && !OPS[op].alone).map((op) => ({ op, ...minimalOf[op] })))], [[], 'permission_actions=']);
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
    t('a stroke carrying both rows beside a comment and a label is accepted — no alone — and mints the five literal grants for ONE repository, permission_actions EMPTY', [mixed.ok, mixed.payload ? tokenPermissionsOf(mixed.payload) : null, mixed.payload ? tokenRepositoriesOf(mixed.payload) : null, mixed.payload ? outputLine(mixed.payload, 'permission_actions') : null], [true, { issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read' }, [REPO], 'permission_actions='], mixed.errors.join(' | '));
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

  // ── the event file ────────────────────────────────────────────────────────
  battery("the event file: the workflow carries client_payload in no step's env, and the payload is read from GITHUB_EVENT_PATH");
  {
    const repoRoot = resolve(SELF_PATH, '../../../..');
    const workflowText = readFileSync(resolve(repoRoot, '.github/workflows/fleet-write.yml'), 'utf8');
    t('⛔ no step env of fleet-write.yml carries client_payload — GitHub prints a step\'s env into the public run log', payloadInStepEnv(workflowText), []);
    const OLD = ['      - name: Validate', '        env:', '          FLEET_WRITE_PAYLOAD: ${{ toJSON(github.event.client_payload) }}', '        run: node x.mjs', '      - name: Execute', '        env: { P: "${{ github.event.client_payload.actions }}" }'].join('\n');
    t('positive control: the reader finds the old step env and an inline one — so the empty list above is a measurement', payloadInStepEnv(OLD), ['          FLEET_WRITE_PAYLOAD: ${{ toJSON(github.event.client_payload) }}', '        env: { P: "${{ github.event.client_payload.actions }}" }']);
    const named = workflowText.split('\n').filter((l) => !/^\s*#/.test(l) && /client_payload|FLEET_WRITE_PAYLOAD/.test(l));
    t('…and the one live line that names client_payload is the run name, reading the request id alone', named, ["run-name: 'fleet-write ${{ github.event.client_payload.request_id }}'"]);
    const runs = [...workflowText.matchAll(/^\s+run:\s*(.*?)\s*$/gm)].map((m) => m[1]);
    t('the validate step reads the event file and the execute step reads it too, with no payload flag beside it', runs, ['node scripts/pm/fleet-write/validate.mjs --from-event --github-output', 'node scripts/pm/fleet-write/execute.mjs']);
    const event = { action: 'fleet-write', client_payload: fixturePayload(), sender: { login: 'os-dev-a' } };
    t('readEventPayload returns the event\'s client_payload, as the runner wrote it', readEventPayload({ [EVENT_PATH_ENV]: '/e.json' }, () => JSON.stringify(event)), fixturePayload());
    const SECRET = 'EVENT TEXT MARKER, never quoted';
    const unread = [() => '{', () => JSON.stringify({ x: SECRET }), () => JSON.stringify({ client_payload: SECRET })].map((read) => {
      try {
        readEventPayload({ [EVENT_PATH_ENV]: '/e.json' }, read);
        return 'read';
      } catch (e) {
        return e.message.includes(SECRET) || e.message.includes('{') ? 'quoted' : 'refused';
      }
    });
    t('⛔ a file that is not JSON, an event with no client_payload and one whose client_payload is not an object are refused — the sentence quotes none of the file', unread, ['refused', 'refused', 'refused']);
  }

  // ── the advisory rows ─────────────────────────────────────────────────────
  battery("the advisory rows: advisory_report, advisory_create, advisory_collaborators_add, advisory_versions and advisory_state — closed keys, a malformed id, package or versions entry refused before any request, a refusal that names the key and the byte count and never echoes a value, published reached by advisory_state alone, from draft alone and through the versions fence; one request each, the draft's and the versions' bodies naming no state and the two other PATCH bodies left to the executor; each a stroke of its own, repository-advisories write minted for it and EMPTY for every other; the bare collection reached by the draft's POST alone and every other security-advisories path refused; the fences, the transitions, the merge and the five read-backs, printing nothing of an answer but the id, the state, the logins and counts");
  {
    const REPO = `${TARGET_OWNER}/objectstack`;
    // The six rows spending repository-advisories: the five that write, then the one that reads (its own battery below).
    const ADVISORY_OPS = ['advisory_report', 'advisory_create', 'advisory_collaborators_add', 'advisory_versions', 'advisory_state', 'advisory_read'];
    const report = (extra = {}) => ({ op: 'advisory_report', summary: 'A short summary.', description: 'What, where, how to reproduce.', ...extra });
    const draft = (extra = {}) => ({ op: 'advisory_create', summary: 'A short summary.', description: 'What, where, how to reproduce.', packages: ['@objectstack/rest'], ...extra });
    const add = (extra = {}) => ({ op: 'advisory_collaborators_add', ghsa_id: GHSA, collaborators: ['os-dev-a'], ...extra });
    const move = (to = 'draft', extra = {}) => ({ op: 'advisory_state', ghsa_id: GHSA, advisory_state: to, ...extra });
    const setv = (extra = {}) => ({ op: 'advisory_versions', ghsa_id: GHSA, versions: [VERSION], ...extra });
    const one = (action) => fixturePayload({ actions: [action] });
    const errorsOf = (action) => validatePayload(one(action)).errors;
    // Spaces and punctuation: prose, never a login's, an id's, a state's or a weakness id's shape.
    const PROSE = 'ADVISORY PROSE MARKER, in the wrong key';
    /** A second release line of the same package — a package may take one entry per line it was fixed on. */
    const LINE_17 = Object.freeze({ package: '@objectstack/rest', vulnerable_version_range: '>= 17.0.0, < 17.9.4', patched_versions: '17.9.4' });
    // The rows and their requests.
    t('the rows: report takes summary and description, optionally severity and cwe_ids; the draft the same plus packages; the other three take ghsa_id with collaborators, versions or advisory_state, and the read ghsa_id with public_key; all six spend repository-advisories alone — the five that write at write, the read at read — travel alone, reach no second repository and close no inputs', ADVISORY_OPS.map((op) => [OPS[op].required, OPS[op].optional, OPS[op].permission, OPS[op].grant ?? null, OPS[op].alsoSpends ?? null, OPS[op].alone, OPS[op].secondRepo ?? null, OPS[op].closedInputs ?? null]), [[['summary', 'description'], ['severity', 'cwe_ids'], 'repository-advisories', null, null, true, null, null], [['summary', 'description', 'packages'], ['severity', 'cwe_ids'], 'repository-advisories', null, null, true, null, null], [['ghsa_id', 'collaborators'], [], 'repository-advisories', null, null, true, null, null], [['ghsa_id', 'versions'], [], 'repository-advisories', null, null, true, null, null], [['ghsa_id', 'advisory_state'], [], 'repository-advisories', null, null, true, null, null], [['ghsa_id', 'public_key'], [], 'repository-advisories', 'read', null, true, null, null]]);
    t('the fields: summary and description byte-capped strings — 1024 and the body cap; severity GitHub\'s four, quiet; cwe_ids a quiet capped list of CWE ids; ghsa_id its own kind; collaborators a quiet login list capped like assignees; advisory_state a quiet enum of draft, closed and published — by the maintainer\'s ruling no state is refused by name any more', [FIELDS.summary, FIELDS.description.max === FIELDS.body.max, [...FIELDS.severity.values], FIELDS.severity.quiet, [FIELDS.cwe_ids.kind, FIELDS.cwe_ids.max, FIELDS.cwe_ids.shape === CWE_ID_SHAPE, FIELDS.cwe_ids.quiet], FIELDS.ghsa_id, [FIELDS.collaborators.max === FIELDS.assignees.max, FIELDS.collaborators.itemMax === FIELDS.assignees.itemMax, FIELDS.collaborators.shape === LOGIN_SHAPE, FIELDS.collaborators.quiet], [[...FIELDS.advisory_state.values], FIELDS.advisory_state.quiet, Object.keys(FIELDS.advisory_state.named)]], [{ kind: 'str', max: MAX_ADVISORY_SUMMARY_BYTES }, true, ['critical', 'high', 'medium', 'low'], true, ['list', 10, true, true], { kind: 'ghsa' }, [true, true, true, true], [['draft', 'closed', 'published'], true, []]]);
    const filed = OPS.advisory_report.requests(report(), REPO);
    const filedFull = OPS.advisory_report.requests(report({ severity: 'high', cwe_ids: ['CWE-79', 'CWE-352'] }), REPO);
    t('advisory_report is ONE POST to the reports endpoint whose body is the summary and description, plus severity and cwe_ids when sent — and no other key', [filed.length, filed[0].verb, filed[0].path, filed[0].body, Object.keys(filedFull[0].body), ADVISORY_REPORTS_PATH_SHAPE.test(filed[0].path), REFUSED_PATH_FAMILIES.filter((re) => re.test(filed[0].path)).map(String)], [1, 'POST', `/repos/${REPO}/security-advisories/reports`, { summary: 'A short summary.', description: 'What, where, how to reproduce.' }, ['summary', 'description', 'severity', 'cwe_ids'], true, []]);
    t('the packages field: a quiet list of npm package names, capped at ten and at the registry\'s 214 characters, shaped by NPM_PACKAGE_SHAPE; the ecosystem the draft names is npm alone', [FIELDS.packages.kind, FIELDS.packages.max, MAX_ADVISORY_PACKAGES, FIELDS.packages.itemMax, MAX_NPM_PACKAGE_CHARS, FIELDS.packages.shape === NPM_PACKAGE_SHAPE, FIELDS.packages.quiet, ADVISORY_CREATE_ECOSYSTEM], ['list', 10, 10, 214, 214, true, true, 'npm']);
    const created = OPS.advisory_create.requests(draft(), REPO);
    const createdFull = OPS.advisory_create.requests(draft({ packages: ['@objectstack/rest', 'hotcrm'], severity: 'high', cwe_ids: ['CWE-79'] }), REPO);
    t('⭐ advisory_create is ONE POST to the bare collection — the create of a DRAFT — whose body is the summary, the description and one vulnerabilities entry per package naming the npm ecosystem and the name alone, plus severity and cwe_ids when sent; no state, no version range, no credit, no CVSS vector, no CVE id and no private fork', [created.length, created[0].verb, created[0].path, created[0].body, Object.keys(createdFull[0].body), createdFull[0].body.vulnerabilities, created[0].advisoryCreate, ADVISORY_CREATE_PATH_SHAPE.test(created[0].path), REFUSED_PATH_FAMILIES.filter((re) => re.test(created[0].path)).map(String)], [1, 'POST', `/repos/${REPO}/security-advisories`, { summary: 'A short summary.', description: 'What, where, how to reproduce.', vulnerabilities: [{ package: { ecosystem: 'npm', name: '@objectstack/rest' } }] }, ['summary', 'description', 'vulnerabilities', 'severity', 'cwe_ids'], [{ package: { ecosystem: 'npm', name: '@objectstack/rest' } }, { package: { ecosystem: 'npm', name: 'hotcrm' } }], true, true, []]);
    t('…the collection shape is the bare path alone: a trailing slash, a query, an advisory\'s path, the reports endpoint and a path under a second segment are not it', ['/repos/o/r/security-advisories/', '/repos/o/r/security-advisories?state=draft', `/repos/o/r/security-advisories/${GHSA}`, '/repos/o/r/security-advisories/reports', '/repos/o/r/x/security-advisories', '/orgs/o/security-advisories'].filter((path) => ADVISORY_CREATE_PATH_SHAPE.test(path)), []);
    const patched = OPS.advisory_collaborators_add.requests(add({ collaborators: ['a', 'B'] }), REPO);
    const moved = OPS.advisory_state.requests(move('closed'), REPO);
    t("the two id rows are ONE PATCH of one advisory's path each, carrying NO body of the payload's — the executor sends { collaborating_users } or { state } after its own GET — and the id with the logins or the state asked for", [patched.length, patched[0].verb, patched[0].path, 'body' in patched[0], patched[0].advisoryCollaborators, moved.length, moved[0].verb, moved[0].path, 'body' in moved[0], moved[0].advisoryState], [1, 'PATCH', `/repos/${REPO}/security-advisories/${GHSA}`, false, { ghsaId: GHSA, add: ['a', 'B'] }, 1, 'PATCH', `/repos/${REPO}/security-advisories/${GHSA}`, false, { ghsaId: GHSA, to: 'closed' }]);
    t('the versions field: its own kind, quiet, at most ten entries — a package may take one per release line — each exactly package, vulnerable_version_range and patched_versions, a patched list of at most five', [FIELDS.versions, MAX_ADVISORY_VERSION_ENTRIES, [...ADVISORY_VERSION_KEYS], MAX_ADVISORY_PATCHED_VERSIONS], [{ kind: 'versions', max: 10, quiet: true }, 10, ['package', 'vulnerable_version_range', 'patched_versions'], 5]);
    const versioned = OPS.advisory_versions.requests(setv({ versions: [VERSION, LINE_17] }), REPO);
    t("⭐ advisory_versions is ONE PATCH of one advisory's path whose body is { vulnerabilities } and NOTHING else — per entry the npm ecosystem, the name, the range and the patched versions, no vulnerable function, no state, no summary or description — and the id with the entries for the executor's fences and read-back", [versioned.length, versioned[0].verb, versioned[0].path, Object.keys(versioned[0].body), versioned[0].body.vulnerabilities, versioned[0].body.vulnerabilities.map((v) => [Object.keys(v), Object.keys(v.package)]), versioned[0].advisoryVersions, REFUSED_PATH_FAMILIES.filter((re) => re.test(versioned[0].path)).length], [1, 'PATCH', `/repos/${REPO}/security-advisories/${GHSA}`, ['vulnerabilities'], [{ package: { ecosystem: 'npm', name: '@objectstack/rest' }, vulnerable_version_range: '<= 18.2.0', patched_versions: '18.3.0' }, { package: { ecosystem: 'npm', name: '@objectstack/rest' }, vulnerable_version_range: '>= 17.0.0, < 17.9.4', patched_versions: '17.9.4' }], [0, 1].map(() => [['package', 'vulnerable_version_range', 'patched_versions'], ['ecosystem', 'name']]), { ghsaId: GHSA, versions: [VERSION, LINE_17] }, 0]);
    t("…and the publish is advisory_state's ONE PATCH, its body left to the executor like every state's: the descriptor names the id and published", OPS.advisory_state.requests(move('published'), REPO).map((r) => [r.verb, r.path, 'body' in r, r.advisoryState]), [['PATCH', `/repos/${REPO}/security-advisories/${GHSA}`, false, { ghsaId: GHSA, to: 'published' }]]);
    // Accepted.
    const acceptedActions = [report(), report({ severity: 'low', cwe_ids: ['CWE-79'] }), draft(), draft({ packages: ['@objectstack/rest', 'hotcrm', 'create-objectstack'], severity: 'critical', cwe_ids: ['CWE-863'] }), add(), setv(), setv({ versions: [VERSION, LINE_17, { package: 'hotcrm', vulnerable_version_range: '< 2.1.0', patched_versions: '2.1.0' }] }), move('draft'), move('closed'), move('published')];
    const accepted = acceptedActions.map((a) => validatePayload(one(a)));
    t('accepted: a report and a draft with and without their optional keys, the collaborators, versions for one entry and for two lines of one package beside another package, and each of the three states — each normalised to exactly what was sent', accepted.map((v) => [v.ok, v.payload?.actions[0]]), acceptedActions.map((a) => [true, a]), accepted.flatMap((v) => v.errors).join(' | '));
    const sentEntry = { ...VERSION };
    const normalised = validatePayload(one(setv({ versions: [sentEntry] }))).payload;
    t('…and a normalised entry is a copy: the payload that travels shares no object with the action it judged', [normalised?.actions[0].versions[0] === sentEntry, normalised?.actions[0].versions[0]], [false, VERSION]);
    // The versions entries, judged by value — each refusal naming the entry and the key, ⛔ never the value.
    const spelled = (range, patched) => validatePayload(one(setv({ versions: [{ package: '@objectstack/rest', vulnerable_version_range: range, patched_versions: patched }] }))).ok;
    const goodSpellings = [['< 1.0.1', '1.0.1'], ['<= 18.2.0', '18.3.0'], ['= 1.0.0', '1.0.1'], ['> 2.0.0', '1.9.9'], ['>= 3.0.0', '2.9.0'], ['>= 1.0.0, < 1.0.1', '1.0.1'], ['> 0.9.0, <= 1.0.0', '1.0.1, 2.0.0'], ['>= 1.0.0, < 999999.0.0', '0.9.0, 999999.0.0']];
    t("⭐ accepted spellings: one comparator of each operator, a lower bound then an upper bound — GitHub's own example spelling among them — and one or more patched versions outside the range", goodSpellings.filter(([r, p]) => !spelled(r, p)), []);
    const badRanges = ['>=1.0.0', '>=  1.0.0', 'v1.0.0', '< v1.0.0', '1.0.0', '^1.0.0', '~1.0.0', '< 1.0', '< 1.0.0-beta.1', '< 1.0.0+build', '< 01.0.0', '< 1.0.0 ', ' < 1.0.0', '<= 1.0.0, >= 0.5.0', '>= 1.0.0,< 2.0.0', '>= 1.0.0 < 2.0.0', '>= 1.0.0, < 2.0.0, < 3.0.0', '= 1.0.0, < 2.0.0', '< 1.0.0 || > 2.0.0', '< 1234567.0.0', '', 7, null, ['< 1.0.0']];
    t('⛔ ranges refused, naming vulnerable_version_range: no space or two, a v prefix, a bare version, a caret or tilde, two parts, a pre-release or build tag, a leading zero, stray spaces, an upper bound first, a missing space or comma, three comparators, an equality in a pair, an or-range, a seven-digit part, empty, a number, null and an array', badRanges.filter((range) => !refuses(one(setv({ versions: [{ ...VERSION, vulnerable_version_range: range }] })), 'actions[0].versions[0].vulnerable_version_range must be one comparator')).map(String), []);
    t('⛔ …and a pair whose bounds do not rise — equal, or falling — is refused naming it', [['>= 2.0.0, < 1.0.0', '2.1.0'], ['>= 1.0.0, <= 1.0.0', '1.0.1']].map(([r, p]) => errorsOf(setv({ versions: [{ ...VERSION, vulnerable_version_range: r, patched_versions: p }] }))), [0, 1].map(() => ['actions[0].versions[0].vulnerable_version_range has a lower bound that is not below its upper bound']));
    const badPatched = ['>= 18.3.0', '18.3', 'v18.3.0', '18.3.0,18.4.0', '18.3.0 , 18.4.0', '18.3.0-rc.1', '18.3.0, 18.4.0, 18.5.0, 18.6.0, 18.7.0, 18.8.0', '', 18, null];
    t('⛔ patched versions refused, naming patched_versions: an operator, two parts, a v prefix, a missing space or a stray one, a pre-release, six versions, empty, a number and null', badPatched.filter((patched) => !refuses(one(setv({ versions: [{ ...VERSION, patched_versions: patched }] })), 'actions[0].versions[0].patched_versions must be one to 5 release versions')).map(String), []);
    t('⛔ …a version named twice, and a patched version INSIDE its own range — the classic swap — refused naming it, the version never', [errorsOf(setv({ versions: [{ ...VERSION, patched_versions: '18.3.0, 18.3.0' }] })), errorsOf(setv({ versions: [{ ...VERSION, patched_versions: '18.2.0' }] })), errorsOf(setv({ versions: [{ ...VERSION, vulnerable_version_range: '>= 18.0.0, < 18.3.0', patched_versions: '17.9.4, 18.3.0, 18.2.9' }] }))], [['actions[0].versions[0].patched_versions names a version twice'], ["actions[0].versions[0].patched_versions names 1 version(s) inside the entry's own vulnerable_version_range — a patched version is never a vulnerable one"], ["actions[0].versions[0].patched_versions names 1 version(s) inside the entry's own vulnerable_version_range — a patched version is never a vulnerable one"]]);
    t('⛔ entries refused: none, eleven, one twice, an entry that is a string, an array or null, one missing each key, one carrying vulnerable_functions, an ecosystem or a state, and a package that is no npm name — a name with a version after it, an uppercase name, a URL', [[], Array.from({ length: 11 }, (_, i) => ({ ...VERSION, vulnerable_version_range: `< ${i + 1}.0.0`, patched_versions: `${i + 1}.0.0` })), [VERSION, { ...VERSION }], ['x'], [[VERSION]], [null], [{ package: VERSION.package, patched_versions: '18.3.0' }], [{ package: VERSION.package, vulnerable_version_range: '<= 18.2.0' }], [{ vulnerable_version_range: '<= 18.2.0', patched_versions: '18.3.0' }], [{ ...VERSION, vulnerable_functions: ['f'] }], [{ ...VERSION, ecosystem: 'npm' }], [{ ...VERSION, state: 'published' }], [{ ...VERSION, package: 'hotcrm@1.0.0' }], [{ ...VERSION, package: 'React' }], [{ ...VERSION, package: 'https://npmjs.com/hotcrm' }]].filter((versions) => !refuses(one(setv({ versions })), 'actions[0].versions')).length, 0);
    t('…each refusal names WHAT is wrong in its own words: the cap, the duplicate, an entry that is no object, a missing key, a key no entry takes, a package that is no npm name', [errorsOf(setv({ versions: Array.from({ length: 11 }, () => VERSION) })), errorsOf(setv({ versions: [VERSION, { ...VERSION }] })), errorsOf(setv({ versions: ['x'] })), errorsOf(setv({ versions: [{ package: VERSION.package, patched_versions: '18.3.0' }] })), errorsOf(setv({ versions: [{ ...VERSION, vulnerable_functions: ['f'] }] })), errorsOf(setv({ versions: [{ ...VERSION, package: 'React' }] }))], [['actions[0].versions names 11 entries, over its cap of 10'], ['actions[0].versions names an entry twice'], ['actions[0].versions[0] must be an object of package, vulnerable_version_range, patched_versions, got a string of 1 byte(s)'], ['actions[0].versions[0] has no vulnerable_version_range — an entry carries all three'], ['actions[0].versions[0] carries vulnerable_functions — an entry is exactly package, vulnerable_version_range, patched_versions'], ['actions[0].versions[0].package must be an npm package name, got a string of 5 byte(s) that is not one — not echoed']]);
    t('the release versions compare by number, part by part, and a range holds a version only when every comparator does', [compareReleaseVersions('18.10.0', '18.9.9') > 0, compareReleaseVersions('1.0.0', '1.0.0'), compareReleaseVersions('0.9.9', '1.0.0') < 0, advisoryRangeComparators('>= 17.0.0, < 17.9.4'), ['16.9.9', '17.0.0', '17.9.3', '17.9.4'].map((v) => inAdvisoryRange(v, advisoryRangeComparators('>= 17.0.0, < 17.9.4'))), advisoryRangeComparators('>=17.0.0'), advisoryRangeComparators(null)], [true, 0, true, [{ op: '>=', version: '17.0.0' }, { op: '<', version: '17.9.4' }], [false, true, true, false], null, null]);
    // Refused by value — and never echoed.
    const malformed = ['ghsa-abcd-2345-wxyz', 'GHSA-ABCD-2345-WXYZ', 'GHSA-abcd-2345', 'GHSA-abcd-2345-wxyz-mnop', 'GHSA-abcde-2345-wxyz', 'GHSA_abcd_2345_wxyz', 'CVE-2026-12345', `${GHSA}/cve`, `../${GHSA}`, ` ${GHSA}`, '', 17, null, [GHSA]];
    t('⛔ a malformed ghsa_id is refused before any request on all three id rows, naming the shape: a lowercase prefix, uppercase groups, too few or too many groups, a long group, another separator, a CVE id, a path suffix or prefix, a space, empty, a number, null and an array', [add, (x) => move('draft', x), setv].map((row) => malformed.filter((ghsa_id) => !refuses(one(row({ ghsa_id })), "actions[0].ghsa_id must be one repository advisory's id")).length), [0, 0, 0]);
    t("⭐ published is a value advisory_state takes, by the maintainer's ruling — no refusal at the validator, and no state refused by name any more; the move itself is fenced on the executor's own read", [errorsOf(move('published')), Object.keys(ADVISORY_REFUSED_STATES), ADVISORY_PUBLISHED_STATE], [[], [], 'published']);
    t('⛔ …and every other state is refused naming the three it may be — unknown ones fail closed: triage, open, withdrawn, a capitalised Published, empty and a number', ['triage', 'open', 'withdrawn', 'Published', '', 7].map((s) => refuses(one(move(s)), 'actions[0].advisory_state must be one of "draft", "closed", "published"')), [true, true, true, true, true, true]);
    const quietly = [
      ['advisory_state', move(PROSE)],
      ['severity', report({ severity: PROSE })],
      ['cwe_ids', report({ cwe_ids: [PROSE] })],
      ['cwe_ids', report({ cwe_ids: [{ text: PROSE }] })],
      ['collaborators', add({ collaborators: [PROSE] })],
      ['collaborators', add({ collaborators: [{ login: PROSE }] })],
      ['ghsa_id', add({ ghsa_id: PROSE })],
      ['summary', report({ summary: { text: PROSE } })],
      ['vulnerabilities', report({ vulnerabilities: [{ package: PROSE }] })],
      ['packages', draft({ packages: [PROSE] })],
      ['packages', draft({ packages: [{ name: PROSE }] })],
      ['severity', draft({ severity: PROSE })],
      ['description', draft({ description: { text: PROSE } })],
      ['vulnerabilities', draft({ vulnerabilities: [{ package: { ecosystem: 'npm', name: PROSE } }] })],
      ['versions', setv({ versions: PROSE })],
      ['versions', setv({ versions: [PROSE] })],
      ['versions', setv({ versions: [{ ...VERSION, package: PROSE }] })],
      ['versions', setv({ versions: [{ ...VERSION, vulnerable_version_range: PROSE }] })],
      ['versions', setv({ versions: [{ ...VERSION, patched_versions: PROSE }] })],
      ['versions', setv({ versions: [{ ...VERSION, [PROSE]: 'x' }] })],
      ['vulnerabilities', setv({ vulnerabilities: [{ package: { ecosystem: 'npm', name: PROSE } }] })],
    ];
    const quiet = quietly.map(([key, action]) => {
      const errors = errorsOf(action);
      return [key, errors.length > 0, errors.some((e) => e.includes('ADVISORY PROSE')), errors.some((e) => e.includes(`actions[0].${key}`))];
    });
    t('⛔ the marker in the wrong key — a state, a severity, a weakness id, a login, an id, a package, a summary or description that is not a string, an unknown vulnerabilities key, and a versions list, entry, package, range, patched list or entry key — on a report, a draft and the versions row, is refused naming the key, and NO refusal line carries it', quiet, quietly.map(([key]) => [key, true, false, true]));
    const long = 'é'.repeat(513);
    t('⛔ an over-cap summary or description is refused naming the key and the byte count — the text itself never', [errorsOf(report({ summary: long })), errorsOf(report({ description: `${PROSE} ${'x'.repeat(60_000)}` })).some((e) => e.includes('ADVISORY PROSE')), refuses(one(report({ description: `${PROSE} ${'x'.repeat(60_000)}` })), 'actions[0].description is 60040 bytes, over its cap of 60000')], [['actions[0].summary is 1026 bytes, over its cap of 1024'], false, true]);
    t('⛔ cwe_ids: CWE-0, a lowercase cwe-79, a six-digit id, a CVE id, an empty list, eleven ids and one twice are refused; CWE-79 and CWE-352 pass', [[['CWE-0'], ['cwe-79'], ['CWE-123456'], ['CVE-2026-1'], [], Array.from({ length: 11 }, (_, i) => `CWE-${i + 1}`), ['CWE-79', 'CWE-79']].filter((cwe_ids) => !refuses(one(report({ cwe_ids })), 'actions[0].cwe_ids')).length, validatePayload(one(report({ cwe_ids: ['CWE-79', 'CWE-352'] }))).ok], [0, true]);
    t('⛔ collaborators: a string, an empty list, eleven logins, a 40-character login, one login twice and a name that is no login are refused', [['os-dev-a'].join(), [], Array.from({ length: 11 }, (_, i) => `u${i}`), ['x'.repeat(40)], ['u', 'u'], ['not a login']].map((collaborators) => refuses(one(add({ collaborators })), 'actions[0].collaborators')), [true, true, true, true, true, true]);
    // Refused by key.
    const takes = (op) => `is not a key \`${op}\` takes (it takes ${[...OPS[op].required, ...OPS[op].optional].join(', ')})`;
    t('⛔ refused BY NAME beside a report: vulnerabilities, a CVSS vector, a private fork, a state, an id, credits, a body and collaborators — the report is its prose and its two tags', ['vulnerabilities', 'cvss_vector_string', 'start_private_fork', 'state', 'ghsa_id', 'credits', 'body', 'collaborators'].filter((key) => !refuses(one(report({ [key]: 'x' })), `actions[0].${key} ${takes('advisory_report')}`)), []);
    t('⛔ packages: a string, an empty list, eleven names, a 215-character name, one name twice, an uppercase name, a version or a range after the name, a path, a URL, a space and a bare scope are refused; a scoped and a plain name pass', [[['@objectstack/rest'].join(), [], Array.from({ length: 11 }, (_, i) => `p${i}`), ['x'.repeat(215)], ['hotcrm', 'hotcrm'], ['React'], ['hotcrm@1.0.0'], ['hotcrm <2.0.0'], ['../hotcrm'], ['https://npmjs.com/hotcrm'], ['hot crm'], ['@objectstack/']].filter((packages) => !refuses(one(draft({ packages })), 'actions[0].packages')).length, validatePayload(one(draft({ packages: ['@objectstack/rest', 'hotcrm'] }))).ok], [0, true]);
    t('⛔ refused BY NAME beside a draft: vulnerabilities, a version range, patched versions, an ecosystem, a CVSS vector, a CVE id, a private fork, a state, an id, credits, a body and collaborators — the draft is its prose, its two tags and its package names', ['vulnerabilities', 'vulnerable_version_range', 'patched_versions', 'ecosystem', 'cvss_vector_string', 'cve_id', 'start_private_fork', 'state', 'ghsa_id', 'credits', 'body', 'collaborators'].filter((key) => !refuses(one(draft({ [key]: 'x' })), `actions[0].${key} ${takes('advisory_create')}`)), []);
    t('⛔ refused BY NAME beside the two id rows: a summary, a description, a severity, a state, the other row\'s key, versions, collaborating_users, collaborating_teams, a body and an issue — an id with logins or a state, and nothing that carries content', [[add, 'advisory_state'], [(x) => move('draft', x), 'collaborators']].map(([row, other]) => ['summary', 'description', 'severity', 'state', other, 'versions', 'collaborating_users', 'collaborating_teams', 'body', 'issue'].filter((key) => !refuses(one(row({ [key]: key === 'issue' ? 7 : 'x' })), `actions[0].${key} ${takes(row({}).op)}`))), [[], []]);
    t('⛔ refused BY NAME beside the versions: a summary, a description, a severity, a state, advisory_state, collaborators, packages, vulnerabilities, vulnerable_functions, a CVE id, credits, a CVSS vector, a body and an issue — an id and its entries, and nothing that carries prose or moves the advisory', ['summary', 'description', 'severity', 'state', 'advisory_state', 'collaborators', 'packages', 'vulnerabilities', 'vulnerable_functions', 'cve_id', 'credits', 'cvss_vector_string', 'body', 'issue'].filter((key) => !refuses(one(setv({ [key]: key === 'issue' ? 7 : 'x' })), `actions[0].${key} ${takes('advisory_versions')}`)), []);
    t('⛔ refused: each required key missing — never defaulted', [refuses(one({ op: 'advisory_report', description: 'd' }), 'actions[0].summary is required'), refuses(one({ op: 'advisory_report', summary: 's' }), 'actions[0].description is required'), refuses(one({ op: 'advisory_create', summary: 's', description: 'd' }), 'actions[0].packages is required'), refuses(one({ op: 'advisory_create', description: 'd', packages: ['p'] }), 'actions[0].summary is required'), refuses(one({ op: 'advisory_collaborators_add', ghsa_id: GHSA }), 'actions[0].collaborators is required'), refuses(one({ op: 'advisory_state', ghsa_id: GHSA }), 'actions[0].advisory_state is required'), refuses(one({ op: 'advisory_state', advisory_state: 'draft' }), 'actions[0].ghsa_id is required'), refuses(one({ op: 'advisory_versions', ghsa_id: GHSA }), 'actions[0].versions is required'), refuses(one({ op: 'advisory_versions', versions: [VERSION] }), 'actions[0].ghsa_id is required')], [true, true, true, true, true, true, true, true, true]);
    // Fence: alone in its stroke.
    t('⛔ fence alone, refused: each row beside a comment, two of a kind, a report beside the collaborators it would want, a draft beside a report or the collaborators, and the versions beside the publish they precede — each naming the action that does not belong', [
      ...[report(), draft(), add(), setv(), move()].map((a) => refuses(fixturePayload({ actions: [a, { op: 'comment', issue: 7, body: 'x' }] }), `actions[1] is \`comment\` in a stroke that carries a \`${a.op}\``)),
      refuses(fixturePayload({ actions: [move('draft'), move('closed')] }), 'a stroke carries exactly ONE `advisory_state` and nothing else'),
      refuses(fixturePayload({ actions: [setv(), move('published')] }), 'in a stroke that carries a `advisory_versions`'),
      refuses(fixturePayload({ actions: [move('published'), move('published', { ghsa_id: 'GHSA-wxyz-2345-abcd' })] }), 'a stroke carries exactly ONE `advisory_state` and nothing else'),
      refuses(fixturePayload({ actions: [draft(), draft()] }), 'a stroke carries exactly ONE `advisory_create` and nothing else'),
      refuses(fixturePayload({ actions: [report(), add()] }), 'in a stroke that carries a `advisory_report`'),
      refuses(fixturePayload({ actions: [draft(), report()] }), 'in a stroke that carries a `advisory_create`'),
      refuses(fixturePayload({ actions: [draft(), add()] }), 'in a stroke that carries a `advisory_create`'),
    ], [true, true, true, true, true, true, true, true, true, true, true, true]);
    t('fence alone, accepted: each stroke of that one action passes the stroke rules — a publish is ONE advisory alone', [report(), draft(), add(), setv(), move(), move('published')].map((a) => strokeErrors(REPO, [a])), [[], [], [], [], [], []]);
    // Fence: the stroke-scoped grant.
    const GRANTED = { issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read', 'repository-advisories': 'write' };
    t('⭐ fence grant, accepted side: each row\'s stroke — the publish\'s among them — mints the five literal grants plus repository-advisories write, never actions and never anything wider, for ONE repository, and the GitHub output spells it so', [report(), draft(), add(), setv(), move(), move('published')].map((a) => {
      const p = validatePayload(one(a)).payload;
      return p ? [tokenPermissionsOf(p), tokenRepositoriesOf(p), outputLine(p, 'permission_repository_advisories'), outputLine(p, 'permission_actions')] : 'refused';
    }), [0, 1, 2, 3, 4, 5].map(() => [GRANTED, [REPO], 'permission_repository_advisories=write', 'permission_actions=']));
    const minimalOf = {
      comment: { issue: 1, body: 'b' }, comment_edit: { comment_id: 1, body: 'b' }, labels_add: { issue: 1, labels: ['a'] }, labels_remove: { issue: 1, labels: ['a'] },
      assign: { issue: 1, assignees: ['u'] }, unassign: { issue: 1, assignees: ['u'] }, issue_patch: { issue: 1, state: 'closed' }, issue_create: { title: 't', body: 'b' },
      pr_create: { title: 't', head: 'h', base: 'main' }, pr_request_reviewers: { pull: 1, reviewers: ['u'] }, pr_update_branch: { pull: 1, expected_head_sha: SHA }, pr_ready: { pull: 1 }, pr_draft: { pull: 1 },
      automerge_enable: { pull: 1 }, automerge_disable: { pull: 1 }, mailbox_branch_delete: { pull: 1, branch: 'claude/mailbox-ui-3' }, transfer: { issue: 1, target_repo: `${TARGET_OWNER}/objectui` },
      sub_issue_add: { issue: 1, sub_issue: 2 }, sub_issue_remove: { issue: 1, sub_issue: 2 },
      workflow_dispatch: { workflow: WORKFLOW_DISPATCH_ALLOWLIST[0], ref: WORKFLOW_DISPATCH_REF }, run_rerun_failed: { run_id: 1 },
    };
    const others = OP_NAMES.filter((op) => !ADVISORY_OPS.includes(op));
    t('…the ledger of every other op, no more and no less', Object.keys(minimalOf).sort(), [...others].sort());
    const advisoryLine = (actions) => {
      const v = validatePayload(fixturePayload({ actions }));
      return v.ok ? [outputLine(v.payload, 'permission_repository_advisories'), tokenPermissionsOf(v.payload)['repository-advisories'] ?? null] : `refused: ${v.errors.join(' | ')}`;
    };
    t('⛔ fence grant, refused side: every other op — each alone in its stroke, the actions strokes among them, and the stroke of all that share one token — writes an EMPTY permission_repository_advisories and mints no such grant', [others.filter((op) => JSON.stringify(advisoryLine([{ op, ...minimalOf[op] }])) !== JSON.stringify(['permission_repository_advisories=', null])), advisoryLine(others.filter((op) => !OPS[op].secondRepo && !OPS[op].alone).map((op) => ({ op, ...minimalOf[op] })))], [[], ['permission_repository_advisories=', null]]);
    t('repository-advisories is spent by the six rows and NOTHING else — as their permission, never as an alsoSpends', [OP_NAMES.filter((op) => OPS[op].permission === 'repository-advisories'), OP_NAMES.filter((op) => (OPS[op].alsoSpends ?? []).includes('repository-advisories'))], [ADVISORY_OPS, []]);
    const repoRoot = resolve(SELF_PATH, '../../../..');
    const workflowText = readFileSync(resolve(repoRoot, '.github/workflows/fleet-write.yml'), 'utf8');
    const mintsFromOutput = [...workflowText.matchAll(/^\s+permission-repository-advisories:\s*\$\{\{\s*steps\.validate\.outputs\.permission_repository_advisories\s*\}\}\s*$/gm)].length;
    const mints = [...workflowText.matchAll(/^\s+(?:-\s+)?uses:\s*actions\/create-github-app-token@/gm)].length;
    t('⭐ the workflow mints permission-repository-advisories from the validator\'s output, never as a literal, names the expected Unexpected-input warning beside it, and has ONE mint step — no second, un-narrowed token for a refused mint to fall back to', [mintsFromOutput, /^\s+permission-repository-advisories:\s*(read|write)\s*$/m.test(workflowText), workflowText.includes("Unexpected input(s) 'permission-repository-advisories'"), mints], [1, false, true, 1]);
    // Every other advisory path stays refused, by no row reachable.
    const refusedTails = ['/', '?state=draft', '?per_page=100', '/x', `/${GHSA}/cve`, `/${GHSA}/forks`, `/${GHSA}/`, `/${GHSA.toUpperCase()}`, '/GHSA-abcd-2345', `/${GHSA}x`, '/reports/', '/reportsx', `/reports/${GHSA}`, '/reports/x/cve', 'x'];
    t('⛔ every other security-advisories path is caught by a refused family: the collection with a trailing slash or a query (the list\'s spellings), anything after it but one advisory or the reports endpoint, the CVE request, the temporary fork, anything after the reports endpoint, and any id that is not exactly one advisory\'s', refusedTails.filter((tail) => !REFUSED_PATH_FAMILIES.some((re) => re.test(`/repos/${REPO}/security-advisories${tail}`))), []);
    t('…while the three paths a row reaches are caught by none: the bare collection, the reports endpoint and one advisory\'s', ['', '/reports', `/${GHSA}`].filter((tail) => REFUSED_PATH_FAMILIES.some((re) => re.test(`/repos/${REPO}/security-advisories${tail}`))), []);
    const fillWith = { ...draft({ severity: 'critical', cwe_ids: ['CWE-79'] }), ...add(), ...setv(), ...move('closed'), public_key: READER.spki };
    const every = OP_NAMES.flatMap((op) => {
      const a = { op };
      for (const k of [...OPS[op].required, ...OPS[op].optional]) {
        const v = minimalOf[op]?.[k] ?? fillWith[k];
        if (v !== undefined) a[k] = v;
      }
      return OPS[op].requests(a, REPO).map((r) => ({ op, ...r }));
    });
    t('⛔ …and the ONLY security-advisories requests any row makes are the report\'s POST, the draft\'s POST to the bare collection — never a GET, the list — the three PATCHes of one advisory and the read\'s GET of that one advisory', every.filter((r) => r.path.includes('security-advisories')).map((r) => `${r.op} ${r.verb} ${r.path}`), [`advisory_report POST /repos/${REPO}/security-advisories/reports`, `advisory_create POST /repos/${REPO}/security-advisories`, `advisory_collaborators_add PATCH /repos/${REPO}/security-advisories/${GHSA}`, `advisory_versions PATCH /repos/${REPO}/security-advisories/${GHSA}`, `advisory_state PATCH /repos/${REPO}/security-advisories/${GHSA}`, `advisory_read GET /repos/${REPO}/security-advisories/${GHSA}`]);
    // ⛔ published: reachable by no row — not as a value, not through any body.
    const everyValue = OP_NAMES.flatMap((op) =>
      [...OPS[op].required, ...OPS[op].optional]
        .filter((k) => FIELDS[k].kind === 'enum')
        .flatMap((k) =>
          FIELDS[k].values.map((value) => {
            const a = { op };
            for (const key of [...OPS[op].required, ...OPS[op].optional]) {
              const v = minimalOf[op]?.[key] ?? fillWith[key];
              if (v !== undefined) a[key] = v;
            }
            a[k] = value;
            return OPS[op].requests(a, REPO);
          }),
        ),
    );
    t("⭐ published is reached by ONE row through ONE field: advisory_state's own value — no other op takes a field that can carry it — and no request any row spells, at every enum value of every field, carries it in a path or a body: the state PATCH's body is the executor's, sent after its fences", [OP_NAMES.filter((op) => [...OPS[op].required, ...OPS[op].optional].some((k) => FIELDS[k].kind === 'enum' && FIELDS[k].values.includes('published'))), OP_NAMES.flatMap((op) => [...OPS[op].required, ...OPS[op].optional]).filter((k) => FIELDS[k].kind === 'enum' && FIELDS[k].values.includes('published')), [...every, ...everyValue.flat()].filter((r) => /publish/.test(`${r.path} ${JSON.stringify(r.body ?? null)} ${JSON.stringify(r.graphql ?? null)}`)).length, [...every, ...everyValue.flat()].filter((r) => r.advisoryState?.to === 'published').map((r) => 'body' in r)], [['advisory_state'], ['advisory_state'], 0, [false]]);
    t('the transitions: draft from triage (the accept) or closed (the reopen), closed from triage or draft, published from draft alone — frozen, nothing leaving published or withdrawn, the settable states exactly their keys, none refused by name, and the versions written in draft alone', [ADVISORY_TRANSITIONS, Object.isFrozen(ADVISORY_TRANSITIONS), Object.values(ADVISORY_TRANSITIONS).every(Object.isFrozen), Object.values(ADVISORY_TRANSITIONS).flat().filter((from) => from === 'published' || from === 'withdrawn'), [...ADVISORY_SETTABLE_STATES], Object.keys(ADVISORY_REFUSED_STATES), [...ADVISORY_VERSIONS_STATES], Object.isFrozen(ADVISORY_VERSIONS_STATES)], [{ draft: ['triage', 'closed'], closed: ['triage', 'draft'], published: ['draft'] }, true, true, [], ['draft', 'closed', 'published'], [], ['draft'], true]);
    // The fences on the advisory, judged on the executor's own read — pure here, each accepted and refused.
    const answer = (json, status = 200) => ({ status, json });
    const advisory = (extra = {}) => ({ ghsa_id: GHSA, state: 'draft', collaborating_users: [{ login: 'os-dev-a' }], summary: PROSE, description: PROSE, vulnerabilities: [{ package: { name: PROSE } }], ...extra });
    const fenced = (a, ctx = {}) => advisoryFenceFailures({ ghsaId: GHSA, answer: a, ...ctx }).map((f) => f.fence);
    // An entry as the platform answers one: the npm package, the two strings, and vulnerable_functions, empty.
    const onWire = (...entries) => advisoryVersionsOnTheWire(entries).map((v) => ({ ...v, vulnerable_functions: [] }));
    t('the open states are exactly triage and draft, frozen, and the fences are read, advisory, state and versions', [[...ADVISORY_OPEN_STATES], Object.isFrozen(ADVISORY_OPEN_STATES), ADVISORY_FENCES.map((f) => f.fence)], [['triage', 'draft'], true, ['read', 'advisory', 'state', 'versions']]);
    t('accepted: a draft and a triage advisory answering as the id the action names pass all three fences', [fenced(answer(advisory())), fenced(answer(advisory({ state: 'triage' })))], [[], []]);
    t('⛔ fence state, refused for the collaborators: published, closed, withdrawn, no state and an unknown one — each naming the state fence alone', ['published', 'closed', 'withdrawn', undefined, 'archived'].map((state) => fenced(answer(advisory({ state })))), [['state'], ['state'], ['state'], ['state'], ['state']]);
    // Versions in the row's spelling, so the publish's versions fence holds and the state fence alone decides.
    const transition = (to, from) => fenced(answer(advisory({ state: from, vulnerabilities: onWire(VERSION) })), { from: ADVISORY_TRANSITIONS[to], to }).length === 0;
    const FROM = ['triage', 'draft', 'closed', 'published', 'withdrawn'];
    t('⭐ the transitions, fenced: to draft from triage or closed; to closed from triage or draft; to published from draft alone — never from published or withdrawn', [FROM.map((from) => transition('draft', from)), FROM.map((from) => transition('closed', from)), FROM.map((from) => transition('published', from))], [[true, false, true, false, false], [true, true, false, false, false], [false, true, false, false, false]]);
    t('…and a refused transition says what it reads and what it moves from', advisoryFenceText(advisoryFenceFailures({ ghsaId: GHSA, answer: answer(advisory({ state: 'published' })), from: ADVISORY_TRANSITIONS.draft, to: 'draft' })), 'fence `state`: the advisory reads state published, and the relay writes only to a move to draft from triage or closed alone');
    t('⛔ a target the transitions do not name fails CLOSED at the state fence, whatever the advisory reads — no from-states, and the sentence says the table names no such move', [['triage', 'draft', 'closed'].map((from) => fenced(answer(advisory({ state: from })), { to: 'withdrawn' })), advisoryFenceText(advisoryFenceFailures({ ghsaId: GHSA, answer: answer(advisory()), to: 'withdrawn' })), Object.hasOwn(ADVISORY_TRANSITIONS, 'withdrawn')], [[['state'], ['state'], ['state']], "fence `state`: the advisory reads state draft, and the relay writes only to no move to withdrawn — the relay's transitions name none, so it fails closed", false]);
    // The versions fence: for the versions row, the whole list replaced; for a publish, the versions set first.
    const forVersions = (vulnerabilities, versions = [VERSION], state = 'draft') => fenced(answer(advisory({ state, vulnerabilities })), { from: ADVISORY_VERSIONS_STATES, versions });
    t('⭐ fence versions, accepted for the versions row: a draft listing nothing (a report accepted), listing only names (a draft as created), listing the package already set, or two packages the action names both', [forVersions([]), forVersions(null), forVersions([{ package: { ecosystem: 'npm', name: '@objectstack/rest' }, vulnerable_version_range: null, patched_versions: null, vulnerable_functions: [] }]), forVersions(onWire(VERSION)), forVersions(onWire(VERSION, { ...VERSION, package: 'hotcrm' }), [VERSION, { ...VERSION, package: 'hotcrm' }])], [[], [], [], [], []]);
    t('⛔ fence versions, refused for the versions row: a listed package the action does not name (the PATCH would drop it), an entry of another ecosystem or naming none, an entry carrying vulnerable_functions — and a closed or published advisory at the state fence', [forVersions(onWire(VERSION, { ...VERSION, package: 'hotcrm' })), forVersions([{ package: { ecosystem: 'pip', name: 'x' } }]), forVersions([{ package: { ecosystem: 'npm', name: null } }]), forVersions([{ ...onWire(VERSION)[0], vulnerable_functions: [PROSE] }]), forVersions(onWire(VERSION), [VERSION], 'closed'), forVersions(onWire(VERSION), [VERSION], 'published')], [['versions'], ['versions'], ['versions'], ['versions'], ['state'], ['state']]);
    const dropText = advisoryFenceText(advisoryFenceFailures({ ghsaId: GHSA, answer: answer(advisory({ vulnerabilities: [...onWire({ ...VERSION, package: PROSE.toLowerCase().replace(/[^a-z]/g, '') }), { package: { ecosystem: 'pip', name: PROSE }, vulnerable_functions: [PROSE] }] })), from: ADVISORY_VERSIONS_STATES, versions: [VERSION] }));
    t('…and its sentence is counts alone: what the advisory lists and why the PATCH would lose it — never a package name, a version or a function', [dropText, dropText.includes('ADVISORY'), dropText.includes('advisoryprosemarker')], ['fence `versions`: the advisory lists 2 entries: 1 entry of another ecosystem or naming no package; 1 entry carrying vulnerable_functions; 1 listed package(s) the action does not name, and the relay writes only to a list the action may replace whole — every package the advisory lists named by the action, every listed entry an npm package with a name and no vulnerable_functions, which this row does not write and the PATCH would drop', false, false]);
    const forPublish = (vulnerabilities) => fenced(answer(advisory({ vulnerabilities })), { from: ADVISORY_TRANSITIONS.published, to: 'published' });
    t('⭐ fence versions, for a publish: accepted when every listed entry is in the row\'s spelling — one entry, or two lines of one package beside another — functions or not', [forPublish(onWire(VERSION)), forPublish(onWire(VERSION, LINE_17, { package: 'hotcrm', vulnerable_version_range: '< 2.1.0', patched_versions: '2.1.0' })), forPublish([{ ...onWire(VERSION)[0], vulnerable_functions: ['f'] }])], [[], [], []]);
    t('⛔ …refused — the versions set FIRST — when the advisory lists none, an entry has no range or patched versions (a draft as created), one is spelled otherwise, one is inside its own range, or one is another ecosystem\'s', [forPublish([]), forPublish(null), forPublish([{ package: { ecosystem: 'npm', name: '@objectstack/rest' }, vulnerable_version_range: null, patched_versions: null, vulnerable_functions: [] }]), forPublish([{ ...onWire(VERSION)[0], vulnerable_version_range: '<=18.2.0' }]), forPublish([{ ...onWire(VERSION)[0], patched_versions: '18.1.0' }]), forPublish([...onWire(VERSION), { package: { ecosystem: 'pip', name: 'x' }, vulnerable_version_range: '< 1.0.0', patched_versions: '1.0.0' }])], [['versions'], ['versions'], ['versions'], ['versions'], ['versions'], ['versions']]);
    t('…its sentences: none listed, or how many of how many are not in the spelling — never a value', [advisoryFenceText(advisoryFenceFailures({ ghsaId: GHSA, answer: answer(advisory({ vulnerabilities: [] })), from: ['draft'], to: 'published' })), advisoryFenceText(advisoryFenceFailures({ ghsaId: GHSA, answer: answer(advisory({ vulnerabilities: [...onWire(VERSION), { package: { ecosystem: 'npm', name: '@objectstack/rest' }, vulnerable_version_range: PROSE, patched_versions: PROSE }] })), from: ['draft'], to: 'published' })).includes(PROSE)], ["fence `versions`: the advisory lists no vulnerabilities entry, and the relay writes only to versions set first — at least one vulnerabilities entry, every one an npm package with a vulnerable_version_range and patched_versions in the versions row's spelling", false]);
    t('…and every other action passes the versions fence untouched — the collaborators, the accept, the reopen and the close, whatever the list reads', [fenced(answer(advisory())), fenced(answer(advisory({ state: 'triage' })), { from: ADVISORY_TRANSITIONS.draft, to: 'draft' }), fenced(answer(advisory({ state: 'closed' })), { from: ADVISORY_TRANSITIONS.draft, to: 'draft' }), fenced(answer(advisory()), { from: ADVISORY_TRANSITIONS.closed, to: 'closed' })], [[], [], [], []]);
    t('⛔ fence advisory, refused: an answer naming another advisory, or none', [fenced(answer(advisory({ ghsa_id: 'GHSA-wxyz-2345-abcd' }))), fenced(answer(advisory({ ghsa_id: undefined })))], [['advisory'], ['advisory']]);
    t('⛔ fence read, refused: a 404, a 403, an array and null — never read as an advisory, the other fences failing as not judged; for the versions row and a publish the versions fence too', [...[answer({ message: 'Not Found' }, 404), answer({ message: 'Forbidden' }, 403), answer([advisory()]), answer(null)].map((a) => fenced(a)), fenced(answer(null, 404), { from: ADVISORY_VERSIONS_STATES, versions: [VERSION] }), fenced(answer(null, 404), { from: ADVISORY_TRANSITIONS.published, to: 'published' })], [...[0, 1, 2, 3].map(() => ['read', 'advisory', 'state']), ['read', 'advisory', 'state', 'versions'], ['read', 'advisory', 'state', 'versions']]);
    const leaky = advisoryFenceFailures({ ghsaId: GHSA, answer: answer(advisory({ ghsa_id: PROSE, state: PROSE })) });
    t('⛔ a fence sentence prints the answer\'s id and state only in their own shapes — prose in either reaches it as a placeholder, never as itself', [leaky.map((f) => f.fence), advisoryFenceText(leaky).includes(PROSE), advisoryFenceText(leaky).includes('(not an advisory id)') && advisoryFenceText(leaky).includes('(not an advisory state)')], [['advisory', 'state'], false, true]);
    // The merge: what the collaborators PATCH sends.
    t('the merge: the existing logins as listed, then each requested login missing from them — compared case-insensitively, each once, in the action\'s spelling', advisoryCollaboratorPlan({ existing: ['Alice', 'bob'], requested: ['alice', 'Carol', 'BOB', 'carol', 'dave'] }), { existing: ['Alice', 'bob'], missing: ['Carol', 'dave'], merged: ['Alice', 'bob', 'Carol', 'dave'] });
    t('…an all-present list is the no-op: nothing missing, the merged list the existing one', advisoryCollaboratorPlan({ existing: ['Alice'], requested: ['ALICE'] }), { existing: ['Alice'], missing: [], merged: ['Alice'] });
    // The read-backs: what LANDED means.
    const listed = (...logins) => answer(advisory({ collaborating_users: logins.map((login) => ({ login })) }));
    t('⭐ collaborators land when the PATCH answer lists every login sent — the added ones and the kept ones, case-insensitively', [advisoryReadBack({ existing: ['Alice'], missing: ['carol'], answer: listed('alice', 'Carol') }).ok, advisoryReadBack({ existing: [], missing: ['carol'], answer: listed('carol') }).ok], [true, true]);
    t('⛔ a login the answer lacks is not a landing, named: a requested one not added, and an existing one dropped', [advisoryReadBack({ existing: ['Alice'], missing: ['carol'], answer: listed('Alice') }).why, advisoryReadBack({ existing: ['Alice'], missing: ['carol'], answer: listed('carol') }).why], ['HTTP 200, but the answer lists Alice — carol not added', 'HTTP 200, but the answer lists carol — Alice dropped — a collaborator before this PATCH and missing from its answer']);
    t('⛔ …nor is a refused PATCH, or a 2xx whose answer is not an advisory', [advisoryReadBack({ missing: ['carol'], answer: answer({ message: 'Validation Failed' }, 422) }).why, advisoryReadBack({ missing: ['carol'], answer: answer([], 200) }).ok], ['HTTP 422', false]);
    t('⭐ a state lands only when the PATCH answer shows that state on the advisory named; another state, another id, a refusal or an answer that is no advisory is not a landing — each said in the id and the state alone', [advisoryStateReadBack({ ghsaId: GHSA, to: 'draft', answer: answer(advisory()) }).ok, advisoryStateReadBack({ ghsaId: GHSA, to: 'closed', answer: answer(advisory()) }).why, advisoryStateReadBack({ ghsaId: GHSA, to: 'draft', answer: answer(advisory({ ghsa_id: 'GHSA-wxyz-2345-abcd' })) }).why, advisoryStateReadBack({ ghsaId: GHSA, to: 'draft', answer: answer({ message: 'Forbidden' }, 403) }).why, advisoryStateReadBack({ ghsaId: GHSA, to: 'draft', answer: answer([], 200) }).ok, advisoryStateReadBack({ ghsaId: GHSA, to: 'closed', answer: answer(advisory({ state: PROSE })) }).why.includes(PROSE)], [true, 'HTTP 200, but the answer reads state draft, not closed', 'HTTP 200, but the answer names GHSA-wxyz-2345-abcd', 'HTTP 403', false, false]);
    // The publish: read back as published, with the versions it was sent — the entries the preflight read.
    const published = (vulnerabilities) => answer(advisory({ state: 'published', vulnerabilities }));
    t("⭐ a publish lands only when the answer reads published AND lists exactly the entries the preflight read — in any order — handing back the id and the count for its row and annotation; a lost, an extra, a changed or a foreign entry is not a landing, said in counts alone", [advisoryStateReadBack({ ghsaId: GHSA, to: 'published', answer: published(onWire(LINE_17, VERSION)), versions: [VERSION, LINE_17] }), advisoryStateReadBack({ ghsaId: GHSA, to: 'published', answer: published(onWire(VERSION)), versions: [VERSION, LINE_17] }).why, advisoryStateReadBack({ ghsaId: GHSA, to: 'published', answer: published(onWire(VERSION, LINE_17)), versions: [VERSION] }).ok, advisoryStateReadBack({ ghsaId: GHSA, to: 'published', answer: published(onWire({ ...VERSION, patched_versions: '18.4.0' })), versions: [VERSION] }).ok, advisoryStateReadBack({ ghsaId: GHSA, to: 'published', answer: published([...onWire(VERSION), { package: { ecosystem: 'pip', name: PROSE } }]), versions: [VERSION] }).why.includes(PROSE), advisoryStateReadBack({ ghsaId: GHSA, to: 'published', answer: answer(advisory({ vulnerabilities: onWire(VERSION) })), versions: [VERSION] }).why], [{ ok: true, why: '', ghsaId: GHSA, entries: 2 }, 'HTTP 200, the answer reads state published, but it lists 1 entry — 1 of the 2 entries read before the publish missing, 0 other', false, false, false, 'HTTP 200, but the answer reads state draft, not published']);
    t('…while the other moves hand back no id: only a publish is annotated', [advisoryStateReadBack({ ghsaId: GHSA, to: 'closed', answer: answer(advisory({ state: 'closed' })) }), advisoryStateReadBack({ ghsaId: GHSA, to: 'draft', answer: answer(advisory()) })], [{ ok: true, why: '' }, { ok: true, why: '' }]);
    // The versions: read back as sent.
    const asSet = (vulnerabilities, extra = {}) => answer(advisory({ vulnerabilities, ...extra }));
    t('⭐ versions land when the PATCH answer, still draft and naming the advisory, lists exactly the entries sent — in any order — with the count for the row', [advisoryVersionsReadBack({ ghsaId: GHSA, sent: [VERSION, LINE_17], answer: asSet(onWire(LINE_17, VERSION)) }), advisoryVersionsReadBack({ ghsaId: GHSA, sent: [VERSION], answer: asSet(onWire(VERSION)) }).ok], [{ ok: true, why: '', entries: 2 }, true]);
    t('⛔ …and nothing else lands: an entry missing, one answered in another spelling, one extra, a foreign one, another state, another id, a refusal or no advisory — each in counts, the id and the state alone', [advisoryVersionsReadBack({ ghsaId: GHSA, sent: [VERSION, LINE_17], answer: asSet(onWire(VERSION)) }).why, advisoryVersionsReadBack({ ghsaId: GHSA, sent: [VERSION], answer: asSet(onWire({ ...VERSION, vulnerable_version_range: '< 18.3.0' })) }).why, advisoryVersionsReadBack({ ghsaId: GHSA, sent: [VERSION], answer: asSet(onWire(VERSION, LINE_17)) }).why, advisoryVersionsReadBack({ ghsaId: GHSA, sent: [VERSION], answer: asSet([...onWire(VERSION), { package: { ecosystem: 'pip', name: PROSE } }]) }).why, advisoryVersionsReadBack({ ghsaId: GHSA, sent: [VERSION], answer: asSet(onWire(VERSION), { state: 'published' }) }).why, advisoryVersionsReadBack({ ghsaId: GHSA, sent: [VERSION], answer: asSet(onWire(VERSION), { ghsa_id: 'GHSA-wxyz-2345-abcd' }) }).why, advisoryVersionsReadBack({ ghsaId: GHSA, sent: [VERSION], answer: answer({ message: 'Validation Failed' }, 422) }).why, advisoryVersionsReadBack({ ghsaId: GHSA, sent: [VERSION], answer: answer([], 200) }).ok], ['HTTP 200, but the answer lists 1 entry — 1 of the 2 entries sent missing or answered in another spelling, 0 other', 'HTTP 200, but the answer lists 1 entry — 1 of the 1 entry sent missing or answered in another spelling, 1 other', 'HTTP 200, but the answer lists 2 entries — 0 of the 1 entry sent missing or answered in another spelling, 1 other', 'HTTP 200, but the answer lists 2 entries — 0 of the 1 entry sent missing or answered in another spelling, 1 other', 'HTTP 200, but the answer reads state published, not draft', 'HTTP 200, but the answer names GHSA-wxyz-2345-abcd', 'HTTP 422', false]);
    t('the wire and the reading are one spelling: what the PATCH sends reads back as the entries sent, and the multiset diff counts the misses and the extras', [advisoryVersionsOf({ vulnerabilities: onWire(VERSION, LINE_17) }), advisoryVersionsOf({ vulnerabilities: [{ package: { ecosystem: 'pip', name: 'x' } }, { package: { ecosystem: 'npm', name: 'y' }, vulnerable_functions: ['f'] }] }), advisoryVersionsDiff([VERSION, VERSION], [VERSION]), advisoryVersionsDiff([VERSION], [LINE_17, VERSION])], [{ total: 2, entries: [VERSION, LINE_17], foreign: 0, functions: 0 }, { total: 2, entries: [{ package: 'y', vulnerable_version_range: null, patched_versions: null }], foreign: 1, functions: 1 }, { same: false, missing: 1, extra: 0 }, { same: false, missing: 0, extra: 1 }]);
    t('⭐ a report lands on a 2xx carrying an advisory id; a 2xx without one is UNCONFIRMED and never re-sent; a refusal is its status; an id that is prose is no id', [advisoryReportReadBack(answer(advisory({ state: 'triage' }), 201)), advisoryReportReadBack(answer({ state: 'triage' }, 201)).why, advisoryReportReadBack(answer({ message: 'Validation Failed', errors: [PROSE] }, 422)).why, advisoryReportReadBack(answer(advisory({ ghsa_id: PROSE }), 201)).ok, advisoryReportReadBack(answer(advisory({ ghsa_id: PROSE }), 201)).why.includes(PROSE)], [{ ok: true, ghsaId: GHSA, state: 'triage', why: '' }, "HTTP 201, but the answer carries no advisory id — UNCONFIRMED: a report may have been filed; ⛔ do not re-send, ask the maintainer to read the repository's reports", 'HTTP 422', false, false]);
    t('⭐ a draft lands on a 2xx carrying an advisory id that reads state draft — the one state the endpoint creates in; a 2xx without an id is UNCONFIRMED and never re-sent; one in another state is not a landing, named in the id and the state alone; a refusal is its status; prose in the id or the state never reaches the sentence', [ADVISORY_CREATED_STATE, advisoryCreateReadBack(answer(advisory(), 201)), advisoryCreateReadBack(answer({ state: 'draft' }, 201)).why, advisoryCreateReadBack(answer(advisory({ state: 'triage' }), 201)).why, advisoryCreateReadBack(answer(advisory({ state: 'published' }), 201)).ok, advisoryCreateReadBack(answer({ message: 'Validation Failed', errors: [PROSE] }, 422)).why, advisoryCreateReadBack(answer(advisory({ ghsa_id: PROSE }), 201)).ok, [advisoryCreateReadBack(answer(advisory({ ghsa_id: PROSE }), 201)).why, advisoryCreateReadBack(answer(advisory({ state: PROSE }), 201)).why].some((why) => why.includes(PROSE))], ['draft', { ok: true, ghsaId: GHSA, state: 'draft', why: '' }, "HTTP 201, but the answer carries no advisory id — UNCONFIRMED: a draft advisory may have been created; ⛔ do not re-send, ask the maintainer to read the repository's draft advisories", `HTTP 201, but ${GHSA} reads state triage, not draft — ⛔ do not re-send, put the id to the maintainer`, false, 'HTTP 422', false, false]);
    // The rows: the id, the state and the logins, each in its own shape, and nothing else.
    t('the landed rows print the id, the state, the logins and counts — nothing else of the answer exists for them to print, a package name or a version least of all', [advisoryReportLandedText({ ghsaId: GHSA, state: 'triage' }), advisoryCreateLandedText({ ghsaId: GHSA, state: 'draft' }), advisoryLandedText({ ghsaId: GHSA, state: 'draft', logins: ['Alice', 'carol'], added: ['carol'] }), advisoryLandedText({ ghsaId: GHSA, state: 'triage', logins: ['Alice'], noop: true }), advisoryStateLandedText({ ghsaId: GHSA, from: 'triage', to: 'draft' }), advisoryVersionsLandedText({ ghsaId: GHSA, state: 'draft', versions: [VERSION, LINE_17, { ...VERSION, package: 'hotcrm' }] }), advisoryStateLandedText({ ghsaId: GHSA, from: 'draft', to: 'published', entries: 1 })], [`reported ${GHSA} · state triage — add whoever works it with advisory_collaborators_add`, `created ${GHSA} · state draft — add whoever works it with advisory_collaborators_add`, `${GHSA} · state draft · collaborators Alice, carol · added carol`, `no-op, nothing sent: ${GHSA} · state triage · collaborators Alice — every login asked for is already a collaborator`, `${GHSA} · state triage → draft`, `${GHSA} · state draft · versions set: 3 entries across 2 packages`, `${GHSA} · state draft → published · 1 entry, each with its versions`]);
    t('⛔ …and a value outside its shape prints as a placeholder, never as itself — a login, a state and an id carrying prose, in every row', [advisoryLandedText({ ghsaId: PROSE, state: PROSE, logins: [PROSE], added: [PROSE] }), advisoryReportLandedText({ ghsaId: PROSE, state: PROSE }), advisoryCreateLandedText({ ghsaId: PROSE, state: PROSE }), advisoryStateLandedText({ ghsaId: PROSE, from: PROSE, to: PROSE }), advisoryVersionsLandedText({ ghsaId: PROSE, state: PROSE, versions: [{ ...VERSION, package: PROSE }] })].some((row) => row.includes(PROSE)), false);
    t('⛔ the platform\'s message is quoted only when it is one the relay names; any other — prose among them — is not printed', [advisoryPlatformText('Resource not accessible by integration'), advisoryPlatformText(PROSE), advisoryPlatformText(undefined), ADVISORY_PLATFORM_MESSAGES.includes('Not Found')], [' (the platform: Resource not accessible by integration)', '', '', true]);
  }

  // ── advisory_read: the one row that reads an advisory, sealed ─────────────
  battery("advisory_read: ghsa_id and public_key alone — the key its own kind, an X25519 key in base64 SPKI DER; a malformed key or id refused before any request and never echoed; ONE GET of one advisory; a stroke of its own whose token alone carries repository-advisories READ; the seal opening byte for byte for its own read and key alone, the parts inside the runner's caps, the sender gate's one setting with every other closed, and the fences, printing no id, state or field");
  {
    const REPO = `${TARGET_OWNER}/objectstack`;
    const read = (extra = {}) => ({ op: 'advisory_read', ghsa_id: GHSA, public_key: READER.spki, ...extra });
    const add = { op: 'advisory_collaborators_add', ghsa_id: GHSA, collaborators: ['os-dev-a'] };
    const one = (action) => fixturePayload({ actions: [action] });
    const errorsOf = (action) => validatePayload(one(action)).errors;
    const PROSE = 'ADVISORY PROSE MARKER, in the wrong key';
    const KEY_REFUSAL = 'actions[0].public_key must be one X25519 public key';
    const { createPublicKey } = await import('node:crypto');
    const derOf = (raw) => Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]).toString('base64');
    const PREFIX = 'MCowBQYDK2VuAyEA';
    // The row, its fields and its one request.
    t('the row: ghsa_id and public_key, nothing optional; it spends repository-advisories at READ (its grant), travels alone, widens nothing else; public_key is its own kind and ghsa_id the existing one', [OPS.advisory_read.required, OPS.advisory_read.optional, OPS.advisory_read.permission, OPS.advisory_read.grant, OPS.advisory_read.alone, OPS.advisory_read.alsoSpends ?? null, OPS.advisory_read.secondRepo ?? null, FIELDS.public_key, FIELDS.ghsa_id], [['ghsa_id', 'public_key'], [], 'repository-advisories', 'read', true, null, null, { kind: 'x25519' }, { kind: 'ghsa' }]);
    t("⚖ the sender gate, by the maintainer's ruling: ONE setting, target-write — write, maintain or admin on the target, the gate every other row keeps — on advisory_read, the one row carrying one, whose grant stays read", [Object.keys(ADVISORY_READ_SENDER_GATES), OPS.advisory_read.senderGate, OP_NAMES.filter((op) => OPS[op].senderGate !== undefined), OPS.advisory_read.grant], [['target-write'], 'target-write', ['advisory_read'], 'read']);
    const asked = OPS.advisory_read.requests(read(), REPO);
    t("its one request is a GET of one advisory's path — no body, no write — carrying the id and the key to the executor, and reaching no refused family", [asked.length, asked[0].verb, asked[0].path, 'body' in asked[0], asked[0].advisoryRead, ADVISORY_PATH_SHAPE.test(asked[0].path), REFUSED_PATH_FAMILIES.filter((re) => re.test(asked[0].path)).length], [1, 'GET', `/repos/${REPO}/security-advisories/${GHSA}`, false, { ghsaId: GHSA, publicKey: READER.spki }, true, 0]);
    // The key: its one spelling, judged before any request.
    t('the key: X25519, 60 base64 characters of SPKI DER in one shape — and twenty fresh key pairs, as the seat makes them, each pass the whole judgment', [ADVISORY_READ_KEY_TYPE, ADVISORY_READ_PUBLIC_KEY_CHARS, READER.spki.length, ADVISORY_READ_PUBLIC_KEY_SHAPE.test(READER.spki), READER.spki.startsWith(PREFIX), Array.from({ length: 20 }, () => advisoryReadKeyFailure(keyPair().spki)).filter((why) => why !== null)], ['x25519', 60, 60, true, true, []]);
    const accepted = validatePayload(one(read()));
    t('accepted: one read with a fresh key, normalised to exactly what was sent', [accepted.ok, accepted.payload?.actions[0]], [true, read()], accepted.errors.join(' | '));
    const ed = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const x448 = generateKeyPairSync('x448').publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const pem = READER.publicKey.export({ format: 'pem', type: 'spki' });
    const raw = READER.publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
    // The curve's low-order points (RFC 7748 §6.1 names the need to refuse them): 0, 1, the two of order 8, p − 1, p and p + 1.
    const lowOrder = ['00', '01', 'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800', '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', 'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', 'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'].map((hex) => derOf(Buffer.from(hex.padEnd(64, '0'), 'hex')));
    const malformedKeys = [
      17, null, true, [READER.spki], { key: READER.spki }, '', 'x', PROSE, READER.spki.slice(0, 59), `${READER.spki}A`, `${READER.spki.slice(0, 59)}A`, ` ${READER.spki.slice(1)}`, `${READER.spki} `,
      `${PREFIX}${'-'.repeat(42)}A=`, `${PREFIX}${'A'.repeat(42)}B=`, ed, x448, pem, raw.toString('base64'), raw.toString('base64url'), Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]).toString('hex'), ...lowOrder,
    ];
    t('⛔ a malformed public_key is refused before any request, naming the key: not a string (a number, null, a boolean, an array, an object), empty, short, prose, one character short or long, unpadded, padded with a space either side, the base64url alphabet, a spare bit set, an Ed25519 key, an X448 key, a PEM, the raw key in base64 or base64url, the DER in hex, and every low-order point of the curve', malformedKeys.filter((public_key) => !refuses(one(read({ public_key })), KEY_REFUSAL)).map((v) => malformedKeys.indexOf(v)), []);
    t("⛔ …each low-order point is refused as one, on the trial derivation — the shape alone would admit it", lowOrder.map((k) => [ADVISORY_READ_PUBLIC_KEY_SHAPE.test(k), advisoryReadKeyFailure(k)]), lowOrder.map(() => [true, 'is a key no secret can be derived with (a low-order point)']));
    const echoes = malformedKeys.filter((v) => typeof v === 'string' && v.length >= 8).filter((v) => errorsOf(read({ public_key: v })).some((e) => e.includes(v) || e.includes(v.slice(-16, -1)) || e.includes(v.slice(16, 32))));
    t('⛔ …and NO refusal echoes the value, in whole or in part — it is described by its type and byte count, and what it failed to be', [echoes.length, errorsOf(read({ public_key: PROSE })), errorsOf(read({ public_key: 17 }))], [0, [`${KEY_REFUSAL}, base64 SPKI DER of exactly 60 characters — got a string of ${Buffer.byteLength(PROSE)} byte(s) that is not 60 characters long; it is refused here, before any request, and never echoed`], [`${KEY_REFUSAL}, base64 SPKI DER of exactly 60 characters — got number that is not a string; it is refused here, before any request, and never echoed`]]);
    const malformedIds = ['ghsa-abcd-2345-wxyz', 'GHSA-ABCD-2345-WXYZ', 'GHSA-abcd-2345', `${GHSA}/cve`, `../${GHSA}`, '', 17, null, PROSE];
    t("⛔ a malformed ghsa_id beside a valid key is refused before any request, naming the shape, and never echoed", [malformedIds.filter((ghsa_id) => !refuses(one(read({ ghsa_id })), "actions[0].ghsa_id must be one repository advisory's id")).length, errorsOf(read({ ghsa_id: PROSE })).some((e) => e.includes('ADVISORY PROSE'))], [0, false]);
    const takes = `is not a key \`advisory_read\` takes (it takes ghsa_id, public_key)`;
    t('⛔ refused BY NAME beside a read: a private key, a key, the fields it would read, the keys of the other advisory rows, a state, a body and an issue — an id and a key, and nothing else', ['private_key', 'key', 'fields', 'summary', 'description', 'vulnerabilities', 'collaborators', 'advisory_state', 'state', 'body', 'issue', 'reveal'].filter((key) => !refuses(one(read({ [key]: key === 'issue' ? 7 : 'x' })), `actions[0].${key} ${takes}`)), []);
    t('⛔ refused: either required key missing — a key is never defaulted, nor an id', [refuses(one({ op: 'advisory_read', ghsa_id: GHSA }), 'actions[0].public_key is required'), refuses(one({ op: 'advisory_read', public_key: READER.spki }), 'actions[0].ghsa_id is required')], [true, true]);
    // Alone in its stroke, and the grant.
    t('⛔ fence alone, refused: a read beside a comment or beside another advisory row, and two reads — naming the action that does not belong and the read grant its token carries', [refuses(fixturePayload({ actions: [read(), { op: 'comment', issue: 7, body: 'x' }] }), 'actions[1] is `comment` in a stroke that carries a `advisory_read` — its token carries repository-advisories read'), refuses(fixturePayload({ actions: [add, read()] }), 'in a stroke that carries a `advisory_collaborators_add`'), refuses(fixturePayload({ actions: [read(), read({ public_key: keyPair().spki })] }), 'a stroke carries exactly ONE `advisory_read` and nothing else'), strokeErrors(REPO, [read()])], [true, true, true, []]);
    const readStroke = validatePayload(one(read())).payload;
    const addStroke = validatePayload(one(add)).payload;
    t("⭐ fence grant: a read's stroke mints the five literal grants plus repository-advisories READ — never write, never actions — for ONE repository, and the GitHub output spells it permission_repository_advisories=read; a writing row's stroke still mints write", [tokenPermissionsOf(readStroke), tokenRepositoriesOf(readStroke), outputLine(readStroke, 'permission_repository_advisories'), outputLine(readStroke, 'permission_actions'), tokenPermissionsOf(addStroke)['repository-advisories']], [{ issues: 'write', 'pull-requests': 'write', contents: 'write', workflows: 'write', metadata: 'read', 'repository-advisories': 'read' }, [REPO], 'permission_repository_advisories=read', 'permission_actions=', 'write']);
    t('⛔ the grant ledger: advisory_read alone names a grant, on a stroke-scoped permission, at a level no higher than PERMISSIONS holds — so no row can mint a grant the table does not carry', [OP_NAMES.filter((op) => OPS[op].grant !== undefined), OP_NAMES.filter((op) => OPS[op].grant !== undefined).every((op) => STROKE_SCOPED_PERMISSIONS.includes(OPS[op].permission) && (OPS[op].grant === 'read' || (OPS[op].grant === 'write' && PERMISSIONS[OPS[op].permission] === 'write')))], [['advisory_read'], true]);
    // The seal.
    const aad = advisoryReadAad({ requestId: 'fw-20261102T000000Z-abc123', action: 1, ghsaId: GHSA });
    const TEXT = JSON.stringify({ ghsa_id: GHSA, summary: `${PROSE} — 漢字, é, 🎉, a quote " and a backslash \\`, description: 'line one\nline two and a separator', vulnerabilities: [{ package: { ecosystem: 'npm', name: 'p' } }] });
    const sealed = sealAdvisoryRead({ plaintext: TEXT, publicKey: READER.spki, aad });
    const box = Buffer.from(sealed, 'base64url');
    const opened = openAdvisoryRead({ sealed, privateKey: READER.privateKey, aad });
    t('⭐ the seal opens to its plaintext BYTE FOR BYTE — CJK, an accent, an emoji, a quote, a backslash, a newline and a line separator among it — and is the version, the ephemeral key, the nonce, the ciphertext and the tag, in unpadded base64url', [opened === TEXT, Buffer.compare(Buffer.from(opened, 'utf8'), Buffer.from(TEXT, 'utf8')), box.length - Buffer.byteLength(TEXT, 'utf8'), ADVISORY_READ_SEAL_OVERHEAD, box[0], ADVISORY_READ_SEAL_VERSION, /^[A-Za-z0-9_-]+$/.test(sealed)], [true, 0, 61, 61, 1, 1, true]);
    const identity = Buffer.from(TEXT, 'utf8').toString('base64url');
    t('⛔ the sealed answer carries no plaintext — not the marker in its characters, nor in its decoded bytes, nor any 12-byte run of the plaintext; positive control: an unsealed encoding of the same text carries it decoded, so the needle finds what is there', [sealed.includes('ADVISORY'), box.includes(Buffer.from('ADVISORY PROSE')), Array.from({ length: Buffer.byteLength(TEXT) - 12 }, (_, i) => Buffer.from(TEXT).subarray(i, i + 12)).some((run) => box.includes(run)), Buffer.from(identity, 'base64url').includes(Buffer.from('ADVISORY PROSE'))], [false, false, false, true]);
    const again = Buffer.from(sealAdvisoryRead({ plaintext: TEXT, publicKey: READER.spki, aad }), 'base64url');
    t('⛔ two seals of one text to one key share nothing but the version — a fresh ephemeral key and a fresh nonce each time — and both open', [again.subarray(1, 33).equals(box.subarray(1, 33)), again.subarray(33, 45).equals(box.subarray(33, 45)), again.subarray(45).equals(box.subarray(45)), openAdvisoryRead({ sealed: again.toString('base64url'), privateKey: READER.privateKey, aad }) === TEXT], [false, false, false, true]);
    const opens = (s, { key = READER.privateKey, data = aad } = {}) => {
      try {
        openAdvisoryRead({ sealed: s, privateKey: key, aad: data });
        return 'opened';
      } catch (e) {
        return e.message === ADVISORY_READ_OPEN_FAILED ? 'refused' : `threw: ${e.message}`;
      }
    };
    const flip = (at) => {
      const b = Buffer.from(box);
      b[at] ^= 1;
      return b.toString('base64url');
    };
    const otherRead = (over) => advisoryReadAad({ requestId: 'fw-20261102T000000Z-abc123', action: 1, ghsaId: GHSA, ...over });
    t("⛔ it opens for its own read and key ALONE: another seat's key, another request id, another action, another advisory, a bit flipped in the version, the ephemeral key, the nonce, the ciphertext or the tag, one byte cut, a pad added, a character outside base64url, empty and a non-string are each refused with the one sentence that carries nothing sealed", [opens(sealed, { key: keyPair().privateKey }), opens(sealed, { data: otherRead({ requestId: 'fw-20261102T000000Z-abc124' }) }), opens(sealed, { data: otherRead({ action: 2 }) }), opens(sealed, { data: otherRead({ ghsaId: 'GHSA-wxyz-2345-abcd' }) }), opens(flip(0)), opens(flip(1)), opens(flip(33)), opens(flip(45)), opens(flip(box.length - 1)), opens(box.subarray(0, -1).toString('base64url')), opens(`${sealed}=`), opens(`${sealed.slice(0, -1)}+`), opens(''), opens(null), opens(sealed)], [...Array(14).fill('refused'), 'opened']);
    const seals = (publicKey) => {
      try {
        sealAdvisoryRead({ plaintext: TEXT, publicKey, aad });
        return 'sealed';
      } catch {
        return 'threw';
      }
    };
    t('⛔ a seal to a low-order point throws — the shared secret is all zeros or underived, never used — and so does a seal to no key at all', [...lowOrder.map(seals), seals(PROSE), seals(READER.spki)], [...lowOrder.map(() => 'threw'), 'threw', 'sealed']);
    // What is sealed, and the channel's parts.
    const served = { ghsa_id: GHSA, url: 'https://api.github.test/x', html_url: 'https://github.test/x', cve_id: null, summary: PROSE, description: PROSE, severity: 'high', state: 'draft', identifiers: [], author: { login: 'a' }, vulnerabilities: [{ package: { ecosystem: 'npm', name: 'p' }, vulnerable_version_range: '< 1.0.0', patched_versions: null, vulnerable_functions: [] }], cvss: { score: 9.8 }, cwes: [], cwe_ids: ['CWE-79'], credits: [{ login: 'a', type: 'finder' }], credits_detailed: [], collaborating_users: [{ login: 'os-dev-a', url: 'https://api.github.test/users/os-dev-a' }], collaborating_teams: [], private_fork: null };
    const picked = JSON.parse(advisoryReadPlaintext(served));
    t("the plaintext: exactly ADVISORY_READ_FIELDS the answer carries, in that order and as the platform answered them — the ids, the state, the severity, the summary, the description, the vulnerabilities, the weakness ids and the credits; never a URL, the collaborators, the CVSS, a fork or a timestamp; a field the answer lacks is absent, never invented", [Object.keys(picked), ADVISORY_READ_FIELDS.every((f) => JSON.stringify(picked[f]) === JSON.stringify(served[f])), advisoryReadPlaintext({ summary: 'S', html_url: 'h' })], [['ghsa_id', 'cve_id', 'state', 'severity', 'summary', 'description', 'vulnerabilities', 'cwe_ids', 'credits'], true, '{"summary":"S"}']);
    const cut = 'abcdefghij'.repeat(1234);
    const largest = sealAdvisoryRead({ plaintext: 'x'.repeat(ADVISORY_READ_MAX_SEALED_CHARS * 0.75 - ADVISORY_READ_SEAL_OVERHEAD), publicKey: READER.spki, aad });
    const overOne = sealAdvisoryRead({ plaintext: 'x'.repeat(ADVISORY_READ_MAX_SEALED_CHARS * 0.75 - ADVISORY_READ_SEAL_OVERHEAD + 1), publicKey: READER.spki, aad });
    t("the parts: 4,000 characters each, at most ten — 40,000 sealed characters, so 29,939 bytes of answer — in order and whole; an empty or larger sealed answer has no parts, so nothing is emitted", [ADVISORY_READ_PART_CHARS, ADVISORY_READ_MAX_PARTS, ADVISORY_READ_MAX_SEALED_CHARS, advisoryReadParts('a'.repeat(4000)).length, advisoryReadParts('a'.repeat(4001)).map((p) => p.length), advisoryReadParts(cut).join('') === cut, [largest.length, advisoryReadParts(largest)?.length], [overOne.length, advisoryReadParts(overOne)], advisoryReadParts('')], [4000, 10, 40000, 1, [4000, 1], true, [40000, 10], [40002, null], null]);
    // The fences on the read, judged on the executor's own GET.
    const answer = (json, status = 200) => ({ status, json });
    const advisory = (extra = {}) => ({ ghsa_id: GHSA, state: 'draft', summary: PROSE, description: PROSE, collaborating_users: [{ login: 'os-dev-a' }], ...extra });
    const fenced = (a, ctx = {}) => advisoryReadFenceFailures({ ghsaId: GHSA, answer: a, gate: 'target-write', ...ctx }).map((f) => f.fence);
    t('the fences are read, advisory and sender; accepted under target-write: the advisory the action names, in whatever state it reads', [ADVISORY_READ_FENCES.map((f) => f.fence), fenced(answer(advisory())), fenced(answer(advisory({ state: 'triage' }))), fenced(answer(advisory({ state: 'closed' })))], [['read', 'advisory', 'sender'], [], [], []]);
    t('⚖ target-write reads no collaborator: an advisory listing someone else, none, null or a team alone is accepted alike, and a sender handed to the fence is not read — the stroke judged the sender before the GET', [fenced(answer(advisory())), fenced(answer(advisory({ collaborating_users: [] }))), fenced(answer(advisory({ collaborating_users: null }))), fenced(answer(advisory({ collaborating_users: [], collaborating_teams: [{ slug: 'os-dev-a' }] }))), fenced(answer(advisory({ collaborating_users: [] })), { sender: 'os-dev-b' })], [[], [], [], [], []]);
    t('⛔ any other gate fails CLOSED, whatever the advisory lists — the retired collaborator, a misspelling, a prototype key, empty or absent', ['collaborator', 'Collaborator', 'Target-Write', 'anyone', 'toString', '', undefined].map((gate) => fenced(answer(advisory()), { gate })), [['sender'], ['sender'], ['sender'], ['sender'], ['sender'], ['sender'], ['sender']]);
    t('⛔ fence read: a 404, a 403, an array and null are never an advisory — the advisory fence not judged; the sender fence holds under target-write and refuses under any other gate', [[answer({ message: 'Not Found' }, 404), answer({ message: 'Forbidden' }, 403), answer([advisory()]), answer(null)].map((a) => fenced(a)), fenced(answer(null, 404), { gate: 'collaborator' })], [[['read', 'advisory'], ['read', 'advisory'], ['read', 'advisory'], ['read', 'advisory']], ['read', 'advisory', 'sender']]);
    const leaky = advisoryReadFenceFailures({ ghsaId: GHSA, answer: answer(advisory({ ghsa_id: 'GHSA-wxyz-2345-abcd', state: PROSE })), gate: PROSE });
    const leakyText = advisoryReadFenceText(leaky);
    t("⛔ a read's fence sentence names no advisory id — neither the one asked for nor the one answered — no state and no prose: another advisory is said to be one, and a gate that is prose is said to be unknown, never echoed", [leaky.map((f) => f.fence), [GHSA, 'GHSA-wxyz-2345-abcd', 'ADVISORY PROSE', 'draft'].filter((needle) => leakyText.includes(needle)), leakyText], [['advisory', 'sender'], [], 'fence `advisory`: the answer names another advisory, and the relay seals only for the advisory the action names, by its ghsa_id; fence `sender`: the row names no sender gate the table knows, so no read is sealed, and the relay seals only for a sender gate the table names']);
    t("⛔ the call, the landed row and the over-cap sentence print counts and the id's placeholder — never an id", [advisoryReadCall(REPO), advisoryReadLandedText({ plaintextBytes: 812, sealedChars: 1164, parts: 1 }), advisoryReadOverCapText({ plaintextBytes: 31000, sealedChars: 41415 })], [`GET /repos/${REPO}/security-advisories/{ghsa_id}`, "sealed 812 byte(s) of the answer to the seat's one-time key — 1164 character(s) in 1 notice part(s), which only that seat's process opens", "the sealed answer is 41415 character(s) (31000 byte(s) of the answer), over the 40000 the run's notices carry (10 of 4000) — nothing was emitted; ⛔ the text never leaves another way, put the reading to the maintainer"]);
    // Positive control for the key refusals: the public half of a real pair parses back to the same key.
    t('…positive control: the key a seat sends is the public half of its pair, byte for byte', createPublicKey({ key: Buffer.from(READER.spki, 'base64'), format: 'der', type: 'spki' }).export({ format: 'der', type: 'spki' }).toString('base64'), READER.spki);
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
      'fenced on its two cards and landed only when the parent\'s list reads the child back, the payload read from the event file and never a step\'s env, ' +
      'and five advisory rows — a report, a draft, an advisory\'s collaborators, its versions and its state, each alone in its stroke — nothing echoed from a refusal, versions entries closed and judged by value, published reached by advisory_state alone, ' +
      'repository-advisories write minted for that one stroke, the bare collection reached by the draft\'s POST alone, and no other advisory path; ' +
      'and one that reads — advisory_read, alone in its stroke, its token at repository-advisories READ, the seat\'s one-time key judged before any request ' +
      'and never echoed, its answer sealed to that key and opening for that read alone.',
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

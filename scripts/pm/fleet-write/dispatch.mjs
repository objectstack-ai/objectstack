#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-write/dispatch — the seat side of the relay: pick the transport, pack
 * ONE stroke into ONE `repository_dispatch`, send it, and wait for its run.
 *
 *   node scripts/pm/fleet-write/dispatch.mjs --repo owner/name --actions-file actions.json [--session session_…] [--json]
 *   node scripts/pm/fleet-write/dispatch.mjs --repo owner/name --actions-file actions.json --dry-run   # pack and print, send nothing
 *   node scripts/pm/fleet-write/dispatch.mjs --self-test                                                # offline, no network
 *
 * ## Why a seat cannot write as the fleet directly, and what this does instead
 *
 * A cloud seat's egress proxy REPLACES every `Authorization` header with the
 * session's own token and refuses the `/app/**` path the token minter needs,
 * so `fleet-token.mjs` cannot mint there and a minted token could not be used
 * there. What the proxy does pass is `POST /repos/{board}/dispatches` with the
 * session token — measured 204 — and GitHub Actions is the broker a cloud seat
 * can reach. So a seat packs the SAME requests it would have sent directly
 * into one payload (`validate.mjs` judges it before it leaves), dispatches it
 * to the board repo, and `.github/workflows/fleet-write.yml` there executes
 * it as `objectstack-fleet[bot]` against `payload.repo`.
 *
 * ## The transport selector — `OS_FLEET_TRANSPORT` ∈ direct | dispatch | auto
 *
 * `direct` is today's path (the tool's own requests with the token it holds);
 * `dispatch` is the relay; `auto` (the default) is `dispatch` only when ALL
 * THREE hold, and `direct` otherwise:
 *
 *   ① the cloud discriminator — `CCR_AGENT_PROXY_ENABLED=1`, the variable that
 *      names the very proxy whose header replacement makes the direct path
 *      unusable, present in every cloud container measured and absent on a
 *      developer's machine and on a runner (⛔ not the proxy port: a port is a
 *      fact about one container's boot, and nothing about identity);
 *   ② the seat's session — the `session_…` id the envelope carries and the
 *      run's summary names. A cloud seat's is READ FROM THE CONTAINER: the
 *      harness sets `CLAUDE_CODE_REMOTE_SESSION_ID=cse_<id>`, and `session_<id>`
 *      is the seat's own id (`sessionSource`). `OS_FLEET_SESSION` OVERRIDES it
 *      (a local checkout, a test) — explicit wins, and an explicit value that
 *      is malformed is refused, never replaced by the container's. The route's
 *      reason names which source was read. ⛔ No documented spelling prefixes a
 *      write with `OS_FLEET_SESSION=…`: the seats' allow rules are literal
 *      command prefixes, and a leading assignment matches none of them;
 *   ③ the relay is LIVE on the board — BOTH the file and its Actions state:
 *      `GET /repos/{board}/contents/.github/workflows/fleet-write.yml?ref=main`
 *      answers 200, AND `GET /repos/{board}/actions/workflows/fleet-write.yml`
 *      answers 200 with `state === 'active'`. Read ONCE per process and cached,
 *      and only reached once ① and ② hold, so a seat outside the cloud never
 *      makes it. The read is judged in THREE buckets, not two:
 *        - LIVE: 200 + `active` ⇒ `dispatch`;
 *        - DEFINITELY NOT LIVE — exactly two signals: the file's GET answers
 *          404 (no relay on the board), or the state is `disabled_manually`
 *          (the maintainer's KILL SWITCH: disabling the workflow in the Actions
 *          UI turns every seat back to `direct` with no prompt or environment
 *          change) ⇒ `direct`, with ONE printed line naming the signal;
 *        - INDETERMINATE — any other status (401, 403, 5xx …), a 200 without a
 *          readable state, any other state, or no answer ⇒ a PREREQUISITE
 *          refusal (exit 3) naming the status and the read. ⛔ Never `direct`:
 *          an unreadable relay is not evidence the relay is gone, and falling
 *          back would exchange the fleet identity for the seat's personal
 *          account without its say-so — the shape that put two seat accounts
 *          on the platform's abuse ledger in one day. The seat re-runs or fixes
 *          its route; `OS_FLEET_TRANSPORT=direct` is the ONLY way to write as
 *          the personal account in a cloud container, and the tool prints it.
 *
 *      ⛔ The read runs only BEHIND the proxy: node's fetch does not read
 *      `HTTPS_PROXY`, and a read from a process that is not re-exec'd with
 *      `--use-env-proxy` leaves the container unproxied and answers 401 for a
 *      relay that is alive — the very reading that once turned a seat `direct`
 *      mid-session. `relayLive` therefore refuses to read at all from such a
 *      process (INDETERMINATE, naming the flag), and every tool re-execs before
 *      it resolves the route, `--dry-run` and `--route` included.
 *
 * ① or ② failing ⇒ `direct`, with ONE printed line naming the failed condition,
 * and ⛔ no 90 s wait on that path: a seat outside the cloud gets today's
 * behaviour at today's speed. Every selection PRINTS which transport it took
 * and why; a silent choice between two identities is the one thing this file
 * must never make.
 *
 * An explicit `OS_FLEET_TRANSPORT=dispatch` stays STRICT: a missing session or
 * a relay that is not live — definitely or indeterminately — is a PREREQUISITE
 * refusal (exit 3), never an invented value and never a silent fall-back to
 * `direct` — the operator asked for the relay, and the fall-back would change
 * the identity every write is booked against. `OS_FLEET_RELAY_LIVE=1|0`
 * overrides condition ③ FOR TESTS (the self-tests and with-fleet's), and says
 * so when it is read.
 *
 * ## The run-poller, and the two ceilings
 *
 * A dispatch answers 204 whether or not anything listens — measured on the
 * board repo with zero listeners: 204, zero runs. So acceptance proves
 * nothing; the run does. After the POST this file polls
 * `GET /repos/{board}/actions/runs?event=repository_dispatch` for the run whose
 * name carries the request id (`run-name: fleet-write <request_id>`), then
 * polls that run until it completes:
 *
 *   `OS_FLEET_DISPATCH_START_MS`    how long a run may take to APPEAR (default 90 s);
 *   `OS_FLEET_DISPATCH_TIMEOUT_MS`  how long, from the dispatch, it may take to COMPLETE (default 5 min);
 *   `OS_FLEET_DISPATCH_POLL_MS`     the poll interval (default 5 s).
 *
 * Neither ceiling is a measured start latency yet — the relay workflow lands
 * separately, and the first live probe is what tunes them. On either ceiling
 * the answer is `UNCONFIRMED` with the run URL when there is one, exit
 * `EXIT_UNCONFIRMED` (6): ⛔ never silent, ⛔ never auto-retried — a retry of a
 * dispatch that may still run is a double write. ⛔ And never fallen back from,
 * under ANY transport request, `auto` included: a run that has not appeared
 * yet is evidence of the wait and of nothing else — the relay may be queued —
 * so a direct write after an accepted dispatch exchanges the fleet identity
 * for the seat's personal account without its say-so, and may land the same
 * write twice when the run does execute. Whether the board LISTENS is
 * condition ③'s question, answered before anything is sent (the workflow
 * file's 404 turns `auto` direct, said out loud); once a dispatch is accepted
 * the only answers are the run's. A run that appeared and FAILED is never
 * fallen back from either — the relay refused or half-wrote, and a direct
 * retry would write twice. Every sender is held to this in ONE place: the
 * no-run conformance below.
 *
 * `write-pace.mjs` counts the dispatch as THE write — one POST, paced and
 * leased like any other; the runner's executor paces its own writes there.
 *
 * ## The read-back — the run's `success` is the executor's, not the write's
 *
 * A run concluding `success` proves the executor's requests were ANSWERED 2xx.
 * It does not prove the board holds the bytes this seat sent: measured, a
 * 41,699-byte `issue_patch` body went through a `success` run and was stored
 * with two multi-byte characters replaced by U+FFFD, deterministically on a
 * re-send — and this file said exit 0 both times. The executor cannot catch
 * that from where it stands: whatever reached it is what it wrote and what the
 * platform echoed, so only the SEAT, which holds the bytes it meant, can.
 *
 * So after a `success` run `sendFleetWrite` reads back every action that
 * carried a `body` — `BODY_OPS`, derived from `ops.mjs`, so a new body op is
 * read back the day it lands (`READ_BACK_LOCATORS` must name it, pinned) — and
 * judges the stored bytes against the bytes sent with post-stamped's own
 * `classifyReadBack` / `sentBodyLanded`: the exact-bytes classifier whose
 * declared normalisations (the platform's footer block, a stripped trailing
 * newline) are the ones this fleet measured, ⛔ never a second copy here. It is
 * loaded with a dynamic import because post-stamped imports THIS file
 * statically; a static import back would be a cycle whose evaluation order
 * decides whether either file's constants exist yet. One cell is added, for
 * the one surface post-stamped never writes: a `pr_create` body the platform
 * stored as the bytes sent followed by exactly the session-URL footer block
 * (`PR_CREATE_FOOTER_TAIL`) — `platform-readings.md`'s fourth shape, where the
 * sent body is a strict prefix of the stored one. It forgives an append after
 * EVERY byte sent and nothing inside them.
 *
 * Each action's verdict is one of three, and the locator decides which a
 * missing match may be:
 *
 *   landed        every byte sent is on the platform (identical, or a declared
 *                 normalisation).
 *   not-stored    the object the action wrote was READ and a byte sent is not
 *                 the byte stored at that offset — the result is `failure`
 *                 with `notStored: true`, exit `EXIT_NOT_STORED` (4), naming the
 *                 op, the object and the first differing byte.
 *   unverified    the stored body could not be read, or — for a `comment`,
 *                 which only its content can find — no comment created since
 *                 the dispatch holds the bytes sent. Result `unverified`,
 *                 exit `EXIT_UNCONFIRMED` (6): an object that was not found was
 *                 not measured, so ⛔ it is never called "not stored", and ⛔ never
 *                 success either.
 *
 * ⛔ No retry on a mismatch: a split that happened once happens again on an
 * identical re-send (measured), and a body edit retried writes the damage over
 * and over. `4` means what it means in every other fleet tool — the write
 * HAPPENED and the board disagrees: go READ it.
 *
 * ## The `issue_create` re-list — the repository issue list lags a create
 *
 * A new issue is found by LISTING the repository's issues, and that list lags
 * a create by seconds: measured over five relay filings in one shift, the three
 * whose issue was created 3–4 s before its run completed read back `unfound`
 * while the issue stood on the board with the title sent, byte for byte, and
 * the two created 5 s before read back IDENTICAL. (Not the query: `since` filters
 * on `updated_at`, which a brand-new issue always meets, and `sort=created`
 * puts it first.) So when an `issue_create`'s list ANSWERED and no issue
 * created since the dispatch carries the title sent, the read-back re-reads
 * that same list on the bounded schedule `ISSUE_CREATE_RELIST_DELAYS_MS` names,
 * one printed line per re-list and one when a re-list finds it, before it may
 * say `unfound`. A list that could not be read ends the wait as `unread`, as
 * on the first pass. Every re-list is a READ: ⛔ the create is never re-sent,
 * and an issue the last re-list still lacks is `unfound` — exit 6,
 * UNCONFIRMED, read the board — exactly what it meant before.
 *
 * The re-list is the FALLBACK. The run knows the number it created, and a
 * seat container reads neither the job log (its endpoint answers 302 to blob
 * storage the egress proxy refuses, CONNECT 403) nor the step summary (the
 * job's check run carries a null `output.summary`) — but it does read the
 * check run's ANNOTATIONS, so the run reports the number there (next section).
 * An `issue_create` whose action the run's annotation names is read back AT
 * that number: one GET, no list, no re-list. Only an action no annotation
 * names takes the re-list above.
 *
 * How the callers read the new outcomes — one exit vocabulary, no caller edited:
 *   - `failure` + `notStored` keeps the state every caller already reads as "the
 *     platform did not keep it whole — go READ, never fall back": post-stamped's
 *     `relayExitFor` maps `failure` to its own `EXIT_NOT_STORED` (4); the tools
 *     that call `exitForResult` (issue-create, label-write, issue-transfer,
 *     close-cards) get 4 from it — issue-create's `EXIT_READ_BACK_MISMATCH`.
 *   - `unverified` is a state no caller names, so each falls to its non-success
 *     branch: `exitForResult` answers 6, post-stamped's `relayExitFor` answers
 *     its default 6. Neither is ever a fall-back to direct — no outcome of an
 *     accepted dispatch is (the no-run conformance below) — and neither is 0.
 *   - a stroke carrying no body (labels, assignees, state, a transfer, the
 *     GraphQL ops) reads nothing back and its outcome is unchanged.
 *
 * ## The no-run conformance — every sender, one answer
 *
 * The rule above lives in each caller's own control flow, where a later edit
 * can quietly re-open a direct path after the dispatch, so it is pinned once,
 * for all of them, in this file's self-test:
 *
 *   - a SENDER is any file under `scripts/` other than this one that names
 *     `sendFleetWrite`, discovered from the source on every run — never a
 *     hand-kept list, so a tool added later is held to this the day it lands;
 *   - every sender exports `relayMissProbe({ route, send, pace })`: ONE write
 *     through its real write path against its own offline fake platform, on
 *     the route, the sender and the throttle the conformance hands in,
 *     answering `{ exit, calls, text }` — the exit, every request that left
 *     the process directly (`METHOD /path`), and what it printed;
 *   - the conformance drives each with a dispatch the platform ACCEPTS (204)
 *     and a run that never appears, under `auto` and under an explicit
 *     `dispatch`, and with a run that never completes under `auto`, through
 *     the real `sendFleetWrite` over a fake platform. Each must answer exit
 *     `EXIT_UNCONFIRMED`, after exactly ONE dispatch, with ZERO direct writes
 *     (any request but a GET), printing the shared `unconfirmedText` sentence;
 *   - the control drives each under `direct`: at least one direct write and no
 *     dispatch — so the empty list above is a measurement, never a recorder
 *     that sees nothing;
 *   - a sender without the probe fails the pin until it carries one and gives
 *     the same answer. ⛔ There is no third, quieter answer to an accepted
 *     dispatch with no run. This file's own CLI (`with-fleet.sh --actions`
 *     execs it) has no direct path at all and is pinned beside them.
 *
 * ## The run's annotations — the numbers a seat CAN read
 *
 * `execute.mjs` prints, for every action whose op is in `ANNOTATED_OPS` (the
 * ops that create or move a card) and whose request LANDED, ONE workflow
 * command — a `notice` titled `fleet-write <op>` whose message is
 * `fleet-write action=<i> op=<op> number=<n> url=<url>`, the number and url
 * taken from the platform's ANSWER to that request (the created issue's
 * `number` / `html_url`, the `transferIssue` answer's `issue.number` /
 * `issue.url`), never from the request. The runner turns it into an
 * annotation on the job's check run. After a success run carrying such an
 * op, `sendFleetWrite` reads them — `GET /repos/{board}/actions/runs/{id}/jobs`
 * (a job's id is its check run's id, measured) then
 * `GET /repos/{board}/check-runs/{id}/annotations`, both measured readable
 * from a seat container — and hands them on as `result.annotations`; a
 * caller that needs a card's number (`issue-create.mjs`, `issue-transfer.mjs`)
 * reads it there first. `relayAnnotationMessage` spells the message and
 * `parseRelayAnnotation` reads it — ONE spelling for the writer and every
 * reader; the executor emits only a message the parser reads back as what it
 * meant. A parsed row is used only when the stroke's action at its index has
 * its op and its url names the repository that op lands the card on
 * (`matchRunAnnotations`); two different rows for one action are neither.
 *
 * Absent is an ordinary state, never a failure, and always said: a relay
 * older than the emission, an annotation read that does not answer, or an
 * action past the platform's cap — 10 notice annotations per step and 50 per
 * job (actions/toolkit `docs/problem-matchers.md`), the rest dropped without
 * a word, so of a stroke carrying more than ten such ops only the first ten
 * are named. Each reader then takes its fallback: the re-list here, the
 * redirect or the title in `issue-transfer.mjs`, the title in
 * `issue-create.mjs`. ⛔ No second read path beyond that fallback, and ⛔ not
 * a gate: an annotation only ever replaces a search for a number.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0   the run completed with conclusion `success`, and every body it wrote
 *       reads back as the bytes sent.
 *   2   usage, or the packed payload was refused by the validator (nothing sent).
 *   3   PREREQUISITE NOT MET — no token, no session in dispatch mode, the
 *       dispatch route dead (401/407/0), or the run list unreadable.
 *   4   NOT STORED — the run succeeded and the read-back shows a body the board
 *       does not hold as sent (op, object and first differing byte printed).
 *       Go READ it; ⛔ do not retry.
 *   5   the platform REFUSED the dispatch (403/404/422), or the run FAILED.
 *   6   UNCONFIRMED — no run in the start window, no completion within the
 *       ceiling, or a body the read-back could not find or read. The run URL
 *       (when any) is printed. Go READ it; ⛔ do not retry blind.
 *  10   the write throttle refused the dispatch.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../../invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, proxyRearmPlan, proxyRoute } from '../check-half-states.mjs';
import { classifyHttp } from '../label-write.mjs';
import { EXIT_WRITE_PACE_REFUSED, isWriteMethod, noteResponse, paceWrite, releaseWriteLease } from '../write-pace.mjs';
import { CONTAINER_SESSION_ENV, CONTAINER_SESSION_SHAPE, MAX_REQUEST_ID_CHARS, OPS, OP_NAMES, RELAY_EVENT_TYPE, RELAY_REPO, SESSION_ENV, SESSION_SHAPE, TRANSPORTS, TRANSPORT_ENV } from './ops.mjs';
import { PAYLOAD_ENV, refusalText, validatePayload } from './validate.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const DEFAULT_API = 'https://api.github.com';
const PROXY_REARM_GUARD = 'OS_FLEET_DISPATCH_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = EXIT_PREREQUISITE_NOT_MET;
/**
 * The run succeeded and the read-back READ a body the board does not hold as
 * sent — the value every fleet tool gives "written, and the board disagrees":
 * post-stamped's `EXIT_NOT_STORED`, issue-create's `EXIT_READ_BACK_MISMATCH`.
 */
export const EXIT_NOT_STORED = 4;
export const EXIT_PLATFORM_REFUSAL = 5;
/** The one exit that means "dispatched, outcome not confirmed" — shared by every tool that takes the relay. */
export const EXIT_UNCONFIRMED = 6;

/** The cloud-seat discriminator `auto` reads. */
export const CLOUD_DISCRIMINATOR = 'CCR_AGENT_PROXY_ENABLED';

/** The workflow whose presence on the board's default branch AND Actions state make condition ③, and the test-only override for it. */
export const RELAY_WORKFLOW_PATH = '.github/workflows/fleet-write.yml';
/** The `{workflow_id}` the Actions API takes for it — the file name is accepted in place of the numeric id. */
export const RELAY_WORKFLOW_FILE = RELAY_WORKFLOW_PATH.slice(RELAY_WORKFLOW_PATH.lastIndexOf('/') + 1);
/** The one Actions `state` that runs a `repository_dispatch`; `disabled_manually` is the maintainer's kill switch. */
export const RELAY_WORKFLOW_ACTIVE_STATE = 'active';
export const RELAY_LIVE_OVERRIDE_ENV = 'OS_FLEET_RELAY_LIVE';

export const DEFAULT_START_MS = 90_000;
export const DEFAULT_CEILING_MS = 5 * 60 * 1000;
export const DEFAULT_POLL_MS = 5_000;

/** The export every sender carries for the no-run conformance (the header's section of that name). */
const RELAY_MISS_PROBE = 'relayMissProbe';

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * Which transport this process takes, and why. Pure: the three conditions
 * `auto` needs are handed in (`relay` is the cached liveness reading, or
 * `null` when it was not read because an earlier condition already failed).
 *
 * @param {Record<string,string|undefined>} env
 * @param {{ relay?: { live: boolean, reason: string } | null }} [conditions]
 * @returns {{ requested: string, transport: 'direct'|'dispatch'|null, reason: string, error: string|null, failed: string|null }}
 */
export function selectTransport(env = process.env, { relay = null } = {}) {
  const raw = String(env[TRANSPORT_ENV] ?? '').trim();
  const requested = raw || 'auto';
  if (!TRANSPORTS.includes(requested)) {
    return { requested, transport: null, reason: '', error: `${TRANSPORT_ENV}=${JSON.stringify(raw)} is not one of ${TRANSPORTS.join(' | ')} — refusing to guess between two identities`, failed: null };
  }
  if (requested !== 'auto') return { requested, transport: requested, reason: `${TRANSPORT_ENV}=${requested}`, error: null, failed: null };
  const cloud = String(env[CLOUD_DISCRIMINATOR] ?? '') === '1';
  const direct = (failed, why) => ({ requested, transport: 'direct', reason: `${TRANSPORT_ENV} is auto → direct: ${why}`, error: null, failed });
  if (!cloud) return direct('cloud', `${CLOUD_DISCRIMINATOR} is not 1 — not a cloud seat container, so the tool's own requests go out directly`);
  const src = sessionSource(env);
  if (!src.session) return direct('session', `${CLOUD_DISCRIMINATOR}=1 but no session: ${src.reason} — the envelope cannot carry this seat's identity, so the tool's own requests go out directly (a cloud seat's session is read from the container's ${CONTAINER_SESSION_ENV}; ${SESSION_ENV}=session_… overrides it)`);
  // ③ read and INDETERMINATE: fail CLOSED. Only the two definite signals (no file, or the kill switch) may turn a
  // cloud seat with a session back to its personal account; anything else is a refusal the seat can see and act on.
  if (relay && !relay.live && relay.definite === false) {
    return {
      requested,
      transport: null,
      failed: 'relay',
      reason: `${TRANSPORT_ENV} is auto → REFUSED: ${relay.reason}`,
      error:
        `${TRANSPORT_ENV} is auto in a cloud seat container with a session, and ${relay.reason}. An indeterminate liveness reading is not evidence ` +
        `that the relay is gone, so this tool does NOT fall back to direct — that would write as the seat's personal account instead of ` +
        `objectstack-fleet[bot]. Re-run once the read answers (or fix the route it failed on); ${TRANSPORT_ENV}=direct is the only way to write as ` +
        'the personal account here, on purpose and printed.',
    };
  }
  if (!relay || !relay.live) return direct('relay', relay ? relay.reason : `the relay's liveness was not read`);
  return {
    requested,
    transport: 'dispatch',
    reason: `${TRANSPORT_ENV} is auto → dispatch: ${CLOUD_DISCRIMINATOR}=1 (a cloud seat container, whose proxy replaces the Authorization header), ${src.reason}, and ${relay.reason}`,
    error: null,
    failed: null,
  };
}

// ── condition ③, read once per process ───────────────────────────────────
let relayLiveCache = null;

/** For the self-test only: forget the cached liveness reading. */
export function resetRelayLiveCache() {
  relayLiveCache = null;
}

/** One GET against the board, never throwing: `{ status, json, detail }` with status 0 for no answer. */
async function boardGet(fetchImpl, api, token, path) {
  try {
    const res = await fetchImpl(`${api}${path}`, {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    let json = null;
    if (res.status === 200) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    return { status: res.status, json, detail: '' };
  } catch (e) {
    return { status: 0, json: null, detail: e?.message ?? 'fetch threw' };
  }
}

const answered = (r) => (r.status === 404 ? '404' : r.status === 0 ? `no answer — ${r.detail}` : `HTTP ${r.status}`);

/** The two states the kill switch can put the workflow in, spelled once; only the first is a DEFINITE not-live signal. */
export const RELAY_WORKFLOW_KILL_SWITCH_STATE = 'disabled_manually';

/**
 * Is the relay LIVE on the board — the workflow file on its default branch AND
 * the workflow's Actions state `active`? Read ONCE per process and cached
 * whatever it answered (the state read happens only once the file read
 * answered 200); `OS_FLEET_RELAY_LIVE=1|0` short-circuits both FOR TESTS and is
 * named in the reason. Never throws.
 *
 * `definite` is the third bucket's flag: `live: false, definite: true` is one
 * of the two signals that MEAN no relay (the file's 404, the kill switch's
 * `disabled_manually`); `live: false, definite: false` is an INDETERMINATE
 * reading — another status, a 200 without a readable state, another state, no
 * answer, or a read this process must not make because its fetch would bypass
 * `HTTPS_PROXY` (`source: 'unrouted'`, not cached: the re-exec'd child reads).
 * The selector refuses on it; it never turns a seat `direct`.
 * @returns {Promise<{ live: boolean, definite: boolean, status: number|null, state: string|null, reason: string, source: 'read'|'cache'|'override'|'unrouted' }>}
 */
export async function relayLive(deps = {}) {
  const env = deps.env ?? process.env;
  const override = String(env[RELAY_LIVE_OVERRIDE_ENV] ?? '').trim();
  if (override === '1' || override === '0') {
    const live = override === '1';
    return { live, definite: true, status: live ? 200 : 404, state: live ? RELAY_WORKFLOW_ACTIVE_STATE : null, reason: `${RELAY_LIVE_OVERRIDE_ENV}=${override} (a test override) says the relay is ${live ? 'live' : 'not live'}`, source: 'override' };
  }
  if (relayLiveCache) return { ...relayLiveCache, source: 'cache' };
  // ⛔ Never read from a process whose fetch would bypass the egress proxy: that read answers 401 for a live relay.
  const { proxy, routed } = proxyRoute({ env, execArgv: deps.execArgv ?? process.execArgv });
  if (proxy && !routed) {
    return {
      live: false,
      definite: false,
      status: null,
      state: null,
      reason: `the relay's liveness was NOT read — HTTPS_PROXY is set (${proxy}) and this process is not routed through it (no ${PROXY_FLAG}), so the read would bypass the egress proxy and answer 401 for a relay that is alive; re-exec with ${PROXY_FLAG} first`,
      source: 'unrouted',
    };
  }
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const api = deps.api ?? DEFAULT_API;
  const token = deps.token ?? env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '';
  const filePath = `/repos/${RELAY_REPO}/contents/${RELAY_WORKFLOW_PATH}?ref=main`;
  const statePath = `/repos/${RELAY_REPO}/actions/workflows/${RELAY_WORKFLOW_FILE}`;
  const onMain = `the relay workflow ${RELAY_WORKFLOW_PATH} is on ${RELAY_REPO}@main (GET answered 200)`;
  const notLive = (why) => `the relay workflow ${RELAY_WORKFLOW_PATH} is NOT live on ${RELAY_REPO}@main: ${why}`;
  const indeterminate = (why) => `the relay's liveness is INDETERMINATE: ${why}`;
  const remember = (entry) => {
    relayLiveCache = entry;
    return { ...entry, source: 'read' };
  };

  const file = await boardGet(fetchImpl, api, token, filePath);
  if (file.status === 404) return remember({ live: false, definite: true, status: 404, state: null, reason: notLive(`the file's GET answered 404 — no relay workflow on the board`) });
  if (file.status !== 200) return remember({ live: false, definite: false, status: file.status, state: null, reason: indeterminate(`the file's GET ${filePath} answered ${answered(file)} — not the 404 that means no relay`) });
  // The file is there; is the workflow ENABLED? Only an `active` workflow runs a repository_dispatch.
  const wf = await boardGet(fetchImpl, api, token, statePath);
  if (wf.status !== 200) return remember({ live: false, definite: false, status: wf.status, state: null, reason: indeterminate(`${onMain} but its Actions state could not be read — GET ${statePath} answered ${answered(wf)}`) });
  const state = typeof wf.json?.state === 'string' ? wf.json.state : null;
  if (state === RELAY_WORKFLOW_ACTIVE_STATE) return remember({ live: true, definite: true, status: 200, state, reason: `${onMain} and its Actions state is ${state} (GET ${statePath} answered 200)` });
  if (state === RELAY_WORKFLOW_KILL_SWITCH_STATE) {
    return remember({ live: false, definite: true, status: 200, state, reason: notLive(`${onMain} but its Actions state is ${state}, not ${RELAY_WORKFLOW_ACTIVE_STATE} — the workflow was disabled in the Actions UI, the fleet's kill switch; every seat writes direct as its own user until it is re-enabled there`) });
  }
  const why = state === null ? `${onMain} but its Actions state is unknown — GET ${statePath} answered 200 without a state` : `${onMain} but its Actions state is ${state}, neither ${RELAY_WORKFLOW_ACTIVE_STATE} nor ${RELAY_WORKFLOW_KILL_SWITCH_STATE}`;
  return remember({ live: false, definite: false, status: 200, state, reason: indeterminate(why) });
}

/**
 * Where the seat's session id comes from, and what it is. Pure.
 *
 * `OS_FLEET_SESSION` first — explicit wins, its validation unchanged, and an
 * explicit value that is malformed is refused, never replaced by the
 * container's. Absent ⇒ the container's `CLAUDE_CODE_REMOTE_SESSION_ID`,
 * `cse_<id>` ⇒ `session_<id>`. Malformed or absent ⇒ `session: null`. The
 * `reason` is what the route prints, so it names the source that was read.
 * @returns {{ session: string|null, source: string|null, reason: string }}
 */
export function sessionSource(env = process.env) {
  const explicit = String(env[SESSION_ENV] ?? '').trim();
  if (explicit !== '') {
    if (SESSION_SHAPE.test(explicit)) return { session: explicit, source: SESSION_ENV, reason: `${SESSION_ENV} is set (it overrides the container's ${CONTAINER_SESSION_ENV})` };
    return { session: null, source: SESSION_ENV, reason: `${SESSION_ENV} is set but malformed (not session_<id>) — an explicit value is refused, never replaced by the container's ${CONTAINER_SESSION_ENV}` };
  }
  const container = String(env[CONTAINER_SESSION_ENV] ?? '').trim();
  if (container === '') return { session: null, source: null, reason: `${SESSION_ENV} is absent and the container sets no ${CONTAINER_SESSION_ENV}` };
  const m = CONTAINER_SESSION_SHAPE.exec(container);
  if (!m) return { session: null, source: CONTAINER_SESSION_ENV, reason: `${SESSION_ENV} is absent and the container's ${CONTAINER_SESSION_ENV} is malformed (not cse_<id>)` };
  return { session: `session_${m[1]}`, source: CONTAINER_SESSION_ENV, reason: `the session was derived from the container's ${CONTAINER_SESSION_ENV} (cse_<id> → session_<id>; ${SESSION_ENV} is absent)` };
}

/** The seat's session id — `OS_FLEET_SESSION`, else derived from the container — or null. */
export function sessionFrom(env = process.env) {
  return sessionSource(env).session;
}

/** A request id: `fw-<UTC instant>-<6 hex>` — under the cap, and unique enough to find its run by name. */
export function newRequestId(nowMs = Date.now(), random = () => randomBytes(3).toString('hex')) {
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const id = `fw-${stamp}-${random()}`;
  if (id.length > MAX_REQUEST_ID_CHARS) throw new RangeError(`request id ${id} exceeds ${MAX_REQUEST_ID_CHARS} characters`);
  return id;
}

/** Pack one stroke. The shared validator is the judge; nothing here restates a rule. */
export function packRequest({ repo, session, actions, requestId = null, now = Date.now } = {}) {
  const payload = { request_id: requestId ?? newRequestId(now()), repo, session, actions };
  const judged = validatePayload(payload);
  return judged.ok ? { ok: true, payload: judged.payload, errors: [] } : { ok: false, payload: null, errors: judged.errors };
}

/** Is this workflow run the one a request id names? `run-name` renders as `display_title`; the workflow's own `name` is the fallback. */
export function runMatches(run, requestId) {
  if (!run || typeof run !== 'object') return false;
  return [run.display_title, run.name].some((v) => typeof v === 'string' && v.includes(requestId));
}

/** The three ceilings, from the environment, with the same parse rule as write-pace: a malformed override is IGNORED and said. */
export function ceilingsFrom(env = process.env) {
  const notes = [];
  const read = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const n = Number(String(raw).trim());
    if (Number.isInteger(n) && n >= 0) return n;
    notes.push(`${name}=${JSON.stringify(String(raw))} is not a non-negative integer — IGNORED, using the default ${fallback}.`);
    return fallback;
  };
  return { startMs: read('OS_FLEET_DISPATCH_START_MS', DEFAULT_START_MS), ceilingMs: read('OS_FLEET_DISPATCH_TIMEOUT_MS', DEFAULT_CEILING_MS), pollMs: read('OS_FLEET_DISPATCH_POLL_MS', DEFAULT_POLL_MS), notes };
}

/** The UNCONFIRMED sentence a tool prints on either ceiling. */
export function unconfirmedText(result, tool = 'fleet-write') {
  const where = result.run?.url ? ` Run: ${result.run.url}` : ' No run carrying this request id appeared.';
  const what = result.state === 'no-run' ? `no run named after request ${result.requestId} appeared within ${result.startMs} ms of the dispatch` : `run ${result.run?.id ?? '?'} had not completed ${result.ceilingMs} ms after the dispatch (last status: ${result.run?.status ?? '?'})`;
  return (
    `${tool}: UNCONFIRMED — ${what}.${where}\n` +
    `  The dispatch was ACCEPTED (HTTP ${result.status}) and may still run. Go READ the run and the target; ⛔ do not re-run this\n` +
    `  command blind — a second dispatch is a second write. Exit ${EXIT_UNCONFIRMED}.`
  );
}

// ---------------------------------------------------------------------------
// The read-back — pure halves (the header's read-back section is the authority)
// ---------------------------------------------------------------------------

/** The clock slack a created object's timestamp may carry before the dispatch — post-stamped's relay read-back allows the same minute. */
export const READ_BACK_SLACK_MS = 60_000;

/**
 * The `issue_create` read-back's bounded re-list (header): the wait before each
 * re-read of the list, in order, taken only while the list answers and the
 * title sent is not on it. Why these values: the measured misses were issues
 * 3–4 s old when their run completed, the measured hits 5 s old, and the first
 * list is taken within one 5 s poll of that completion — so the first re-list,
 * 3 s later, already puts every measured miss past the measured hit age, and
 * 7 s then 15 s cover a list that lags harder under load. 25 s in all, under
 * 30 s: a genuine miss pays the window once and still reads `unfound`. ⛔ Never
 * unbounded and ⛔ never a re-send of the create; the self-test holds the sum.
 */
export const ISSUE_CREATE_RELIST_DELAYS_MS = Object.freeze([3_000, 7_000, 15_000]);

/** Every op the table lets carry a `body` — derived from `ops.mjs`, never listed, so a new body op is read back the day it lands. */
export const BODY_OPS = Object.freeze(OP_NAMES.filter((op) => [...OPS[op].required, ...OPS[op].optional].includes('body')));

/**
 * Where each body op's stored body is read from, and how it is FOUND — which
 * decides what a missing match may mean. `address`: the action named the
 * object. `key`: the run created it and a key the action sent (the title, the
 * head) finds it. Found either way, the object is identified independently of
 * its body, so a difference is a measurement of THAT object: `not-stored`.
 * `content`: only the body can find it (a new comment), so a body that matches
 * nothing is `unverified` — an object that was not found was not measured.
 * The self-test pins that this table names exactly `BODY_OPS`.
 */
export const READ_BACK_LOCATORS = Object.freeze({
  issue_patch: Object.freeze({ found: 'address', where: 'GET /repos/{repo}/issues/{issue}' }),
  comment_edit: Object.freeze({ found: 'address', where: 'GET /repos/{repo}/issues/comments/{comment_id}' }),
  issue_create: Object.freeze({ found: 'key', where: "the issue at the number the run's annotation names; absent that, the newest issue created since the dispatch whose title is the title sent, the list re-read on ISSUE_CREATE_RELIST_DELAYS_MS before unfound" }),
  pr_create: Object.freeze({ found: 'key', where: 'the newest pull request on the head sent, created since the dispatch' }),
  comment: Object.freeze({ found: 'content', where: 'the newest comment on the issue, created since the dispatch, whose stored body holds the bytes sent' }),
});

/**
 * The tail the platform appends to a `pr_create` body that does not already
 * end in the block — `.claude/skills/pm-dispatch/references/platform-readings.md`,
 * the fourth shape: a rule plus ONE session-URL footer, the sent body a strict
 * prefix of the stored one, 90/91 bytes (the session id's length). A pattern
 * only because the session id varies; everything around it is literal.
 */
export const PR_CREATE_FOOTER_TAIL = /^\n+---\n_Generated by \[Claude Code\]\(https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+\)_$/u;

/** The read-back's judge — post-stamped's exact-bytes classifier, loaded when a body is read back. ⛔ Never restated here (header). */
export async function loadReadBackJudge() {
  const judge = await import('../post-stamped.mjs');
  return { classifyReadBack: judge.classifyReadBack, sentBodyLanded: judge.sentBodyLanded };
}

/** Every action in a judged payload that carried a body, with the keys its locator needs. Pure. */
export function readBackTargets(payload) {
  const out = [];
  const actions = Array.isArray(payload?.actions) ? payload.actions : [];
  actions.forEach((a, i) => {
    if (!BODY_OPS.includes(a?.op) || typeof a.body !== 'string') return;
    const target = { action: i + 1, op: a.op, sent: a.body };
    for (const key of ['issue', 'comment_id', 'title', 'head']) if (key in a) target[key] = a[key];
    out.push(target);
  });
  return out;
}

const replacementCount = (s) => (String(s ?? '').match(/\uFFFD/gu) ?? []).length;

/**
 * One stored body against the bytes sent. Pure: `judge` is post-stamped's pair
 * (`loadReadBackJudge`). Returns `{ verdict, cls, offset, sentBytes,
 * storedBytes, sentContext, storedContext, replacements }` — `verdict` is
 * `landed` or `not-stored` for a body that was read, `unverified` for one that
 * was not a string. `replacements` is how many MORE U+FFFD the stored body
 * carries than the sent one: the mark of a byte-level split upstream, printed
 * because the context window drops a replacement glyph at its edges.
 */
export function judgeStoredBody({ op, sent, stored }, judge) {
  const sentText = String(sent ?? '');
  const sentBytes = Buffer.byteLength(sentText, 'utf8');
  if (typeof stored !== 'string') return { verdict: 'unverified', cls: 'unreadable', offset: null, sentBytes, storedBytes: null, replacements: 0 };
  const storedBytes = Buffer.byteLength(stored, 'utf8');
  const rb = judge.classifyReadBack({ sent: sentText, stored });
  if (judge.sentBodyLanded(rb)) return { verdict: 'landed', cls: rb.class, offset: null, sentBytes, storedBytes, replacements: 0 };
  const content = sentText.replace(/\n+$/u, '');
  if (op === 'pr_create' && stored.startsWith(content) && PR_CREATE_FOOTER_TAIL.test(stored.slice(content.length))) {
    return { verdict: 'landed', cls: 'pr-create-footer-appended', offset: null, sentBytes, storedBytes, replacements: 0 };
  }
  return {
    verdict: 'not-stored',
    cls: rb.class,
    offset: rb.offset,
    sentBytes,
    storedBytes,
    sentContext: rb.sentContext,
    storedContext: rb.storedContext,
    replacements: Math.max(0, replacementCount(stored) - replacementCount(sentText)),
  };
}

/** The stroke's verdict from its rows: any `not-stored` wins, then any `unverified`; `none` when nothing carried a body. Pure. */
export function strokeReadBackState(rows) {
  if (!rows.length) return 'none';
  if (rows.some((r) => r.verdict === 'not-stored')) return 'not-stored';
  if (rows.some((r) => r.verdict === 'unverified')) return 'unverified';
  return 'landed';
}

/** The transcript line for one read-back row. Pure. */
export function readBackLine(row) {
  const head = `fleet-write: read-back action ${row.action} ${row.op}${row.where ? ` ${row.where}` : ''}`;
  if (row.verdict === 'landed') return `${head}: ${row.sentBytes} byte(s) sent, ${row.storedBytes} stored — ${row.cls}; every byte sent is on the platform.`;
  if (row.verdict === 'unverified') return `${head}: ⚠️ UNVERIFIED — ${row.why ?? `the stored body could not be read (${row.cls})`}.`;
  const fffd = row.replacements > 0 ? ` The stored body carries ${row.replacements} U+FFFD replacement character(s) the sent one does not — the mark of a byte-level split upstream.` : '';
  return `${head}: ✗ NOT STORED — sent ${row.sentBytes} byte(s), stored ${row.storedBytes}; first difference at byte ${row.offset}: sent ${row.sentContext} | stored ${row.storedContext}.${fffd}`;
}

/** What the CLI prints on a `failure` the read-back measured. */
export function notStoredText(result, tool = 'fleet-write') {
  const bad = (result.readBack?.rows ?? []).filter((r) => r.verdict === 'not-stored');
  const which = bad.map((r) => `action ${r.action} (${r.op}${r.where ? ` ${r.where}` : ''}) first differs at byte ${r.offset}`).join('; ');
  return (
    `${tool}: NOT STORED — run ${result.run?.id ?? '?'} concluded success, and the read-back shows the board does NOT hold the bytes sent: ${which}.` +
    `${result.run?.url ? ` Run: ${result.run.url}` : ''}\n` +
    '  The write HAPPENED. Go READ what is stored and send a body that can land. ⛔ Do not re-run blind: an identical re-send\n' +
    `  reproduces a deterministic split, and a body edit retried writes the damage again. Exit ${EXIT_NOT_STORED}.`
  );
}

/** What the CLI prints when the run succeeded and a body could not be read back. */
export function unverifiedText(result, tool = 'fleet-write') {
  const open = (result.readBack?.rows ?? []).filter((r) => r.verdict === 'unverified');
  return (
    `${tool}: UNCONFIRMED — run ${result.run?.id ?? '?'} concluded success, but ${open.length} body/bodies could not be read back: ` +
    `${open.map((r) => `action ${r.action} (${r.op}) — ${r.why ?? r.cls}`).join('; ')}.${result.run?.url ? ` Run: ${result.run.url}` : ''}\n` +
    `  Go READ the target; ⛔ do not re-run blind — a second dispatch is a second write. Exit ${EXIT_UNCONFIRMED}.`
  );
}

// ---------------------------------------------------------------------------
// The run's annotations — pure halves (the header's annotations section is the authority)
// ---------------------------------------------------------------------------

/**
 * The ops whose landing the executor reports as an annotation — every op that
 * creates or moves a card, and nothing else — each with the repository it
 * lands the card on, which a parsed row's url is held to. `execute.mjs` reads
 * a number and url out of each one's answer (`ANNOTATION_ANSWERS`, pinned to
 * these keys by its self-test).
 */
export const ANNOTATED_OPS = Object.freeze({
  issue_create: Object.freeze({ lands: (action, repo) => repo }),
  transfer: Object.freeze({ lands: (action) => action?.target_repo }),
});

/** The word a relay annotation's message starts with — and its title, before the op. */
export const RELAY_ANNOTATION_PREFIX = 'fleet-write';

const RELAY_ANNOTATION_SHAPE = new RegExp(`^${RELAY_ANNOTATION_PREFIX} action=([1-9][0-9]*) op=([a-z_]+) number=([1-9][0-9]*) url=(https://\\S+)$`);
/** An issue's web url — group 1 its repository, group 2 its number. */
const ISSUE_URL_SHAPE = /^https:\/\/[^/\s]+\/([^/\s]+\/[^/\s]+)\/issues\/([1-9][0-9]*)$/;

/** The message of the one annotation the executor emits for a landed annotated op. Pure. */
export function relayAnnotationMessage({ action, op, number, url }) {
  return `${RELAY_ANNOTATION_PREFIX} action=${action} op=${op} number=${number} url=${url}`;
}

/**
 * An annotation's `message` as `{ action, op, number, url, repo }`, or null —
 * for anything else on the check run (the runner's own notices, an action's
 * deprecation warnings), an op outside `ANNOTATED_OPS`, or a url that is not
 * an issue url carrying the same number. Pure; never throws.
 */
export function parseRelayAnnotation(message) {
  const m = RELAY_ANNOTATION_SHAPE.exec(typeof message === 'string' ? message : '');
  if (!m || !Object.hasOwn(ANNOTATED_OPS, m[2])) return null;
  const at = ISSUE_URL_SHAPE.exec(m[4]);
  if (!at || at[2] !== m[3]) return null;
  return { action: Number(m[1]), op: m[2], number: Number(m[3]), url: m[4], repo: at[1] };
}

/**
 * The parsed rows a stroke may use: a row whose action index holds an action
 * of its op, and whose url names the repository that op lands the card on.
 * Anything else is `ignored`, with why — and so are BOTH rows of an action
 * two different rows name: a reader never picks between two answers. Pure.
 */
export function matchRunAnnotations(payload, parsed) {
  const actions = Array.isArray(payload?.actions) ? payload.actions : [];
  const ignored = [];
  const byAction = new Map();
  for (const row of Array.isArray(parsed) ? parsed : []) {
    const action = actions[row.action - 1];
    if (!action || action.op !== row.op) {
      ignored.push({ ...row, why: `the stroke's action ${row.action} is ${action ? action.op : 'absent'}, not ${row.op}` });
      continue;
    }
    const lands = String(ANNOTATED_OPS[row.op].lands(action, payload.repo) ?? '');
    if (lands.toLowerCase() !== row.repo.toLowerCase()) {
      ignored.push({ ...row, why: `its url names ${row.repo}, and ${row.op} lands the card on ${lands || 'no repository'}` });
      continue;
    }
    byAction.set(row.action, [...(byAction.get(row.action) ?? []), row]);
  }
  const rows = [];
  for (const [action, list] of byAction) {
    const distinct = new Set(list.map((r) => `${r.number} ${r.url}`));
    if (distinct.size > 1) ignored.push(...list.map((r) => ({ ...r, why: `${distinct.size} different annotations name action ${action}` })));
    else rows.push(list[0]);
  }
  rows.sort((a, b) => a.action - b.action);
  return { rows, ignored };
}

/** A job's check run id — from its `check_run_url`, else its own id (measured equal). Pure. */
export function checkRunIdOf(job) {
  const m = /\/check-runs\/([1-9][0-9]*)$/.exec(String(job?.check_run_url ?? ''));
  if (m) return Number(m[1]);
  return Number.isInteger(job?.id) && job.id > 0 ? job.id : null;
}

// ---------------------------------------------------------------------------
// Transport — the one POST, paced; the reads around it are not.
// ---------------------------------------------------------------------------

async function rest(api, path, { method = 'GET', body = null } = {}, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const token = deps.token ?? '';
  const paceDeps = deps.pace ?? {};
  const paced = isWriteMethod(method);
  if (paced) await paceWrite({ token, kind: `fleet-write dispatch ${method}` }, paceDeps);
  let res;
  try {
    res = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    if (paced) releaseWriteLease(paceDeps.file);
    return { status: 0, rateRemaining: null, json: null, detail: e?.message ?? 'fetch threw', call: `${method} ${path}` };
  }
  const rateRemaining = res.headers.get('x-ratelimit-remaining');
  let json = null;
  if (res.status !== 204) {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  }
  if (paced) {
    noteResponse(
      { token, status: res.status, headers: res.headers, body: json, verdict: classifyHttp({ status: res.status, rateRemaining: rateRemaining === null ? null : Number(rateRemaining), body: json }) },
      paceDeps,
    );
  }
  return { status: res.status, rateRemaining: rateRemaining === null ? null : Number(rateRemaining), json, detail: typeof json?.message === 'string' ? json.message : '', call: `${method} ${path}` };
}

/** Every page of a list endpoint (at most `maxPages`), or the first failing answer. Reads only — never paced. */
async function listAll(api, path, t, maxPages = 10) {
  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await rest(api, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, {}, t);
    if (r.status !== 200 || !Array.isArray(r.json)) return { ok: false, rows, failed: r };
    rows.push(...r.json);
    if (r.json.length < 100) break;
  }
  return { ok: true, rows };
}

/**
 * The relay annotations on a run's check runs — its jobs, then each job's
 * check-run annotations, every message through `parseRelayAnnotation` (the
 * rest of the check run's annotations are ignored). Returns `{ state, parsed,
 * why }`: `read`, or `unread` naming the call that did not answer, with
 * whatever was parsed before it. Reads only — never paced; never throws.
 */
export async function readRunAnnotations(runId, deps = {}) {
  const api = deps.api ?? DEFAULT_API;
  const t = { fetch: deps.fetch, token: deps.token };
  const said = (r) => `${r.call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}`;
  const jobs = await rest(api, `/repos/${RELAY_REPO}/actions/runs/${runId}/jobs?per_page=100`, {}, t);
  if (jobs.status !== 200 || !Array.isArray(jobs.json?.jobs)) return { state: 'unread', parsed: [], why: said(jobs) };
  const parsed = [];
  for (const job of jobs.json.jobs) {
    const id = checkRunIdOf(job);
    if (id === null) continue;
    const r = await rest(api, `/repos/${RELAY_REPO}/check-runs/${id}/annotations?per_page=100`, {}, t);
    if (r.status !== 200 || !Array.isArray(r.json)) return { state: 'unread', parsed, why: said(r) };
    for (const a of r.json) {
      const row = parseRelayAnnotation(a?.message);
      if (row) parsed.push(row);
    }
  }
  return { state: 'read', parsed, why: '' };
}

/**
 * The annotations a stroke's success run carries, matched to its actions and
 * said: one line per row, per ignored row, per annotated action no row names,
 * and one when the read did not answer. A stroke with no annotated op reads
 * nothing (`state: 'none'`). Returns `{ state, rows, ignored, why }`.
 */
async function runAnnotationsFor(payload, run, deps) {
  const annotated = payload.actions.map((a, i) => ({ action: i + 1, op: a.op })).filter((a) => Object.hasOwn(ANNOTATED_OPS, a.op));
  if (!annotated.length) return { state: 'none', rows: [], ignored: [], why: '' };
  const read = await readRunAnnotations(run.id, deps);
  const { rows, ignored } = matchRunAnnotations(payload, read.parsed);
  const log = deps.log;
  for (const r of rows) log(`fleet-write: run ${run.id}'s annotation names action ${r.action} ${r.op} → ${r.repo}#${r.number} ${r.url} (the platform's own answer).`);
  for (const r of ignored) log(`fleet-write: run ${run.id}'s annotation for action ${r.action} ${r.op} (#${r.number}) is ignored — ${r.why}.`);
  if (read.state === 'unread') log(`fleet-write: run ${run.id}'s annotations could not be read — ${read.why}; a number no annotation above names is read from the board instead.`);
  for (const a of annotated) {
    if (!rows.some((r) => r.action === a.action)) log(`fleet-write: no annotation on run ${run.id} names action ${a.action} ${a.op} — its number is read from the board instead (the fallback).`);
  }
  return { state: read.state, rows, ignored, why: read.why };
}

/**
 * Read back every body a completed stroke wrote and judge it against the bytes
 * sent. Returns `{ state, rows }` — `state` from `strokeReadBackState`. Never
 * throws on a status: a read that fails makes its row `unverified`, with the
 * call and status in `why`. `taken` keeps two actions of one stroke from being
 * judged against the same created object. `annotations` are the run's matched
 * rows (`matchRunAnnotations`): an `issue_create` one of them names is read
 * at that number, never listed. `sleep` and `log` serve the `issue_create`
 * re-list alone (`ISSUE_CREATE_RELIST_DELAYS_MS`), which only an
 * `issue_create` no annotation names takes.
 */
export async function readBackStroke(payload, { dispatchedAt, annotations = [] }, deps = {}) {
  const targets = readBackTargets(payload);
  if (!targets.length) return { state: 'none', rows: [] };
  const api = deps.api ?? DEFAULT_API;
  const t = { fetch: deps.fetch, token: deps.token };
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((line) => console.error(line));
  const judge = deps.judge ?? (await loadReadBackJudge());
  const since = dispatchedAt - READ_BACK_SLACK_MS;
  const sinceIso = encodeURIComponent(new Date(since).toISOString());
  const created = (row) => Date.parse(row?.created_at ?? '') >= since;
  const repo = payload.repo;
  const taken = new Set();
  const rows = [];
  const unread = (target, where, r) => ({ action: target.action, op: target.op, where, verdict: 'unverified', cls: 'unread', why: `${r.call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}` });
  for (const target of targets) {
    const judged = (where, stored) => ({ action: target.action, op: target.op, where, ...judgeStoredBody({ op: target.op, sent: target.sent, stored }, judge) });
    if (target.op === 'issue_patch' || target.op === 'comment_edit') {
      const path = target.op === 'issue_patch' ? `/repos/${repo}/issues/${target.issue}` : `/repos/${repo}/issues/comments/${target.comment_id}`;
      const where = target.op === 'issue_patch' ? `${repo}#${target.issue}` : `${repo} comment ${target.comment_id}`;
      const r = await rest(api, path, {}, t);
      rows.push(r.status === 200 && r.json ? judged(where, r.json.body) : unread(target, where, r));
      continue;
    }
    // An `issue_create` the run's annotation names is read AT that number — the platform's own answer to the create:
    // one GET, no list, no re-list (header). A read that fails is `unread`, as any addressed read is.
    const named = target.op === 'issue_create' ? annotations.find((a) => a.op === target.op && a.action === target.action) : undefined;
    if (named) {
      const where = `${repo}#${named.number}`;
      const r = await rest(api, `/repos/${repo}/issues/${named.number}`, {}, t);
      if (r.status === 200 && r.json) {
        if (r.json.id !== undefined) taken.add(r.json.id);
        rows.push({ ...judged(where, r.json.body), foundBy: 'annotation' });
      } else rows.push({ ...unread(target, where, r), foundBy: 'annotation' });
      continue;
    }
    if (target.op === 'issue_create' || target.op === 'pr_create') {
      const isPr = target.op === 'pr_create';
      const head = isPr ? (String(target.head).includes(':') ? String(target.head) : `${repo.split('/')[0]}:${target.head}`) : null;
      const path = isPr
        ? `/repos/${repo}/pulls?state=all&head=${encodeURIComponent(head)}&sort=created&direction=desc`
        : `/repos/${repo}/issues?state=all&sort=created&direction=desc&since=${sinceIso}`;
      const where = isPr ? `${repo} head ${head}` : `${repo} (new issue)`;
      const find = (listedRows) => listedRows.find((o) => created(o) && !taken.has(o.id) && (isPr ? true : !o.pull_request && String(o.title ?? '').trim() === String(target.title ?? '').trim()));
      let listed = await listAll(api, path, t, isPr ? 1 : 3);
      let hit = find(listed.rows);
      // `issue_create` alone: the list lags a create (header), so a list that ANSWERED without the title sent is re-read
      // on the bounded schedule before `unfound`. Reads only — ⛔ the create is never re-sent.
      const relists = isPr ? [] : ISSUE_CREATE_RELIST_DELAYS_MS;
      let waited = 0;
      for (let i = 0; i < relists.length && listed.ok && !hit; i++) {
        log(`fleet-write: read-back action ${target.action} ${target.op} ${where}: no issue created since the dispatch carries the title sent yet — re-list ${i + 1}/${relists.length} in ${relists[i]} ms (the issue list lags a create; ⛔ the create is not re-sent).`);
        await sleep(relists[i]);
        waited += relists[i];
        listed = await listAll(api, path, t, 3);
        hit = find(listed.rows);
        if (hit) log(`fleet-write: read-back action ${target.action} ${target.op}: ${repo}#${hit.number} found on re-list ${i + 1}, ${waited} ms after the first list.`);
      }
      if (!listed.ok && !hit) {
        rows.push(unread(target, where, listed.failed));
        continue;
      }
      if (!hit) {
        const tried = relists.length ? ` (listed ${relists.length + 1} times over ${waited} ms)` : '';
        rows.push({ action: target.action, op: target.op, where, verdict: 'unverified', cls: 'unfound', why: isPr ? `no pull request on ${head} was created since the dispatch` : `no issue created on ${repo} since the dispatch carries the title sent${tried}` });
        continue;
      }
      taken.add(hit.id);
      rows.push({ ...judged(`${repo}#${hit.number}`, hit.body), ...(isPr ? {} : { foundBy: 'list' }) });
      continue;
    }
    // `comment`: only the body finds a new comment, so a body that matches nothing is unverified, never not-stored.
    const where = `${repo}#${target.issue} (new comment)`;
    const listed = await listAll(api, `/repos/${repo}/issues/${target.issue}/comments?since=${sinceIso}`, t);
    const candidates = listed.rows.filter((c) => created(c) && !taken.has(c.id));
    const hit = [...candidates].reverse().find((c) => judgeStoredBody({ op: target.op, sent: target.sent, stored: c.body }, judge).verdict === 'landed');
    if (hit) {
      taken.add(hit.id);
      rows.push(judged(`${repo}#${target.issue} comment ${hit.id}`, hit.body));
      continue;
    }
    if (!listed.ok) {
      rows.push(unread(target, where, listed.failed));
      continue;
    }
    // One candidate is named with its first difference as a LEAD, never as a verdict: it may be someone else's comment.
    const lone = candidates.length === 1 ? judgeStoredBody({ op: target.op, sent: target.sent, stored: candidates[0].body }, judge) : null;
    const lead = lone && lone.verdict === 'not-stored' ? `; the one comment created since then (${candidates[0].id}) first differs at byte ${lone.offset}${lone.replacements > 0 ? ` and carries ${lone.replacements} extra U+FFFD` : ''}` : '';
    rows.push({ action: target.action, op: target.op, where, verdict: 'unverified', cls: 'unfound', why: `${candidates.length} comment(s) created on #${target.issue} since the dispatch, none holding the bytes sent${lead}` });
  }
  return { state: strokeReadBackState(rows), rows };
}

/**
 * Send one packed payload and wait for its run.
 *
 * Returns `{ state, ok, status, verdict, run, requestId, dispatchedAt, startMs, ceilingMs, detail, readBack }` where `state` is one of
 * `success` (the run succeeded and every body reads back as sent) · `failure` (the run completed otherwise, or — `notStored:
 * true` — it succeeded and the read-back measured a body the board does not hold as sent) · `unverified` (it succeeded and a
 * body could not be read back) · `no-run` · `timeout` · `refused` (the dispatch itself). `readBack` is `readBackStroke`'s
 * answer, present once the run succeeded, and so is `annotations` — `{ state, rows, ignored, why }`, the run's
 * annotations matched to the stroke (`state` `none` when it carries no annotated op). Never throws on an HTTP status.
 */
export async function sendFleetWrite(payload, deps = {}) {
  const api = deps.api ?? DEFAULT_API;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((line) => console.error(line));
  const { startMs, ceilingMs, pollMs, notes } = deps.ceilings ?? ceilingsFrom(deps.env ?? process.env);
  for (const note of notes ?? []) log(`fleet-write: ${note}`);
  const t = { fetch: deps.fetch, token: deps.token, pace: deps.pace };
  const requestId = payload.request_id;
  const base = { requestId, startMs, ceilingMs, run: null };

  const dispatchedAt = now();
  const sent = await rest(api, `/repos/${RELAY_REPO}/dispatches`, { method: 'POST', body: { event_type: RELAY_EVENT_TYPE, client_payload: payload } }, t);
  const verdict = classifyHttp({ status: sent.status, rateRemaining: sent.rateRemaining, body: sent.json });
  if (sent.status !== 204) {
    log(`fleet-write: ${sent.call} -> HTTP ${sent.status}${sent.detail ? ` (${sent.detail})` : ''} — the dispatch was NOT accepted (${verdict}); nothing ran.`);
    return { ...base, state: 'refused', ok: false, status: sent.status, verdict, dispatchedAt, detail: sent.detail };
  }
  log(`fleet-write: dispatched request ${requestId} to ${RELAY_REPO} (HTTP 204) — ${payload.actions.length} action(s) for ${payload.repo}; waiting for its run.`);

  // ── find the run ──────────────────────────────────────────────────────────
  const since = new Date(dispatchedAt - 60_000).toISOString();
  let run = null;
  let listFailure = null;
  while (run === null) {
    const list = await rest(api, `/repos/${RELAY_REPO}/actions/runs?event=repository_dispatch&per_page=20&created=%3E%3D${encodeURIComponent(since)}`, {}, t);
    if (list.status !== 200) {
      listFailure = list;
    } else {
      listFailure = null;
      const hit = (list.json?.workflow_runs ?? []).find((r) => runMatches(r, requestId));
      if (hit) run = { id: hit.id, url: hit.html_url ?? null, status: hit.status ?? null, conclusion: hit.conclusion ?? null };
    }
    if (run !== null) break;
    if (now() - dispatchedAt >= startMs) {
      if (listFailure) {
        log(`fleet-write: ${listFailure.call} -> HTTP ${listFailure.status}${listFailure.detail ? ` (${listFailure.detail})` : ''} — the run list could not be read, so the run cannot be found.`);
        return { ...base, state: 'no-run', ok: false, status: 204, verdict: 'ok', dispatchedAt, detail: `run list HTTP ${listFailure.status}`, listUnreadable: true };
      }
      return { ...base, state: 'no-run', ok: false, status: 204, verdict: 'ok', dispatchedAt, detail: 'no run appeared' };
    }
    await sleep(pollMs);
  }
  log(`fleet-write: run ${run.id} found (${run.status})${run.url ? ` ${run.url}` : ''}.`);

  // ── wait for it ───────────────────────────────────────────────────────────
  while (run.status !== 'completed') {
    if (now() - dispatchedAt >= ceilingMs) return { ...base, run, state: 'timeout', ok: false, status: 204, verdict: 'ok', dispatchedAt, detail: `run ${run.id} ${run.status}` };
    await sleep(pollMs);
    const one = await rest(api, `/repos/${RELAY_REPO}/actions/runs/${run.id}`, {}, t);
    if (one.status === 200 && one.json) run = { id: run.id, url: one.json.html_url ?? run.url, status: one.json.status ?? run.status, conclusion: one.json.conclusion ?? null };
  }
  const ok = run.conclusion === 'success';
  log(`fleet-write: run ${run.id} completed — conclusion ${run.conclusion}${run.url ? ` ${run.url}` : ''}.`);
  const done = { ...base, run, status: 204, verdict: 'ok', dispatchedAt };
  if (!ok) return { ...done, state: 'failure', ok: false, detail: `conclusion ${run.conclusion}` };

  // ── the run's annotations — the numbers it created or moved, where a seat CAN read them (header) ─────
  const annotations = await runAnnotationsFor(payload, run, { api, fetch: deps.fetch, token: deps.token, log });

  // ── read it back — the run's success is the executor's, not the write's ─────
  const readBack = await readBackStroke(payload, { dispatchedAt, annotations: annotations.rows }, { api, fetch: deps.fetch, token: deps.token, judge: deps.judge, sleep, log });
  for (const row of readBack.rows) log(readBackLine(row));
  if (readBack.state === 'not-stored') {
    const first = readBack.rows.find((r) => r.verdict === 'not-stored');
    return { ...done, state: 'failure', ok: false, notStored: true, readBack, annotations, detail: `conclusion success, but NOT STORED — action ${first.action} (${first.op} ${first.where}) first differs from the bytes sent at byte ${first.offset}` };
  }
  if (readBack.state === 'unverified') {
    const first = readBack.rows.find((r) => r.verdict === 'unverified');
    return { ...done, state: 'unverified', ok: false, readBack, annotations, detail: `conclusion success, but UNVERIFIED — action ${first.action} (${first.op}): ${first.why ?? first.cls}` };
  }
  return { ...done, state: 'success', ok: true, readBack, annotations, detail: `conclusion ${run.conclusion}` };
}

/** The exit a tool takes from a result that is not `success`. */
export function exitForResult(result) {
  if (result.state === 'refused') return result.verdict === 'prerequisite' || result.verdict === 'ratelimit' ? EXIT_PREREQUISITE : EXIT_PLATFORM_REFUSAL;
  if (result.state === 'failure') return result.notStored ? EXIT_NOT_STORED : EXIT_PLATFORM_REFUSAL;
  if (result.state === 'no-run' || result.state === 'timeout' || result.state === 'unverified') return EXIT_UNCONFIRMED;
  return EXIT_OK;
}

/**
 * The route a tool takes for THIS write, resolved once: the transport, the
 * session the envelope needs, and the refusal an explicit `dispatch` gets
 * when its prerequisites fail. Async only for condition ③, which is read
 * once per process and only when the cheaper conditions already hold. Every
 * tool prints `reason` — the choice is never silent.
 */
export async function resolveRoute(env = process.env, deps = {}) {
  const first = selectTransport(env);
  if (first.error) return { ...first, session: null, sessionSource: null };
  if (first.requested === 'direct') return { ...first, session: null, sessionSource: null };
  // auto with ① or ② already failed: direct, said, and condition ③ is never read.
  if (first.requested === 'auto' && first.failed !== 'relay') return { ...first, session: null, sessionSource: null };
  const src = sessionSource(env);
  const session = src.session;
  if (first.requested === 'dispatch') {
    if (!session) {
      return {
        ...first,
        session: null,
        sessionSource: src.source,
        error: `${TRANSPORT_ENV}=dispatch needs this seat's own session_… id on the envelope, and there is none: ${src.reason}. A cloud seat's session is read from the container's ${CONTAINER_SESSION_ENV}; ${SESSION_ENV}=session_… overrides it (a local checkout, a test). ⛔ Not falling back to direct: that would change the identity the write is booked against.`,
      };
    }
    const relay = await relayLive({ ...deps, env });
    if (!relay.live) {
      return {
        ...first,
        session,
        sessionSource: src.source,
        error: `${TRANSPORT_ENV}=dispatch but ${relay.reason}. ⛔ Not falling back to direct: the operator asked for the relay${relay.definite ? `; use ${TRANSPORT_ENV}=auto to let a relay that is definitely gone or disabled fall back, or bring the relay back first (land the workflow, or re-enable it in the Actions UI)` : ' — and an indeterminate reading is not evidence the relay is gone; re-run once the read answers, or fix the route it failed on'}.`,
      };
    }
    return { ...first, session, sessionSource: src.source, reason: `${first.reason} — ${src.reason} — ${relay.reason}` };
  }
  // auto: ① and ② held (selectTransport would have answered direct otherwise), so ③ is read now. A definite
  // not-live reading is direct with its line; an INDETERMINATE one is a refusal the selector spells (fail closed).
  const relay = await relayLive({ ...deps, env });
  const sel = selectTransport(env, { relay });
  return { ...sel, session: sel.transport === 'dispatch' || sel.error ? session : null, sessionSource: sel.transport === 'dispatch' || sel.error ? src.source : null };
}

// ---------------------------------------------------------------------------
// Self-test — offline: a fake platform with a fake Actions run list, an
// injected clock, an injected throttle, no network.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the selector: OS_FLEET_TRANSPORT wins; auto is dispatch only under all three conditions and direct otherwise': 8,
  'the session: OS_FLEET_SESSION first, else derived from the container (cse_<id> → session_<id>), the reason naming the source; refused in dispatch mode when absent, never invented': 14,
  'the three conditions of auto: cloud, session and a live relay — each alone failing is direct with its line, all three is dispatch, explicit dispatch stays strict': 16,
  "condition ③'s second half — the workflow's Actions state: active is live; disabled_manually is the one other DEFINITE signal (direct with the line); any other state, a missing state, another status or no answer is indeterminate and refuses; read once after the file, cached; explicit dispatch refuses": 11,
  'fail closed: an indeterminate liveness read — 401, 403, 5xx, a malformed answer, no answer, or a read this process must not make — refuses naming the status, under auto and explicit dispatch alike; only 404 and disabled_manually turn a seat direct': 10,
  'the packer: one payload per stroke, a fresh request id under the cap, judged by the shared validator': 6,
  'the dispatch: one paced POST to the board repo with event_type and client_payload; 204 is acceptance, anything else a refusal': 7,
  'the run-poller: the run named after the request id, its completion, its conclusion': 6,
  'the ceilings: no run in the start window, no completion in the ceiling — UNCONFIRMED, never retried': 7,
  'the read-back targets: every op the table lets carry a body — derived, each with a locator — and no other op is read back': 6,
  "the verdict: post-stamped's own classifier, imported — declared normalisations land, a split, lost or truncated byte is NOT STORED at its first differing byte, an unreadable body is unverified, the PR-create footer forgiven on pr_create alone": 13,
  "the round trip: the card's 41,699 bytes with a multi-byte character across every 16 KiB boundary of every stream, byte for byte through pack, the wire, the runner's env text, the validator and the executor; a per-chunk decode is NOT STORED": 8,
  'the read-back end to end: after a success run each body at its locator — a corrupted read-back exits 4 through the CLI, an unreadable or unfound one 6, a body-less stroke reads nothing, never a retry': 17,
  'the issue_create re-list: a list that lags the create reads back IDENTICAL on a bounded re-list; a real miss is still unfound (exit 6) after exactly the declared window; an unreadable re-list is unread; the create is never re-sent': 13,
  "the run's annotations: after a success run carrying an op that creates or moves a card its check-run annotations are read first — an issue_create they name read back AT that number with NO re-list; absent, unreadable, ignored or past the cap, the re-list as before; a stroke with no such op reads none": 14,
  'the wiring: the POST is paced and on the roster, the reads are not, the token never reaches the log': 5,
  'the CLI: a dry run sends nothing, usage, the exit ladder, the session derived from the container, a route read behind a dead proxy refuses': 11,
  'the no-run conformance: every sender — discovered from the source — answers an accepted dispatch with no run, or none completed, UNCONFIRMED (6) after ONE dispatch with ZERO direct writes, under auto and explicit dispatch alike; under direct its write is seen': 27,
});
const SELF_TEST_BATTERY_FLOOR = 18;
const UNATTRIBUTED_BATTERY = '(unattributed)';

const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

export async function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true, detail) => {
    const bucket = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(bucket, (batteryCases.get(bucket) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `${detail ? `${detail} — ` : ''}got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const { mkdtempSync, rmSync, existsSync, readFileSync: readReal, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const TOKEN = 'ghs_FixtureTokenNotRealAtAll0000000000000';
  const SESSION = 'session_01ABCDEFGHJKMNPQRSTVWXYZ';
  const ACTIONS = [{ op: 'comment', issue: 19701, body: 'Hello from the relay.' }];
  // The read-back's judge, loaded the way the live path loads it — so this self-test, run from this file's own entry,
  // is also the proof that the entry settles before the import back into it (the header's no-top-level-await note).
  const JUDGE = await loadReadBackJudge();
  const { PLATFORM_COMMENT_FOOTER, classifyReadBack: POST_STAMPED_CLASSIFIER } = await import('../post-stamped.mjs');

  // ── the selector ────────────────────────────────────────────────────────
  battery('the selector: OS_FLEET_TRANSPORT wins; auto is dispatch only under all three conditions and direct otherwise');
  {
    const LIVE = { live: true, reason: 'the relay workflow is on the board (fixture)' };
    t('no variables at all is auto → direct, naming the cloud condition', [selectTransport({}).requested, selectTransport({}).transport, selectTransport({}).failed], ['auto', 'direct', 'cloud']);
    t('the cloud discriminator alone is still direct — the session condition failed, and the line says how to opt in', [selectTransport({ [CLOUD_DISCRIMINATOR]: '1' }).transport, selectTransport({ [CLOUD_DISCRIMINATOR]: '1' }).failed, selectTransport({ [CLOUD_DISCRIMINATOR]: '1' }).reason.includes(SESSION_ENV)], ['direct', 'session', true]);
    t('all three conditions make auto → dispatch, and the reason names the variable and the proxy', [selectTransport({ [CLOUD_DISCRIMINATOR]: '1', [SESSION_ENV]: SESSION }, { relay: LIVE }).transport, selectTransport({ [CLOUD_DISCRIMINATOR]: '1', [SESSION_ENV]: SESSION }, { relay: LIVE }).reason.includes(CLOUD_DISCRIMINATOR) && selectTransport({ [CLOUD_DISCRIMINATOR]: '1', [SESSION_ENV]: SESSION }, { relay: LIVE }).reason.includes('Authorization')], ['dispatch', true]);
    t('the discriminator must be exactly 1 — an empty value is not a cloud container', selectTransport({ [CLOUD_DISCRIMINATOR]: '' }).transport, 'direct');
    t('an explicit direct wins over the discriminator', selectTransport({ [TRANSPORT_ENV]: 'direct', [CLOUD_DISCRIMINATOR]: '1' }).transport, 'direct');
    t('an explicit dispatch wins outside a cloud container', selectTransport({ [TRANSPORT_ENV]: 'dispatch' }).transport, 'dispatch');
    t('an unknown value is refused, never guessed', [selectTransport({ [TRANSPORT_ENV]: 'relay' }).transport, typeof selectTransport({ [TRANSPORT_ENV]: 'relay' }).error], [null, 'string']);
    t('⛔ the proxy port is not what the selector reads — its source names no proxy variable or port', /HTTPS_PROXY|https_proxy|34111|_PORT|proxy port/.test(selectTransport.toString()), false);
  }

  // ── the session ─────────────────────────────────────────────────────────
  battery('the session: OS_FLEET_SESSION first, else derived from the container (cse_<id> → session_<id>), the reason naming the source; refused in dispatch mode when absent, never invented');
  {
    const CONTAINER = 'cse_01ABCDEFGHJKMNPQRSTVWXYZ';
    const OTHER = 'session_01ZZZZZZZZZZZZZZZZZZZZZZZZ';
    t('a well-formed session id is read', sessionFrom({ [SESSION_ENV]: SESSION }), SESSION);
    t('a UUID is not a session id', sessionFrom({ [SESSION_ENV]: 'd589e4b7-cc75-54c6-a119-874fab8f21f8' }), null);
    const derived = sessionSource({ [CONTAINER_SESSION_ENV]: CONTAINER });
    t(`${SESSION_ENV} absent: the session is DERIVED from the container's ${CONTAINER_SESSION_ENV} — cse_<id> → session_<id>`, [derived.session, derived.source], [SESSION, CONTAINER_SESSION_ENV]);
    t('…and the reason names the source that was read', derived.reason.includes(CONTAINER_SESSION_ENV) && derived.reason.includes('derived'));
    const explicit = sessionSource({ [SESSION_ENV]: OTHER, [CONTAINER_SESSION_ENV]: CONTAINER });
    t('explicit wins: with both set, OS_FLEET_SESSION is the session and the reason says it overrides the container', [explicit.session, explicit.source, explicit.reason.includes('overrides')], [OTHER, SESSION_ENV, true]);
    const badExplicit = sessionSource({ [SESSION_ENV]: 'not-a-session', [CONTAINER_SESSION_ENV]: CONTAINER });
    t('⛔ an explicit value that is malformed is refused, NEVER replaced by the container\'s (validation unchanged)', [badExplicit.session, badExplicit.source, badExplicit.reason.includes('malformed')], [null, SESSION_ENV, true]);
    t('a malformed container value (a UUID, no cse_ prefix) derives nothing', sessionFrom({ [CONTAINER_SESSION_ENV]: 'd589e4b7-cc75-54c6-a119-874fab8f21f8' }), null);
    t('…nor does a tail shorter than six characters, nor a session_-spelled container value', [sessionFrom({ [CONTAINER_SESSION_ENV]: 'cse_abc' }), sessionFrom({ [CONTAINER_SESSION_ENV]: SESSION })], [null, null]);
    const none = sessionSource({});
    t('both absent: null, no source, and the reason names both variables', [none.session, none.source, none.reason.includes(SESSION_ENV) && none.reason.includes(CONTAINER_SESSION_ENV)], [null, null, true]);
    t('a blank OS_FLEET_SESSION counts as absent, so the container is read', sessionFrom({ [SESSION_ENV]: '  ', [CONTAINER_SESSION_ENV]: CONTAINER }), SESSION);
    const missing = await resolveRoute({ [TRANSPORT_ENV]: 'dispatch' });
    t('dispatch mode without a session is a refusal naming both variables and saying it will NOT fall back', [missing.transport, missing.error?.includes(SESSION_ENV) && missing.error?.includes(CONTAINER_SESSION_ENV), missing.error?.includes('Not falling back')], ['dispatch', true, true]);
    const derivedStrict = await resolveRoute({ [TRANSPORT_ENV]: 'dispatch', [CONTAINER_SESSION_ENV]: CONTAINER, [RELAY_LIVE_OVERRIDE_ENV]: '1' });
    t('dispatch mode with only the container variable carries the DERIVED session on the route, its source named', [derivedStrict.transport, derivedStrict.session, derivedStrict.sessionSource, derivedStrict.error], ['dispatch', SESSION, CONTAINER_SESSION_ENV, null]);
    const plain = await resolveRoute({});
    t('direct mode needs no session and carries no error', [plain.transport, plain.error, plain.session], ['direct', null, null]);
    t('⛔ no documented spelling prefixes a write with the variable: the usage text says never-as-a-prefix and names the container source', USAGE.includes('Never as a prefix') && USAGE.includes(CONTAINER_SESSION_ENV));
  }

  // ── the three conditions of auto ────────────────────────────────────────
  battery('the three conditions of auto: cloud, session and a live relay — each alone failing is direct with its line, all three is dispatch, explicit dispatch stays strict');
  {
    const CONTENTS = `GET /repos/${RELAY_REPO}/contents/${RELAY_WORKFLOW_PATH}`;
    const WORKFLOW = `GET /repos/${RELAY_REPO}/actions/workflows/${RELAY_WORKFLOW_FILE}`;
    /**
     * A fake board answering BOTH halves of condition ③: `contents` is the file
     * GET's status (or `{ throws }`), `workflow` the state GET's `{ status, json }`
     * (or `{ throws }`). A bare number is the file's status with an active workflow.
     */
    const ACTIVE = { status: 200, json: { id: 364389970, name: 'Fleet Write', state: 'active' } };
    const board = (spec, seen) => async (url, init) => {
      const u = new URL(url);
      const call = `${init?.method ?? 'GET'} ${u.pathname}`;
      seen.push({ call, ref: u.searchParams.get('ref'), auth: init?.headers?.authorization ?? '' });
      const s = typeof spec === 'number' ? { contents: spec } : spec;
      if (call === WORKFLOW) {
        const wf = s.workflow ?? ACTIVE;
        if (wf.throws) throw new Error(wf.throws);
        return { status: wf.status, headers: new Headers(), json: async () => wf.json ?? {} };
      }
      if (s.throws) throw new Error(s.throws);
      return { status: s.contents ?? 200, headers: new Headers(), json: async () => ({}) };
    };
    const route = async (env, spec = 200, throws = null) => {
      resetRelayLiveCache();
      const seen = [];
      const r = await resolveRoute(env, { fetch: board(throws ? { contents: spec, throws } : spec, seen), token: 'ghs_FixtureTokenNotRealAtAll0000000000000' });
      return { ...r, seen };
    };
    const CLOUD = { [CLOUD_DISCRIMINATOR]: '1' };
    const OPTED = { ...CLOUD, [SESSION_ENV]: SESSION };
    const noCloud = await route({ [SESSION_ENV]: SESSION });
    t('① missing (not a cloud container): direct, its line, and the relay is NOT read', [noCloud.transport, noCloud.failed, noCloud.seen.length], ['direct', 'cloud', 0]);
    const noSession = await route(CLOUD);
    t('② missing (no session from either source in a cloud container): direct, its line names both variables, and the relay is NOT read', [noSession.transport, noSession.failed, noSession.reason.includes(SESSION_ENV) && noSession.reason.includes(CONTAINER_SESSION_ENV), noSession.seen.length], ['direct', 'session', true, 0]);
    const dead = await route(OPTED, 404);
    t('③ failing (the relay workflow answers 404 on main): direct, its line names the workflow and the 404, ONE read, ⛔ no 90 s wait on this path', [dead.transport, dead.failed, dead.reason.includes(RELAY_WORKFLOW_PATH) && dead.reason.includes('404'), dead.seen.length], ['direct', 'relay', true, 1]);
    t('…the read is the contents endpoint on the board at ref=main, with the token', [dead.seen[0].call, dead.seen[0].ref, dead.seen[0].auth.startsWith('Bearer ')], [CONTENTS, 'main', true]);
    const live = await route(OPTED, 200);
    t('all three: dispatch, with the session on the route and the reason naming every condition', [live.transport, live.session, live.reason.includes(CLOUD_DISCRIMINATOR) && live.reason.includes(SESSION_ENV) && live.reason.includes('200')], ['dispatch', SESSION, true]);
    t('…after TWO reads — the file, then its Actions state — and the reason names the state', [live.seen.map((s) => s.call), live.reason.includes('active')], [[CONTENTS, WORKFLOW], true]);
    const derivedLive = await route({ ...CLOUD, [CONTAINER_SESSION_ENV]: 'cse_01ABCDEFGHJKMNPQRSTVWXYZ' }, 200);
    t('② from the CONTAINER alone (no OS_FLEET_SESSION): dispatch, the derived session on the route, the reason naming the container variable', [derivedLive.transport, derivedLive.session, derivedLive.sessionSource, derivedLive.reason.includes(CONTAINER_SESSION_ENV)], ['dispatch', SESSION, CONTAINER_SESSION_ENV, true]);
    const odd = await route(OPTED, 500);
    t('⛔ any other answer on the file (HTTP 500) is INDETERMINATE: a REFUSAL (exit-3 shaped, transport null), never direct, the error naming the status', [odd.transport, odd.failed, typeof odd.error, odd.error?.includes('HTTP 500') && odd.error?.includes('INDETERMINATE')], [null, 'relay', 'string', true]);
    const down = await route(OPTED, 200, 'ECONNRESET');
    t('no answer at all is INDETERMINATE too: a refusal naming no answer, never a throw, never direct', [down.transport, down.failed, down.error?.includes('no answer')], [null, 'relay', true]);
    // The cache: two routes in one process, one read of each half.
    resetRelayLiveCache();
    const seenOnce = [];
    const deps = { fetch: board(200, seenOnce), token: 'x' };
    const a = await resolveRoute(OPTED, deps);
    const b = await resolveRoute(OPTED, deps);
    t('condition ③ is read ONCE per process (both halves) and cached for the next route', [a.transport, b.transport, seenOnce.map((s) => s.call)], ['dispatch', 'dispatch', [CONTENTS, WORKFLOW]]);
    const strictNoSession = await route({ [TRANSPORT_ENV]: 'dispatch' }, 200);
    t('explicit dispatch without a session is exit-3 shaped (error), never direct, and the relay is not even read', [strictNoSession.transport, typeof strictNoSession.error, strictNoSession.seen.length], ['dispatch', 'string', 0]);
    const strictDead = await route({ [TRANSPORT_ENV]: 'dispatch', [SESSION_ENV]: SESSION }, 404);
    t('explicit dispatch with a dead relay is an error naming the relay and saying it will NOT fall back', [strictDead.transport, strictDead.error?.includes('NOT live') && strictDead.error?.includes('Not falling back')], ['dispatch', true]);
    const strictLive = await route({ [TRANSPORT_ENV]: 'dispatch', [SESSION_ENV]: SESSION }, 200);
    t('explicit dispatch with a session and a live relay is dispatch, outside any cloud container', [strictLive.transport, strictLive.error, strictLive.session], ['dispatch', null, SESSION]);
    const explicitDirect = await route({ ...OPTED, [TRANSPORT_ENV]: 'direct' }, 200);
    t('explicit direct never reads the relay', [explicitDirect.transport, explicitDirect.seen.length], ['direct', 0]);
    const overrideLive = await route({ ...OPTED, [RELAY_LIVE_OVERRIDE_ENV]: '1' }, 404);
    t(`${RELAY_LIVE_OVERRIDE_ENV}=1 (tests only) stands in for the read and is named in the reason`, [overrideLive.transport, overrideLive.seen.length, overrideLive.reason.includes(RELAY_LIVE_OVERRIDE_ENV)], ['dispatch', 0, true]);
    const overrideDead = await route({ ...OPTED, [RELAY_LIVE_OVERRIDE_ENV]: '0' }, 200);
    t(`…and ${RELAY_LIVE_OVERRIDE_ENV}=0 makes it direct without a read`, [overrideDead.transport, overrideDead.failed, overrideDead.seen.length], ['direct', 'relay', 0]);
    resetRelayLiveCache();

    // ── condition ③'s second half: the workflow's Actions state ─────────────
    battery("condition ③'s second half — the workflow's Actions state: active is live; disabled_manually is the one other DEFINITE signal (direct with the line); any other state, a missing state, another status or no answer is indeterminate and refuses; read once after the file, cached; explicit dispatch refuses");
    {
      const withState = (state) => ({ contents: 200, workflow: { status: 200, json: { id: 364389970, name: 'Fleet Write', state } } });
      const active = await route(OPTED, withState('active'));
      t('state active (the seat\'s own measured reading: 200, {"id":364389970,"state":"active"}): LIVE — dispatch', [active.transport, active.failed], ['dispatch', null]);
      t('…the state read is the Actions workflows endpoint keyed by the FILE NAME, with the token, and it is the SECOND read', [active.seen[1]?.call, active.seen[1]?.auth.startsWith('Bearer '), active.seen.length], [WORKFLOW, true, 2]);
      const killed = await route(OPTED, withState('disabled_manually'));
      t('⭐ state disabled_manually (the maintainer\'s kill switch): NOT live — direct, the line naming the state VERBATIM and the switch', [killed.transport, killed.failed, killed.reason.includes('disabled_manually'), killed.reason.includes('kill switch')], ['direct', 'relay', true, true]);
      t('…and it names the file as present: the file is on main, the workflow is what is off', killed.reason.includes('is on') && killed.reason.includes('NOT live'));
      const inactive = await route(OPTED, withState('disabled_inactivity'));
      t('⛔ any other state (disabled_inactivity) is INDETERMINATE — not the kill switch, not active: a refusal naming the state verbatim, never direct', [inactive.transport, inactive.failed, inactive.error?.includes('disabled_inactivity')], [null, 'relay', true]);
      const noState = await route(OPTED, { contents: 200, workflow: { status: 200, json: { id: 1 } } });
      t('a 200 that carries no state is NOT read as active nor as absent: a refusal saying the state is unknown', [noState.transport, noState.failed, noState.error?.includes('unknown')], [null, 'relay', true]);
      const gone = await route(OPTED, { contents: 200, workflow: { status: 404, json: { message: 'Not Found' } } });
      t('the state GET answering 404 (the file exists, so this 404 is not "no relay"): a refusal naming the endpoint and the 404', [gone.transport, gone.failed, gone.error?.includes('404') && gone.error?.includes('actions/workflows')], [null, 'relay', true]);
      const broken = await route(OPTED, { contents: 200, workflow: { status: 500, json: {} } });
      t('the state GET answering 500: a refusal saying HTTP 500', [broken.transport, broken.failed, broken.error?.includes('HTTP 500')], [null, 'relay', true]);
      const silent = await route(OPTED, { contents: 200, workflow: { throws: 'ECONNRESET' } });
      t('the state GET getting no answer: a refusal saying no answer, never a throw', [silent.transport, silent.failed, silent.error?.includes('no answer')], [null, 'relay', true]);
      // Cached once per process, whatever it answered — a disabled reading is not re-read on the next route either.
      resetRelayLiveCache();
      const seenKilled = [];
      const depsKilled = { fetch: board(withState('disabled_manually'), seenKilled), token: 'x' };
      const k1 = await resolveRoute(OPTED, depsKilled);
      const k2 = await resolveRoute(OPTED, depsKilled);
      t('the state reading is cached with the file reading: two routes, one read of each, both direct', [k1.transport, k2.transport, seenKilled.map((s) => s.call)], ['direct', 'direct', [CONTENTS, WORKFLOW]]);
      const strictKilled = await route({ [TRANSPORT_ENV]: 'dispatch', [SESSION_ENV]: SESSION }, withState('disabled_manually'));
      t('⛔ explicit dispatch with a disabled workflow is a PREREQUISITE refusal (exit-3 shaped) naming the state, never a silent fall-back', [strictKilled.transport, typeof strictKilled.error, strictKilled.error?.includes('disabled_manually') && strictKilled.error?.includes('Not falling back')], ['dispatch', 'string', true]);
      resetRelayLiveCache();

      // ── fail closed ─────────────────────────────────────────────────────────
      battery('fail closed: an indeterminate liveness read — 401, 403, 5xx, a malformed answer, no answer, or a read this process must not make — refuses naming the status, under auto and explicit dispatch alike; only 404 and disabled_manually turn a seat direct');
      {
        const unauth = await route(OPTED, 401);
        t("⭐ the file GET answering 401 (an unproxied read's signature) under auto is a REFUSAL naming HTTP 401 — never direct, never silent", [unauth.transport, unauth.failed, unauth.error?.includes('HTTP 401'), unauth.reason.includes('REFUSED')], [null, 'relay', true, true]);
        const forbidden = await route(OPTED, 403);
        t('403 likewise, and the error says why no fall-back: an indeterminate reading is not evidence the relay is gone', [forbidden.transport, forbidden.error?.includes('HTTP 403') && forbidden.error?.includes('not evidence')], [null, true]);
        const strict401 = await route({ [TRANSPORT_ENV]: 'dispatch', [SESSION_ENV]: SESSION }, 401);
        t('explicit dispatch on a 401: a refusal naming the status, saying the reading is indeterminate, transport kept at dispatch', [strict401.transport, strict401.error?.includes('HTTP 401') && strict401.error?.includes('not evidence')], ['dispatch', true]);
        const strict500 = await route({ [TRANSPORT_ENV]: 'dispatch', [SESSION_ENV]: SESSION }, { contents: 200, workflow: { status: 500, json: {} } });
        t('explicit dispatch on a 500 from the state read: a refusal naming HTTP 500', strict500.error?.includes('HTTP 500'));
        t('the two DEFINITE signals still turn auto direct — the file 404 and disabled_manually — and nothing else does', [(await route(OPTED, 404)).transport, (await route(OPTED, withState('disabled_manually'))).transport], ['direct', 'direct']);
        t('…while 200 + active is dispatch', (await route(OPTED, withState('active'))).transport, 'dispatch');
        t('a refusal under auto still carries the session it would have put on the envelope, so a tool can say who was refused', unauth.session, SESSION);
        // The read never leaves an unrouted process — and a reading it did not take is not cached.
        resetRelayLiveCache();
        let fetched = 0;
        const PROXIED = { ...OPTED, HTTPS_PROXY: 'http://127.0.0.1:9' };
        const unrouted = await relayLive({
          env: PROXIED,
          execArgv: [],
          token: 'x',
          fetch: async () => {
            fetched += 1;
            throw new Error('the read left an unrouted process');
          },
        });
        t(`⛔ with HTTPS_PROXY set and no ${PROXY_FLAG} on this process, relayLive makes NO request: indeterminate, source unrouted, the reason naming the flag`, [fetched, unrouted.live, unrouted.definite, unrouted.source, unrouted.reason.includes(PROXY_FLAG)], [0, false, false, 'unrouted', true]);
        t('…and the selector turns that reading into a refusal, not direct', [selectTransport(OPTED, { relay: unrouted }).transport, typeof selectTransport(OPTED, { relay: unrouted }).error], [null, 'string']);
        const routedSeen = [];
        const routed = await relayLive({ env: PROXIED, execArgv: [PROXY_FLAG], fetch: board(200, routedSeen), token: 'x' });
        t(`the same process carrying ${PROXY_FLAG} reads normally — two GETs, live — which also proves the unrouted reading was NOT cached`, [routed.live, routed.source, routedSeen.map((s) => s.call)], [true, 'read', [CONTENTS, WORKFLOW]]);
        resetRelayLiveCache();
      }
    }
  }

  // ── the packer ──────────────────────────────────────────────────────────
  battery('the packer: one payload per stroke, a fresh request id under the cap, judged by the shared validator');
  {
    const NOW = Date.UTC(2026, 8, 22, 9, 4, 0);
    const id = newRequestId(NOW, () => 'abc123');
    t('the request id carries the UTC instant and a random tail', id, 'fw-20260922T090400Z-abc123');
    t('…and is under the cap', id.length <= MAX_REQUEST_ID_CHARS);
    const packed = packRequest({ repo: 'objectstack-ai/objectstack', session: SESSION, actions: ACTIONS, now: () => NOW });
    t('a stroke packs to a valid payload with the four keys', [packed.ok, Object.keys(packed.payload)], [true, ['request_id', 'repo', 'session', 'actions']]);
    t('a given request id is kept', packRequest({ repo: 'objectstack-ai/objectstack', session: SESSION, actions: ACTIONS, requestId: 'given-1' }).payload.request_id, 'given-1');
    const bad = packRequest({ repo: 'someone/else', session: SESSION, actions: [{ op: 'merge' }] });
    t('a bad stroke is refused by the SHARED validator with every reason', [bad.ok, bad.errors.length >= 2], [false, true]);
    t('…and nothing here restates a rule: the refusal comes from validate.mjs', bad.errors.some((e) => e.includes('objectstack-ai/<name>')));
  }

  const dir = mkdtempSync(join(tmpdir(), 'fleet-write-dispatch-'));
  try {
    let paceCase = 0;
    const paceFor = (file) => ({
      file,
      env: { OS_PM_WRITE_MIN_GAP_MS: '0' },
      log: () => {},
      exit: (code) => {
        throw Object.assign(new Error(`throttle refused with exit ${code}`), { throttleExit: code });
      },
    });
    const paceFile = join(dir, 'pace-shared.jsonl');
    const payload = packRequest({ repo: 'objectstack-ai/objectstack', session: SESSION, actions: ACTIONS, requestId: 'fw-test-1' }).payload;
    const DISPATCH = `POST /repos/${RELAY_REPO}/dispatches`;
    const RUNS = `GET /repos/${RELAY_REPO}/actions/runs`;
    /**
     * A fake platform whose run list is a SCRIPT over the clock: `runs` is a
     * function of the elapsed ms since the dispatch, so appearance latency and
     * completion are modelled as time, not as call counts.
     */
    /**
     * The BOARD the read-back reads: `store` maps a read call (`GET <path>`) to
     * `{ status, json }`, or to a function of the parsed query and the elapsed
     * ms since the dispatch — so a list that lags a create is time too. The default
     * holds the one comment the default stroke writes, created just after the
     * dispatch and stored as sent — so a stroke that succeeds reads back clean.
     */
    const T0 = Date.UTC(2026, 8, 22, 9, 4, 0);
    const at = (ms) => new Date(T0 + ms).toISOString();
    const DEFAULT_STORE = { [`GET /repos/objectstack-ai/objectstack/issues/19701/comments`]: { status: 200, json: [{ id: 501, created_at: at(8_000), body: ACTIONS[0].body }] } };
    /**
     * The run's one job and its check run's annotations: by default the job answers and its check run carries only the
     * runner's own notice (measured on a live relay run) — no relay annotation, so every stroke below that does not
     * script `notes` takes the fallback, as a run of a relay older than the emission does.
     */
    const JOB = { id: 4200, name: 'Fleet write relay', check_run_url: `https://api.github.test/repos/${RELAY_REPO}/check-runs/4200` };
    const RUNNER_NOTICE = { path: '.github', annotation_level: 'notice', title: '', message: '"The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026."' };
    const platform = ({ dispatch = { status: 204 }, runs = () => [], one = () => null, store = DEFAULT_STORE, jobs = () => ({ status: 200, json: { total_count: 1, jobs: [JOB] } }), notes = () => ({ status: 200, json: [RUNNER_NOTICE] }) }, seen, clock) => async (url, init) => {
      const u = new URL(url);
      const call = `${init?.method ?? 'GET'} ${u.pathname}`;
      seen.push({ call, query: u.search, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization ?? '' });
      const headers = new Headers({ 'x-ratelimit-remaining': '4999' });
      if (call === DISPATCH) {
        if (dispatch.throws) throw new Error(dispatch.throws);
        return { status: dispatch.status, headers: new Headers({ 'x-ratelimit-remaining': dispatch.rateRemaining ?? '4999' }), json: async () => dispatch.json ?? null };
      }
      if (call === RUNS) {
        const r = runs(clock.elapsed());
        if (r === 'down') return { status: 503, headers, json: async () => ({ message: 'down' }) };
        return { status: 200, headers, json: async () => ({ total_count: r.length, workflow_runs: r }) };
      }
      const jm = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname);
      if (jm) {
        const a = jobs(Number(jm[1]));
        return { status: a.status, headers, json: async () => a.json };
      }
      const am = /\/check-runs\/(\d+)\/annotations$/.exec(u.pathname);
      if (am) {
        const a = notes(Number(am[1]));
        return { status: a.status, headers, json: async () => a.json };
      }
      const m = /\/actions\/runs\/(\d+)$/.exec(u.pathname);
      if (m) {
        const r = one(Number(m[1]), clock.elapsed());
        return r ? { status: 200, headers, json: async () => r } : { status: 404, headers, json: async () => ({ message: 'Not Found' }) };
      }
      if (call in store) {
        const s = typeof store[call] === 'function' ? store[call](u.searchParams, clock.elapsed()) : store[call];
        // A list answers its rows on page 1 and nothing after, as the platform's pagination does.
        const page = Number(u.searchParams.get('page') ?? '1');
        const json = Array.isArray(s.json) && page > 1 ? [] : s.json;
        return { status: s.status, headers, json: async () => json };
      }
      return { status: 404, headers, json: async () => ({ message: 'Not Found' }) };
    };
    const drive = async (script, { file, ceilings, stroke = payload } = {}) => {
      const seen = [];
      const logs = [];
      let nowMs = T0;
      const t0 = nowMs;
      const clock = { now: () => nowMs, elapsed: () => nowMs - t0 };
      const pace = paceFor(file ?? join(dir, `pace-${paceCase++}.jsonl`));
      try {
        const r = await sendFleetWrite(stroke, {
          fetch: platform(script, seen, clock),
          token: TOKEN,
          pace,
          now: clock.now,
          sleep: async (ms) => {
            nowMs += ms;
          },
          log: (l) => logs.push(l),
          ceilings: ceilings ?? { startMs: 90_000, ceilingMs: 300_000, pollMs: 5_000, notes: [] },
        });
        return { ...r, seen, logs, pace };
      } catch (e) {
        if (e?.throttleExit === undefined) throw e;
        return { state: 'throttled', ok: false, exitCode: e.throttleExit, seen, logs, pace, throttled: true };
      }
    };
    const RUN = (status, conclusion = null) => ({ id: 42, display_title: 'fleet-write fw-test-1', name: 'Fleet Write', html_url: 'https://github.test/run/42', status, conclusion });

    // ── the dispatch ────────────────────────────────────────────────────────
    battery('the dispatch: one paced POST to the board repo with event_type and client_payload; 204 is acceptance, anything else a refusal');
    {
      const ok = await drive({ runs: (ms) => (ms >= 10_000 ? [RUN('completed', 'success')] : []) }, { file: paceFile });
      t('the POST goes to the BOARD repo, whatever the target', ok.seen[0].call, DISPATCH);
      t('…with event_type fleet-write and the payload as client_payload, under the session token', [ok.seen[0].body, ok.seen[0].auth], [{ event_type: RELAY_EVENT_TYPE, client_payload: payload }, `Bearer ${TOKEN}`]);
      t('…exactly ONE dispatch per stroke, however long the wait', ok.seen.filter((s) => s.call === DISPATCH).length, 1);
      const refused = await drive({ dispatch: { status: 404, json: { message: 'Not Found' } } });
      t('a 404 on the dispatch is refused — nothing ran, no run list read, exit 5', [refused.state, refused.seen.length, exitForResult(refused)], ['refused', 1, EXIT_PLATFORM_REFUSAL]);
      const dead = await drive({ dispatch: { status: 401, json: { message: 'Bad credentials' } } });
      t('a 401 is a prerequisite failure (exit 3)', [dead.state, exitForResult(dead)], ['refused', EXIT_PREREQUISITE]);
      const down = await drive({ dispatch: { throws: 'ECONNRESET' } });
      t('an unreachable platform is refused with status 0, and the lease was released', [down.state, down.status, existsSync(`${down.pace.file}.lease`)], ['refused', 0, false]);
      const exhausted = await drive({ dispatch: { status: 403, rateRemaining: '0', json: { message: 'API rate limit exceeded' } } });
      const after = await drive({ runs: () => [RUN('completed', 'success')] }, { file: exhausted.pace.file });
      t('a rate-limit refusal writes the stop marker and the NEXT dispatch on that log is refused before it leaves', [exitForResult(exhausted), after.throttled, after.seen.length], [EXIT_PREREQUISITE, true, 0]);
    }

    // ── the run-poller ──────────────────────────────────────────────────────
    battery('the run-poller: the run named after the request id, its completion, its conclusion');
    {
      t('a run is matched by its display_title carrying the request id', runMatches({ display_title: 'fleet-write fw-test-1' }, 'fw-test-1'));
      t('…or by its name, and never by a different id', [runMatches({ name: 'fleet-write fw-test-1' }, 'fw-test-1'), runMatches({ display_title: 'fleet-write fw-test-2' }, 'fw-test-1')], [true, false]);
      const slow = await drive({
        runs: (ms) => (ms >= 20_000 ? [{ ...RUN('queued'), id: 42 }] : []),
        one: (id, ms) => (id === 42 ? RUN(ms >= 60_000 ? 'completed' : 'in_progress', ms >= 60_000 ? 'success' : null) : null),
      }, { file: paceFile });
      t('a run that appears after 20 s and completes after 60 s is success, with its url', [slow.state, slow.ok, slow.run?.url], ['success', true, 'https://github.test/run/42']);
      t('…the list was polled until the run appeared, then the run itself until it completed', [slow.seen.filter((s) => s.call === RUNS).length >= 4, slow.seen.some((s) => s.call.endsWith('/actions/runs/42'))], [true, true]);
      t('…and the list is filtered to repository_dispatch runs created around the dispatch', slow.seen.find((s) => s.call === RUNS).query.includes('event=repository_dispatch') && slow.seen.find((s) => s.call === RUNS).query.includes('created='));
      const failed = await drive({ runs: () => [RUN('completed', 'failure')] });
      t('a run that completed with failure is `failure`, exit 5 — ⛔ never a fall-back candidate', [failed.state, failed.ok, exitForResult(failed)], ['failure', false, EXIT_PLATFORM_REFUSAL]);
    }

    // ── the ceilings ────────────────────────────────────────────────────────
    battery('the ceilings: no run in the start window, no completion in the ceiling — UNCONFIRMED, never retried');
    {
      const none = await drive({ runs: () => [] });
      t('no run within the start window is `no-run`, exit 6', [none.state, exitForResult(none)], ['no-run', EXIT_UNCONFIRMED]);
      t('…after ONE dispatch, and it says how long it waited', [none.seen.filter((s) => s.call === DISPATCH).length, unconfirmedText(none).includes('90000 ms')], [1, true]);
      t('…the dispatch WAS accepted (HTTP 204) and no run is known — the state every sender answers UNCONFIRMED and none falls back from (the no-run conformance)', [none.status, none.ok, none.run], [204, false, null]);
      const stuck = await drive({ runs: () => [RUN('in_progress')], one: () => RUN('in_progress') });
      t('a run that never completes within the ceiling is `timeout`, exit 6, with the run url', [stuck.state, exitForResult(stuck), unconfirmedText(stuck).includes('https://github.test/run/42')], ['timeout', EXIT_UNCONFIRMED, true]);
      t('…and the sentence says not to retry blind', unconfirmedText(stuck).includes('do not re-run'));
      const listDown = await drive({ runs: () => 'down' });
      t('a run list that cannot be read is `no-run` flagged unreadable, never a silent no', [listDown.state, listDown.listUnreadable, listDown.logs.some((l) => l.includes('could not be read'))], ['no-run', true, true]);
      t('the ceilings read the environment with malformed overrides ignored and said', [ceilingsFrom({ OS_FLEET_DISPATCH_START_MS: '10', OS_FLEET_DISPATCH_TIMEOUT_MS: 'soon' }).startMs, ceilingsFrom({ OS_FLEET_DISPATCH_TIMEOUT_MS: 'soon' }).ceilingMs, ceilingsFrom({ OS_FLEET_DISPATCH_TIMEOUT_MS: 'soon' }).notes.length], [10, DEFAULT_CEILING_MS, 1]);
    }

    // ── the read-back: which actions are read, and where ─────────────────────
    battery('the read-back targets: every op the table lets carry a body — derived, each with a locator — and no other op is read back');
    {
      t('BODY_OPS is derived from the op table: exactly the five ops that can carry a body', [...BODY_OPS].sort(), ['comment', 'comment_edit', 'issue_create', 'issue_patch', 'pr_create']);
      t('⛔ READ_BACK_LOCATORS names exactly BODY_OPS — a body op without a locator reds here the day it lands in ops.mjs', Object.keys(READ_BACK_LOCATORS).sort(), [...BODY_OPS].sort());
      t('an addressed object and one found by a key are MEASURED; a new comment only its content can find', Object.fromEntries(Object.entries(READ_BACK_LOCATORS).map(([op, l]) => [op, l.found])), { issue_patch: 'address', comment_edit: 'address', issue_create: 'key', pr_create: 'key', comment: 'content' });
      const mixed = { repo: 'objectstack-ai/objectstack', actions: [{ op: 'labels_add', issue: 1, labels: ['a'] }, { op: 'issue_patch', issue: 2, state: 'closed' }, { op: 'issue_patch', issue: 3, body: 'B' }, { op: 'pr_create', title: 'T', head: 'h', base: 'main' }, { op: 'pr_create', title: 'T', head: 'h2', base: 'main', body: 'P' }] };
      t('only an action that SENT a body is a target, numbered as the stroke numbers it', readBackTargets(mixed).map((x) => [x.action, x.op]), [[3, 'issue_patch'], [5, 'pr_create']]);
      t('…carrying the keys its locator needs', [readBackTargets(mixed)[0].issue, readBackTargets(mixed)[1].head, readBackTargets(mixed)[1].sent], [3, 'h2', 'P']);
      let fetched = 0;
      const none = await readBackStroke({ repo: 'objectstack-ai/objectstack', actions: [{ op: 'labels_add', issue: 1, labels: ['a'] }] }, { dispatchedAt: T0 }, {
        judge: JUDGE,
        fetch: async () => {
          fetched += 1;
          throw new Error('no read expected');
        },
      });
      t('a stroke with no body reads NOTHING back — state none, zero requests', [none.state, none.rows.length, fetched], ['none', 0, 0]);
    }

    // ── the verdict ─────────────────────────────────────────────────────────
    battery("the verdict: post-stamped's own classifier, imported — declared normalisations land, a split, lost or truncated byte is NOT STORED at its first differing byte, an unreadable body is unverified, the PR-create footer forgiven on pr_create alone");
    {
      const J = (op, sent, stored) => judgeStoredBody({ op, sent, stored }, JUDGE);
      const SENT = 'A census table:\n| card | title |\n|---|---|\n| #1 | no… 全部 |\n';
      const TRIMMED = SENT.replace(/\n+$/u, '');
      t('identical bytes land', [J('issue_patch', SENT, SENT).verdict, J('issue_patch', SENT, SENT).cls], ['landed', 'identical']);
      t("the platform's footer block appended lands (post-stamped's footer-appended)", [J('issue_patch', SENT, `${TRIMMED}${PLATFORM_COMMENT_FOOTER}`).verdict, J('issue_patch', SENT, `${TRIMMED}${PLATFORM_COMMENT_FOOTER}`).cls], ['landed', 'footer-appended']);
      t('a stripped trailing newline lands', J('comment', SENT, TRIMMED).verdict, 'landed');
      const ell = Buffer.byteLength(SENT.slice(0, SENT.indexOf('…')), 'utf8');
      const SPLIT_ELL = SENT.replace('…', '\uFFFD\uFFFD\uFFFD');
      const e1 = J('issue_patch', SENT, SPLIT_ELL);
      t("⭐ the card's first shape — '…' stored as three U+FFFD — is NOT STORED at the byte where '…' began, three extra replacement characters", [e1.verdict, e1.offset, e1.replacements], ['not-stored', ell, 3]);
      const quan = Buffer.byteLength(SENT.slice(0, SENT.indexOf('全')), 'utf8');
      const e2 = J('issue_patch', SENT, SENT.replace('全', '\uFFFD\uFFFD'));
      t("⭐ …and its second — '全' stored as two U+FFFD — at the byte where '全' began", [e2.verdict, e2.offset, e2.replacements], ['not-stored', quan, 2]);
      t('a truncation is NOT STORED at the first byte the stored body lacks', [J('comment_edit', SENT, SENT.slice(0, 10)).verdict, J('comment_edit', SENT, SENT.slice(0, 10)).offset], ['not-stored', 10]);
      t('a stored body that is not a string is unverified — never landed, never not-stored', [J('issue_patch', SENT, null).verdict, J('issue_patch', SENT, undefined).verdict], ['unverified', 'unverified']);
      const PR_TAIL = '\n\n---\n_Generated by [Claude Code](https://claude.ai/code/session_01KTZmMfzVzjNvyaLyQ8mHvg)_';
      t("pr_create: the platform's rule + ONE session-URL footer after every byte sent lands as pr-create-footer-appended", [J('pr_create', SENT, `${TRIMMED}${PR_TAIL}`).verdict, J('pr_create', SENT, `${TRIMMED}${PR_TAIL}`).cls], ['landed', 'pr-create-footer-appended']);
      t("⛔ …that cell is pr_create's alone: the same tail on an issue body is NOT STORED", J('issue_patch', SENT, `${TRIMMED}${PR_TAIL}`).verdict, 'not-stored');
      t('⛔ …it forgives nothing INSIDE the bytes sent: a split character before that footer is still NOT STORED', J('pr_create', SENT, `${SPLIT_ELL.replace(/\n+$/u, '')}${PR_TAIL}`).verdict, 'not-stored');
      t('⛔ …nor an append that is not exactly that block', J('pr_create', SENT, `${SENT}\nextra`).verdict, 'not-stored');
      const line = readBackLine({ action: 1, op: 'issue_patch', where: 'objectstack-ai/objectui#11041', ...e1 });
      t('the NOT STORED line names the op, the object, the first differing byte and the replacement characters', line.includes('NOT STORED') && line.includes('issue_patch') && line.includes('#11041') && line.includes(`first difference at byte ${ell}`) && line.includes('3 U+FFFD'));
      const own = readReal(SELF_PATH, 'utf8');
      t("⛔ the judge is post-stamped's, imported — this file declares no classifier of its own", [JUDGE.classifyReadBack === POST_STAMPED_CLASSIFIER, /import\('\.\.\/post-stamped\.mjs'\)/u.test(own), new RegExp('function\\s+(classifyReadBack|footerReAnchoring|firstDifferingByte|sentBodyLanded)\\b').test(own)], [true, true, false]);
    }

    // ── the round trip ──────────────────────────────────────────────────────
    // The platform legs are MODELLED here, not measured: GitHub parses the wire, and the runner's `toJSON` is taken as
    // the 2-space JSON the workflow's expression engine renders. Everything this repository executes is the real code.
    battery("the round trip: the card's 41,699 bytes with a multi-byte character across every 16 KiB boundary of every stream, byte for byte through pack, the wire, the runner's env text, the validator and the executor; a per-chunk decode is NOT STORED");
    {
      const { executeFleetWrite } = await import('./execute.mjs');
      const KIB16 = 16 * 1024;
      const CARD_BYTES = 41_699;
      const UNIT = '𠮷😀全😀…😀é\n"'; // 4-, 3- and 2-byte characters, and the newline and quote the JSON streams escape
      const UNIT_BYTES = Buffer.byteLength(UNIT, 'utf8');
      const build = (pad) => {
        let s = 'x'.repeat(pad);
        while (Buffer.byteLength(s, 'utf8') + UNIT_BYTES <= CARD_BYTES) s += UNIT;
        return s + 'x'.repeat(CARD_BYTES - Buffer.byteLength(s, 'utf8'));
      };
      const streamsOf = (body) => {
        const p = packRequest({ repo: 'objectstack-ai/objectui', session: SESSION, actions: [{ op: 'issue_patch', issue: 11041, body }], requestId: 'fw-20260929T061500Z-abc123' }).payload;
        const wire = JSON.stringify({ event_type: RELAY_EVENT_TYPE, client_payload: p });
        return { payload: p, wire, envText: JSON.stringify(JSON.parse(wire).client_payload, null, 2), exec: JSON.stringify({ body }) };
      };
      /** Every 16 KiB boundary of the stream falls on a UTF-8 continuation byte — inside a character, never between two. */
      const straddles = (text) => {
        const buf = Buffer.from(text, 'utf8');
        for (let k = KIB16; k < buf.length; k += KIB16) if ((buf[k] & 0xc0) !== 0x80) return false;
        return true;
      };
      let pad = -1;
      for (let p = 0; p < 2000 && pad < 0; p++) {
        const body = build(p);
        const s = streamsOf(body);
        if ([body, s.wire, s.envText, s.exec].every(straddles)) pad = p;
      }
      const BODY = build(Math.max(pad, 0));
      const SENT_BYTES = Buffer.from(BODY, 'utf8');
      const S = streamsOf(BODY);
      t("a body of exactly the card's 41,699 bytes exists whose EVERY 16 KiB boundary — in the body, the dispatch wire, the runner's env text and the executor's request — falls inside a multi-byte character", [pad >= 0, SENT_BYTES.length, [BODY, S.wire, S.envText, S.exec].every(straddles)], [true, CARD_BYTES, true]);
      t('…and every one of those streams crosses at least two such boundaries', [BODY, S.wire, S.envText, S.exec].map((x) => Buffer.byteLength(x, 'utf8') > 2 * KIB16), [true, true, true, true]);
      t('① pack → the dispatch wire → the platform\'s parse: byte for byte', Buffer.compare(Buffer.from(JSON.parse(S.wire).client_payload.actions[0].body, 'utf8'), SENT_BYTES), 0);
      const child = spawnSync(process.execPath, [fileURLToPath(new URL('./validate.mjs', import.meta.url)), '--from-env', '--json'], { encoding: 'utf8', env: { ...process.env, [PAYLOAD_ENV]: S.envText, GITHUB_STEP_SUMMARY: '' }, maxBuffer: 1 << 24 });
      const judged = child.status === 0 ? JSON.parse(child.stdout.trim().split('\n')[1]) : null;
      t("② the runner's env text through FLEET_WRITE_PAYLOAD into validate.mjs --from-env, in its own process: byte for byte", [child.status, judged ? Buffer.compare(Buffer.from(judged.actions[0].body, 'utf8'), SENT_BYTES) : null], [0, 0], child.stderr.slice(-300));
      let captured = null;
      const execRun = await executeFleetWrite({ payload: JSON.parse(S.envText), sender: 'os-support-ai', token: TOKEN }, {
        fetch: async (url, init) => {
          if (init?.method === 'PATCH') captured = init.body;
          const json = new URL(url).pathname.endsWith('/permission') ? { permission: 'write', role_name: 'write' } : { number: 11041 };
          return { status: 200, headers: new Headers({ 'x-ratelimit-remaining': '4999' }), json: async () => json };
        },
        pace: paceFor(join(dir, 'pace-roundtrip.jsonl')),
        log: () => {},
      });
      t("③ the executor's own PATCH is exactly the request the stream check straddled, carrying the bytes sent", [execRun.exit, captured === S.exec, captured ? Buffer.compare(Buffer.from(JSON.parse(captured).body, 'utf8'), SENT_BYTES) : null], [0, true, 0]);
      const answer = (body) => async () => ({ status: 200, headers: new Headers(), json: async () => ({ number: 11041, body }) });
      const back = await readBackStroke(S.payload, { dispatchedAt: T0 }, { judge: JUDGE, token: TOKEN, fetch: answer(`${BODY}${PLATFORM_COMMENT_FOOTER}`) });
      t("④ what that request stored, read back with the platform's footer, lands", [back.state, back.rows[0]?.cls], ['landed', 'footer-appended']);
      // The defect the card suspects: a reader that decodes each 16 KiB chunk of the wire on its own.
      const wireBuf = Buffer.from(S.wire, 'utf8');
      const chunked = Array.from({ length: Math.ceil(wireBuf.length / KIB16) }, (_, i) => wireBuf.subarray(i * KIB16, (i + 1) * KIB16).toString('utf8')).join('');
      const damaged = JSON.parse(chunked).client_payload.actions[0].body;
      // Where the first wire boundary falls in BODY coordinates: walk the body a character at a time, each one as wide
      // on the wire as its JSON escape, until the character that spans wire byte 16384.
      let predicted = null;
      {
        let wirePos = Buffer.byteLength(S.wire.slice(0, S.wire.indexOf('"body":"') + '"body":"'.length), 'utf8');
        let bodyPos = 0;
        for (const ch of BODY) {
          const w = Buffer.byteLength(JSON.stringify(ch).slice(1, -1), 'utf8');
          if (wirePos < KIB16 && KIB16 < wirePos + w) {
            predicted = bodyPos;
            break;
          }
          wirePos += w;
          bodyPos += Buffer.byteLength(ch, 'utf8');
        }
      }
      const broken = await readBackStroke(S.payload, { dispatchedAt: T0 }, { judge: JUDGE, token: TOKEN, fetch: answer(damaged) });
      t('⑤ that body decoded chunk by chunk — every boundary splitting a character — is NOT STORED, with the replacement characters counted', [broken.state, damaged === BODY, broken.rows[0]?.replacements > 0], ['not-stored', false, true]);
      t('…at exactly the body byte where the first 16 KiB wire boundary split a character', [predicted !== null, broken.rows[0]?.offset], [true, predicted]);
    }

    // ── the read-back, end to end ───────────────────────────────────────────
    battery('the read-back end to end: after a success run each body at its locator — a corrupted read-back exits 4 through the CLI, an unreadable or unfound one 6, a body-less stroke reads nothing, never a retry');
    {
      const UI = 'objectstack-ai/objectui';
      const strokeOf = (actions, repo = 'objectstack-ai/objectstack') => packRequest({ repo, session: SESSION, actions, requestId: 'fw-test-1' }).payload;
      const OK_RUN = { runs: () => [RUN('completed', 'success')] };
      const B = 'Body with a multi-byte tail: no… 全部\n';
      const SPLIT = B.replace('全', '\uFFFD\uFFFD');
      const AT = Buffer.byteLength(B.slice(0, B.indexOf('全')), 'utf8');
      const patch = strokeOf([{ op: 'issue_patch', issue: 11041, body: B }], UI);
      const ISSUE = `GET /repos/${UI}/issues/11041`;
      const good = await drive({ ...OK_RUN, store: { [ISSUE]: { status: 200, json: { number: 11041, body: `${B.replace(/\n+$/u, '')}${PLATFORM_COMMENT_FOOTER}` } } } }, { stroke: patch });
      t('a success run whose body reads back as sent (plus the footer) is success, its row landed, exit 0', [good.state, good.ok, good.readBack?.state, exitForResult(good)], ['success', true, 'landed', EXIT_OK]);
      t('…read at the address the action named, once, AFTER the run completed', [good.seen.filter((s) => s.call === ISSUE).length, good.seen.findIndex((s) => s.call === ISSUE) > good.seen.findIndex((s) => s.call === RUNS)], [1, true]);
      const bad = await drive({ ...OK_RUN, store: { [ISSUE]: { status: 200, json: { number: 11041, body: SPLIT } } } }, { stroke: patch });
      t('⭐ a deliberately corrupted read-back: failure + notStored, exit 4, naming the op, the object and the first differing byte', [bad.state, bad.ok, bad.notStored, exitForResult(bad), bad.detail.includes('issue_patch') && bad.detail.includes('#11041') && bad.detail.includes(`byte ${AT}`)], ['failure', false, true, EXIT_NOT_STORED, true], bad.detail);
      t('…the transcript says NOT STORED and counts the U+FFFD, and ⛔ there was exactly ONE dispatch — never a retry', [bad.logs.some((l) => l.includes('NOT STORED') && l.includes('U+FFFD')), bad.seen.filter((s) => s.call === DISPATCH).length], [true, 1]);
      t('…and the CLI text says the write HAPPENED, go READ, never re-run blind, exit 4', notStoredText(bad).includes('HAPPENED') && notStoredText(bad).includes('Do not re-run') && notStoredText(bad).includes(`Exit ${EXIT_NOT_STORED}`));
      const unread = await drive({ ...OK_RUN, store: { [ISSUE]: { status: 503, json: { message: 'down' } } } }, { stroke: patch });
      t('an object the read-back cannot read is unverified, exit 6 — ⛔ never success, ⛔ never not-stored — and says which call failed', [unread.state, unread.ok, unread.notStored ?? false, exitForResult(unread), unverifiedText(unread).includes('HTTP 503')], ['unverified', false, false, EXIT_UNCONFIRMED, true]);
      const EDIT = 'GET /repos/objectstack-ai/objectstack/issues/comments/77';
      const edit = await drive({ ...OK_RUN, store: { [EDIT]: { status: 200, json: { id: 77, body: SPLIT } } } }, { stroke: strokeOf([{ op: 'comment_edit', comment_id: 77, body: B }]) });
      t('comment_edit: read at its address; a split character is NOT STORED, exit 4', [edit.state, edit.notStored, exitForResult(edit)], ['failure', true, EXIT_NOT_STORED]);
      const CMTS = 'GET /repos/objectstack-ai/objectstack/issues/19701/comments';
      const two = await drive({ ...OK_RUN, store: { [CMTS]: { status: 200, json: [{ id: 601, created_at: at(5_000), body: B }, { id: 602, created_at: at(6_000), body: B }] } } }, { stroke: strokeOf([{ op: 'comment', issue: 19701, body: B }, { op: 'comment', issue: 19701, body: B }]) });
      t('comment: found by its content among those created since the dispatch; two identical comments match two DIFFERENT stored ones', [two.state, two.readBack?.rows?.map((r) => r.where)], ['success', ['objectstack-ai/objectstack#19701 comment 602', 'objectstack-ai/objectstack#19701 comment 601']]);
      const lost = await drive({ ...OK_RUN, store: { [CMTS]: { status: 200, json: [{ id: 603, created_at: at(5_000), body: SPLIT }] } } }, { stroke: strokeOf([{ op: 'comment', issue: 19701, body: B }]) });
      t("⛔ a comment only its content can find is UNVERIFIED when nothing matches — exit 6, never not-stored — the one candidate's first difference named as a LEAD", [lost.state, exitForResult(lost), lost.readBack?.rows?.[0]?.why?.includes(`first differs at byte ${AT}`) ?? false, lost.readBack?.rows?.[0]?.why?.includes('U+FFFD') ?? false], ['unverified', EXIT_UNCONFIRMED, true, true]);
      const stale = await drive({ ...OK_RUN, store: { [CMTS]: { status: 200, json: [{ id: 604, created_at: at(-120_000), body: B }] } } }, { stroke: strokeOf([{ op: 'comment', issue: 19701, body: B }]) });
      t('…and a comment created BEFORE the dispatch (outside the slack) is never taken for this write', [stale.state, exitForResult(stale)], ['unverified', EXIT_UNCONFIRMED]);
      const ISSUES = 'GET /repos/objectstack-ai/objectstack/issues';
      const created = await drive({ ...OK_RUN, store: { [ISSUES]: { status: 200, json: [{ id: 9, number: 20999, title: 'Other', created_at: at(4_000), body: B }, { id: 8, number: 20998, title: 'Card', created_at: at(3_000), body: SPLIT }] } } }, { stroke: strokeOf([{ op: 'issue_create', title: 'Card', body: B }]) });
      t('issue_create: the new issue found by the title sent and its body judged — a split character is NOT STORED on THAT issue, exit 4', [created.state, created.notStored, created.readBack?.rows?.[0]?.where, exitForResult(created)], ['failure', true, 'objectstack-ai/objectstack#20998', EXIT_NOT_STORED]);
      const PULLS = 'GET /repos/objectstack-ai/objectstack/pulls';
      const PR_TAIL = '\n\n---\n_Generated by [Claude Code](https://claude.ai/code/session_01KTZmMfzVzjNvyaLyQ8mHvg)_';
      const prStroke = strokeOf([{ op: 'pr_create', title: 'T', head: 'claude/issue-1-x', base: 'main', body: B }]);
      const pr = await drive({ ...OK_RUN, store: { [PULLS]: (q) => ({ status: 200, json: q.get('head') === 'objectstack-ai:claude/issue-1-x' ? [{ id: 31, number: 20600, created_at: at(4_000), body: `${B.replace(/\n+$/u, '')}${PR_TAIL}` }] : [] }) } }, { stroke: prStroke });
      t("pr_create: found by owner:head; the platform's session-URL footer after every byte sent is success", [pr.state, pr.readBack?.rows?.[0]?.cls, pr.readBack?.rows?.[0]?.where], ['success', 'pr-create-footer-appended', 'objectstack-ai/objectstack#20600']);
      const noPr = await drive({ ...OK_RUN, store: { [PULLS]: { status: 200, json: [] } } }, { stroke: prStroke });
      t('…and a pull the head does not find is unverified, exit 6', [noPr.state, exitForResult(noPr)], ['unverified', EXIT_UNCONFIRMED]);
      const labels = await drive(OK_RUN, { stroke: strokeOf([{ op: 'labels_add', issue: 1, labels: ['a'] }]) });
      t('a stroke carrying no body reads nothing back: success, read-back none, no request beyond the dispatch and the run', [labels.state, labels.readBack?.state, labels.seen.filter((s) => !s.call.includes('/actions/runs') && s.call !== DISPATCH).length], ['success', 'none', 0]);
      t("the callers' one vocabulary: failure + notStored → 4, failure → 5, unverified → 6", [exitForResult({ state: 'failure', notStored: true }), exitForResult({ state: 'failure' }), exitForResult({ state: 'unverified' })], [EXIT_NOT_STORED, EXIT_PLATFORM_REFUSAL, EXIT_UNCONFIRMED]);
      // The CLI, end to end: the exit code a seat actually reads, from the actions file the card's seat sent.
      writeFileSync(join(dir, 'patch.json'), JSON.stringify([{ op: 'issue_patch', issue: 11041, body: B }]), 'utf8');
      const cli = async (stored) => {
        let nowMs = T0;
        const clock = { now: () => nowMs, elapsed: () => nowMs - T0 };
        const out = [];
        const [log, err] = [console.log, console.error];
        console.log = (l) => out.push(String(l));
        console.error = () => {};
        try {
          const code = await main(['--repo', UI, '--actions-file', join(dir, 'patch.json'), '--request-id', 'fw-test-1', '--json'], {
            env: { GITHUB_TOKEN: TOKEN, [SESSION_ENV]: SESSION },
            send: { fetch: platform({ ...OK_RUN, store: { [ISSUE]: { status: 200, json: { number: 11041, body: stored } } } }, [], clock), pace: paceFor(join(dir, `pace-cli-${paceCase++}.jsonl`)), now: clock.now, sleep: async (ms) => { nowMs += ms; }, log: () => {}, ceilings: { startMs: 90_000, ceilingMs: 300_000, pollMs: 5_000, notes: [] } },
          });
          return { code, json: out.length ? JSON.parse(out[out.length - 1]) : null };
        } finally {
          [console.log, console.error] = [log, err];
        }
      };
      const cliBad = await cli(SPLIT);
      t("⭐ the CLI: the card's stroke with a deliberately corrupted read-back EXITS 4, and --json says not_stored with the first differing byte", [cliBad.code, cliBad.json?.not_stored, cliBad.json?.read_back?.[0]?.first_difference_byte], [EXIT_NOT_STORED, true, AT]);
      const cliGood = await cli(`${B.replace(/\n+$/u, '')}${PLATFORM_COMMENT_FOOTER}`);
      t('…and the same stroke read back intact exits 0, its row landed', [cliGood.code, cliGood.json?.read_back?.[0]?.verdict], [EXIT_OK, 'landed']);
    }

    // ── the issue_create re-list ────────────────────────────────────────────
    battery('the issue_create re-list: a list that lags the create reads back IDENTICAL on a bounded re-list; a real miss is still unfound (exit 6) after exactly the declared window; an unreadable re-list is unread; the create is never re-sent');
    {
      const REPO = 'objectstack-ai/objectstack';
      const ISSUES = `GET /repos/${REPO}/issues`;
      const PULLS = `GET /repos/${REPO}/pulls`;
      const OK_RUN = { runs: () => [RUN('completed', 'success')] };
      const B = 'Body with a multi-byte tail: no… 全部\n';
      const strokeOf = (action) => packRequest({ repo: REPO, session: SESSION, actions: [action], requestId: 'fw-test-1' }).payload;
      const stroke = strokeOf({ op: 'issue_create', title: 'Card', body: B });
      const CARD = { id: 8, number: 20998, title: 'Card', created_at: at(3_000), body: B };
      const OTHER = { id: 9, number: 20999, title: 'Other', created_at: at(2_000), body: 'x' };
      const WINDOW = ISSUE_CREATE_RELIST_DELAYS_MS.reduce((a, b) => a + b, 0);
      const SCHEDULE = ISSUE_CREATE_RELIST_DELAYS_MS.reduce((acc, ms) => [...acc, acc[acc.length - 1] + ms], [0]);
      const writes = (r) => r.seen.filter((s) => !s.call.startsWith('GET ')).map((s) => s.call);
      /** The issue list as a function of time: CARD is on it from `visibleFromMs` on. Each first-page read is recorded at its elapsed ms. */
      const lagging = (visibleFromMs, rows, reads) => ({
        [ISSUES]: (q, ms) => {
          if ((q.get('page') ?? '1') === '1') reads.push(ms);
          return { status: 200, json: ms >= visibleFromMs ? [CARD, ...rows] : rows };
        },
      });
      t('the schedule is frozen and non-empty, every wait a positive integer that never shrinks, the whole window at most 30 s', [Object.isFrozen(ISSUE_CREATE_RELIST_DELAYS_MS), ISSUE_CREATE_RELIST_DELAYS_MS.length > 0, ISSUE_CREATE_RELIST_DELAYS_MS.every((ms, i, a) => Number.isInteger(ms) && ms > 0 && (i === 0 || ms >= a[i - 1])), WINDOW <= 30_000], [true, true, true, true]);
      const lagReads = [];
      const lag = await drive({ ...OK_RUN, store: lagging(8_000, [OTHER], lagReads) }, { stroke });
      t('⭐ the list lags the create — the new issue absent from it until 8 s after the dispatch — and the read-back is IDENTICAL on THAT issue, not unfound: success, exit 0', [lag.state, lag.readBack?.rows?.[0]?.verdict, lag.readBack?.rows?.[0]?.cls, lag.readBack?.rows?.[0]?.where, exitForResult(lag)], ['success', 'landed', 'identical', `${REPO}#20998`, EXIT_OK]);
      t('…found on the SECOND re-list: the list read at the declared cumulative waits, in order, and no further', lagReads, SCHEDULE.slice(0, 3));
      t('…one printed line per re-list, and one naming the issue and the re-list that found it', [lag.logs.filter((l) => l.includes('re-list') && l.includes('the create is not re-sent')).length, lag.logs.some((l) => l.includes(`${REPO}#20998 found on re-list 2`))], [2, true]);
      t('⛔ the create is never re-sent: ONE write across the whole stroke — the dispatch — however many re-lists', writes(lag), [DISPATCH]);
      const missReads = [];
      const miss = await drive({ ...OK_RUN, store: lagging(Infinity, [OTHER], missReads) }, { stroke });
      t('the control — a list that never carries the title sent — is still unfound: unverified, exit 6, ⛔ never success, ⛔ never not-stored', [miss.state, miss.readBack?.rows?.[0]?.cls, miss.notStored ?? false, exitForResult(miss)], ['unverified', 'unfound', false, EXIT_UNCONFIRMED]);
      t('…after exactly the declared window: one list read per step of the schedule, at its cumulative waits, and no more', missReads, SCHEDULE);
      t('…its reason names how often and over how long it listed, and the CLI sentence still says do not re-run blind, exit 6', [miss.readBack?.rows?.[0]?.why?.includes(`listed ${SCHEDULE.length} times over ${WINDOW} ms`), unverifiedText(miss).includes('do not re-run blind'), unverifiedText(miss).includes(`Exit ${EXIT_UNCONFIRMED}`)], [true, true, true]);
      t('⛔ …and still ONE write: a miss re-sends nothing', writes(miss), [DISPATCH]);
      const STALE = { id: 7, number: 20001, title: 'Card', created_at: at(-120_000), body: B };
      const stale = await drive({ ...OK_RUN, store: lagging(8_000, [STALE], []) }, { stroke });
      t('an issue carrying the same title but created BEFORE the dispatch is never taken while the new one lags — the re-list waits for the new one', [stale.state, stale.readBack?.rows?.[0]?.where], ['success', `${REPO}#20998`]);
      const flakyReads = [];
      const flaky = await drive({ ...OK_RUN, store: { [ISSUES]: (q, ms) => {
        if ((q.get('page') ?? '1') === '1') flakyReads.push(ms);
        return ms === 0 ? { status: 200, json: [OTHER] } : { status: 503, json: { message: 'down' } };
      } } }, { stroke });
      t('a re-list that cannot be read ends the wait as unread — the call and its status named, ⛔ not unfound, no further re-list', [flaky.state, flaky.readBack?.rows?.[0]?.cls, flaky.readBack?.rows?.[0]?.why?.includes('HTTP 503') ?? false, flakyReads.length, exitForResult(flaky)], ['unverified', 'unread', true, 2, EXIT_UNCONFIRMED]);
      const promptReads = [];
      const prompt = await drive({ ...OK_RUN, store: lagging(0, [OTHER], promptReads) }, { stroke });
      t('a list that already carries it is read ONCE — no wait, no re-list line', [prompt.state, promptReads.length, prompt.logs.some((l) => l.includes('re-list'))], ['success', 1, false]);
      let pulls = 0;
      const noPr = await drive({ ...OK_RUN, store: { [PULLS]: () => {
        pulls += 1;
        return { status: 200, json: [] };
      } } }, { stroke: strokeOf({ op: 'pr_create', title: 'T', head: 'claude/issue-1-x', base: 'main', body: B }) });
      t("the re-list is issue_create's alone: a pull its head does not find is read ONCE and unfound, as before", [noPr.state, noPr.readBack?.rows?.[0]?.cls, pulls], ['unverified', 'unfound', 1]);
    }

    // ── the run's annotations ───────────────────────────────────────────────
    battery("the run's annotations: after a success run carrying an op that creates or moves a card its check-run annotations are read first — an issue_create they name read back AT that number with NO re-list; absent, unreadable, ignored or past the cap, the re-list as before; a stroke with no such op reads none");
    {
      const REPO = 'objectstack-ai/objectstack';
      const UI = 'objectstack-ai/objectui';
      const ISSUES = `GET /repos/${REPO}/issues`;
      const ONE = `GET /repos/${REPO}/issues/20998`;
      const JOBS = `GET /repos/${RELAY_REPO}/actions/runs/42/jobs`;
      const NOTES = `GET /repos/${RELAY_REPO}/check-runs/4200/annotations`;
      const OK_RUN = { runs: () => [RUN('completed', 'success')] };
      const B = 'Body with a multi-byte tail: no… 全部\n';
      const SPLIT = B.replace('全', '\uFFFD\uFFFD');
      const strokeOf = (actions, repo = REPO) => packRequest({ repo, session: SESSION, actions, requestId: 'fw-test-1' }).payload;
      const create = strokeOf([{ op: 'issue_create', title: 'Card', body: B }]);
      const CARD = { id: 8, number: 20998, title: 'Card', created_at: at(3_000), body: B };
      const URL98 = `https://github.test/${REPO}/issues/20998`;
      /** One annotation as the runner stores the executor's notice: the message the relay's own speller writes. */
      const note = (action, op, number, repo = REPO) => ({ path: '.github', annotation_level: 'notice', title: `fleet-write ${op}`, message: relayAnnotationMessage({ action, op, number, url: `https://github.test/${repo}/issues/${number}` }) });
      const named = (...rows) => () => ({ status: 200, json: [RUNNER_NOTICE, ...rows] });
      const calls = (r, call) => r.seen.filter((x) => x.call === call).length;
      const writes = (r) => r.seen.filter((x) => !x.call.startsWith('GET ')).map((x) => x.call);
      // The issue list never shows the new card — the measured lag at its worst: only the annotation can find it.
      const blindList = { [ISSUES]: { status: 200, json: [] }, [ONE]: { status: 200, json: CARD } };

      const hit = await drive({ ...OK_RUN, notes: named(note(1, 'issue_create', 20998)), store: blindList }, { stroke: create });
      t(
        "⭐ the run's annotation names #20998: read back AT that number — IDENTICAL, success, exit 0 — with ZERO list reads and no wait, though the list never shows it",
        [hit.state, hit.readBack?.rows?.[0]?.where, hit.readBack?.rows?.[0]?.cls, hit.readBack?.rows?.[0]?.foundBy, calls(hit, ISSUES), calls(hit, ONE), hit.logs.some((l) => l.includes('re-list')), exitForResult(hit)],
        ['success', `${REPO}#20998`, 'identical', 'annotation', 0, 1, false, EXIT_OK],
        hit.logs.join(' | '),
      );
      const order = hit.seen.map((x) => x.call);
      t('…the jobs, then their check run\'s annotations, then the issue — all after the run completed — and ONE write, the dispatch', [order.indexOf(JOBS) > order.lastIndexOf(`GET /repos/${RELAY_REPO}/actions/runs`), order.indexOf(NOTES) > order.indexOf(JOBS), order.indexOf(ONE) > order.indexOf(NOTES), writes(hit)], [true, true, true, [DISPATCH]]);
      t("…and the result hands the matched row on for the callers, the runner's own notice passed over", [hit.annotations?.state, hit.annotations?.rows], ['read', [{ action: 1, op: 'issue_create', number: 20998, url: URL98, repo: REPO }]]);
      const split = await drive({ ...OK_RUN, notes: named(note(1, 'issue_create', 20998)), store: { ...blindList, [ONE]: { status: 200, json: { ...CARD, body: SPLIT } } } }, { stroke: create });
      t('a split character on the annotated issue is NOT STORED on THAT issue, exit 4', [split.state, split.notStored, split.readBack?.rows?.[0]?.where, exitForResult(split)], ['failure', true, `${REPO}#20998`, EXIT_NOT_STORED]);
      const gone = await drive({ ...OK_RUN, notes: named(note(1, 'issue_create', 20998)), store: { ...blindList, [ONE]: { status: 503, json: { message: 'down' } } } }, { stroke: create });
      t('⛔ an annotated number whose issue cannot be read is unverified (unread), exit 6 — and still NO list: the fallback is for an ABSENT annotation only', [gone.state, gone.readBack?.rows?.[0]?.cls, calls(gone, ISSUES), exitForResult(gone)], ['unverified', 'unread', 0, EXIT_UNCONFIRMED]);

      // The fallback, unchanged: absent, unreadable or ignored, the list is read and re-read as before.
      const lagReads = [];
      const lagging = { [ISSUES]: (q, ms) => {
        if ((q.get('page') ?? '1') === '1') lagReads.push(ms);
        return { status: 200, json: ms >= 8_000 ? [CARD] : [] };
      } };
      const absent = await drive({ ...OK_RUN, store: lagging }, { stroke: create });
      t('absent (the check run carries only the runner\'s notice): said, and the re-list finds the card as before — success via the list', [absent.state, absent.readBack?.rows?.[0]?.foundBy, lagReads.length, absent.logs.some((l) => l.includes('no annotation on run 42 names action 1 issue_create'))], ['success', 'list', 3, true], absent.logs.join(' | '));
      const unreadable = await drive({ ...OK_RUN, jobs: () => ({ status: 403, json: { message: 'Forbidden' } }), store: { ...blindList, [ISSUES]: { status: 200, json: [CARD] } } }, { stroke: create });
      t('unreadable (the jobs read answers 403): said, naming the call, and the list finds the card — never a failure', [unreadable.state, unreadable.annotations?.state, unreadable.readBack?.rows?.[0]?.foundBy, unreadable.logs.some((l) => l.includes('could not be read') && l.includes(JOBS) && l.includes('HTTP 403'))], ['success', 'unread', 'list', true], unreadable.logs.join(' | '));
      const foreign = await drive({ ...OK_RUN, notes: named(note(1, 'issue_create', 20998, UI)), store: { ...blindList, [ISSUES]: { status: 200, json: [CARD] } } }, { stroke: create });
      t('an annotation whose url names another repository than the create landed on is ignored — said — and the list finds the card', [foreign.state, foreign.annotations?.rows, foreign.readBack?.rows?.[0]?.foundBy, foreign.logs.some((l) => l.includes('is ignored') && l.includes(`names ${UI}`))], ['success', [], 'list', true]);

      // Past the cap: the platform keeps ten notices per step, so a later action may carry none — that one falls back alone.
      const CARD2 = { id: 9, number: 20999, title: 'Card', created_at: at(4_000), body: B };
      const two = await drive({ ...OK_RUN, notes: named(note(1, 'issue_create', 20998)), store: { [ONE]: { status: 200, json: CARD }, [ISSUES]: { status: 200, json: [CARD2, CARD] } } }, { stroke: strokeOf([{ op: 'issue_create', title: 'Card', body: B }, { op: 'issue_create', title: 'Card', body: B }]) });
      t('two creates, only the first annotated: the first read at its number, the second found by the list — never the first one\'s issue again', [two.state, two.readBack?.rows?.map((r) => [r.action, r.where, r.foundBy])], ['success', [[1, `${REPO}#20998`, 'annotation'], [2, `${REPO}#20999`, 'list']]]);

      const plain = await drive(OK_RUN, { stroke: strokeOf([{ op: 'labels_add', issue: 1, labels: ['a'] }]) });
      t('a stroke with no op that creates or moves a card reads NO jobs and NO annotations', [plain.state, plain.annotations?.state, calls(plain, JOBS), calls(plain, NOTES)], ['success', 'none', 0, 0]);
      const move = await drive({ ...OK_RUN, notes: named(note(1, 'transfer', 31, UI)) }, { stroke: strokeOf([{ op: 'transfer', issue: 7, target_repo: UI }]) });
      t('a transfer stroke reads them (it carries no body, so nothing is read back) and hands its row on for issue-transfer', [move.state, move.readBack?.state, move.annotations?.rows], ['success', 'none', [{ action: 1, op: 'transfer', number: 31, url: `https://github.test/${UI}/issues/31`, repo: UI }]]);

      const P = (action, op, number, repo = REPO) => parseRelayAnnotation(note(action, op, number, repo).message);
      const mixed = { repo: REPO, actions: [{ op: 'issue_create', title: 'a', body: 'b' }, { op: 'comment', issue: 1, body: 'c' }, { op: 'issue_create', title: 'd', body: 'e' }] };
      const matched = matchRunAnnotations(mixed, [P(1, 'issue_create', 5), P(1, 'issue_create', 5), P(2, 'issue_create', 6), P(4, 'issue_create', 7), P(3, 'issue_create', 8), P(3, 'issue_create', 9)]);
      t(
        'the matcher: an identical repeat is one row; an index holding another op, or no action, is ignored; two DIFFERENT rows for one action are both ignored — a reader never picks between two answers',
        [matched.rows.map((r) => [r.action, r.number]), matched.ignored.map((r) => [r.action, r.number])],
        [[[1, 5]], [[2, 6], [4, 7], [3, 8], [3, 9]]],
      );
      t('a job\'s check run id: from its check_run_url, else its own id, else none', [checkRunIdOf(JOB), checkRunIdOf({ id: 77 }), checkRunIdOf({})], [4200, 77, null]);

      // The CLI: --json carries the numbers a seat could not read before, and how each read-back found its object.
      writeFileSync(join(dir, 'create.json'), JSON.stringify([{ op: 'issue_create', title: 'Card', body: B }]), 'utf8');
      let nowMs = T0;
      const clock = { now: () => nowMs, elapsed: () => nowMs - T0 };
      const out = [];
      const [log, err] = [console.log, console.error];
      console.log = (l) => out.push(String(l));
      console.error = () => {};
      let code;
      try {
        code = await main(['--repo', REPO, '--actions-file', join(dir, 'create.json'), '--request-id', 'fw-test-1', '--json'], {
          env: { GITHUB_TOKEN: TOKEN, [SESSION_ENV]: SESSION },
          send: { fetch: platform({ ...OK_RUN, notes: named(note(1, 'issue_create', 20998)), store: blindList }, [], clock), pace: paceFor(join(dir, `pace-cli-${paceCase++}.jsonl`)), now: clock.now, sleep: async (ms) => { nowMs += ms; }, log: () => {}, ceilings: { startMs: 90_000, ceilingMs: 300_000, pollMs: 5_000, notes: [] } },
        });
      } finally {
        [console.log, console.error] = [log, err];
      }
      const json = out.length ? JSON.parse(out[out.length - 1]) : null;
      t('the CLI: exit 0, and --json names the annotated number and url and that the read-back found it by the annotation', [code, json?.annotations, json?.read_back?.[0]?.found_by], [EXIT_OK, [{ action: 1, op: 'issue_create', number: 20998, url: URL98 }], 'annotation']);
    }

    // ── the wiring ──────────────────────────────────────────────────────────
    battery('the wiring: the POST is paced and on the roster, the reads are not, the token never reaches the log');
    {
      const { WIRED_WRITE_TOOLS } = await import('../write-pace.mjs');
      const own = readReal(SELF_PATH, 'utf8');
      t('write-pace lists this file among the wired write tools', WIRED_WRITE_TOOLS.includes('scripts/pm/fleet-write/dispatch.mjs'));
      t('this file calls both halves, guarded by the write-verb predicate', own.includes('paceWrite(') && own.includes('noteResponse(') && own.includes('isWriteMethod('));
      const records = readReal(paceFile, 'utf8');
      t('the dispatches above were paced; the run-list, run and read-back reads were not', [records.includes('fleet-write dispatch POST'), records.includes('fleet-write dispatch GET')], [true, false]);
      t('⛔ and the token never reached the throttle\'s log', records.includes(TOKEN), false);
      const entry = own.slice(own.lastIndexOf('if (isEntrypoint(import.meta.url))'));
      t('⛔ the entry settles before main runs — no top-level await on main — so the read-back\'s import of post-stamped (which imports this file) cannot wait on it', [/\bawait\s+main\(/u.test(entry), /main\(process\.argv\.slice\(2\)\)\.then\(/u.test(entry)], [false, true]);
    }

    // ── the CLI ─────────────────────────────────────────────────────────────
    battery('the CLI: a dry run sends nothing, usage, the exit ladder, the session derived from the container, a route read behind a dead proxy refuses');
    {
      writeFileSync(join(dir, 'actions.json'), JSON.stringify(ACTIONS), 'utf8');
      writeFileSync(join(dir, 'bad.json'), JSON.stringify([{ op: 'merge', pull: 1 }]), 'utf8');
      // The container variable is CLEARED in the base env: this self-test runs inside cloud containers too, and an inherited value would derive a session where a case expects none.
      const env = (extra) => ({ ...process.env, GITHUB_TOKEN: TOKEN, GH_TOKEN: '', HTTPS_PROXY: '', https_proxy: '', OS_PM_WRITE_PACE_FILE: join(dir, 'cli-pace.jsonl'), [SESSION_ENV]: SESSION, [CONTAINER_SESSION_ENV]: '', ...extra });
      const spawn = (args, extra = {}) => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: 'utf8', env: env(extra) });
      const dry = spawn(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'actions.json'), '--dry-run']);
      t('--dry-run packs, prints the payload and sends nothing (exit 0, no pace record)', [dry.status, dry.stdout.includes('"event_type"') && dry.stdout.includes('fw-'), existsSync(join(dir, 'cli-pace.jsonl'))], [EXIT_OK, true, false], dry.stderr.slice(-300));
      t('a refused actions file is usage (2) with the reasons, nothing sent', [spawn(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'bad.json'), '--dry-run']).status, spawn(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'bad.json'), '--dry-run']).stderr.includes('REFUSED')], [EXIT_USAGE, true]);
      t('no --actions-file is usage', spawn(['--repo', 'objectstack-ai/objectstack']).status, EXIT_USAGE);
      t('an unknown flag is usage', spawn(['--repo', 'o/r', '--actions-file', join(dir, 'actions.json'), '--dry-run', '--bogus']).status, EXIT_USAGE);
      const noSession = spawn(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'actions.json'), '--dry-run'], { [SESSION_ENV]: '' });
      t('no session from either source is exit 3 naming both variables — even on a dry run, the envelope needs it', [noSession.status, noSession.stderr.includes(SESSION_ENV) && noSession.stderr.includes(CONTAINER_SESSION_ENV)], [EXIT_PREREQUISITE, true]);
      const derivedDry = spawn(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'actions.json'), '--dry-run'], { [SESSION_ENV]: '', [CONTAINER_SESSION_ENV]: 'cse_01ABCDEFGHJKMNPQRSTVWXYZ' });
      t('⭐ no OS_FLEET_SESSION but the container variable: the dry run packs the DERIVED session onto the envelope, exit 0', [derivedDry.status, derivedDry.status === EXIT_OK ? JSON.parse(derivedDry.stdout).client_payload.session : derivedDry.stderr.slice(-200)], [EXIT_OK, SESSION]);
      const malformedContainer = spawn(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'actions.json'), '--dry-run'], { [SESSION_ENV]: '', [CONTAINER_SESSION_ENV]: 'cse_' });
      t('a malformed container variable derives nothing: exit 3, the line saying it is malformed', [malformedContainer.status, malformedContainer.stderr.includes('malformed')], [EXIT_PREREQUISITE, true]);
      t('⛔ no spawned run printed the token', [dry, noSession, derivedDry, malformedContainer].some((r) => `${r.stdout}${r.stderr}`.includes(TOKEN)), false);
      const routeOut = spawn(['--route'], { [CLOUD_DISCRIMINATOR]: '', [TRANSPORT_ENV]: '' });
      t('--route prints ONE JSON line with the transport and its reason, exit 0 — outside a cloud container: direct', [routeOut.status, JSON.parse(routeOut.stdout.trim()).transport, JSON.parse(routeOut.stdout.trim()).failed], [EXIT_OK, 'direct', 'cloud']);
      const routeLive = spawn(['--route'], { [CLOUD_DISCRIMINATOR]: '1', [TRANSPORT_ENV]: '', [RELAY_LIVE_OVERRIDE_ENV]: '1' });
      t('…and under all three conditions (the relay stood in by the test override): dispatch, no network, the session and its source printed', [routeLive.status, JSON.parse(routeLive.stdout.trim()).transport, JSON.parse(routeLive.stdout.trim()).session, JSON.parse(routeLive.stdout.trim()).session_source], [EXIT_OK, 'dispatch', SESSION, SESSION_ENV]);
      const routeDerived = spawn(['--route'], { [CLOUD_DISCRIMINATOR]: '1', [TRANSPORT_ENV]: '', [RELAY_LIVE_OVERRIDE_ENV]: '1', [SESSION_ENV]: '', [CONTAINER_SESSION_ENV]: 'cse_01ABCDEFGHJKMNPQRSTVWXYZ' });
      t('⭐ --route with NO OS_FLEET_SESSION in a cloud container: "transport":"dispatch" with the DERIVED session, its source the container variable', [routeDerived.status, JSON.parse(routeDerived.stdout.trim()).transport, JSON.parse(routeDerived.stdout.trim()).session, JSON.parse(routeDerived.stdout.trim()).session_source], [EXIT_OK, 'dispatch', SESSION, CONTAINER_SESSION_ENV]);
      // End to end through the real re-exec: a proxy that answers nothing. The child carries the flag, the read gets no answer, the answer is a refusal.
      const routeDeadProxy = spawn(['--route'], { [CLOUD_DISCRIMINATOR]: '1', [TRANSPORT_ENV]: '', HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', OS_FLEET_DISPATCH_PROXY_REARMED: '' });
      const deadOut = routeDeadProxy.stdout.trim() ? JSON.parse(routeDeadProxy.stdout.trim()) : null;
      t(`⭐ --route behind a proxy that answers nothing: the process re-execs with ${PROXY_FLAG}, the read gets no answer, and the verdict is exit 3 with the error naming it — never direct`, [routeDeadProxy.status, deadOut?.transport ?? null, (deadOut?.error ?? '').includes('no answer'), routeDeadProxy.stderr.includes(PROXY_FLAG)], [EXIT_PREREQUISITE, null, true, true], routeDeadProxy.stderr.slice(-300));
    }

    // ── the no-run conformance ──────────────────────────────────────────────
    battery('the no-run conformance: every sender — discovered from the source — answers an accepted dispatch with no run, or none completed, UNCONFIRMED (6) after ONE dispatch with ZERO direct writes, under auto and explicit dispatch alike; under direct its write is seen');
    {
      const { readdirSync } = await import('node:fs');
      const { dirname, relative, resolve, sep } = await import('node:path');
      const { pathToFileURL } = await import('node:url');
      const REPO_ROOT = resolve(dirname(SELF_PATH), '../../..');
      const own = relative(REPO_ROOT, SELF_PATH).split(sep).join('/');
      // The senders, from the SOURCE: every code file under scripts/ but this one that names the sender function.
      const senders = readdirSync(join(REPO_ROOT, 'scripts'), { recursive: true })
        .map((f) => `scripts/${String(f).split(sep).join('/')}`)
        .filter((f) => /\.(?:mjs|cjs|js|mts|ts)$/u.test(f) && !f.split('/').includes('node_modules') && f !== own)
        .filter((f) => /\bsendFleetWrite\b/u.test(readReal(join(REPO_ROOT, f), 'utf8')))
        .sort();
      // The discovery's floor, BY NAME: a scan gone blind — a moved root, a renamed import — finds fewer and reds here.
      const KNOWN = ['scripts/pm/close-cards.mjs', 'scripts/pm/issue-create.mjs', 'scripts/pm/issue-transfer.mjs', 'scripts/pm/label-write.mjs', 'scripts/pm/post-stamped.mjs'];
      t('the discovery finds every sender known today — the scan is not blind', KNOWN.filter((k) => !senders.includes(k)), []);

      const relayRoute = (requested) => ({ requested, transport: 'dispatch', reason: `conformance: ${requested} → dispatch`, error: null, session: SESSION });
      const DIRECT_ROUTE = { requested: 'direct', transport: 'direct', reason: 'conformance: direct', error: null, session: null };
      const isDirectWrite = (call) => !/^(?:GET|HEAD) /u.test(call);
      // The tool-independent lines of the ONE sentence every sender prints — computed, so a sender's own copy of it cannot pass.
      const shared = (result) => unconfirmedText(result, '').split('\n').slice(1).join('\n');
      const freshPace = () => paceFor(join(dir, `pace-conformance-${paceCase++}.jsonl`));
      // The REAL sender over a fake platform: the dispatch is accepted (204); its run never appears, or never completes.
      const relayAnswering = (state, counter) => async (payload, opts = {}) => {
        counter.dispatches += 1;
        let nowMs = T0;
        const clock = { now: () => nowMs, elapsed: () => nowMs - T0 };
        const run = { id: 77, display_title: `fleet-write ${payload.request_id}`, name: 'Fleet Write', html_url: 'https://github.test/run/77', status: 'in_progress', conclusion: null };
        const script = state === 'no-run' ? { runs: () => [] } : { runs: () => [run], one: () => run };
        const r = await sendFleetWrite(payload, {
          fetch: platform(script, [], clock),
          token: TOKEN,
          pace: freshPace(),
          now: clock.now,
          sleep: async (ms) => {
            nowMs += ms;
          },
          log: opts.log ?? (() => {}),
          ceilings: { startMs: 90_000, ceilingMs: 300_000, pollMs: 5_000, notes: [] },
        });
        counter.results.push(r);
        return r;
      };
      const drive = async (probe, args) => {
        try {
          return await probe(args);
        } catch (e) {
          return { exit: `threw: ${e?.message ?? e}`, calls: [], text: '' };
        }
      };
      for (const sender of senders) {
        const probe = (await import(pathToFileURL(join(REPO_ROOT, sender)).href))[RELAY_MISS_PROBE];
        t(`${sender} sends a relay dispatch and exports ${RELAY_MISS_PROBE} — a sender without it fails here until it answers like the rest`, typeof probe, 'function');
        if (typeof probe !== 'function') continue;
        for (const [requested, state] of [['auto', 'no-run'], ['dispatch', 'no-run'], ['auto', 'timeout']]) {
          const counter = { dispatches: 0, results: [] };
          const r = await drive(probe, { route: relayRoute(requested), send: relayAnswering(state, counter), pace: freshPace() });
          const answered = counter.results[0] ?? null;
          t(
            `⭐ ${sender}: ${requested} + an ACCEPTED dispatch + ${state} ⇒ exit ${EXIT_UNCONFIRMED} after ONE dispatch, ZERO direct writes, the shared UNCONFIRMED sentence printed`,
            [r.exit, counter.dispatches, answered?.status ?? null, answered?.state ?? null, r.calls.filter(isDirectWrite), answered ? r.text.includes(shared(answered)) : false],
            [EXIT_UNCONFIRMED, 1, 204, state, [], true],
            r.text.slice(-400),
          );
        }
        // The control: the same probe under direct WRITES, and the recorder sees it — so the empty lists above are a measurement.
        const control = { dispatches: 0 };
        const c = await drive(probe, {
          route: DIRECT_ROUTE,
          send: async (payload) => {
            control.dispatches += 1;
            return { state: 'refused', ok: false, status: 0, verdict: 'refusal', run: null, requestId: payload.request_id, startMs: 0, ceilingMs: 0, detail: 'the conformance control: a direct route dispatched' };
          },
          pace: freshPace(),
        });
        t(`…the control: ${sender} under direct issues its write directly — the recorder sees it — and never dispatches`, [control.dispatches, c.calls.filter(isDirectWrite).length > 0], [0, true], `${c.exit} · ${c.calls.join(' | ')}`);
      }

      // This file's own CLI, the route `with-fleet.sh --actions` execs: it has no direct path, and it answers the same.
      writeFileSync(join(dir, 'conformance-actions.json'), JSON.stringify(ACTIONS), 'utf8');
      let nowMs = T0;
      const clock = { now: () => nowMs, elapsed: () => nowMs - T0 };
      const seen = [];
      const printed = [];
      const [keepLog, keepErr] = [console.log, console.error];
      console.log = () => {};
      console.error = (l) => printed.push(String(l));
      let code;
      try {
        code = await main(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'conformance-actions.json')], {
          env: { GITHUB_TOKEN: TOKEN, [SESSION_ENV]: SESSION },
          send: { fetch: platform({ runs: () => [] }, seen, clock), pace: freshPace(), now: clock.now, sleep: async (ms) => { nowMs += ms; }, log: () => {}, ceilings: { startMs: 90_000, ceilingMs: 300_000, pollMs: 5_000, notes: [] } },
        });
      } finally {
        [console.log, console.error] = [keepLog, keepErr];
      }
      t(
        "this file's own CLI answers the same: exit 6 after ONE dispatch, no other write, the shared UNCONFIRMED sentence printed",
        [code, seen.filter((x) => x.call === DISPATCH).length, seen.filter((x) => x.call !== DISPATCH && isDirectWrite(x.call)).length, printed.join('\n').includes(shared({ status: 204, state: 'no-run' }))],
        [EXIT_UNCONFIRMED, 1, 0, true],
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
    console.error(`✗ fleet-write/dispatch self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ fleet-write/dispatch self-test: ${cases.length} cases pass across ${declared.length} batteries — the transport selector that never guesses, ` +
      'the session on the envelope, one paced dispatch per stroke, a run found by its request id and waited to its conclusion, both ceilings answered UNCONFIRMED and never retried, ' +
      'and every body read back after a success run — the card\'s 41,699 bytes byte-exact across every 16 KiB boundary, a corrupted read-back NOT STORED (exit 4), an unfound one UNCONFIRMED (6) ' +
      "only after a lagging issue list was re-read on its bounded schedule — unless the run's annotation named the new number, which is read at once and never listed — the create never re-sent; " +
      'and every relay sender, discovered from the source, answering an accepted dispatch with no run, or none completed, UNCONFIRMED (6) with ZERO direct writes, under auto as under dispatch (the no-run conformance).',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch (the CLI)
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { repo: null, actionsFile: null, session: null, requestId: null, dryRun: false, json: false, selfTest: false, help: false, route: false, errors: [] };
  const args = [...argv];
  const value = (flag) => {
    const v = args.shift();
    if (v === undefined || v.startsWith('--')) {
      opts.errors.push(`${flag} needs a value`);
      return null;
    }
    return v;
  };
  while (args.length) {
    const a = args.shift();
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--route') opts.route = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--repo') opts.repo = value(a);
    else if (a === '--actions-file') opts.actionsFile = value(a);
    else if (a === '--session') opts.session = value(a);
    else if (a === '--request-id') opts.requestId = value(a);
    else if (a.startsWith('--') && a.includes('=')) {
      const [k, ...rest] = a.split('=');
      args.unshift(k, rest.join('='));
    } else opts.errors.push(`unrecognised argument ${JSON.stringify(a)}`);
  }
  if (!opts.selfTest && !opts.help && !opts.route) {
    if (!opts.repo) opts.errors.push('--repo owner/name is required (the TARGET repo)');
    if (!opts.actionsFile) opts.errors.push('--actions-file <path> is required — a JSON array of actions');
  }
  return opts;
}

const USAGE = [
  'usage:',
  '  node scripts/pm/fleet-write/dispatch.mjs --repo owner/name --actions-file actions.json [--session session_…] [--request-id id] [--json]',
  '  node scripts/pm/fleet-write/dispatch.mjs --repo owner/name --actions-file actions.json --dry-run',
  '  node scripts/pm/fleet-write/dispatch.mjs --route        # ONE JSON line: the transport this environment resolves to, and why',
  '  node scripts/pm/fleet-write/dispatch.mjs --self-test',
  '',
  `  The session comes from --session, else ${SESSION_ENV}, else — in a cloud seat container — the container's own`,
  `  ${CONTAINER_SESSION_ENV} (cse_<id> → session_<id>); ${SESSION_ENV} overrides the container (a local checkout, a test).`,
  `  ⛔ Never as a prefix on the command line: the seats' allow rules are literal command prefixes. The dispatch always`,
  `  goes to ${RELAY_REPO}; --repo names the target.`,
  `  Exits: ${EXIT_OK} run succeeded and every body reads back as sent · ${EXIT_USAGE} usage / payload refused · ${EXIT_PREREQUISITE} prerequisite ·`,
  `         ${EXIT_NOT_STORED} NOT STORED (the run succeeded, a body reads back otherwise — go READ, never retry) · ${EXIT_PLATFORM_REFUSAL} dispatch refused or run failed ·`,
  `         ${EXIT_UNCONFIRMED} UNCONFIRMED (no run, no completion within the ceiling, or a body not read back) · ${EXIT_WRITE_PACE_REFUSED} throttle refused`,
].join('\n');

function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
    guard: PROXY_REARM_GUARD,
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — the dispatch will bypass the proxy.`);
  return null;
}

/**
 * The CLI. `deps` is the self-test's door and nothing else's: `env` stands in
 * for `process.env` and `send` is handed to `sendFleetWrite` (a fake platform,
 * a throttle file, a clock), so a corrupted read-back can be driven end to end
 * through the exit code a seat actually reads.
 */
export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (opts.selfTest) return selfTest();
  if (opts.errors.length) {
    for (const e of opts.errors) console.error(`fleet-write/dispatch: ${e}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  if (opts.route) {
    // The liveness read is a GET to the board; in a cloud container it needs the proxy route like every other request.
    const rearmedForRoute = rearmThroughProxy(argv);
    if (rearmedForRoute !== null) return rearmedForRoute;
    const r = await resolveRoute(process.env);
    console.log(JSON.stringify({ requested: r.requested, transport: r.transport, failed: r.failed ?? null, session: r.session ?? null, session_source: r.sessionSource ?? null, reason: r.reason, error: r.error ?? null }));
    return r.error ? EXIT_PREREQUISITE : EXIT_OK;
  }
  let actions;
  try {
    actions = JSON.parse(readFileSync(opts.actionsFile, 'utf8'));
  } catch (e) {
    console.error(`fleet-write/dispatch: --actions-file ${opts.actionsFile} cannot be read as JSON (${e?.message ?? 'unreadable'}). Nothing was sent.`);
    return EXIT_USAGE;
  }
  const session = opts.session ?? sessionFrom(env);
  if (!session || !SESSION_SHAPE.test(session)) {
    console.error(
      `fleet-write/dispatch: PREREQUISITE NOT MET — no session id: ${sessionSource(env).reason}. Pass --session session_…, or set ${SESSION_ENV} (a cloud seat container supplies it as ${CONTAINER_SESSION_ENV}=cse_<id>; the explicit variable overrides it). The envelope carries the dispatching seat's identity; it is never invented. Nothing was sent.`,
    );
    return EXIT_PREREQUISITE;
  }
  const packed = packRequest({ repo: opts.repo, session, actions, requestId: opts.requestId });
  if (!packed.ok) {
    console.error(refusalText(packed.errors));
    console.error('fleet-write/dispatch: nothing was sent.');
    return EXIT_USAGE;
  }
  if (opts.dryRun) {
    console.error(`fleet-write/dispatch: DRY RUN — nothing sent. This is the request POST /repos/${RELAY_REPO}/dispatches would carry:`);
    console.log(JSON.stringify({ event_type: RELAY_EVENT_TYPE, client_payload: packed.payload }, null, 2));
    return EXIT_OK;
  }
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '';
  if (!token) {
    console.error('fleet-write/dispatch: PREREQUISITE NOT MET — no GITHUB_TOKEN / GH_TOKEN in the environment. Nothing was sent.');
    return EXIT_PREREQUISITE;
  }
  if (!deps.send) {
    const rearmed = rearmThroughProxy(argv);
    if (rearmed !== null) return rearmed;
  }
  const tool = 'scripts/pm/fleet-write/dispatch.mjs';
  const result = await sendFleetWrite(packed.payload, { token, ...(deps.send ?? {}) });
  if (!result.ok && (result.state === 'no-run' || result.state === 'timeout')) console.error(unconfirmedText(result, tool));
  if (result.notStored) console.error(notStoredText(result, tool));
  if (result.state === 'unverified') console.error(unverifiedText(result, tool));
  if (opts.json) {
    console.log(
      JSON.stringify({
        request_id: packed.payload.request_id,
        state: result.state,
        ok: result.ok,
        not_stored: result.notStored === true,
        run: result.run,
        dispatched_at: new Date(result.dispatchedAt).toISOString(),
        read_back: (result.readBack?.rows ?? []).map((r) => ({ action: r.action, op: r.op, where: r.where, verdict: r.verdict, class: r.cls, first_difference_byte: r.offset ?? null, sent_bytes: r.sentBytes ?? null, stored_bytes: r.storedBytes ?? null, found_by: r.foundBy ?? null })),
        annotations: (result.annotations?.rows ?? []).map((a) => ({ action: a.action, op: a.op, number: a.number, url: a.url })),
      }),
    );
  }
  return result.ok ? EXIT_OK : exitForResult(result);
}

// ⛔ No top-level await here. The read-back imports post-stamped, which imports THIS file: were this module's evaluation
// still pending on `await main(…)`, that import would wait on it while it waits on the import — a deadlock node reports
// as exit 13, "unsettled top-level await" (measured, the first time the read-back ran from this entry). Settling the
// evaluation first and running `main` after it is what makes the dynamic import in `loadReadBackJudge` safe.
if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
      console.error(
        '\n✗ fleet-write/dispatch self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
          'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  });
}

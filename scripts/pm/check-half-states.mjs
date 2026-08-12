#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PM half-state sweeper (#7341 item 2) — REPORT-ONLY enumeration of the
 * label/assignee invariants the dispatch protocol calls "过夜半状态".
 *
 *   node scripts/pm/check-half-states.mjs               # sweep the live repo
 *   node scripts/pm/check-half-states.mjs --probe       # can live mode run HERE? (no sweep)
 *   node scripts/pm/check-half-states.mjs --self-test   # verify the predicates offline
 *
 * ## Why report-only, and why the exit code is ALWAYS 0 on a completed sweep
 *
 * The pm-dispatch state model (.claude/skills/pm-dispatch/SKILL.md, "State
 * model") says the labels ARE the state machine, and its label discipline says
 * 「状态变更不过夜」: a label applied without its paired signal is a state no
 * sweep can interpret. Those half-states occur in practice — a card carried
 * `pm:queue` AND `pm:dispatched` simultaneously for ~14 hours (#5925's
 * 2026-08-09 correction comment); another sat dispatched with an assignee and
 * no claim for 48h+ (the #5925 stale-claim reclaim) — and today finding them
 * is a manual read of every card. This script is the mechanical enumerator.
 *
 * It is deliberately NOT a gate: a half-state is a fact about a live, shared
 * board, not about the PR that happens to run CI next — failing an unrelated
 * PR over board state would punish the wrong actor (the same reasoning that
 * keeps `check:platform-checklist` out of CI, lint.yml's own note). So a
 * completed sweep exits 0 whether it found 0 or 40 violations; the findings
 * are the output, and the consumer is a PM seat's patrol round (the standby
 * posture in SKILL.md documents the invocation). Only a sweep that could not
 * run (network, auth, bad usage) exits non-zero — per #4690, "could not read
 * the input" must never look like "input is clean".
 *
 * ## The invariants (each names its protocol source)
 *
 *   H1  `pm:dispatched` with no assignee — dispatch marks a claim; a claim is
 *       assign + claim comment (state model / step 4).
 *   H2  assignee set on a pm-tracked card, but no claim comment on the thread
 *       (a comment whose body carries a "Claim:" line) — the assignee field
 *       alone cannot say WHICH session owns it (step 4; #4588). The marker is
 *       read with an OPTIONAL leading blockquote ">", because step 4's own
 *       claim template is a blockquote (SKILL.md, "> Claim: …") — the predicate
 *       used to reject the exact shape the skill tells every seat to write, and
 *       reported a correctly-claimed card as a half-state (#7488, measured on
 *       #6752). The strictness either side of that marker is deliberate and
 *       stays: the line must BEGIN with the word, so ordinary prose containing
 *       "claim" is not a claim comment.
 *   H3  `pm:queue` + `pm:dispatched` both present — reads as available to the
 *       queue view and in-flight to the lane view; neither is trustworthy
 *       (#5925 2026-08-09 correction, the measured specimen).
 *   H4  `pm:blocked` without a `Blocked-by:` body line — the machine half of
 *       the label is the body line; without it the unlock sweep can never
 *       return the card (state model, label discipline).
 *   H5  `pm:seat` sticker whose title/assignee pair is out of sync — the
 *       seat-sticker protocol makes 标题、assignee、正文 a same-write triple:
 *       a title claiming 🟢 <login> must have that login as assignee; a title
 *       claiming ⏳ vacant must have none. (Routine seats declare 🟢 Routine
 *       and are exempt from the assignee half — bots can't be assigned.)
 *   H6  `pm:seat` sticker whose body exceeds ~10 KB — the seat-post protocol
 *       bounds the live body to current state (six-section template, #7583,
 *       maintainer-accepted 2026-08-11); an oversized body means shift
 *       narration is accreting where per-card state already lives (cards,
 *       PRs, round reports). Soft report-only signal: the remedy is a
 *       takeover-style compaction (edit history is the archive), never
 *       truncation. #6019 reached ~61 KB and exceeded tool read limits
 *       before this rule existed.
 *
 * The body half of H5 (the 「当前 PM」 paragraph) is NOT machine-checked here:
 * seat-sticker bodies are prose with no pinned grammar, and a fuzzy parser
 * would report phantom desyncs — the #4690 shape in mirror image. The
 * title/assignee pair is the mechanical half; the sweep prints the sticker
 * URL so the patrol reads the body itself.
 *
 * ## Transport prerequisite — MEASURED per run, never assumed (#7412)
 *
 * Live mode talks to `api.github.com` over node's global `fetch`, and that needs
 * two things this repo's agent containers do NOT uniformly provide:
 *
 *   1. a route to `api.github.com` from NODE. Node's `fetch` (undici) ignores
 *      `HTTPS_PROXY`, so it does not share the path `curl`, `gh` and the
 *      `mcp__github__*` tools take. A container where `curl https://api.github.com`
 *      answers 200 can be one where this script reaches nothing, and the reverse
 *      also occurs. `curl` is therefore NOT a valid pre-flight for this script;
 *      the probe below is.
 *   2. either NO token, or a token that really is a GitHub credential.
 *      `GITHUB_TOKEN` / `GH_TOKEN` being SET does not make them GitHub tokens:
 *      in agent containers both are commonly the agent proxy's own 14-character
 *      `prox…` placeholder. Sending that as a Bearer earns a hard 401 — strictly
 *      WORSE than sending nothing, because the token fallback at `TOKEN` turns a
 *      container where anonymous access WOULD have worked into one where the
 *      sweep cannot start.
 *
 * The paragraph this replaces claimed "unauthenticated works at 60 req/h". That
 * is not a fact about this script's environment. Three container classes have
 * been measured and no two agree:
 *
 *   PM seat session (#7412 as filed) — proxy denies the host (curl 403 with and
 *       without the token), node fetch 401. GitHub access is MCP-only there, so
 *       live mode cannot run at all.
 *   Triage Routine (#7412 comment, 2026-08-11) — host reachable AND the injected
 *       `GITHUB_TOKEN` is a real credential (`/rate_limit` 200, 15000 core
 *       quota). Live mode runs fully.
 *   Cloud dev session (this change's own measurement, 2026-08-11) — node fetch
 *       reaches the host, but NEITHER identity can read the board: the token is
 *       the `prox…` placeholder (401 Bad credentials), and anonymous is 403
 *       `API rate limit exceeded for <ip>` because the 60 req/h anonymous quota
 *       is counted per EGRESS IP and was already spent by other containers
 *       behind the same NAT. Meanwhile `curl` answered 200 BOTH ways, because it
 *       honours HTTPS_PROXY and the proxy substitutes a real credential — the
 *       misleading pre-flight point 1 warns about, measured.
 *
 * That last class also produced the trap worth naming: `/rate_limit` is EXEMPT
 * from the limit it reports. With the quota spent it still answers 200 (carrying
 * `x-ratelimit-remaining: 0`) while every other endpoint answers 403 — so a
 * probe that reads only the status code cheerfully green-lights a sweep that
 * cannot make one request. The first draft of the probe below did exactly that.
 * `probeIsUsable` is that lesson, and the self-test pins it.
 *
 * So the script PROBES (`GET /rate_limit`, which costs no core quota) before it
 * sweeps. A failed probe prints a classified PREREQUISITE NOT MET report naming
 * which of the two requirements is unmet and the one command that satisfies it —
 * never a sweep result. `--probe` runs that check alone, which is what a seat
 * should use to answer "can live mode run in THIS container?".
 *
 * Deliberately NOT decided here: whether these scripts should grow an MCP-backed
 * transport or a required-real-token doctrine. That depends on where
 * `scripts/pm/**` live modes are meant to execute, which is a maintainer call
 * (#7412 triage, explicitly out of scope). This change only stops the file from
 * lying about the transport it has. It does not drop, substitute or re-route the
 * token, so a container where the sweep worked before works identically after.
 *
 * REST only, never GraphQL (Operational notes 3: the loop's hot path stays on
 * the core quota).
 *
 * ## Exit codes
 *
 *   0  the sweep completed — 0 or 40 findings alike (report-only, see above).
 *   3  PREREQUISITE NOT MET — a classified transport failure. Nothing was swept,
 *      and the report says so instead of implying a clean board.
 *   2  the sweep could not run for a reason this file cannot classify. The
 *      pre-existing catch-all, kept so an unfamiliar failure stays loud (#4690).
 *
 * 2 and 3 are both non-zero, so any wrapper reading non-zero as failure behaves
 * exactly as before. The split exists so a patrol can tell "this container was
 * never able to run the live sweep" (3 — expected, go run it elsewhere) from
 * "something broke" (2 — investigate).
 */

import process from 'node:process';

const OWNER_REPO = process.env.PM_SWEEP_REPO ?? 'objectstack-ai/objectstack';
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

// ---------------------------------------------------------------------------
// Predicates — pure functions over the REST issue shape, so the self-test can
// drive them with fixtures and the live sweep stays a thin fetch loop.
// ---------------------------------------------------------------------------

export function labelNames(issue) {
  return (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}

export function h1DispatchedNoAssignee(issue) {
  const labels = labelNames(issue);
  return labels.includes('pm:dispatched') && (issue.assignees ?? []).length === 0;
}

export function h2AssigneeNoClaimComment(issue, commentBodies) {
  const labels = labelNames(issue);
  const pmTracked = labels.some((l) => l === 'pm:queue' || l === 'pm:dispatched');
  if (!pmTracked || (issue.assignees ?? []).length === 0) return false;
  return !commentBodies.some((b) => /^\s*>?\s*Claim(?:ed)?\s*[::]/mi.test(b ?? ''));
}

export function h3QueueAndDispatched(issue) {
  const labels = labelNames(issue);
  return labels.includes('pm:queue') && labels.includes('pm:dispatched');
}

export function h4BlockedNoBlockedBy(issue) {
  const labels = labelNames(issue);
  if (!labels.includes('pm:blocked')) return false;
  return !/^\s*Blocked-by:\s*\S/m.test(issue.body ?? '');
}

// H5 returns null (in sync), a string naming the desync, or undefined when the
// title doesn't parse as a seat sticker (reported as its own finding — an
// unparseable status board row is a desync of the board itself).
export function h5SeatStickerDesync(issue) {
  const m = /^\[PM seat\]\s*(.*?)\s*—\s*(.*)$/u.exec(issue.title ?? '');
  if (!m) return 'title does not match 「[PM seat] <seat> — <status>」';
  const status = m[2].trim();
  const assignees = (issue.assignees ?? []).map((a) => a.login);
  if (status.startsWith('🟢')) {
    const holder = status.replace('🟢', '').trim();
    if (holder === 'Routine') return null; // Routine seats keep assignee empty by design
    if (!assignees.includes(holder)) {
      return `title says 🟢 ${holder} but assignees are [${assignees.join(', ') || 'none'}]`;
    }
    return null;
  }
  if (status.startsWith('⏳')) {
    return assignees.length > 0
      ? `title says ⏳ vacant but assignees are [${assignees.join(', ')}]`
      : null;
  }
  if (status.startsWith('⏸️') || status.startsWith('⏸')) return null; // paused: assignee state is the maintainer's call
  return `unrecognized status word 「${status}」`;
}

// H6 — soft size bound on seat-sticker bodies (#7583). Report-only like every
// other item; the threshold is deliberately generous (the compacted #6019 body
// is ~4.5 KB, the pathological one was ~61 KB) so a healthy six-section body
// never trips it. Byte length, not code points: the read-limit failure this
// guards against is byte-sized.
export const SEAT_BODY_SOFT_LIMIT = 10_000;

export function h6SeatBodyOversized(issue, limit = SEAT_BODY_SOFT_LIMIT) {
  if (!labelNames(issue).includes('pm:seat')) return false;
  return Buffer.byteLength(issue.body ?? '', 'utf8') > limit;
}

// ---------------------------------------------------------------------------
// Transport prerequisite — the classifier (pure) and the probe that feeds it.
//
// Modelled on `scripts/cli-build-prerequisite.mjs`: the knowledge lives in pure
// functions the self-test can drive with the REAL measured observations, and the
// WORDING stays here, next to the only code that knows what it did not check.
// Kept in this file rather than shared with the CLI-build prerequisites — those
// classify a subprocess's stderr, this classifies HTTP observations; a common
// module would be one name over two unrelated corpora.
// ---------------------------------------------------------------------------

/** The exit code for a classified transport prerequisite failure (see header). */
export const EXIT_PREREQUISITE_NOT_MET = 3;

/**
 * What the token in the environment LOOKS like — never whether it is valid; only
 * GitHub can say that, and a 401 is it saying so. This exists to enrich the
 * report ("…and it carries no GitHub token prefix"), never to pre-reject a token:
 * pre-rejecting on shape would silently drop a credential in a format GitHub
 * added after this line was written, which is the confident-wrong-diagnosis
 * failure the sibling module is built to avoid.
 *
 * `redacted` is prefix-plus-length, the same form #7412 used to report the
 * `prox…` placeholder. A real token's first four characters are its public
 * prefix, so this is safe to print; the rest never is.
 *
 * @param {string} token
 * @returns {{ present: boolean, shape: 'absent'|'github-prefix'|'legacy-40-hex'|'unrecognized', redacted: string }}
 */
export function describeToken(token) {
  const t = String(token ?? '');
  if (!t) return { present: false, shape: 'absent', redacted: '<unset>' };
  const redacted = `${t.slice(0, 4)}… (len ${t.length})`;
  if (/^(?:gh[pousr]_|github_pat_)/.test(t)) return { present: true, shape: 'github-prefix', redacted };
  if (/^[0-9a-f]{40}$/.test(t)) return { present: true, shape: 'legacy-40-hex', redacted };
  return { present: true, shape: 'unrecognized', redacted };
}

/**
 * Whether a probe result means "requests will actually go through" — which is
 * NOT the same as "the probe returned 200".
 *
 * `/rate_limit` is exempt from the rate limit it reports: with the anonymous
 * quota spent it still answers 200, carrying `x-ratelimit-remaining: 0`, while
 * `/repos/…/issues` answers 403 `API rate limit exceeded`. Measured on this
 * change's own container, where the first draft of this probe green-lit a sweep
 * that then failed on its very first page. A `null` remaining (header absent) is
 * treated as usable: absence is not evidence of exhaustion, and the in-loop net
 * is the backstop.
 */
export function probeIsUsable(result) {
  if (!result || result.networkError) return false;
  return result.status === 200 && result.rateLimitRemaining !== 0;
}

/**
 * `x-ratelimit-remaining` as a number, or null when the header is absent.
 *
 * The null matters and `Number()` alone will not give it: `Number(null)` is 0,
 * and a 401 carries no rate-limit headers at all — so the naive read turns every
 * bad-credential response into "quota exhausted" and would misprescribe the
 * remedy. Absent means unknown, and `probeIsUsable` treats unknown as usable.
 */
export function parseRemaining(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** One probe result as a readable clause, for the report's evidence lines. */
export function describeProbe(result) {
  if (!result) return 'not attempted';
  if (result.networkError) return `did not complete (${result.networkError})`;
  if (result.status === 200 && result.rateLimitRemaining === 0) {
    return 'HTTP 200 but with x-ratelimit-remaining: 0 — the quota endpoint is exempt from the limit it reports, so every other endpoint answers 403';
  }
  const left = result.rateLimitRemaining === null || result.rateLimitRemaining === undefined ? '' : ` (${result.rateLimitRemaining} left)`;
  return `HTTP ${result.status}${left}`;
}

/**
 * The exhausted-quota verdict, shared by the two observations that mean it: a
 * 403 on a real endpoint, and `/rate_limit`'s exempt 200 with 0 remaining.
 */
function rateLimitedVerdict(tok, result, how) {
  return {
    kind: 'rate-limited',
    headline: tok.present
      ? 'the API rate limit for this credential is exhausted'
      : 'the anonymous API rate limit (60 req/h) is exhausted for this egress IP',
    detail: [
      `\`GET /rate_limit\` -> ${describeProbe(result)}.`,
      ...(how ? [`In this state ${how}.`] : []),
      ``,
      ...(tok.present
        ? [`The quota refills on the hour.`]
        : [
            `The anonymous 60 req/h is counted per EGRESS IP, not per container, so in a`,
            `shared-NAT agent container it is routinely already spent by neighbours — being`,
            `"unauthenticated" is not a quota of one's own. It refills on the hour.`,
          ]),
    ],
    fix: tok.present
      ? ['wait for the quota window, or use a credential with a larger quota.']
      : ['export GITHUB_TOKEN=<a real GitHub token> (5,000+ req/h), or wait for the window.'],
  };
}

/**
 * Turn probe OBSERVATIONS into a named prerequisite verdict. Pure — the network
 * lives in `probeTransport` — so `--self-test` can pin every branch against the
 * three container classes actually measured in #7412.
 *
 * Deliberately narrow, in the same direction as `looksLikeStaleWorkspaceDist`:
 * an unrecognised status comes back as `null` (= "not a failure this classifier
 * can name") and the caller keeps its pre-existing loud generic failure. A wrong
 * confident diagnosis here would send a seat to fix a credential when GitHub was
 * merely down.
 *
 * @param {{ token?: string, authed?: object|null, anon?: object|null }} obs
 *   `authed` / `anon` are each `{ status, rateLimitRemaining }` or
 *   `{ networkError }`; `anon` is only gathered when a token was used and failed.
 * @returns {{ kind: string, headline: string, detail: string[], fix: string[] } | null}
 */
export function classifyTransportProbe(obs) {
  const token = obs?.token ?? '';
  const tok = describeToken(token);
  const authed = obs?.authed ?? null;
  const anon = obs?.anon ?? null;
  const primary = tok.present ? authed : anon;
  if (!primary) return null;
  const anonUsable = probeIsUsable(anon);

  const shapeNote =
    tok.shape === 'unrecognized'
      ? `The value carries no GitHub token prefix (\`ghp_\`/\`gho_\`/\`ghs_\`/\`github_pat_\`) — in`
      : `The value has a GitHub token shape, so it is a credential this account no longer holds —`;
  const shapeNote2 =
    tok.shape === 'unrecognized'
      ? `agent containers this is normally the proxy's own placeholder, not a credential.`
      : `expired, revoked, or scoped to a different repo.`;

  if (primary.networkError) {
    return {
      kind: 'host-unreachable',
      headline: '`api.github.com` is not reachable from node in this container',
      detail: [
        `\`GET /rate_limit\` did not complete: ${primary.networkError}`,
        ``,
        `Node's fetch does not use HTTPS_PROXY, so this says nothing about \`curl\`, \`gh\``,
        `or the \`mcp__github__*\` tools — those may all work here and still not be this`,
        `script's transport.`,
      ],
      fix: [
        'run the sweep from a container with direct egress to api.github.com (CI, or',
        'the Routine seat class); in an MCP-only seat the board read stays manual.',
      ],
    };
  }

  // A 200 from `/rate_limit` is NOT sufficient, and finding that out is what the
  // measurement below cost: GitHub exempts `/rate_limit` from the limit it
  // reports, so it keeps answering 200 with `x-ratelimit-remaining: 0` while
  // every other endpoint answers 403. A probe that read only the status would
  // vouch for a sweep that cannot make a single request — the exact
  // "green check that checked nothing" this file exists to refuse (#4690).
  if (primary.status === 200 && primary.rateLimitRemaining === 0) {
    return rateLimitedVerdict(tok, primary, 'every OTHER endpoint answers 403 `API rate limit exceeded`');
  }

  if (primary.status === 200) {
    return {
      kind: 'reachable',
      headline: tok.present
        ? 'api.github.com is reachable and the token authenticates'
        : 'api.github.com is reachable anonymously (no token in the environment)',
      detail: [],
      fix: [],
    };
  }

  if (primary.status === 401 || (primary.status === 403 && anonUsable)) {
    const anonWorks = anonUsable;
    return {
      kind: anonWorks ? 'bad-credential-anon-reachable' : 'bad-credential',
      headline: anonWorks
        ? 'the token in the environment is not a valid GitHub credential — and it is the ONLY thing stopping the sweep'
        : 'the token in the environment is not a valid GitHub credential',
      detail: [
        `\`GET /rate_limit\` with GITHUB_TOKEN/GH_TOKEN = ${tok.redacted} -> ${describeProbe(primary)}.`,
        ...(anon ? [`The same request with NO token -> ${describeProbe(anon)}.`] : []),
        ``,
        `${shapeNote} ${shapeNote2}`,
        ``,
        ...(anonWorks
          ? [
              `The host IS reachable from node here and anonymous access has quota left, so`,
              `the credential is the only thing in the way.`,
              ``,
              `This script does not drop the token on its own — which token to send is the`,
              `caller's decision, and silently sweeping as a different identity is not a call`,
              `a report-only tool should make (#7412 triage: transport doctrine is the`,
              `maintainer's).`,
            ]
          : [
              `Dropping the token would NOT be enough here: the anonymous path is unusable`,
              `too, so this container needs a real credential rather than a re-run.`,
            ]),
      ],
      fix: anonWorks
        ? [
            'GITHUB_TOKEN= GH_TOKEN= node scripts/pm/check-half-states.mjs',
            '  ↑ anonymous is 60 req/h and that quota is per EGRESS IP, shared with every',
            '    other container behind it. This sweep spends one request per label page plus',
            '    one per assigned pm-tracked card, so it can exhaust mid-run — which surfaces',
            '    as another PREREQUISITE NOT MET, never as a short finding list.',
          ]
        : ['export GITHUB_TOKEN=<a real GitHub token> and re-run (see the anonymous reading above).'],
    };
  }

  if (primary.status === 403) {
    if (primary.rateLimitRemaining === 0) {
      return rateLimitedVerdict(tok, primary, '');
    }
    return {
      kind: 'host-unreachable',
      headline: '`api.github.com` answers 403 in this container — the host is refusing, not rate-limiting',
      detail: [
        `\`GET /rate_limit\` -> HTTP 403${tok.present ? ` with GITHUB_TOKEN/GH_TOKEN = ${tok.redacted}` : ' (no token)'}.`,
        ...(anon ? [`The same request with NO token -> ${anon.networkError ? anon.networkError : `HTTP ${anon.status}`}.`] : []),
        ``,
        `403 in both directions with quota left is the egress proxy refusing the host,`,
        `not GitHub refusing the caller — the shape #7412 measured in a PM seat session.`,
        `\`curl\` and the \`mcp__github__*\` tools take a different path and may still work.`,
      ],
      fix: [
        'run the sweep from a container with direct egress to api.github.com (CI, or',
        'the Routine seat class); in an MCP-only seat the board read stays manual.',
      ],
    };
  }

  return null;
}

/**
 * The observations, gathered from the live host. `/rate_limit` is the probe
 * because it is the one endpoint that costs no core quota — asking "can I read
 * this board?" must not spend the budget the sweep then needs.
 *
 * The second, token-less probe fires ONLY when a token was sent and failed. That
 * is what separates "the credential is bad" from "the host is unreachable" —
 * two facts with different remedies that the card's original measurement could
 * not tell apart. The healthy path stays at exactly one request.
 */
async function probeRateLimit(token) {
  try {
    const res = await fetch(`${API}/rate_limit`, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    return { status: res.status, rateLimitRemaining: parseRemaining(res.headers.get('x-ratelimit-remaining')) };
  } catch (err) {
    return { networkError: err?.cause?.code ?? err?.cause?.message ?? err?.message ?? 'fetch failed' };
  }
}

async function probeTransport() {
  const first = await probeRateLimit(TOKEN);
  if (!TOKEN) return classifyTransportProbe({ token: '', anon: first });
  if (first.status === 200) return classifyTransportProbe({ token: TOKEN, authed: first });
  return classifyTransportProbe({ token: TOKEN, authed: first, anon: await probeRateLimit('') });
}

/**
 * The prerequisite printer. Its load-bearing half is the closing paragraph: the
 * whole point of #4690 is that "could not read the input" must never be legible
 * as "the input is clean", and on a REPORT-ONLY tool that risk is sharper than
 * on a gate — a silent run of this script looks exactly like a healthy board.
 *
 * `swept` keeps that paragraph TRUE when the failure arrives mid-run: the
 * pre-sweep probe fires at 0, where "nothing was listed" is exact, while the
 * in-loop net can fire after some labels were already read. Same invariant as
 * `check-i18n-bundles`'s partial-round wording (#7681/#6033).
 *
 * @param {{ kind: string, headline: string, detail: string[], fix: string[] }} v
 * @param {{ swept?: number }} [options]
 */
function reportPrerequisiteNotMet(v, options = {}) {
  const { swept = 0 } = options;
  const nothing =
    swept === 0
      ? [
          `  Nothing was swept: no issue was listed and no predicate (H1–H6) ran, so this`,
          `  result says NOTHING about whether the board carries half-states. It is not a`,
          `  clean board and it is not a dirty one — it is no reading at all.`,
        ]
      : [
          `  Nothing was judged: the transport failed after ${swept} issue(s) had been listed,`,
          `  the rest were never fetched, and no finding line was printed — H2 in particular`,
          `  needs a per-card comment fetch that never happened. An empty finding list here`,
          `  is not a clean board.`,
        ];
  console.error(
    `\ncheck-half-states: PREREQUISITE NOT MET — ${v.headline}\n\n` +
      v.detail.map((l) => (l ? `  ${l}` : '')).join('\n') +
      `\n\n  Fix:  ${v.fix[0] ?? 'unknown'}\n` +
      v.fix.slice(1).map((l) => `        ${l}\n`).join('') +
      `\n${nothing.join('\n')}\n` +
      `  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from the unclassified failure's 2 — but piping this\n` +
      `  reports the PIPE's status, so \`… | tail -4\` reads green either way. Use \`echo "EXIT=$?"\`.)`,
  );
  process.exit(EXIT_PREREQUISITE_NOT_MET);
}

// ---------------------------------------------------------------------------
// Live sweep
// ---------------------------------------------------------------------------

async function rest(path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    // The status rides along so the in-loop net can re-classify rather than
    // re-parse the message — the same reason the CLI prerequisites return the
    // matched sentence instead of a boolean.
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function listIssues(label) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await rest(
      `/repos/${OWNER_REPO}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100&page=${page}`,
    );
    out.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return out;
}

async function sweep() {
  // Answered once, before any listing — so an unusable transport costs ONE
  // classified verdict instead of a raw HTTP status from whichever label page
  // happened to go first (`pm:dispatched`, in the failure #7412 recorded).
  const pre = await probeTransport();
  if (pre && pre.kind !== 'reachable') reportPrerequisiteNotMet(pre);

  const findings = [];
  const seen = new Map();
  try {
    await sweepInto(findings, seen);
  } catch (err) {
    err.sweptSoFar = seen.size;
    throw err;
  }

  findings.sort((a, b) => a[0].number - b[0].number);
  for (const [issue, code, msg] of findings) {
    console.log(`  ${code} #${issue.number} ${msg}\n     ${issue.html_url}`);
  }
  console.log(
    `check-half-states: swept ${seen.size} open pm-labeled issue(s) in ${OWNER_REPO} — ` +
      `${findings.length} half-state(s) found. Report-only: findings are patrol input, not a gate verdict.`,
  );
}

async function sweepInto(findings, seen) {
  for (const label of ['pm:dispatched', 'pm:queue', 'pm:blocked', 'pm:seat']) {
    for (const issue of await listIssues(label)) seen.set(issue.number, issue);
  }

  for (const issue of seen.values()) {
    const labels = labelNames(issue);
    if (h1DispatchedNoAssignee(issue)) {
      findings.push([issue, 'H1', '`pm:dispatched` with no assignee']);
    }
    if (h3QueueAndDispatched(issue)) {
      findings.push([issue, 'H3', '`pm:queue` and `pm:dispatched` both present']);
    }
    if (h4BlockedNoBlockedBy(issue)) {
      findings.push([issue, 'H4', '`pm:blocked` without a `Blocked-by:` body line']);
    }
    if (labels.includes('pm:seat')) {
      const desync = h5SeatStickerDesync(issue);
      if (desync) findings.push([issue, 'H5', desync]);
      if (h6SeatBodyOversized(issue)) {
        const kb = (Buffer.byteLength(issue.body ?? '', 'utf8') / 1024).toFixed(1);
        findings.push([issue, 'H6', `seat body is ${kb} KB (soft bound ~10 KB) — compact to the six-section current-state template (#7583; edit history is the archive)`]);
      }
    } else if ((issue.assignees ?? []).length > 0 && labels.some((l) => l.startsWith('pm:'))) {
      // H2 needs the comment thread — fetched only for candidates, and only
      // their first pages: a claim comment is posted at claim time, so on a
      // healthy card it is early in the thread; a >100-comment card with a
      // late claim shows up as a finding the patrol then reads by hand.
      const comments = await rest(`/repos/${OWNER_REPO}/issues/${issue.number}/comments?per_page=100`);
      if (h2AssigneeNoClaimComment(issue, comments.map((c) => c.body))) {
        findings.push([issue, 'H2', 'assignee set but no claim comment on the thread']);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Self-test — predicates and the transport classifier; no network.
// ---------------------------------------------------------------------------

function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => cases.push([name, actual, expected]);
  const issue = (labels, assignees = [], body = '', title = '') => ({
    labels: labels.map((name) => ({ name })),
    assignees: assignees.map((login) => ({ login })),
    body,
    title,
  });

  t('H1: dispatched + no assignee -> finding', h1DispatchedNoAssignee(issue(['pm:dispatched'])), true);
  t('H1: dispatched + assignee -> clean', h1DispatchedNoAssignee(issue(['pm:dispatched'], ['os-help'])), false);
  t('H2: assignee + no claim comment -> finding', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['looks good', 'triage: routed']), true);
  t('H2: assignee + claim comment -> clean', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['Claim: PM loop round 3\nSession: session_x']), false);
  t('H2: unassigned card is out of scope', h2AssigneeNoClaimComment(issue(['pm:queue']), []), false);
  // #7488: SKILL.md step 4's claim template IS a blockquote, so the documented
  // shape must read as a claim. Live specimen: #6752's "> Claim: PM loop wave 9".
  t('H2: blockquote claim comment (the documented shape) -> clean', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['> Claim: PM loop wave 9 (seat #6019)\n> Session: `session_x`\n> Branch: `claude/issue-6752-x`']), false);
  t('H2: indented blockquote claim -> clean', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['   > Claimed: PM loop round 3']), false);
  // …and the strictness the relaxation must NOT cost: the line still has to
  // BEGIN with the word, blockquote or not (#7488's explicit width limit).
  t('H2: prose containing the word claim -> still a finding', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['Nobody will claim: this card is ready\nthe seat did not claim it']), true);
  t('H2: blockquoted prose containing claim -> still a finding', h2AssigneeNoClaimComment(issue(['pm:dispatched'], ['os-help']), ['> the next seat should claim: only after the ruling lands']), true);
  t('H3: both queue labels -> finding', h3QueueAndDispatched(issue(['pm:queue', 'pm:dispatched'])), true);
  t('H3: dispatched alone -> clean', h3QueueAndDispatched(issue(['pm:dispatched'])), false);
  t('H4: blocked without body line -> finding', h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'waiting on upstream')), true);
  t('H4: blocked with Blocked-by line -> clean', h4BlockedNoBlockedBy(issue(['pm:blocked'], [], 'Blocked-by: #123')), false);
  t('H4: unblocked card is out of scope', h4BlockedNoBlockedBy(issue([], [], '')), false);
  t('H5: 🟢 login matching assignee -> clean', h5SeatStickerDesync(issue(['pm:seat'], ['os-zhuang'], '', '[PM seat] domain:devx — 🟢 os-zhuang')), null);
  t('H5: 🟢 login without assignee -> finding', typeof h5SeatStickerDesync(issue(['pm:seat'], [], '', '[PM seat] domain:devx — 🟢 os-zhuang')), 'string');
  t('H5: ⏳ vacant with assignee -> finding', typeof h5SeatStickerDesync(issue(['pm:seat'], ['os-help'], '', '[PM seat] domain:cli — ⏳ vacant')), 'string');
  t('H5: ⏳ vacant clean', h5SeatStickerDesync(issue(['pm:seat'], [], '', '[PM seat] domain:cli — ⏳ vacant')), null);
  t('H5: Routine seat needs no assignee', h5SeatStickerDesync(issue(['pm:seat'], [], '', '[PM seat] 分诊 — 🟢 Routine')), null);
  t('H5: unparseable title -> finding', typeof h5SeatStickerDesync(issue(['pm:seat'], [], '', 'devx seat registry')), 'string');
  t('H6: seat body over the soft bound -> finding', h6SeatBodyOversized(issue(['pm:seat'], [], 'x'.repeat(10_001), '[PM seat] domain:devx — ⏳ vacant')), true);
  t('H6: seat body at the bound -> clean', h6SeatBodyOversized(issue(['pm:seat'], [], 'x'.repeat(10_000), '[PM seat] domain:devx — ⏳ vacant')), false);
  // Byte length, not code points: multi-byte bodies trip the bound at the same
  // byte size the read-limit failure cares about (3 bytes per CJK char).
  t('H6: multi-byte body measured in bytes', h6SeatBodyOversized(issue(['pm:seat'], [], '账'.repeat(3_400), '[PM seat] domain:devx — ⏳ vacant')), true);
  t('H6: oversized body without pm:seat is out of scope', h6SeatBodyOversized(issue(['pm:queue'], [], 'x'.repeat(20_000), 'big card')), false);

  // -- transport prerequisite (#7412) ---------------------------------------
  // The three container classes are REAL measurements, not invented fixtures;
  // each names where it was taken, so a future transport change can be checked
  // against the environments that actually exist rather than against a guess.
  const kind = (o) => classifyTransportProbe(o)?.kind;

  // Class 1 — PM seat session, #7412 as filed: the host refuses in both
  // directions with quota left. Must NOT be reported as a credential problem:
  // a real token would not have helped, and sending a seat to find one wastes
  // the round.
  t(
    '#7412 class 1 (PM seat): 403 both ways -> host-unreachable',
    kind({ token: 'prox_placeholder', authed: { status: 403, rateLimitRemaining: 59 }, anon: { status: 403, rateLimitRemaining: 59 } }),
    'host-unreachable',
  );
  // Class 2 — triage Routine container: reachable with a real credential.
  t(
    '#7412 class 2 (Routine): authed 200 -> reachable',
    kind({ token: 'ghp_' + 'x'.repeat(36), authed: { status: 200, rateLimitRemaining: 14_999 } }),
    'reachable',
  );
  // Class 3a — a token GitHub rejects while anonymous still has quota. The
  // distinguishing case the card could not name: the ONLY fault is the
  // credential, and the remedy is a re-run, not a hunt for a token.
  t(
    'token 401 but anon has quota -> bad-credential-anon-reachable',
    kind({ token: 'prox_abcdefghi', authed: { status: 401, rateLimitRemaining: null }, anon: { status: 200, rateLimitRemaining: 59 } }),
    'bad-credential-anon-reachable',
  );
  t(
    'that verdict prescribes the token-less re-run, not a new credential',
    classifyTransportProbe({ token: 'prox_abcdefghi', authed: { status: 401 }, anon: { status: 200, rateLimitRemaining: 59 } }).fix[0].includes('GITHUB_TOKEN= GH_TOKEN='),
    true,
  );
  // Class 3b — the SAME container as actually measured on 2026-08-11: the token
  // 401s AND the shared-IP anonymous quota is spent. Dropping the token does not
  // help, so the verdict must not prescribe it — the first draft did, and the
  // prescribed command then failed with 403 on its first page.
  const class3 = classifyTransportProbe({
    token: 'prox_abcdefghi',
    authed: { status: 401, rateLimitRemaining: null },
    anon: { status: 200, rateLimitRemaining: 0 },
  });
  t('#7412 class 3 (cloud dev, measured): 401 + exhausted anon -> bad-credential', class3?.kind, 'bad-credential');
  t('…and it does NOT prescribe the token-less re-run', class3.fix.join(' ').includes('GITHUB_TOKEN= GH_TOKEN='), false);
  t('…and it names a real credential as the remedy', class3.fix[0].includes('a real GitHub token'), true);
  // The trap itself: `/rate_limit` is exempt from the limit it reports, so a
  // 200 with 0 remaining is an EXHAUSTED quota, never a green transport. A
  // status-only reading here green-lights a sweep that cannot run (#4690).
  t(
    '/rate_limit 200 with remaining 0 is rate-limited, NOT reachable',
    kind({ token: '', anon: { status: 200, rateLimitRemaining: 0 } }),
    'rate-limited',
  );
  t('probeIsUsable: 200 with quota left', probeIsUsable({ status: 200, rateLimitRemaining: 5 }), true);
  t('probeIsUsable: 200 with 0 left is NOT usable', probeIsUsable({ status: 200, rateLimitRemaining: 0 }), false);
  t('probeIsUsable: absent header is not evidence of exhaustion', probeIsUsable({ status: 200, rateLimitRemaining: null }), true);
  t('probeIsUsable: network error', probeIsUsable({ networkError: 'ECONNREFUSED' }), false);
  // `Number(null)` is 0, so the naive header read turns every 401 (which carries
  // no rate-limit headers) into a phantom exhausted quota and misprescribes the
  // remedy. Absent must mean unknown.
  t('parseRemaining: absent header is null, not 0', parseRemaining(null), null);
  t('parseRemaining: empty header is null, not 0', parseRemaining(''), null);
  t('parseRemaining: a real 0 survives', parseRemaining('0'), 0);
  t('parseRemaining: a real count survives', parseRemaining('4999'), 4999);
  t('parseRemaining: garbage is unknown, not 0', parseRemaining('n/a'), null);
  t('probeIsUsable: nothing observed', probeIsUsable(null), false);
  t(
    'describeProbe names the exemption in the evidence line',
    describeProbe({ status: 200, rateLimitRemaining: 0 }).includes('exempt from the limit it reports'),
    true,
  );
  // No token at all, host fine — the shape the old docblock assumed universal.
  t('no token + 200 -> reachable', kind({ token: '', anon: { status: 200, rateLimitRemaining: 60 } }), 'reachable');
  // A bad credential where anonymous ALSO fails must not promise that dropping
  // the token is enough.
  t(
    '401 with anon also refused -> bad-credential (not the anon-reachable remedy)',
    kind({ token: 'ghp_stale', authed: { status: 401 }, anon: { status: 403, rateLimitRemaining: 0 } }),
    'bad-credential',
  );
  // 403 WITH remaining:0 is the quota, not the proxy — different remedy.
  t('403 + remaining 0 -> rate-limited', kind({ token: '', anon: { status: 403, rateLimitRemaining: 0 } }), 'rate-limited');
  t(
    'exhausted anonymous quota prescribes a credential',
    classifyTransportProbe({ token: '', anon: { status: 403, rateLimitRemaining: 0 } }).fix[0].includes('GITHUB_TOKEN'),
    true,
  );
  t('network error -> host-unreachable', kind({ token: '', anon: { networkError: 'ENOTFOUND' } }), 'host-unreachable');
  // The narrowness that keeps a wrong confident diagnosis out: anything this
  // classifier cannot name stays unclassified, and the caller keeps its loud
  // generic failure (exit 2) rather than blaming a credential for a GitHub
  // outage or a typo'd PM_SWEEP_REPO.
  t('502 is not a prerequisite failure', classifyTransportProbe({ token: '', anon: { status: 502 } }), null);
  t('404 is not a prerequisite failure', classifyTransportProbe({ token: 'ghp_x', authed: { status: 404 } }), null);
  t('no observation at all -> unclassified', classifyTransportProbe({ token: '' }), null);
  // Token shape enriches the wording and never gates the request: an unknown
  // future prefix must still be SENT, so GitHub gets to be the judge.
  t('describeToken: classic prefix recognised', describeToken('ghp_abc').shape, 'github-prefix');
  t('describeToken: fine-grained prefix recognised', describeToken('github_pat_abc').shape, 'github-prefix');
  t('describeToken: legacy 40-hex recognised', describeToken('a'.repeat(40)).shape, 'legacy-40-hex');
  t('describeToken: proxy placeholder is unrecognized', describeToken('prox_abcdefghi').shape, 'unrecognized');
  t('describeToken: absent', describeToken('').present, false);
  // Redaction: prefix + length only. The #7412 report form, and never the token.
  t('describeToken: redacts to prefix + length', describeToken('ghp_secretsecret').redacted, 'ghp_… (len 16)');
  t(
    'a rendered verdict never contains the token body',
    JSON.stringify(classifyTransportProbe({ token: 'prox_SECRETVALUE', authed: { status: 401 }, anon: { status: 200 } })).includes('SECRETVALUE'),
    false,
  );

  let failed = 0;
  for (const [name, actual, expected] of cases) {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  }
  if (failed) {
    console.error(`✗ check-half-states self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-half-states self-test: ${cases.length} cases pass.`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else if (process.argv.includes('--probe')) {
    // "Can live mode run HERE?" answered on its own, so a seat can find out
    // without a sweep and without reading a raw HTTP status off a label page.
    probeTransport().then((v) => {
      if (!v) {
        console.error('check-half-states: transport probe returned an unclassified result — run the sweep to see the raw failure.');
        process.exit(2);
      }
      if (v.kind !== 'reachable') reportPrerequisiteNotMet(v);
      console.log(`✓ check-half-states: transport prerequisite met — ${v.headline}.`);
    });
  } else {
    sweep().catch((err) => {
      // The in-loop net. The pre-sweep probe answers the common case, but the
      // transport can also fail mid-run (a quota exhausted by this very sweep,
      // a credential revoked between pages), and those must report as the
      // prerequisite they are rather than as an unexplained HTTP number. The
      // probe is re-run rather than inferred from the status alone: a fresh
      // reading is what distinguishes a real transport failure from a transient
      // 5xx on one page, and it comes back `reachable` in the latter — which
      // correctly falls through to the generic failure below.
      const classify = err.status ? probeTransport() : Promise.resolve(null);
      return classify.then((v) => {
        if (v && v.kind !== 'reachable') reportPrerequisiteNotMet(v, { swept: err.sweptSoFar ?? 0 });
        // A sweep that could not run must not read as a clean board (#4690).
        console.error(`check-half-states: sweep failed to run — ${err.message}`);
        process.exit(2);
      });
    });
  }
}

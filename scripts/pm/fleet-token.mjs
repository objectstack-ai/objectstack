#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-token — the fleet's GitHub identity, minted from the App and never from a person.
 *
 *   node scripts/pm/fleet-token.mjs --export      # `export GITHUB_TOKEN=…` lines, for `eval "$(…)"`
 *   node scripts/pm/fleet-token.mjs --print       # the token alone on stdout, nothing else
 *   node scripts/pm/fleet-token.mjs --status      # the cache, REDACTED: expiry, identity, permissions
 *   node scripts/pm/fleet-token.mjs --refresh     # mint now, whatever the cache says
 *   node scripts/pm/fleet-token.mjs --self-test   # offline: a throwaway RSA key, a fake platform, no network
 *
 * ## Why an App identity, and why an installation token specifically
 *
 * Two seat accounts were restricted by the platform in one day. The token the
 * seats wrote with was USER-TO-SERVER — issued by a GitHub App, but acting as a
 * person: `GET /user` answered a login, `X-OAuth-Scopes` was empty,
 * `X-RateLimit-Limit` read 15000 and an expiry header was present — so every
 * write was booked against that person, and the person was the thing the
 * platform restricted. A SERVER-TO-SERVER installation token has nobody behind
 * it: `GET /user` answers 403, the actor of every write is the App's bot user
 * (`objectstack-fleet[bot]`), and a push made with it still dispatches
 * workflows — the recursion guard that silences pushes applies only to the
 * `GITHUB_TOKEN` Actions itself injects, never to an App of our own.
 *
 * The rate SHAPE that triggered the restriction is `write-pace.mjs`'s subject
 * (its header carries the reading); this file's subject is the identity.
 *
 * ## Inputs — environment only, ⛔ none of them is ever committed
 *
 *   OS_FLEET_APP_ID             the App's numeric id (the JWT's `iss`)
 *   OS_FLEET_INSTALLATION_ID    the installation on the organization
 *   OS_FLEET_PRIVATE_KEY        the App's private key, in any of three spellings:
 *                               PEM text; PEM with literal `\n` sequences (what
 *                               most secret stores make of a multi-line value);
 *                               or base64 of the PEM. Detected, never declared.
 *   OS_FLEET_API_URL            optional; default https://api.github.com
 *   OS_FLEET_TOKEN_CACHE_FILE   optional; default ~/.cache/objectstack-pm/fleet-token.json
 *   OS_FLEET_GIT_AUTHOR_LOGIN   optional; a real login recorded as the commit
 *                               AUTHOR by `with-fleet.sh` (the committer stays
 *                               the bot, and so does the actor of every write)
 *
 * The private key is needed only to MINT. A fresh cache for the same
 * installation serves `--print` / `--export` with the app and installation ids
 * alone — which is what lets `with-fleet.sh --self-test` run offline.
 *
 * ## The second route: the repository's Actions VARIABLES
 *
 * A fleet container has no `OS_FLEET_*` of its own unless every Claude account
 * that runs one configures them, so the maintainer decided to hold all three
 * as repository variables of the board repo instead. When the environment
 * lacks any of them (and `OS_FLEET_INPUTS_FROM_GITHUB` is not `0`), the absent
 * ones are read from `GET /repos/{repo}/actions/variables/{NAME}` with this
 * session's own `GITHUB_TOKEN` / `GH_TOKEN` — the board the sweep tooling
 * resolves, or `OS_FLEET_VARIABLES_REPO`. The environment wins per variable.
 * The key so read lives in this process's memory for the length of one mint
 * and is never written anywhere; the cache stays token-only.
 *
 * ⚠️ The trust boundary this widens, stated so nobody rediscovers it: a
 * repository variable is plaintext, readable by every collaborator and by
 * every App installation holding `actions: read` on the repo. Every one of
 * them can therefore mint as the fleet. That is the maintainer's decision,
 * taken with that consequence in front of them, and a Secret would not serve:
 * no API reads a Secret back, only a workflow run can.
 *
 * ## The JWT — node's `crypto`, no dependency
 *
 * RS256 over `base64url(header).base64url(payload)`; `iat = now − 60` (clock
 * drift), `exp = now + 600` (the platform's ceiling — a longer one is refused
 * by it, and by `buildAppJwt`), `iss = OS_FLEET_APP_ID`. `--self-test`
 * generates a throwaway key pair and VERIFIES the signature with the public
 * half, so the encoding is proven rather than eyeballed.
 *
 * ## The cache, and why the mint goes through the write gate
 *
 * `~/.cache/objectstack-pm/fleet-token.json` — beside `write-pace.jsonl`, for
 * the same reason it lives there: every process on this host shares ONE
 * throttle and should share ONE token, so a per-session scratchpad would mint
 * once per session and let N sessions mint at once. Mode 0600, written to a
 * temp file and renamed, refreshed `REFRESH_MARGIN_MS` (5 min) before expiry.
 *
 * The mint is a POST, and `write-pace.mjs` pins the closed set of files under
 * `scripts/pm` that issue a write verb — so the mint is paced like any other,
 * keyed to the App rather than to a token (it is not content and shares no
 * budget with content). That pacing takes rule ④'s LEASE, which is exactly the
 * cross-process lock a concurrent start needs: after the lease is granted the
 * cache is READ AGAIN, and a sibling's fresh mint is used instead of a second
 * one.
 *
 * ## Redaction — the rule every output path obeys
 *
 * The token is written to exactly three places: the cache file, and the two
 * delivery modes `--print` and `--export`, whose whole purpose is to hand it
 * to the caller. Every OTHER string this file produces — log lines, `--status`,
 * error messages, the message of any thrown error — shows `redact(token)`:
 * the first four characters and the length. Platform error bodies and thrown
 * transport messages are scrubbed of the token and the JWT before they are
 * re-thrown. `--self-test` feeds a known token and a known key through every
 * one of those paths and greps them all.
 *
 * ## Exit codes — capture them BEFORE any pipe (label-write's ladder)
 *
 *   0   the token was delivered (or `--status`, or a self-test that reached its verdict).
 *   2   usage.
 *   3   PREREQUISITE NOT MET — an input missing or unreadable, the platform
 *       unreachable, the cache path unwritable, a rate-limit refusal. Nothing
 *       was minted and nothing is claimed.
 *   5   the platform REFUSED the mint or the identity read — a 401 on the JWT,
 *       a 403/404 on the installation, a 422. The status and the platform's
 *       own sentence are printed, scrubbed.
 *  10   the write throttle refused the mint (a stop marker is active, or no
 *       turn on the lease). `write-pace.mjs`'s prescription was printed.
 */

import { spawnSync } from 'node:child_process';
import { createPrivateKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, proxyRearmPlan, resolveSweepRepo } from './check-half-states.mjs';
import { classifyHttp } from './label-write.mjs';
import { EXIT_WRITE_PACE_REFUSED, isWriteMethod, noteResponse, paceFilePath, paceWrite, releaseWriteLease } from './write-pace.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const PROXY_REARM_GUARD = 'OS_FLEET_TOKEN_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = EXIT_PREREQUISITE_NOT_MET;
export const EXIT_PLATFORM_REFUSAL = 5;

export const DEFAULT_API = 'https://api.github.com';
export const JWT_TTL_S = 600;
export const JWT_BACKDATE_S = 60;
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;
export const REQUIRED_INPUTS = Object.freeze(['OS_FLEET_APP_ID', 'OS_FLEET_INSTALLATION_ID']);
export const MINT_INPUT = 'OS_FLEET_PRIVATE_KEY';
export const INPUT_NAMES = Object.freeze([...REQUIRED_INPUTS, MINT_INPUT]);
/** `0` closes the repository-variables route, so a self-test or a locked-down host reads the environment alone. */
export const VARIABLES_OPT_OUT = 'OS_FLEET_INPUTS_FROM_GITHUB';

/** A failure with the exit code it maps to. Its message is ALREADY redacted. */
export class FleetTokenError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = 'FleetTokenError';
    this.exitCode = exitCode;
  }
}

// ---------------------------------------------------------------------------
// Pure core — the encoding, the claims, the key forms, the cache arithmetic and
// the redaction, each a function `--self-test` drives with fixtures.
// ---------------------------------------------------------------------------

/** What a token looks like anywhere but the cache file and the delivery modes. */
export function redact(token) {
  const t = String(token ?? '');
  if (!t) return '(empty)';
  return `${t.slice(0, 4)}…(${t.length} chars)`;
}

/**
 * Remove every secret from a string that is about to be printed or thrown:
 * the secrets this process KNOWS (the JWT, the token once minted), and any
 * token-SHAPED run it does not — a platform sentence or a transport error can
 * echo a credential this process never saw.
 */
export function scrub(text, secrets = []) {
  let out = String(text ?? '');
  for (const s of secrets) {
    if (typeof s !== 'string' || s.length < 8) continue;
    out = out.split(s).join('<redacted>');
  }
  return out.replace(/\bgh[a-z]_[A-Za-z0-9_]{20,}\b/g, '<redacted>').replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<redacted>');
}

export function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function fromBase64url(text) {
  const padded = String(text).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

/**
 * The private key, from any of the three spellings. Returns the key object and
 * which spelling arrived, and never the PEM text — the caller has no reason to
 * hold it.
 */
export function readPrivateKey(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new FleetTokenError(`${MINT_INPUT} is empty`, EXIT_PREREQUISITE);
  let pem = null;
  let form = 'pem';
  if (text.includes('-----BEGIN')) {
    pem = text;
  } else {
    let decoded = '';
    try {
      decoded = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      decoded = '';
    }
    if (decoded.includes('-----BEGIN')) {
      pem = decoded;
      form = 'base64';
    }
  }
  if (pem === null) {
    throw new FleetTokenError(`${MINT_INPUT} is neither a PEM (no -----BEGIN line) nor base64 of one`, EXIT_PREREQUISITE);
  }
  if (pem.includes('\\n')) {
    pem = pem.replace(/\\n/g, '\n');
    if (form === 'pem') form = 'pem-escaped';
  }
  pem = `${pem.replace(/\r\n?/g, '\n').trim()}\n`;
  let key;
  try {
    key = createPrivateKey(pem);
  } catch (e) {
    throw new FleetTokenError(`${MINT_INPUT} does not parse as a private key (${e?.message ?? 'unreadable'})`, EXIT_PREREQUISITE);
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw new FleetTokenError(`${MINT_INPUT} is a ${key.asymmetricKeyType} key, and RS256 needs RSA`, EXIT_PREREQUISITE);
  }
  return { key, form };
}

/** The App JWT: RS256, backdated `iat`, an `exp` at or under the platform's ceiling. */
export function buildAppJwt({ appId, key, nowS = Math.floor(Date.now() / 1000), ttlS = JWT_TTL_S } = {}) {
  if (!Number.isInteger(ttlS) || ttlS <= 0 || ttlS > JWT_TTL_S) {
    throw new RangeError(`a JWT lifetime over ${JWT_TTL_S}s is refused by the platform; got ${JSON.stringify(ttlS)}`);
  }
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: nowS - JWT_BACKDATE_S, exp: nowS + ttlS, iss: String(appId) };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signingInput), key);
  return { jwt: `${signingInput}.${base64url(signature)}`, header, payload };
}

export function decodeJwt(jwt) {
  const [h, p, s] = String(jwt).split('.');
  return {
    header: JSON.parse(fromBase64url(h).toString('utf8')),
    payload: JSON.parse(fromBase64url(p).toString('utf8')),
    signature: s,
    signingInput: `${h}.${p}`,
  };
}

/** Does `publicKey` verify this JWT? The self-test's proof that the encoding is right. */
export function verifyJwt(jwt, publicKey) {
  const d = decodeJwt(jwt);
  return cryptoVerify('RSA-SHA256', Buffer.from(d.signingInput), publicKey, fromBase64url(d.signature));
}

/** Where the cache lives for this environment. */
export function cacheFilePath(env = process.env, home = homedir()) {
  const override = typeof env.OS_FLEET_TOKEN_CACHE_FILE === 'string' ? env.OS_FLEET_TOKEN_CACHE_FILE.trim() : '';
  return override || join(home, '.cache', 'objectstack-pm', 'fleet-token.json');
}

/** Must this cache be replaced? Absent, unreadable, foreign, or inside the margin all say yes. */
export function needsRefresh(cache, nowMs, { marginMs = REFRESH_MARGIN_MS, installationId } = {}) {
  if (!cache || typeof cache !== 'object') return true;
  if (typeof cache.token !== 'string' || !cache.token) return true;
  if (!cache.bot || typeof cache.bot.login !== 'string' || !Number.isInteger(Number(cache.bot.id))) return true;
  if (installationId !== undefined && String(cache.installation_id) !== String(installationId)) return true;
  const exp = Date.parse(cache.expires_at);
  if (!Number.isFinite(exp)) return true;
  return exp - nowMs <= marginMs;
}

export function readCache(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Written to a sibling temp file at 0600 and renamed, so a reader never sees a torn cache. */
export function writeCache(file, data) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/** The inputs, validated. `mint: true` also demands the private key. */
export function readInputs(env = process.env, { mint = true } = {}) {
  const missing = REQUIRED_INPUTS.filter((name) => !String(env[name] ?? '').trim());
  if (mint && !String(env[MINT_INPUT] ?? '').trim()) missing.push(MINT_INPUT);
  if (missing.length) {
    throw new FleetTokenError(
      `missing ${missing.join(', ')} — the fleet identity is injected as environment variables (` +
        `${[...REQUIRED_INPUTS, MINT_INPUT].join(', ')}); nothing was minted.`,
      EXIT_PREREQUISITE,
    );
  }
  const appId = String(env.OS_FLEET_APP_ID).trim();
  const installationId = String(env.OS_FLEET_INSTALLATION_ID).trim();
  if (!/^\d+$/.test(appId)) throw new FleetTokenError('OS_FLEET_APP_ID must be the App\'s numeric id', EXIT_PREREQUISITE);
  if (!/^\d+$/.test(installationId)) throw new FleetTokenError('OS_FLEET_INSTALLATION_ID must be the installation\'s numeric id', EXIT_PREREQUISITE);
  const api = String(env.OS_FLEET_API_URL ?? '').trim().replace(/\/+$/, '') || DEFAULT_API;
  const authorLogin = String(env.OS_FLEET_GIT_AUTHOR_LOGIN ?? '').trim() || null;
  return { appId, installationId, api, authorLogin, privateKey: mint ? env[MINT_INPUT] : null };
}

/**
 * The second route: read the named inputs from the repository's Actions
 * variables with the session's own token. Returns what was found and what was
 * absent (404); any other answer is thrown with the exit the status maps to.
 */
export async function fetchInputsFromGitHub({ repo, token, api = DEFAULT_API, fetchImpl = globalThis.fetch, names = INPUT_NAMES } = {}) {
  if (!token) {
    throw new FleetTokenError(
      `${names.join(', ')} are not in the environment, and there is no GITHUB_TOKEN / GH_TOKEN to read them from ${repo}'s repository variables with — set them in one of the two places.`,
      EXIT_PREREQUISITE,
    );
  }
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${token}` };
  const get = async (path) => {
    let res;
    try {
      res = await fetchImpl(`${api}${path}`, { method: 'GET', headers });
    } catch (e) {
      throw new FleetTokenError(`GET ${path}: the platform could not be reached — ${scrub(e?.message ?? 'fetch threw', [token])}`, EXIT_PREREQUISITE);
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { res, json };
  };

  // An ORGANIZATION variable shared with the repo is read through the REPO's
  // own endpoint — `/orgs/{org}/actions/variables/{name}` needs org-admin or
  // the org-level variables permission, which a seat's token does not carry,
  // while this one needs only `actions: read` on the repo. Fetched once, and
  // only when a repo-level lookup came back 404. First page of 100: an
  // organization sharing more variables than that with one repo is not this
  // fleet's shape, and a name past the page reads as absent, loudly.
  let shared = null;
  const sharedValue = async (name) => {
    if (shared === null) {
      const { res, json } = await get(`/repos/${repo}/actions/organization-variables?per_page=100`);
      shared = res.status === 200 && Array.isArray(json?.variables) ? json.variables : [];
    }
    const hit = shared.find((v) => v?.name === name && typeof v.value === 'string');
    return hit ? hit.value : null;
  };

  const values = {};
  const missing = [];
  for (const name of names) {
    const path = `/repos/${repo}/actions/variables/${name}`;
    const { res, json } = await get(path);
    if (res.status === 404) {
      const fromOrg = await sharedValue(name);
      if (fromOrg === null) missing.push(name);
      else values[name] = fromOrg;
      continue;
    }
    if (res.status !== 200 || typeof json?.value !== 'string') {
      throw new FleetTokenError(`GET ${path} → HTTP ${res.status} ${scrub(platformSentence(json), [token])}`.trim(), exitForStatus(res.status, res.headers));
    }
    values[name] = json.value;
  }
  return { values, missing };
}

/**
 * The inputs, from the environment first and the repository's variables for
 * whatever the environment lacks. Async because the second route is a read.
 */
export async function resolveInputs(env = process.env, deps = {}, { mint = true } = {}) {
  const names = mint ? INPUT_NAMES : REQUIRED_INPUTS;
  const absent = names.filter((n) => !String(env[n] ?? '').trim());
  if (absent.length === 0 || String(env[VARIABLES_OPT_OUT] ?? '').trim() === '0') return { ...readInputs(env, { mint }), source: 'environment' };
  const log = deps.log ?? ((line) => console.error(line));
  const repo = String(env.OS_FLEET_VARIABLES_REPO ?? '').trim() || resolveSweepRepo(env).repo;
  const api = String(env.OS_FLEET_API_URL ?? '').trim().replace(/\/+$/, '') || DEFAULT_API;
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '';
  const { values, missing } = await fetchInputsFromGitHub({ repo, token, api, fetchImpl: deps.fetch ?? globalThis.fetch, names: absent });
  if (missing.length) {
    throw new FleetTokenError(
      `${missing.join(', ')} neither in the environment nor among ${repo}'s repository variables — set each in one of the two places ` +
        `(gh variable set <NAME> --repo ${repo} --body …); nothing was minted.`,
      EXIT_PREREQUISITE,
    );
  }
  log(`fleet-token: ${absent.join(', ')} not in the environment — read from ${repo}'s repository variables with this session's GitHub token.`);
  return { ...readInputs({ ...env, ...values }, { mint }), source: `repository variables of ${repo}` };
}

/** POSIX shell single-quoting, so `eval "$(… --export)"` is exact for any byte. */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/** The `--export` text. The ONE place besides `--print` where the token is spelled out. */
export function exportLines(cache) {
  const lines = [
    `export GITHUB_TOKEN=${shellQuote(cache.token)}`,
    `export GH_TOKEN=${shellQuote(cache.token)}`,
    `export OS_FLEET_BOT_LOGIN=${shellQuote(cache.bot.login)}`,
    `export OS_FLEET_BOT_USER_ID=${shellQuote(String(cache.bot.id))}`,
    `export OS_FLEET_TOKEN_EXPIRES_AT=${shellQuote(cache.expires_at)}`,
  ];
  if (cache.author && cache.author.login) {
    lines.push(
      `export OS_FLEET_GIT_AUTHOR_NAME=${shellQuote(cache.author.name || cache.author.login)}`,
      `export OS_FLEET_GIT_AUTHOR_EMAIL=${shellQuote(`${cache.author.id}+${cache.author.login}@users.noreply.github.com`)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** `--status`: everything about the cache EXCEPT the token. */
export function statusText(cache, nowMs, file) {
  if (!cache) return [`fleet-token --status`, `  cache : ${file} — absent or unreadable; the next --print / --export mints.`].join('\n');
  const exp = Date.parse(cache.expires_at);
  const left = Number.isFinite(exp) ? exp - nowMs : NaN;
  const perms = cache.permissions && typeof cache.permissions === 'object' ? Object.entries(cache.permissions).map(([k, v]) => `${k}:${v}`).join(' ') : '(unknown)';
  return [
    'fleet-token --status',
    `  cache       : ${file}`,
    `  token       : ${redact(cache.token)}  (⛔ never printed here — --print / --export are the delivery modes)`,
    `  expires     : ${cache.expires_at ?? '?'}${Number.isFinite(left) ? ` (${left > 0 ? `in ${Math.round(left / 60000)}m` : 'EXPIRED'}; refreshed ${Math.round(REFRESH_MARGIN_MS / 60000)}m early)` : ''}`,
    `  identity    : ${cache.bot?.login ?? '?'} (user id ${cache.bot?.id ?? '?'}) — App ${cache.app_id ?? '?'}, installation ${cache.installation_id ?? '?'}`,
    `  author      : ${cache.author?.login ? `${cache.author.login} (user id ${cache.author.id}) — commits will be authored by this login, committed by the bot` : 'the bot (set OS_FLEET_GIT_AUTHOR_LOGIN to record a real login as author)'}`,
    `  permissions : ${perms}`,
    `  selection   : ${cache.repository_selection ?? '?'}`,
    `  minted      : ${cache.minted_at ?? '?'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The live path — one POST (paced, leased) and three GETs, all through an
// injectable `fetch` so the self-test drives every branch offline.
// ---------------------------------------------------------------------------

/** The platform's remaining-quota header as `classifyHttp` wants it: a number, or `null` when absent. */
function rateRemainingOf(headers) {
  const raw = headers?.get?.('x-ratelimit-remaining') ?? null;
  return raw === null || String(raw).trim() === '' ? null : Number(raw);
}

function exitForStatus(status, headers) {
  const verdict = classifyHttp({ status, rateRemaining: rateRemainingOf(headers) });
  if (verdict === 'prerequisite' || verdict === 'ratelimit') return EXIT_PREREQUISITE;
  if (status >= 500 || status === 0) return EXIT_PREREQUISITE;
  return EXIT_PLATFORM_REFUSAL;
}

function platformSentence(json) {
  if (json && typeof json === 'object' && typeof json.message === 'string') return json.message;
  return '';
}

/**
 * Mint an installation token and resolve the identity behind it. Throws a
 * `FleetTokenError` carrying the exit code; every message it throws or logs is
 * scrubbed of the JWT and the token.
 */
export async function mintInstallationToken(inputs, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((line) => console.error(line));
  const file = deps.file ?? cacheFilePath(deps.env ?? process.env, deps.home ?? homedir());
  const paceDeps = { ...(deps.pace ?? {}) };
  if (!paceDeps.exit) {
    paceDeps.exit = (code) => {
      throw new FleetTokenError('the write throttle refused the mint — its prescription is above', code);
    };
  }
  const paceFile = paceDeps.file ?? paceFilePath(paceDeps.env ?? process.env, paceDeps.home ?? homedir());
  const paceToken = `app:${inputs.appId}`;

  const { key, form } = readPrivateKey(inputs.privateKey);
  const { jwt } = buildAppJwt({ appId: inputs.appId, key, nowS: Math.floor(now() / 1000) });
  const secrets = [jwt];
  const headers = (bearer) => ({ accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${bearer}` });
  const readJson = async (res) => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };
  const get = async (path, bearer, what) => {
    let res;
    try {
      res = await fetchImpl(`${inputs.api}${path}`, { method: 'GET', headers: headers(bearer) });
    } catch (e) {
      throw new FleetTokenError(`GET ${path} (${what}): the platform could not be reached — ${scrub(e?.message ?? 'fetch threw', secrets)}`, EXIT_PREREQUISITE);
    }
    const json = await readJson(res);
    if (res.status !== 200) {
      throw new FleetTokenError(`GET ${path} (${what}) → HTTP ${res.status} ${scrub(platformSentence(json), secrets)}`.trim(), exitForStatus(res.status, res.headers));
    }
    return json;
  };

  // ⏱ The one write verb this file issues, paced and leased like every other.
  const mintPath = `/app/installations/${inputs.installationId}/access_tokens`;
  const mintMethod = 'POST';
  if (isWriteMethod(mintMethod)) await paceWrite({ token: paceToken, kind: 'fleet-token POST' }, paceDeps);

  // Under the lease: a sibling that waited on the same lease may have minted.
  if (deps.recheck) {
    const sibling = deps.recheck();
    if (!needsRefresh(sibling, now(), { installationId: inputs.installationId })) {
      releaseWriteLease(paceFile);
      log(`fleet-token: a sibling minted ${redact(sibling.token)} while this process waited — using it, no second mint.`);
      return { ...sibling, fresh: false, file };
    }
  }

  let res;
  try {
    res = await fetchImpl(`${inputs.api}${mintPath}`, { method: 'POST', headers: headers(jwt) });
  } catch (e) {
    releaseWriteLease(paceFile);
    throw new FleetTokenError(`POST ${mintPath}: the platform could not be reached — ${scrub(e?.message ?? 'fetch threw', secrets)}`, EXIT_PREREQUISITE);
  }
  const minted = await readJson(res);
  noteResponse(
    {
      token: paceToken,
      status: res.status,
      headers: res.headers,
      body: minted,
      verdict: classifyHttp({ status: res.status, rateRemaining: rateRemainingOf(res.headers) }),
    },
    paceDeps,
  );
  if (res.status !== 201 || !minted || typeof minted.token !== 'string' || !minted.token) {
    throw new FleetTokenError(
      `POST ${mintPath} → HTTP ${res.status} ${scrub(platformSentence(minted), secrets)}`.trim() +
        (res.status === 401 ? ' — the JWT was refused: check OS_FLEET_APP_ID and the private key belong to the same App, and the host clock' : '') +
        (res.status === 404 ? ' — the installation was not found under this App: check OS_FLEET_INSTALLATION_ID' : ''),
      exitForStatus(res.status, res.headers),
    );
  }
  secrets.push(minted.token);

  // The identity behind the token: the App's slug (JWT), then the bot user
  // that slug names (installation token) — its numeric id is what a noreply
  // address needs, and it is NOT the App id.
  const app = await get('/app', jwt, 'the App');
  const slug = typeof app?.slug === 'string' && app.slug ? app.slug : null;
  if (!slug) throw new FleetTokenError('GET /app answered without a slug — cannot name the bot user', EXIT_PLATFORM_REFUSAL);
  const botLogin = `${slug}[bot]`;
  const bot = await get(`/users/${encodeURIComponent(botLogin)}`, minted.token, 'the bot user');
  if (!Number.isInteger(Number(bot?.id)) || bot?.login !== botLogin) {
    throw new FleetTokenError(`GET /users/${botLogin} answered login ${JSON.stringify(bot?.login ?? null)} and id ${JSON.stringify(bot?.id ?? null)} — not the bot user`, EXIT_PLATFORM_REFUSAL);
  }
  let author = null;
  if (inputs.authorLogin) {
    const user = await get(`/users/${encodeURIComponent(inputs.authorLogin)}`, minted.token, 'the author login');
    if (!Number.isInteger(Number(user?.id))) throw new FleetTokenError(`GET /users/${inputs.authorLogin} answered without a numeric id`, EXIT_PLATFORM_REFUSAL);
    author = { login: String(user.login), id: Number(user.id), name: typeof user.name === 'string' && user.name ? user.name : String(user.login) };
  }

  const cache = {
    token: minted.token,
    expires_at: minted.expires_at,
    permissions: minted.permissions ?? null,
    repository_selection: minted.repository_selection ?? null,
    app_id: inputs.appId,
    installation_id: inputs.installationId,
    api: inputs.api,
    bot: { login: botLogin, id: Number(bot.id) },
    author,
    key_form: form,
    minted_at: new Date(now()).toISOString(),
  };
  try {
    writeCache(file, cache);
  } catch (e) {
    throw new FleetTokenError(`the cache at ${file} cannot be written (${scrub(e?.message ?? 'write failed', secrets)}) — point OS_FLEET_TOKEN_CACHE_FILE at a writable path; the minted token was discarded`, EXIT_PREREQUISITE);
  }
  log(
    `fleet-token: minted ${redact(minted.token)} for ${botLogin} (App ${inputs.appId}, installation ${inputs.installationId}, key given as ${form}), ` +
      `expires ${minted.expires_at}; cached at ${file} (mode 0600).`,
  );
  return { ...cache, fresh: true, file };
}

/**
 * The importable entry: a fresh cached token, or a newly minted one. Throws
 * `FleetTokenError` (with `exitCode`) rather than exiting, so an importer keeps
 * its own process.
 */
export async function getFleetToken({ force = false } = {}, deps = {}) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const file = deps.file ?? cacheFilePath(env, deps.home ?? homedir());
  const cached = force ? null : readCache(file);
  // The probe resolves the ids only, quietly: the mint's own resolve below
  // says where the inputs came from, once, on the run that actually mints.
  // A shell with neither OS_FLEET_* nor a session token can resolve nothing —
  // but a fresh cache is still a fresh cache: it is served as is, matched
  // against no installation because none was named. Measured: without this,
  // `--print` in such a shell printed nothing and the caller sent `Bearer `.
  let probe = null;
  try {
    probe = await resolveInputs(env, { ...deps, log: () => {} }, { mint: false });
  } catch (e) {
    if (!(e instanceof FleetTokenError) || force || needsRefresh(cached, now())) throw e;
  }
  if (!force && !needsRefresh(cached, now(), probe ? { installationId: probe.installationId } : {})) return { ...cached, fresh: false, file };
  const inputs = await resolveInputs(env, deps, { mint: true });
  return mintInstallationToken(inputs, { ...deps, env, file, recheck: force ? null : () => readCache(file) });
}

// ---------------------------------------------------------------------------
// Self-test — OFFLINE. A throwaway RSA pair, a fake platform, a temp cache.
// The battery roster is the floor (AGENTS.md, "Writing a --self-test").
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the JWT: RS256 over node crypto, the claims the platform reads, no library': 9,
  'the key: PEM, PEM with literal \\n, base64 of the PEM — one key out of three spellings': 7,
  'the cache: 0600, refreshed five minutes early, keyed to the installation': 8,
  'the mint: what a fake platform answers, and what this tool does with it': 11,
  'redaction: a known token and a known key fed through every output path never come back out': 12,
  'the CLI: --print prints the token alone, --export prints shell, --status prints neither': 10,
  'the repository-variables route: read when the environment has none, environment wins, the key never lands anywhere': 11,
  'the wiring: the one POST is paced and leased, and the throttle roster names this file': 4,
});
const SELF_TEST_BATTERY_FLOOR = 8;
const UNATTRIBUTED_BATTERY = '(unattributed)';

const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};

// Set as `selfTest()`'s LAST statement, after the success line prints, and read
// at the dispatch — an exit code is not a handshake.
let selfTestReachedVerdict = false;

export async function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true, detail) => {
    const bucket = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(bucket, (batteryCases.get(bucket) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `${detail ? `${detail} — ` : ''}got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const PEM_BODY = PEM.split('\n').filter((l) => l && !l.startsWith('-----'))[1];
  const TOKEN = 'ghs_FixtureTokenNotRealAtAll0000000000000';
  const NOW = Date.UTC(2026, 8, 22, 9, 0, 0);
  const inputs = { appId: '5028251', installationId: '163654544', api: 'https://api.example.test', authorLogin: null, privateKey: PEM };

  // ── the JWT ───────────────────────────────────────────────────────────────
  battery('the JWT: RS256 over node crypto, the claims the platform reads, no library');
  {
    const nowS = Math.floor(NOW / 1000);
    const { jwt, header, payload } = buildAppJwt({ appId: inputs.appId, key: privateKey, nowS });
    t('three base64url segments', jwt.split('.').length, 3);
    t('…with no padding, plus or slash anywhere', /[=+/]/.test(jwt), false);
    t('the header is RS256 / JWT', header, { alg: 'RS256', typ: 'JWT' });
    t('iat is backdated 60 s for clock drift', payload.iat, nowS - 60);
    t('exp is 600 s ahead — the platform\'s ceiling, never over it', payload.exp, nowS + 600);
    t('iss is the App id', payload.iss, inputs.appId);
    t('⛔ a lifetime over the ceiling is refused here, before the platform refuses it', (() => {
      try {
        buildAppJwt({ appId: inputs.appId, key: privateKey, nowS, ttlS: 601 });
        return 'built';
      } catch (e) {
        return e instanceof RangeError ? 'refused' : 'other';
      }
    })(), 'refused');
    t('the signature VERIFIES with the public half', verifyJwt(jwt, publicKey));
    t('…and a tampered payload does not', verifyJwt(`${jwt.split('.')[0]}.${base64url('{"iat":1,"exp":2,"iss":"x"}')}.${jwt.split('.')[2]}`, publicKey), false);
  }

  // ── the key ───────────────────────────────────────────────────────────────
  battery('the key: PEM, PEM with literal \\n, base64 of the PEM — one key out of three spellings');
  {
    const asPem = readPrivateKey(PEM);
    const asEscaped = readPrivateKey(PEM.replace(/\n/g, '\\n'));
    const asB64 = readPrivateKey(Buffer.from(PEM, 'utf8').toString('base64'));
    const fingerprint = (k) => k.export({ type: 'pkcs1', format: 'der' }).toString('hex').slice(0, 32);
    t('PEM text is read as pem', asPem.form, 'pem');
    t('PEM with literal \\n is read as pem-escaped', asEscaped.form, 'pem-escaped');
    t('base64 of the PEM is read as base64', asB64.form, 'base64');
    t('⛔ all three are the SAME key', [fingerprint(asEscaped.key), fingerprint(asB64.key)], [fingerprint(asPem.key), fingerprint(asPem.key)]);
    const refused = (raw) => {
      try {
        readPrivateKey(raw);
        return 'accepted';
      } catch (e) {
        return e instanceof FleetTokenError ? e.exitCode : 'other';
      }
    };
    t('an empty key is a prerequisite failure (exit 3)', refused(''), EXIT_PREREQUISITE);
    t('a string that is neither PEM nor base64 of one is too', refused('not-a-key'), EXIT_PREREQUISITE);
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    t('a non-RSA key is refused — RS256 needs RSA', refused(ec), EXIT_PREREQUISITE);
  }

  const dir = mkdtempSync(join(tmpdir(), 'fleet-token-'));
  try {
    // ── the cache ───────────────────────────────────────────────────────────
    battery('the cache: 0600, refreshed five minutes early, keyed to the installation');
    {
      const file = join(dir, 'nested', 'fleet-token.json');
      const fresh = { token: TOKEN, expires_at: new Date(NOW + 60 * 60 * 1000).toISOString(), bot: { login: 'objectstack-fleet[bot]', id: 332303061 }, installation_id: inputs.installationId };
      t('absent → refresh', needsRefresh(null, NOW), true);
      t('an hour left → no refresh', needsRefresh(fresh, NOW, { installationId: inputs.installationId }), false);
      t('five minutes left → refresh (the margin)', needsRefresh({ ...fresh, expires_at: new Date(NOW + REFRESH_MARGIN_MS).toISOString() }, NOW), true);
      t('six minutes left → not yet', needsRefresh({ ...fresh, expires_at: new Date(NOW + REFRESH_MARGIN_MS + 60_000).toISOString() }, NOW), false);
      t('⛔ a cache for ANOTHER installation is refreshed, whatever its expiry', needsRefresh(fresh, NOW, { installationId: '1' }), true);
      t('a cache without the bot identity is refreshed — the wrapper needs it', needsRefresh({ ...fresh, bot: null }, NOW), true);
      writeCache(file, fresh);
      t('the file is written at mode 0600', (statSync(file).mode & 0o777).toString(8), '600');
      t('…and reads back whole', readCache(file).token, TOKEN);
    }

    // ── the mint ────────────────────────────────────────────────────────────
    battery('the mint: what a fake platform answers, and what this tool does with it');
    const platform = (answers, seen) => async (url, init) => {
      const u = new URL(url);
      const call = `${init?.method ?? 'GET'} ${u.pathname}`;
      seen.push({ call, auth: init?.headers?.authorization ?? '' });
      const a = answers[call] ?? { status: 404, json: { message: 'Not Found' } };
      if (a.throws) throw new Error(a.throws);
      // `echoBearer` makes the fake platform quote the credential it was
      // handed — the JWT on the mint, the token on the identity reads — which
      // is the shape a real refusal or proxy error can take.
      const json = a.echoBearer ? { ...a.json, message: `${a.json?.message ?? ''} ${init?.headers?.authorization ?? ''}`.trim() } : a.json;
      return { status: a.status, headers: new Headers(a.headers ?? {}), json: async () => json };
    };
    const happy = {
      'POST /app/installations/163654544/access_tokens': { status: 201, json: { token: TOKEN, expires_at: new Date(NOW + 3600_000).toISOString(), permissions: { contents: 'write', issues: 'write' }, repository_selection: 'all' } },
      'GET /app': { status: 200, json: { id: 5028251, slug: 'objectstack-fleet' } },
      'GET /users/objectstack-fleet%5Bbot%5D': { status: 200, json: { login: 'objectstack-fleet[bot]', id: 332303061, type: 'Bot' } },
      'GET /users/someone': { status: 200, json: { login: 'someone', id: 42, name: 'Some One' } },
    };
    const paceFile = join(dir, 'pace.jsonl');
    const paceEnv = { OS_PM_WRITE_MIN_GAP_MS: '0' };
    const mintWith = async (answers, extra = {}) => {
      const seen = [];
      const logs = [];
      const file = extra.file ?? join(dir, `cache-${cases.length}.json`);
      let result = null;
      let error = null;
      try {
        result = await mintInstallationToken({ ...inputs, ...(extra.inputs ?? {}) }, {
          fetch: platform(answers, seen),
          now: () => NOW,
          log: (l) => logs.push(l),
          file,
          pace: { file: paceFile, env: paceEnv, log: (l) => logs.push(l) },
          recheck: extra.recheck ?? null,
        });
      } catch (e) {
        error = e;
      }
      return { seen, logs, result, error, file };
    };
    {
      const m = await mintWith(happy);
      t('a 201 yields the token, the expiry and the permissions', [m.result?.token, m.result?.permissions?.contents, m.result?.repository_selection], [TOKEN, 'write', 'all']);
      t('the mint is authenticated with the JWT, the identity reads with the token', [m.seen[0].auth.startsWith('Bearer ey'), m.seen[2].auth], [true, `Bearer ${TOKEN}`]);
      t('the calls, in order: mint, the App, the bot user', m.seen.map((s) => s.call), ['POST /app/installations/163654544/access_tokens', 'GET /app', 'GET /users/objectstack-fleet%5Bbot%5D']);
      t('the bot identity is the slug plus [bot], with the bot USER id (not the App id)', m.result?.bot, { login: 'objectstack-fleet[bot]', id: 332303061 });
      t('…and it is cached, whole, at 0600', [readCache(m.file)?.bot?.id, (statSync(m.file).mode & 0o777).toString(8)], [332303061, '600']);
      t('the log names the identity and the redacted token, and says which key form arrived', m.logs.some((l) => l.includes('objectstack-fleet[bot]') && l.includes(redact(TOKEN)) && l.includes('key given as pem')));
      const withAuthor = await mintWith(happy, { inputs: { authorLogin: 'someone' } });
      t('an author login is resolved to its numeric id for the noreply address', withAuthor.result?.author, { login: 'someone', id: 42, name: 'Some One' });
      const jwtRefused = await mintWith({ ...happy, 'POST /app/installations/163654544/access_tokens': { status: 401, json: { message: 'A JSON web token could not be decoded' } } });
      t('a 401 on the JWT is a prerequisite failure that names what to check', [jwtRefused.error?.exitCode, jwtRefused.error?.message.includes('OS_FLEET_APP_ID')], [EXIT_PREREQUISITE, true]);
      const notFound = await mintWith({ ...happy, 'POST /app/installations/163654544/access_tokens': { status: 404, json: { message: 'Not Found' } } });
      t('a 404 on the installation is a platform refusal (exit 5) that names the installation id', [notFound.error?.exitCode, notFound.error?.message.includes('OS_FLEET_INSTALLATION_ID')], [EXIT_PLATFORM_REFUSAL, true]);
      const down = await mintWith({ ...happy, 'POST /app/installations/163654544/access_tokens': { throws: 'getaddrinfo ENOTFOUND api.example.test' } });
      t('an unreachable platform is a prerequisite failure, and the mint left no cache', [down.error?.exitCode, existsSync(down.file)], [EXIT_PREREQUISITE, false]);
      const sibling = { token: 'ghs_SiblingMintedFirst00000000000000000000', expires_at: new Date(NOW + 3600_000).toISOString(), bot: { login: 'objectstack-fleet[bot]', id: 332303061 }, installation_id: inputs.installationId };
      const reused = await mintWith(happy, { recheck: () => sibling });
      t('⛔ a sibling\'s fresh mint, found after the lease was granted, is used and no second POST leaves', [reused.result?.token, reused.seen.length], [sibling.token, 0]);
    }

    // ── redaction ───────────────────────────────────────────────────────────
    battery('redaction: a known token and a known key fed through every output path never come back out');
    {
      writeFileSync(join(dir, 'blocker'), 'x', 'utf8'); // a FILE where a cache directory would have to be
      const outputs = [];
      const ok = await mintWith(happy);
      outputs.push(...ok.logs, statusText(ok.result, NOW, ok.file));
      const bad401 = await mintWith({ ...happy, 'POST /app/installations/163654544/access_tokens': { status: 401, echoBearer: true, json: { message: `bad JWT, and by the way ${TOKEN}` } } });
      outputs.push(bad401.error.message, String(bad401.error.stack));
      const badUser = await mintWith({ ...happy, 'GET /users/objectstack-fleet%5Bbot%5D': { status: 403, echoBearer: true, json: { message: `refused for ${TOKEN}` } } });
      outputs.push(badUser.error.message, String(badUser.error.stack));
      const jwtLeak = await mintWith({ ...happy, 'GET /app': { throws: 'proxy said: authorization: Bearer ' } });
      outputs.push(jwtLeak.error.message);
      const throwing = await mintWith({ ...happy, 'GET /users/objectstack-fleet%5Bbot%5D': { throws: `socket hung up while sending ${TOKEN}` } });
      outputs.push(throwing.error.message, String(throwing.error.stack));
      const unwritable = await mintWith(happy, { file: join(dir, 'blocker', 'x.json') });
      outputs.push(String(unwritable.error?.message ?? ''), String(unwritable.error?.stack ?? ''));
      t('an unwritable cache path is a prerequisite failure naming the override, and the minted token is discarded', [unwritable.error?.exitCode, unwritable.error?.message.includes('OS_FLEET_TOKEN_CACHE_FILE'), existsSync(unwritable.file)], [EXIT_PREREQUISITE, true, false]);
      const joined = outputs.join('\n');
      t('⛔ THE case: the token appears in NO log line, status report, error message or stack', joined.includes(TOKEN), false, joined.slice(0, 400));
      t('…and neither does the private key body', joined.includes(PEM_BODY), false);
      t('the redacted form is what appears instead', joined.includes(redact(TOKEN)));
      t('a platform sentence that echoed the JWT it was handed is scrubbed before it is re-thrown', bad401.error.message.includes('<redacted>') && !bad401.error.message.includes('eyJ'));
      t('…and one that echoed the token is scrubbed too, on the identity read', badUser.error.message.includes('<redacted>') && !badUser.error.message.includes(TOKEN));
      t('a transport error that echoed the token is scrubbed too', throwing.error.message.includes('<redacted>') && !throwing.error.message.includes(TOKEN));
      t('a token-SHAPED run this process never saw is scrubbed by shape', scrub('proxy log: ghs_SomeOtherToken0000000000000000000 and eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMDYwMH0.c2lnbmF0dXJlLXNpZ25hdHVyZQ'), 'proxy log: <redacted> and <redacted>');
      t('`scrub` leaves short strings alone rather than blanking every "e"', scrub('the eel', ['e']), 'the eel');
      t('`redact` shows four characters and the length', redact(TOKEN), `ghs_…(${TOKEN.length} chars)`);
      t('…and says (empty) for nothing, rather than crashing', redact(''), '(empty)');
      const cacheText = readFileSync(ok.file, 'utf8');
      t('the cache file — and only it — carries the token', cacheText.includes(TOKEN));
    }

    // ── the CLI ─────────────────────────────────────────────────────────────
    battery('the CLI: --print prints the token alone, --export prints shell, --status prints neither');
    {
      const file = join(dir, 'cli-cache.json');
      writeCache(file, {
        token: TOKEN,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        bot: { login: 'objectstack-fleet[bot]', id: 332303061 },
        author: { login: 'someone', id: 42, name: 'Some One' },
        app_id: inputs.appId,
        installation_id: inputs.installationId,
        permissions: { contents: 'write' },
        repository_selection: 'all',
        minted_at: new Date().toISOString(),
      });
      // `OS_FLEET_INPUTS_FROM_GITHUB=0`: a CI runner carries a GITHUB_TOKEN, and
      // the "missing inputs" case below must refuse from the environment alone
      // rather than go and read the real repository's variables.
      const base = { ...process.env, OS_FLEET_TOKEN_CACHE_FILE: file, OS_FLEET_APP_ID: inputs.appId, OS_FLEET_INSTALLATION_ID: inputs.installationId, OS_PM_WRITE_PACE_FILE: paceFile, OS_FLEET_PRIVATE_KEY: '', OS_FLEET_INPUTS_FROM_GITHUB: '0', HTTPS_PROXY: '', https_proxy: '' };
      const run = (args, env = base) => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: 'utf8', env });
      const print = run(['--print']);
      t('--print prints exactly the token and a newline, at exit 0, with nothing on stderr', [print.status, print.stdout, print.stderr], [0, `${TOKEN}\n`, '']);
      const exp = run(['--export']);
      t('--export prints the token as GITHUB_TOKEN and GH_TOKEN, single-quoted', [exp.status, exp.stdout.includes(`export GITHUB_TOKEN='${TOKEN}'`), exp.stdout.includes(`export GH_TOKEN='${TOKEN}'`)], [0, true, true]);
      t('…with the bot identity and the resolved author beside it', exp.stdout.includes("export OS_FLEET_BOT_USER_ID='332303061'") && exp.stdout.includes("export OS_FLEET_GIT_AUTHOR_EMAIL='42+someone@users.noreply.github.com'"));
      t('…and every line is a shell export a shell can eval', exp.stdout.trim().split('\n').every((l) => /^export [A-Z_]+='.*'$/.test(l)));
      const status = run(['--status']);
      t('--status prints the identity, the expiry and the permissions, and ⛔ not the token', [status.status, status.stdout.includes('objectstack-fleet[bot]'), status.stdout.includes(TOKEN)], [0, true, false]);
      t("a value with a quote in it survives eval's quoting", shellQuote("it's"), "'it'\\''s'");
      const missing = run(['--print'], { ...base, OS_FLEET_APP_ID: '', OS_FLEET_TOKEN_CACHE_FILE: join(dir, 'absent.json') });
      t('without the inputs and without a cache, --print exits 3 naming the variables and prints no token', [missing.status, missing.stderr.includes('OS_FLEET_APP_ID'), missing.stdout], [EXIT_PREREQUISITE, true, '']);
      // A real shell: no inputs, no session token, the repository route OPEN —
      // it throws before any request because there is no token to read with.
      const bare = run(['--print'], { ...base, OS_FLEET_APP_ID: '', OS_FLEET_INSTALLATION_ID: '', GITHUB_TOKEN: '', GH_TOKEN: '', OS_FLEET_INPUTS_FROM_GITHUB: '' });
      t('a shell with no inputs and no session token is still served a FRESH cache — the token, exit 0', [bare.status, bare.stdout], [0, `${TOKEN}\n`]);
      const stale = join(dir, 'stale-cache.json');
      writeCache(stale, { ...readCache(file), expires_at: new Date(Date.now() - 1000).toISOString() });
      const bareStale = run(['--print'], { ...base, OS_FLEET_TOKEN_CACHE_FILE: stale, OS_FLEET_APP_ID: '', OS_FLEET_INSTALLATION_ID: '', GITHUB_TOKEN: '', GH_TOKEN: '', OS_FLEET_INPUTS_FROM_GITHUB: '' });
      t('…but a STALE cache in that shell is exit 3 naming both routes, ⛔ never the expired token', [bareStale.status, bareStale.stdout, bareStale.stderr.includes('GITHUB_TOKEN')], [EXIT_PREREQUISITE, '', true]);
      t('an unrecognised flag is usage, ⛔ never a silent pass', run(['--pritn']).status, EXIT_USAGE);
    }

    // ── the repository-variables route ──────────────────────────────────────
    battery('the repository-variables route: read when the environment has none, environment wins, the key never lands anywhere');
    {
      const vars = { OS_FLEET_APP_ID: inputs.appId, OS_FLEET_INSTALLATION_ID: inputs.installationId, OS_FLEET_PRIVATE_KEY: Buffer.from(PEM, 'utf8').toString('base64') };
      // `absent`: names the REPO level answers 404 for; `orgShared`: names the
      // organization shares with the repo (read through the repo endpoint).
      const varsPlatform = (seen, absent = [], orgShared = []) => async (url, init) => {
        const u = new URL(url);
        seen.push({ call: `${init?.method ?? 'GET'} ${u.pathname}`, auth: init?.headers?.authorization ?? '' });
        if (u.pathname.endsWith('/actions/organization-variables')) {
          return { status: 200, headers: new Headers({ 'x-ratelimit-remaining': '4999' }), json: async () => ({ total_count: orgShared.length, variables: orgShared.map((name) => ({ name, value: vars[name] })) }) };
        }
        const m = /\/actions\/variables\/([A-Z_]+)$/.exec(u.pathname);
        const name = m?.[1];
        if (!name || absent.includes(name) || !(name in vars)) return { status: 404, headers: new Headers(), json: async () => ({ message: 'Not Found' }) };
        return { status: 200, headers: new Headers({ 'x-ratelimit-remaining': '4999' }), json: async () => ({ name, value: vars[name] }) };
      };
      const logs = [];
      const seen = [];
      const got = await resolveInputs({ GITHUB_TOKEN: TOKEN, PM_SWEEP_REPO: 'o/r' }, { fetch: varsPlatform(seen), log: (l) => logs.push(l) });
      t('with no OS_FLEET_* in the environment the three are read from the repository variables', [got.appId, got.installationId, got.source], [inputs.appId, inputs.installationId, 'repository variables of o/r']);
      t('…with the session token, from the resolved board, one GET each', [seen.every((s) => s.auth === `Bearer ${TOKEN}`), seen.map((s) => s.call)], [true, INPUT_NAMES.map((n) => `GET /repos/o/r/actions/variables/${n}`)]);
      t('…and the key arrives in its base64 spelling and parses', readPrivateKey(got.privateKey).form, 'base64');
      t('…and one line says where the inputs came from', logs.some((l) => l.includes("read from o/r's repository variables")));
      const seen2 = [];
      const fromEnv = await resolveInputs({ ...vars, GITHUB_TOKEN: TOKEN }, { fetch: varsPlatform(seen2) });
      t('the environment wins when it has them all: no request at all', [fromEnv.source, seen2.length], ['environment', 0]);
      const seen3 = [];
      await resolveInputs({ OS_FLEET_APP_ID: inputs.appId, OS_FLEET_INSTALLATION_ID: inputs.installationId, GITHUB_TOKEN: TOKEN, PM_SWEEP_REPO: 'o/r' }, { fetch: varsPlatform(seen3), log: () => {} });
      t('…and only the absent ones are fetched', seen3.map((s) => s.call), ['GET /repos/o/r/actions/variables/OS_FLEET_PRIVATE_KEY']);
      const refused = async (env, fetchImpl) => {
        try {
          await resolveInputs(env, { fetch: fetchImpl, log: () => {} });
          return ['ok', ''];
        } catch (e) {
          return e instanceof FleetTokenError ? [e.exitCode, e.message] : ['other', String(e)];
        }
      };
      const seen4 = [];
      const viaOrg = await resolveInputs({ GITHUB_TOKEN: TOKEN, PM_SWEEP_REPO: 'o/r' }, { fetch: varsPlatform(seen4, INPUT_NAMES, INPUT_NAMES), log: () => {} });
      t('an ORGANIZATION variable shared with the repo is found through the repo endpoint when the repo level answers 404', [viaOrg.appId, viaOrg.installationId, readPrivateKey(viaOrg.privateKey).form], [inputs.appId, inputs.installationId, 'base64']);
      t('…and the shared list is fetched ONCE, after the first 404, ⛔ never through /orgs/', [seen4.filter((s) => s.call.endsWith('/actions/organization-variables')).length, seen4.some((s) => s.call.startsWith('GET /orgs/'))], [1, false]);
      const missingVar = await refused({ GITHUB_TOKEN: TOKEN, PM_SWEEP_REPO: 'o/r' }, varsPlatform([], ['OS_FLEET_PRIVATE_KEY'], ['OS_FLEET_APP_ID']));
      t('a variable absent at the repo level AND not shared by the organization is exit 3, naming it and the command that sets it', [missingVar[0], missingVar[1].includes('OS_FLEET_PRIVATE_KEY') && missingVar[1].includes('gh variable set')], [EXIT_PREREQUISITE, true]);
      const noToken = await refused({ PM_SWEEP_REPO: 'o/r' }, varsPlatform([]));
      t('no session token to read them with is exit 3 naming both routes', [noToken[0], noToken[1].includes('GITHUB_TOKEN') && noToken[1].includes('repository variables')], [EXIT_PREREQUISITE, true]);
      const optOut = await refused({ GITHUB_TOKEN: TOKEN, PM_SWEEP_REPO: 'o/r', [VARIABLES_OPT_OUT]: '0' }, varsPlatform([]));
      t(`${VARIABLES_OPT_OUT}=0 keeps the route closed: exit 3 from the environment alone`, [optOut[0], optOut[1].includes('OS_FLEET_APP_ID')], [EXIT_PREREQUISITE, true]);
      const minted = await mintWith(happy, { inputs: got });
      t('⛔ a key read from the repository reaches neither the cache file nor any log line', [readFileSync(minted.file, 'utf8').includes(vars.OS_FLEET_PRIVATE_KEY), minted.logs.join('\n').includes(PEM_BODY), minted.result?.key_form], [false, false, 'base64']);
    }

    // ── the wiring ──────────────────────────────────────────────────────────
    battery('the wiring: the one POST is paced and leased, and the throttle roster names this file');
    {
      const { WIRED_WRITE_TOOLS } = await import('./write-pace.mjs');
      const own = readFileSync(SELF_PATH, 'utf8');
      t('write-pace lists this file among the wired write tools', WIRED_WRITE_TOOLS.includes('scripts/pm/fleet-token.mjs'));
      t('this file calls both halves around its POST', own.includes('paceWrite(') && own.includes('noteResponse(') && own.includes('isWriteMethod('));
      const records = readFileSync(paceFile, 'utf8');
      t('the mints above were recorded by the throttle under the App key, ⛔ not under any token', records.includes('fleet-token POST') && !records.includes(TOKEN));
      t('…and the lease was released after each', existsSync(`${paceFile}.lease`), false);
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
    console.error(`✗ fleet-token self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ fleet-token self-test: ${cases.length} cases pass across ${declared.length} batteries — an RS256 JWT built on node crypto and ` +
      'verified with the public half, three spellings of one key, a 0600 cache refreshed five minutes early, a fake platform ' +
      "through every branch of the mint, and a known token that came back out of NO log, status, error or stack.",
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = Object.freeze(['--export', '--print', '--status', '--refresh', '--self-test', '--help', '-h']);

const USAGE = [
  'usage:',
  '  node scripts/pm/fleet-token.mjs --export      export GITHUB_TOKEN / GH_TOKEN and the bot identity, for eval "$(…)"',
  '  node scripts/pm/fleet-token.mjs --print       the token alone on stdout',
  '  node scripts/pm/fleet-token.mjs --status      the cache, redacted',
  '  node scripts/pm/fleet-token.mjs --refresh     mint now (combine with --print / --export)',
  '  node scripts/pm/fleet-token.mjs --self-test   offline: throwaway key, fake platform',
  '',
  '  Inputs: OS_FLEET_APP_ID · OS_FLEET_INSTALLATION_ID · OS_FLEET_PRIVATE_KEY (PEM, PEM with literal \\n, or base64)',
  '          — from the environment, else read from the board repo\'s Actions variables with this session\'s',
  '          GITHUB_TOKEN (OS_FLEET_VARIABLES_REPO to name another repo; OS_FLEET_INPUTS_FROM_GITHUB=0 to forbid)',
  '          optional OS_FLEET_API_URL · OS_FLEET_TOKEN_CACHE_FILE · OS_FLEET_GIT_AUTHOR_LOGIN',
  `  Exits: 0 ok · ${EXIT_USAGE} usage · ${EXIT_PREREQUISITE} prerequisite not met · ${EXIT_PLATFORM_REFUSAL} platform refused · ${EXIT_WRITE_PACE_REFUSED} the write throttle refused the mint`,
].join('\n');

/** Route this process through the session proxy when one is configured — label-write's pattern, this file's guard. */
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
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — the mint will bypass the proxy.`);
  return null;
}

export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (argv.includes('--self-test')) return selfTest();
  const unknown = argv.filter((a) => !KNOWN_FLAGS.includes(a));
  if (unknown.length) {
    console.error(`fleet-token: unrecognised option ${unknown.map((u) => `\`${u}\``).join(', ')}\n`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const modes = argv.filter((a) => ['--export', '--print', '--status'].includes(a));
  if (modes.length !== 1) {
    console.error('fleet-token: exactly one of --export, --print, --status\n');
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const mode = modes[0];
  const file = cacheFilePath();
  if (mode === '--status') {
    console.log(statusText(readCache(file), Date.now(), file));
    return EXIT_OK;
  }
  const rearmed = rearmThroughProxy(argv);
  if (rearmed !== null) return rearmed;
  let cache;
  try {
    cache = await getFleetToken({ force: argv.includes('--refresh') });
  } catch (e) {
    if (e instanceof FleetTokenError) {
      console.error(`✗ fleet-token: ${e.message}`);
      return e.exitCode ?? EXIT_PREREQUISITE;
    }
    console.error(`✗ fleet-token: ${scrub(e?.message ?? String(e), [])}`);
    return EXIT_PREREQUISITE;
  }
  if (mode === '--print') process.stdout.write(`${cache.token}\n`);
  else process.stdout.write(exportLines(cache));
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ fleet-token self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}

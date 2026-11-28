#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// publish-starter-marketplace -- publish examples/app-starter to an ObjectOS
// Cloud marketplace as THE first-party starter. The body of the publish step in
// publish-starter-staging.yml and publish-starter-production.yml (#38024).
//
//   node scripts/ci/publish-starter-marketplace.mjs [--dry-run] [--app-dir <dir>]
//   node scripts/ci/publish-starter-marketplace.mjs --self-test
//
// ## What reads the row this writes
//
// A new workspace's first environment installs the platform starter on first
// open (objectstack-ai/cloud#5149). The control plane counts exactly ONE row as
// that starter: a `sys_package` with manifest id `com.example.starter`,
// `is_starter: true`, no owner organization (first-party), visibility
// `marketplace`, and an approved version. Nothing else creates that row, so
// until this runs the cloud path does nothing.
//
// ## Why this is not `os package publish`
//
// The CLI never sends `is_starter`: `isStarter` is a retired manifest key there,
// because the starter flag is the platform's to decide, never an author's
// claim (`packages/cli/src/commands/package/publish.ts`,
// `RETIRED_INERT_MANIFEST_KEYS`). This first-party publish IS the platform
// deciding, so it sends the flag from its own payload, as HotCRM's
// `scripts/publish-marketplace.mjs` sends its own first-party constants.
//
// ## The two requests
//
//   1. POST {OS_CLOUD_URL}/api/v1/cloud/packages -- upsert by manifest id.
//      `visibility: marketplace`, `is_starter: true`, and NO `owner_org_id`:
//      a service-mode caller that names no owner mints the first-party row.
//   2. POST {OS_CLOUD_URL}/api/v1/cloud/packages/:id/versions -- the built
//      artifact, with `auto_approve: true` (honoured for a platform-admin key
//      only; without it the version stays draft and the catalog hides it).
//      A version that answers with a `listing_status` other than `approved`
//      fails the run. 409 means the version is already there: a re-run is a
//      no-op, not a failure -- but this run did not see that version's status,
//      so it says approval was NOT verified rather than calling it published
//      (a draft left by an earlier run with a non-admin key also answers 409).
//      A 2xx answer that carries no `listing_status` is reported the same way.
//
// ## Comparing the two planes
//
// Every run, a dry run included, prints the commit it built from and a sha256
// of the bundle it sends. The starter is never tagged, so these two lines are
// what tells a production publish apart from the staging one it promotes.
//
// Auth is `Authorization: Bearer $OS_CLOUD_API_KEY` (service mode).
//
// ## The version
//
// The version is `examples/app-starter/package.json`'s, which changesets bump
// on every release. The manifest's own `version` is hand-kept and has not moved
// since the package was created, so publishing it would answer 409 forever and
// leave every later change unpublished. The artifact's `manifest.version` is
// set to the published version before it is sent, and the run says so, so the
// stored bundle and its version row agree. While `main` is in prerelease mode
// the version carries `-next.N`.
//
// ## The listing
//
// The README is the listing text, and the icon is the platform's own logo: the
// marketplace refuses a listing with no README or no icon
// (content/docs/deployment/marketplace-handbook.mdx). Nothing else is invented
// for it: no tags, no taxonomy facets, no translated copy.
//
// ## Refusals, all before the first request (a dry run included)
//
//   - the artifact is missing, does not parse, or carries no objects;
//   - its manifest id is not `com.example.starter`, the one id the cloud counts;
//   - package.json carries no version;
//   - not a dry run, and OS_CLOUD_URL or OS_CLOUD_API_KEY is empty: an unset
//     secret fails the run and names itself, never a silent green skip.
//
// Env: OS_CLOUD_URL, OS_CLOUD_API_KEY, OS_CLOUD_TIMEOUT_MS (per request,
// default 240000: the control plane is a singleton that can be cold).
// Exit: 0 published (or already there, approval not verified), 1 refused or failed, 2 usage.

import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_DIR = path.resolve(HERE, '../../examples/app-starter');

/** The one manifest id the cloud's first-open install counts as the starter. */
export const STARTER_MANIFEST_ID = 'com.example.starter';
/** The publisher this first-party publish names on its listing. */
export const STARTER_PUBLISHER = 'objectstack';
/** The platform's own logo; the marketplace refuses a listing with no icon. */
export const STARTER_ICON_URL = 'https://raw.githubusercontent.com/objectstack-ai/objectstack/main/apps/docs/public/logo.svg';

const MAX_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 240_000;

export class RefusalError extends Error {}

/** 3 s, 6 s, 12 s, capped at 30 s: time for a cold control plane to come up. */
export function backoffMs(attempt) {
  return Math.min(3000 * 2 ** (attempt - 1), 30_000);
}

/**
 * Read and check everything the publish sends, before any request.
 * @returns {{ artifact: any, version: string, readme: string | undefined, license: string | undefined, stampedFrom: string | undefined }}
 */
export function loadStarter(appDir) {
  const pkgPath = path.join(appDir, 'package.json');
  const distPath = path.join(appDir, 'dist', 'objectstack.json');
  if (!fs.existsSync(pkgPath)) throw new RefusalError(`missing ${pkgPath}`);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (typeof pkg.version !== 'string' || pkg.version.trim() === '') {
    throw new RefusalError(`${pkgPath} declares no version`);
  }
  if (!fs.existsSync(distPath)) {
    throw new RefusalError(`missing ${distPath} -- build the starter first (pnpm turbo run build --filter=@objectstack/example-starter)`);
  }
  let artifact;
  try {
    artifact = JSON.parse(fs.readFileSync(distPath, 'utf8'));
  } catch (err) {
    throw new RefusalError(`${distPath} does not parse as JSON: ${err.message}`);
  }
  const id = artifact?.manifest?.id;
  if (id !== STARTER_MANIFEST_ID) {
    throw new RefusalError(
      `the artifact's manifest id is ${JSON.stringify(id)}, not ${JSON.stringify(STARTER_MANIFEST_ID)} -- the cloud counts only that id as the starter`,
    );
  }
  if (!Array.isArray(artifact.objects) || artifact.objects.length === 0) {
    throw new RefusalError('the artifact carries no objects -- an empty build would install an empty starter in every new workspace');
  }
  const version = pkg.version.trim();
  const stampedFrom = artifact.manifest.version === version ? undefined : String(artifact.manifest.version);
  artifact.manifest.version = version;
  const readmePath = path.join(appDir, 'README.md');
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : undefined;
  return { artifact, version, readme, license: typeof pkg.license === 'string' ? pkg.license : undefined, stampedFrom };
}

/** The body of `POST /api/v1/cloud/packages`. ⛔ Never an `owner_org_id`: its absence is what makes the row first-party. */
export function packageBody({ artifact, readme, license }) {
  /** @type {Record<string, any>} */
  const body = {
    manifest_id: STARTER_MANIFEST_ID,
    visibility: 'marketplace',
    is_starter: true,
    publisher: STARTER_PUBLISHER,
    display_name: artifact.manifest.name,
    description: artifact.manifest.description,
    icon_url: STARTER_ICON_URL,
  };
  if (artifact.manifest.namespace) body.namespace = artifact.manifest.namespace;
  if (license) body.license = license;
  if (readme) body.readme = readme;
  return body;
}

/** The body of `POST /api/v1/cloud/packages/:id/versions`. */
export function versionBody({ artifact, version }) {
  return { version, bundle: artifact, auto_approve: true };
}

/** One line per top-level artifact key: an array's item count, else its kind. */
function describeBundle(bundle) {
  return Object.entries(bundle)
    .map(([key, value]) => (Array.isArray(value) ? `${key} ${value.length}` : `${key} ${value && typeof value === 'object' ? `{${Object.keys(value).length} keys}` : typeof value}`))
    .join(' · ');
}

/** sha256 of the bundle exactly as it is sent (the JSON the version body carries). */
export function bundleDigest(artifact) {
  return createHash('sha256').update(JSON.stringify(artifact)).digest('hex');
}

/** The commit this run built from: GITHUB_SHA in CI, else the checkout's HEAD, else unknown. */
function builtFrom(appDir) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const r = spawnSync('git', ['-C', appDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown (not a git checkout)';
}

/** The package body as printed: the README is long, so it is shown by length. */
function printablePackageBody(body) {
  return { ...body, ...(body.readme ? { readme: `<${body.readme.length} chars, starts ${JSON.stringify(body.readme.split('\n')[0])}>` } : {}) };
}

/**
 * POST with a timeout and retries for a transient failure (timeout, network,
 * 5xx). A 4xx -- 409 included -- returns at once.
 */
async function postJson({ url, body, apiKey, timeoutMs, fetchImpl, sleep, log }) {
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        log(`  retry ${attempt}/${MAX_ATTEMPTS - 1}: ${url} answered ${res.status}`);
        await sleep(backoffMs(attempt));
        continue;
      }
      return { ok: res.ok, status: res.status, json };
    } catch (err) {
      clearTimeout(timer);
      lastReason = err?.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : String(err?.message ?? err);
      if (attempt < MAX_ATTEMPTS) {
        log(`  retry ${attempt}/${MAX_ATTEMPTS - 1}: ${url} failed (${lastReason})`);
        await sleep(backoffMs(attempt));
        continue;
      }
    }
  }
  return { ok: false, status: 0, json: { error: `request failed: ${lastReason}` } };
}

/**
 * The whole publish. Returns the exit code; prints everything it decides.
 * Injectable `fetchImpl` / `sleep` / `log` are for the self-test.
 */
export async function publish({
  appDir = DEFAULT_APP_DIR,
  cloudUrl = '',
  apiKey = '',
  dryRun = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = (m) => console.log(m),
  error = (m) => console.error(m),
  commit = undefined,
} = {}) {
  const base = cloudUrl.replace(/\/+$/, '');
  let starter;
  try {
    starter = loadStarter(appDir);
    if (!dryRun) {
      if (!base) throw new RefusalError('OS_CLOUD_URL is empty -- the workflow names the control plane it publishes to');
      if (!apiKey) {
        throw new RefusalError(
          'OS_CLOUD_API_KEY is empty -- the workflow\'s secret (OS_CLOUD_API_KEY_STAGING or OS_CLOUD_API_KEY_PRODUCTION) does not reach this repository; '
            + 'a platform-admin key must be added before this can publish',
        );
      }
    }
  } catch (err) {
    if (err instanceof RefusalError) {
      error(`✗ refusing to publish the starter: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const { artifact, version, stampedFrom } = starter;
  const pkgBody = packageBody(starter);
  const verBody = versionBody({ artifact, version });

  log(`── ${STARTER_MANIFEST_ID} @ ${version} → ${base || '(no control plane: dry run)'}`);
  if (stampedFrom !== undefined) log(`  artifact manifest.version ${stampedFrom} set to ${version}, the package.json version this publishes`);
  log(`  bundle: ${describeBundle(artifact)}`);
  log(`  built from commit ${commit ?? builtFrom(appDir)}`);
  log(`  bundle sha256 ${bundleDigest(artifact)}`);

  if (dryRun) {
    log('  dry run: no HTTP request is made.');
    log(`  POST ${base || '<OS_CLOUD_URL>'}/api/v1/cloud/packages`);
    log(JSON.stringify(printablePackageBody(pkgBody), null, 2));
    log(`  POST ${base || '<OS_CLOUD_URL>'}/api/v1/cloud/packages/<id>/versions`);
    log(JSON.stringify({ ...verBody, bundle: `<artifact: ${describeBundle(artifact)}>` }, null, 2));
    return 0;
  }

  const common = { apiKey, timeoutMs, fetchImpl, sleep, log };
  const upsert = await postJson({ url: `${base}/api/v1/cloud/packages`, body: pkgBody, ...common });
  if (!upsert.ok) {
    error(`✗ package upsert failed (${upsert.status}): ${JSON.stringify(upsert.json).slice(0, 600)}`);
    return 1;
  }
  const pkg = upsert.json?.data ?? upsert.json;
  const pkgId = pkg?.id;
  if (!pkgId) {
    error(`✗ package upsert answered ${upsert.status} with no package id: ${JSON.stringify(upsert.json).slice(0, 600)}`);
    return 1;
  }
  log(`  ✓ ${pkg?.created ? 'created' : 'updated'} sys_package ${pkgId}`);

  const ver = await postJson({ url: `${base}/api/v1/cloud/packages/${encodeURIComponent(pkgId)}/versions`, body: verBody, ...common });
  if (ver.status === 409) {
    log(`  = version ${version} already exists -- nothing was sent for it`);
    log(
      `::warning::version ${version} already existed, so this run did not see its listing status and its approval was NOT verified. `
        + `Check GET ${base}/api/v1/cloud/packages for ${STARTER_MANIFEST_ID}: the cloud counts only an approved version as the starter.`,
    );
    return 0;
  }
  if (!ver.ok) {
    error(`✗ version publish failed (${ver.status}): ${JSON.stringify(ver.json).slice(0, 600)}`);
    const violations = Array.isArray(ver.json?.violations) ? ver.json.violations : [];
    for (const v of violations) error(`    marketplace policy violation: ${v}`);
    return 1;
  }
  const data = ver.json?.data ?? ver.json;
  if (!data?.listing_status) {
    log(`  ✓ created version ${version}`);
    log(
      `::warning::the version answer carried no listing_status, so approval was NOT verified. `
        + `Check GET ${base}/api/v1/cloud/packages for ${STARTER_MANIFEST_ID}: the cloud counts only an approved version as the starter.`,
    );
    return 0;
  }
  if (data.listing_status !== 'approved') {
    error(`✗ version ${version} landed as ${data.listing_status}, not approved -- the cloud counts only an approved version as the starter; the key is probably not a platform-admin key`);
    return 1;
  }
  log(`  ✓ published version ${version} (listing status: approved)`);
  return 0;
}

function parseArgs(argv) {
  const out = { dryRun: false, appDir: DEFAULT_APP_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--app-dir' && argv[i + 1]) out.appDir = path.resolve(argv[++i]);
    else return { usage: `unknown argument ${JSON.stringify(a)}` };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-test -- the table-driven shape of scripts/check-agent-model-declared.mjs:
// each row label is a battery with a floor of 1, registered before anything in
// the loop can `continue`, and the verdict sets a flag the dispatch reads.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the package body is first-party: is_starter, marketplace, no owner, a readme and an icon': 1,
  'the version body auto-approves and carries the package.json version': 1,
  'the artifact manifest version is set to the published version, and the run says so': 1,
  'a dry run prints both payloads and makes no request, with no key or URL': 1,
  'a full run upserts the package and then publishes the version, both with the bearer key': 1,
  'an existing version answers 409: a no-op that exits 0 and says approval was NOT verified': 1,
  'a 5xx is retried with backoff and then succeeds': 1,
  'a 4xx on the upsert fails the run and never posts a version': 1,
  'a 422 on the version prints the marketplace policy violations and fails': 1,
  'a version that lands unapproved fails the run': 1,
  'an empty OS_CLOUD_API_KEY outside a dry run is refused before any request, naming the secret': 1,
  'an artifact with no objects is refused before any request, a dry run included': 1,
  'an artifact with another manifest id is refused before any request': 1,
  'a missing artifact is refused and names the build command': 1,
  'the CLI exits 1 on a refusal, 2 on an unknown argument, 0 on a dry run': 1,
  'a version answer with no listing_status exits 0 and says approval was NOT verified': 1,
  'every run prints the commit it built from and the bundle sha256, a dry run included': 1,
  'a network error on every attempt gives up after the last retry and fails the run': 1,
  'an upsert answer with no package id fails the run and never posts a version': 1,
  'an empty OS_CLOUD_URL outside a dry run is refused before any request': 1,
});
// Deleting a roster entry silences its floor as surely as zeroing it.
const SELF_TEST_BATTERY_FLOOR = 20;

let selfTestReachedVerdict = false;

function fixtureDir({ objects = 1, id = STARTER_MANIFEST_ID, manifestVersion = '0.1.0', version = '0.1.1-next.1', dist = true } = {}) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'publish-starter-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@objectstack/example-starter', version, license: 'Apache-2.0' }));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Starter\n\nCompanies and contacts.\n');
  if (dist) {
    fs.mkdirSync(path.join(dir, 'dist'));
    const artifact = {
      manifest: { id, namespace: 'starter', version: manifestVersion, type: 'app', name: 'Starter', description: 'Companies and contacts.' },
      objects: Array.from({ length: objects }, (_, i) => ({ name: `starter_o${i}` })),
      apps: [{ name: 'starter' }],
    };
    fs.writeFileSync(path.join(dir, 'dist', 'objectstack.json'), JSON.stringify(artifact));
  }
  return dir;
}

/** A fake control plane: answers from a queue, records every request. */
function fakeFetch(answers) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => JSON.stringify(next.json ?? {}) };
  };
  return { impl, calls };
}

const PKG_OK = { status: 200, json: { success: true, data: { id: 'pkg_1', created: true } } };
const VER_OK = { status: 201, json: { success: true, data: { id: 'ver_1', version: '0.1.1-next.1', listing_status: 'approved' } } };

async function run(opts) {
  const out = [];
  const err = [];
  const slept = [];
  const code = await publish({ cloudUrl: 'https://cloud.test', apiKey: 'k-test', commit: 'c0ffee', sleep: async (ms) => { slept.push(ms); }, log: (m) => out.push(m), error: (m) => err.push(m), ...opts });
  return { code, out: out.join('\n'), err: err.join('\n'), slept };
}

const SELF_TEST_CASES = [
  {
    label: 'the package body is first-party: is_starter, marketplace, no owner, a readme and an icon',
    check: async (dir) => {
      const body = packageBody(loadStarter(dir));
      const problems = [];
      if (body.is_starter !== true) problems.push('is_starter is not true');
      if (body.visibility !== 'marketplace') problems.push(`visibility is ${body.visibility}`);
      if ('owner_org_id' in body) problems.push('owner_org_id is present');
      if (body.manifest_id !== STARTER_MANIFEST_ID) problems.push(`manifest_id is ${body.manifest_id}`);
      if (!body.readme?.startsWith('# Starter')) problems.push('no readme');
      if (body.icon_url !== STARTER_ICON_URL) problems.push('no icon');
      if (body.publisher !== STARTER_PUBLISHER) problems.push('no publisher');
      return problems;
    },
  },
  {
    label: 'the version body auto-approves and carries the package.json version',
    check: async (dir) => {
      const s = loadStarter(dir);
      const body = versionBody(s);
      const problems = [];
      if (body.auto_approve !== true) problems.push('auto_approve is not true');
      if (body.version !== '0.1.1-next.1') problems.push(`version is ${body.version}`);
      if (body.bundle?.manifest?.id !== STARTER_MANIFEST_ID) problems.push('bundle is not the artifact');
      return problems;
    },
  },
  {
    label: 'the artifact manifest version is set to the published version, and the run says so',
    check: async (dir) => {
      const r = await run({ appDir: dir, dryRun: true });
      const problems = [];
      if (!r.out.includes('manifest.version 0.1.0 set to 0.1.1-next.1')) problems.push(`no stamp line:\n${r.out}`);
      if (loadStarter(dir).artifact.manifest.version !== '0.1.1-next.1') problems.push('the loaded artifact keeps the old version');
      const same = fixtureDir({ manifestVersion: '0.1.1-next.1' });
      try {
        const r2 = await run({ appDir: same, dryRun: true });
        if (r2.out.includes('set to')) problems.push('a matching version still printed a stamp line');
      } finally {
        fs.rmSync(same, { recursive: true, force: true });
      }
      return problems;
    },
  },
  {
    label: 'a dry run prints both payloads and makes no request, with no key or URL',
    check: async (dir) => {
      const f = fakeFetch([]);
      const r = await run({ appDir: dir, dryRun: true, cloudUrl: '', apiKey: '', fetchImpl: f.impl });
      const problems = [];
      if (r.code !== 0) problems.push(`exit ${r.code}: ${r.err}`);
      if (f.calls.length !== 0) problems.push(`${f.calls.length} request(s) made`);
      for (const want of ['"is_starter": true', '"visibility": "marketplace"', '"auto_approve": true', '/api/v1/cloud/packages/<id>/versions']) {
        if (!r.out.includes(want)) problems.push(`dry-run output lacks ${want}`);
      }
      if (r.out.includes('owner_org_id')) problems.push('dry-run output names owner_org_id');
      return problems;
    },
  },
  {
    label: 'a full run upserts the package and then publishes the version, both with the bearer key',
    check: async (dir) => {
      const f = fakeFetch([PKG_OK, VER_OK]);
      const r = await run({ appDir: dir, fetchImpl: f.impl, cloudUrl: 'https://cloud.test/' });
      const problems = [];
      if (r.code !== 0) problems.push(`exit ${r.code}: ${r.err}`);
      if (f.calls[0]?.url !== 'https://cloud.test/api/v1/cloud/packages') problems.push(`first request ${f.calls[0]?.url}`);
      if (f.calls[1]?.url !== 'https://cloud.test/api/v1/cloud/packages/pkg_1/versions') problems.push(`second request ${f.calls[1]?.url}`);
      if (!f.calls.every((c) => c.auth === 'Bearer k-test')) problems.push('a request lacks the bearer key');
      if (f.calls[0] && 'owner_org_id' in f.calls[0].body) problems.push('the upsert sent owner_org_id');
      return problems;
    },
  },
  {
    label: 'an existing version answers 409: a no-op that exits 0 and says approval was NOT verified',
    check: async (dir) => {
      const f = fakeFetch([PKG_OK, { status: 409, json: { error: 'duplicate' } }]);
      const r = await run({ appDir: dir, fetchImpl: f.impl });
      return [
        ...(r.code === 0 ? [] : [`exit ${r.code}`]),
        ...(r.out.includes('::warning::version 0.1.1-next.1 already existed') && r.out.includes('NOT verified') ? [] : [`no not-verified warning:\n${r.out}`]),
        ...(/published version/.test(r.out) ? ['a 409 run still claims the version is published'] : []),
      ];
    },
  },
  {
    label: 'a 5xx is retried with backoff and then succeeds',
    check: async (dir) => {
      const f = fakeFetch([{ status: 503 }, { status: 502 }, PKG_OK, VER_OK]);
      const r = await run({ appDir: dir, fetchImpl: f.impl });
      const problems = [];
      if (r.code !== 0) problems.push(`exit ${r.code}: ${r.err}`);
      if (JSON.stringify(r.slept) !== JSON.stringify([3000, 6000])) problems.push(`backoff ${JSON.stringify(r.slept)}`);
      if (f.calls.length !== 4) problems.push(`${f.calls.length} requests`);
      return problems;
    },
  },
  {
    label: 'a 4xx on the upsert fails the run and never posts a version',
    check: async (dir) => {
      const f = fakeFetch([{ status: 403, json: { error: 'forbidden' } }]);
      const r = await run({ appDir: dir, fetchImpl: f.impl });
      return [
        ...(r.code === 1 ? [] : [`exit ${r.code}`]),
        ...(f.calls.length === 1 ? [] : [`${f.calls.length} requests`]),
        ...(r.err.includes('upsert failed (403)') ? [] : [`no upsert failure line: ${r.err}`]),
      ];
    },
  },
  {
    label: 'a 422 on the version prints the marketplace policy violations and fails',
    check: async (dir) => {
      const f = fakeFetch([PKG_OK, { status: 422, json: { violations: ['icon is required'] } }]);
      const r = await run({ appDir: dir, fetchImpl: f.impl });
      return [
        ...(r.code === 1 ? [] : [`exit ${r.code}`]),
        ...(r.err.includes('marketplace policy violation: icon is required') ? [] : [`violations not printed: ${r.err}`]),
      ];
    },
  },
  {
    label: 'a version that lands unapproved fails the run',
    check: async (dir) => {
      const f = fakeFetch([PKG_OK, { status: 201, json: { data: { id: 'ver_1', listing_status: 'draft' } } }]);
      const r = await run({ appDir: dir, fetchImpl: f.impl });
      return [...(r.code === 1 ? [] : [`exit ${r.code}`]), ...(r.err.includes('not approved') ? [] : [`no unapproved line: ${r.err}`])];
    },
  },
  {
    label: 'an empty OS_CLOUD_API_KEY outside a dry run is refused before any request, naming the secret',
    check: async (dir) => {
      const f = fakeFetch([]);
      const r = await run({ appDir: dir, apiKey: '', fetchImpl: f.impl });
      return [
        ...(r.code === 1 ? [] : [`exit ${r.code}`]),
        ...(f.calls.length === 0 ? [] : ['a request was made']),
        ...(r.err.includes('OS_CLOUD_API_KEY_STAGING') ? [] : [`the refusal does not name the secret: ${r.err}`]),
      ];
    },
  },
  {
    label: 'an artifact with no objects is refused before any request, a dry run included',
    fixture: { objects: 0 },
    check: async (dir) => {
      const f = fakeFetch([]);
      const r = await run({ appDir: dir, dryRun: true, fetchImpl: f.impl });
      return [...(r.code === 1 ? [] : [`exit ${r.code}`]), ...(r.err.includes('no objects') ? [] : [`no refusal line: ${r.err}`])];
    },
  },
  {
    label: 'an artifact with another manifest id is refused before any request',
    fixture: { id: 'com.example.crm' },
    check: async (dir) => {
      const r = await run({ appDir: dir, dryRun: true });
      return [...(r.code === 1 ? [] : [`exit ${r.code}`]), ...(r.err.includes('com.example.crm') ? [] : [`no refusal line: ${r.err}`])];
    },
  },
  {
    label: 'a missing artifact is refused and names the build command',
    fixture: { dist: false },
    check: async (dir) => {
      const r = await run({ appDir: dir, dryRun: true });
      return [...(r.code === 1 ? [] : [`exit ${r.code}`]), ...(r.err.includes('--filter=@objectstack/example-starter') ? [] : [`no build hint: ${r.err}`])];
    },
  },
  {
    label: 'the CLI exits 1 on a refusal, 2 on an unknown argument, 0 on a dry run',
    check: async (dir) => {
      const self = fileURLToPath(import.meta.url);
      const env = { PATH: process.env.PATH ?? '', OS_CLOUD_URL: '', OS_CLOUD_API_KEY: '' };
      const problems = [];
      const dry = spawnSync(process.execPath, [self, '--dry-run', '--app-dir', dir], { encoding: 'utf8', env });
      if (dry.status !== 0) problems.push(`dry run exit ${dry.status}: ${dry.stderr}`);
      const refused = spawnSync(process.execPath, [self, '--app-dir', dir], { encoding: 'utf8', env });
      if (refused.status !== 1) problems.push(`no-key run exit ${refused.status}`);
      const usage = spawnSync(process.execPath, [self, '--dryrun'], { encoding: 'utf8', env });
      if (usage.status !== 2) problems.push(`unknown argument exit ${usage.status}`);
      return problems;
    },
  },
  {
    label: 'a version answer with no listing_status exits 0 and says approval was NOT verified',
    check: async (dir) => {
      const f = fakeFetch([PKG_OK, { status: 201, json: { data: { id: 'ver_1' } } }]);
      const r = await run({ appDir: dir, fetchImpl: f.impl });
      return [
        ...(r.code === 0 ? [] : [`exit ${r.code}`]),
        ...(r.out.includes('carried no listing_status') && r.out.includes('NOT verified') ? [] : [`no not-verified warning:\n${r.out}`]),
        ...(/published version/.test(r.out) ? ['an unread status is still reported as published'] : []),
      ];
    },
  },
  {
    label: 'every run prints the commit it built from and the bundle sha256, a dry run included',
    check: async (dir) => {
      const want = bundleDigest(loadStarter(dir).artifact);
      const problems = [];
      const dry = await run({ appDir: dir, dryRun: true });
      const full = await run({ appDir: dir, fetchImpl: fakeFetch([PKG_OK, VER_OK]).impl });
      for (const [name, r] of [['dry run', dry], ['full run', full]]) {
        if (!r.out.includes('built from commit c0ffee')) problems.push(`${name}: no commit line`);
        if (!r.out.includes(`bundle sha256 ${want}`)) problems.push(`${name}: no bundle sha256 ${want}`);
      }
      if (!/^[0-9a-f]{64}$/.test(want)) problems.push(`digest is not a sha256: ${want}`);
      return problems;
    },
  },
  {
    label: 'a network error on every attempt gives up after the last retry and fails the run',
    check: async (dir) => {
      let calls = 0;
      const impl = async () => { calls += 1; throw new Error('ECONNRESET'); };
      const r = await run({ appDir: dir, fetchImpl: impl });
      return [
        ...(r.code === 1 ? [] : [`exit ${r.code}`]),
        ...(calls === 4 ? [] : [`${calls} attempts, expected 4`]),
        ...(JSON.stringify(r.slept) === JSON.stringify([3000, 6000, 12000]) ? [] : [`backoff ${JSON.stringify(r.slept)}`]),
        ...(r.err.includes('request failed: ECONNRESET') ? [] : [`no failure line: ${r.err}`]),
      ];
    },
  },
  {
    label: 'an upsert answer with no package id fails the run and never posts a version',
    check: async (dir) => {
      const f = fakeFetch([{ status: 200, json: { success: true, data: {} } }]);
      const r = await run({ appDir: dir, fetchImpl: f.impl });
      return [
        ...(r.code === 1 ? [] : [`exit ${r.code}`]),
        ...(f.calls.length === 1 ? [] : [`${f.calls.length} requests`]),
        ...(r.err.includes('no package id') ? [] : [`no failure line: ${r.err}`]),
      ];
    },
  },
  {
    label: 'an empty OS_CLOUD_URL outside a dry run is refused before any request',
    check: async (dir) => {
      const f = fakeFetch([]);
      const r = await run({ appDir: dir, cloudUrl: '', fetchImpl: f.impl });
      return [
        ...(r.code === 1 ? [] : [`exit ${r.code}`]),
        ...(f.calls.length === 0 ? [] : ['a request was made']),
        ...(r.err.includes('OS_CLOUD_URL is empty') ? [] : [`no refusal line: ${r.err}`]),
      ];
    },
  },
];

async function selfTest() {
  const failures = [];
  const seen = new Map();
  for (const c of SELF_TEST_CASES) {
    // Registered FIRST, before anything that can `continue`, so the floor measures reach.
    seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
    const dir = fixtureDir(c.fixture);
    try {
      const problems = await c.check(dir);
      if (problems.length > 0) failures.push(`${c.label}:\n      ${problems.join('\n      ')}`);
    } catch (err) {
      failures.push(`${c.label}: threw ${err?.stack ?? err}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failures.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  }
  const labels = SELF_TEST_CASES.map((c) => c.label);
  const duplicated = [...new Set(labels.filter((n, i) => labels.indexOf(n) !== i))];
  if (duplicated.length > 0) failures.push(`row label(s) used twice: ${duplicated.map((n) => JSON.stringify(n)).join(', ')}`);
  for (const [name, count] of seen) {
    if (!declared.includes(name)) failures.push(`case "${name}" (${count}) is not declared in SELF_TEST_BATTERIES`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      failures.push(`self-test battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]} -- it DID NOT RUN`);
    }
  }

  if (failures.length > 0) {
    console.error(`✗ publish-starter-marketplace --self-test: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ publish-starter-marketplace --self-test: ${SELF_TEST_CASES.length} cases pass against a fake control plane.`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ publish-starter-marketplace self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    const args = parseArgs(process.argv.slice(2));
    if (args.usage) {
      console.error(`✗ ${args.usage}\n  usage: node scripts/ci/publish-starter-marketplace.mjs [--dry-run] [--app-dir <dir>] | --self-test`);
      process.exit(2);
    }
    const code = await publish({
      appDir: args.appDir,
      dryRun: args.dryRun,
      cloudUrl: process.env.OS_CLOUD_URL ?? '',
      apiKey: process.env.OS_CLOUD_API_KEY ?? '',
      timeoutMs: Number(process.env.OS_CLOUD_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    });
    process.exit(code);
  }
}

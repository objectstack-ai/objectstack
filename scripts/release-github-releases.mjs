#!/usr/bin/env node
/**
 * release-github-releases.mjs — create (or update) one GitHub Release per
 * published package, with a body that CANNOT exceed the Releases API's
 * 125,000-character limit.
 *
 * ## Why this exists (#4900)
 *
 * `changesets/action` with `createGithubReleases: true` posts each package's
 * raw CHANGELOG section as the Release body. `@objectstack/spec`'s section for
 * a single v17 RC is ~343,000 characters — 2.7x the API's limit — so the POST
 * came back:
 *
 *     HttpError: Validation Failed:
 *       {"resource":"Release","code":"custom","field":"body",
 *        "message":"body is too long (maximum is 125000 characters)"}
 *
 * That throw happens INSIDE the action's `runPublish`: after `changeset
 * publish` has fully succeeded, but BEFORE the action sets its `published`
 * output. So the step went red, `published` stayed false, and the `docker` job
 * gated on it was skipped — a published npm version with no runtime image.
 *
 * The section only grows, so every release in the window failed the same way.
 * Measured against the live API while writing this: `@objectstack/spec` has NO
 * GitHub Release for 17.0.0-rc.0, rc.1 or rc.2 (all 404 on the by-tag
 * endpoint), while 16.0.0 and 16.1.0 — whose sections are 62,886 and 1,523
 * characters — have both a Release and their ADR-0087 D4 `spec-changes.json`
 * asset. That asset is uploaded ONTO the spec Release, so D4 has been silently
 * unmounted for the whole v17 RC window as well, not just the Release itself.
 *
 * The fix: the action stops creating Releases (`createGithubReleases: false`)
 * and this script does it, truncating any body that would be rejected and
 * pointing at the complete entry in CHANGELOG.md.
 *
 * ## Contract
 *
 * Faithful to what `changesets/action` produced, minus the failure: same tag
 * (`<pkg>@<version>`), same release name, same `prerelease` rule, and the same
 * changelog-entry body — extracted with a direct port of the action's own
 * `getChangelogEntry`, so an under-limit body is byte-identical to what the
 * action would have posted. Verified against the real
 * `@objectstack/cli@17.0.0-rc.2` release body (73,993 characters, exact match).
 *
 * Beyond that it adds the three properties the action's version lacked:
 *
 *   - **Bounded.** A body over the limit is truncated at a line boundary, with
 *     an unbalanced code fence closed so the notice renders as markdown, and a
 *     link to the full entry in CHANGELOG.md at this exact commit.
 *   - **Idempotent.** Looks the release up by tag first: PATCH when it exists,
 *     POST when it does not. A re-run is a no-op-shaped update, never an
 *     `already_exists` 422 — which matters because a partial failure is the
 *     normal state to recover from (rc.2 left ~69 of 70 releases created).
 *   - **Per-package isolation.** The action ran the whole set through one
 *     `Promise.all`, so the first rejection abandoned the rest. This runs them
 *     sequentially, collects failures, and still exits non-zero — one package's
 *     bad changelog can no longer cost @objectstack/spec its release (and D4
 *     its mount point).
 *
 * Sequential is also deliberate for the writes: #2191 is this repo's standing
 * lesson that bursts of concurrent ref-creating requests race GitHub's backend.
 *
 * Run:
 *   node scripts/release-github-releases.mjs              # from release.yml
 *   node scripts/release-github-releases.mjs --self-test  # verify the logic
 *   node scripts/release-github-releases.mjs --dry-run    # plan + sizes only
 *
 * Env:
 *   PUBLISHED         changesets/action `publishedPackages` JSON. Primary input.
 *   RELEASE_VERSION   fallback: the recovery path's version. Every publishable
 *                     workspace package is released at this version (the
 *                     Changesets `fixed` group bumps in lockstep).
 *   GITHUB_TOKEN      repo-scoped token with `contents: write`.
 *   GITHUB_REPOSITORY / GITHUB_SHA / GITHUB_API_URL / GITHUB_SERVER_URL
 *                     standard Actions context.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/**
 * The GitHub Releases API's documented maximum body length, as quoted verbatim
 * in the 422 that #4900 is about: "body is too long (maximum is 125000
 * characters)".
 */
export const BODY_LIMIT = 125_000;

/**
 * Headroom held back from the limit. Absorbs the closing fence `balanceFences`
 * may append and any accounting slip; the caller asserts the final body against
 * the real limit regardless, so this only decides how far under we land.
 */
const SAFETY_MARGIN = 1_024;

/**
 * How many characters a string costs against the limit.
 *
 * GitHub counts CHARACTERS, not bytes — the failing spec section is 342,910
 * characters but 359,636 UTF-8 bytes, and the API quoted the former. We measure
 * with JS `.length` (UTF-16 code units), which is >= the code-point count for
 * every string and equal for everything outside the astral planes. So it can
 * only ever over-estimate the cost, never under-estimate it, whichever of the
 * two "character" definitions the API applies.
 *
 * @param {string} text
 * @returns {number}
 */
export function measure(text) {
  return text.length;
}

/**
 * Extract the changelog section for `version`.
 *
 * Direct port of `getChangelogEntry` from changesets/action's `src/utils.ts`
 * (v1), including its code-fence skipping — a changeset body can legitimately
 * contain `##` headings, and this repo's do (`## FROM → TO` inside migration
 * notes). Ported rather than imported: the action is a bundled GitHub Action,
 * not an npm dependency of this repo.
 *
 * @param {string} changelog full CHANGELOG.md text
 * @param {string} version exact version string, e.g. `17.0.0-rc.2`
 * @returns {string | null} the section content (trimmed), or null when absent
 */
export function getChangelogEntry(changelog, version) {
  /** @type {{ index: number; depth: number } | undefined} */
  let headingStartInfo;
  /** @type {number | undefined} */
  let endIndex;

  const regex = /^(#{1,6})\s(.*)$|^(`{3,})/gm;
  /** @type {RegExpExecArray | null} */
  let match;
  while ((match = regex.exec(changelog)) != null) {
    // Skip over code blocks so headings inside them never match.
    if (match[3]) {
      const endOfCodeBlockRegex = new RegExp(`^${match[3]}`, 'gm');
      endOfCodeBlockRegex.lastIndex = regex.lastIndex;
      const endMatch = endOfCodeBlockRegex.exec(changelog);
      if (endMatch) {
        regex.lastIndex = endOfCodeBlockRegex.lastIndex;
        continue;
      }
      break; // unterminated fence — malformed changelog
    }

    const headingDepth = match[1].length;
    const headingText = match[2].trim();

    if (headingText === version) {
      headingStartInfo = { index: regex.lastIndex, depth: headingDepth };
      continue;
    }

    if (headingStartInfo && headingDepth === headingStartInfo.depth) {
      endIndex = match.index;
      break;
    }
  }

  if (!headingStartInfo) return null;
  return changelog.slice(headingStartInfo.index, endIndex).trim();
}

/**
 * GitHub's heading slug for an in-file anchor: lowercase, drop punctuation,
 * spaces to hyphens. `17.0.0-rc.2` -> `1700-rc2`.
 *
 * Cross-checked against `github-slugger` (the implementation GitHub's own
 * renderer uses) over the version shapes this can see — `17.0.0-rc.2`,
 * `16.1.0`, `17.0.0`, `1.2.3-beta.10` — which all agree. Kept as four lines
 * rather than a dependency: the input domain here is semver strings, not
 * arbitrary heading text.
 *
 * @param {string} text
 * @returns {string}
 */
export function headingAnchor(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .replace(/ /g, '-');
}

/**
 * Slice without ever splitting a surrogate pair — a lone surrogate is not valid
 * UTF-8 and would be mangled or rejected on the way to the API.
 *
 * @param {string} text
 * @param {number} max in UTF-16 code units
 * @returns {string}
 */
export function sliceSafely(text, max) {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // high surrogate: drop it
  return text.slice(0, end);
}

/**
 * Close a code fence left open by truncation. Without this the notice and the
 * CHANGELOG link render INSIDE the code block — i.e. the one thing truncation
 * owes the reader is exactly what gets swallowed.
 *
 * @param {string} text
 * @returns {string}
 */
export function balanceFences(text) {
  /** @type {string | null} */
  let open = null;
  for (const line of text.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!m) continue;
    const marker = m[1];
    if (open === null) open = marker;
    else if (marker[0] === open[0] && marker.length >= open.length) open = null;
  }
  return open === null ? text : `${text}\n${open}`;
}

/**
 * Build the Release body for one package: the changelog entry when it fits, a
 * truncated entry framed by a notice and a link to the complete one when it
 * does not.
 *
 * @param {object} opts
 * @param {string} opts.entry changelog section content
 * @param {string} opts.tagName e.g. `@objectstack/spec@17.0.0-rc.2`
 * @param {string} opts.changelogLabel repo-relative path shown to the reader
 * @param {string} opts.changelogHref link to the full entry
 * @param {number} [opts.limit]
 * @returns {{ body: string; truncated: boolean; originalLength: number }}
 */
export function buildReleaseBody({ entry, tagName, changelogLabel, changelogHref, limit = BODY_LIMIT }) {
  const originalLength = measure(entry);
  if (originalLength <= limit) {
    return { body: entry, truncated: false, originalLength };
  }

  const n = (v) => v.toLocaleString('en-US');
  const link = `[\`${changelogLabel}\`](${changelogHref})`;

  const notice =
    [
      '> [!IMPORTANT]',
      `> **This release note is truncated.** The changelog entry for \`${tagName}\` is`,
      `> ${n(originalLength)} characters; the GitHub Releases API rejects any body over`,
      `> ${n(limit)}. The complete entry is in ${link}.`,
      '',
      '---',
      '',
    ].join('\n') + '\n';

  const footer = `\n\n---\n\n**Truncated here.** The rest of this entry is in ${link}.\n`;

  const budget = limit - measure(notice) - measure(footer) - SAFETY_MARGIN;
  if (budget <= 0) {
    throw new Error(`release body limit ${limit} is too small to hold even the truncation notice`);
  }

  // Cut on a line boundary so markdown structures stay whole where possible.
  /** @type {string[]} */
  const kept = [];
  let used = 0;
  for (const line of entry.split('\n')) {
    const cost = kept.length === 0 ? measure(line) : measure(line) + 1;
    if (used + cost > budget) break;
    kept.push(line);
    used += cost;
  }

  // A single line longer than the whole budget still has to be cut somewhere.
  let head = kept.length > 0 ? kept.join('\n') : sliceSafely(entry, budget);
  head = balanceFences(head.replace(/\s+$/, ''));

  const body = notice + head + footer;
  if (measure(body) > limit) {
    throw new Error(`truncation produced ${measure(body)} characters, over the ${limit} limit`);
  }
  return { body, truncated: true, originalLength };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace discovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal pnpm-workspace.yaml `packages:` reader. Same approach as
 * scripts/check-changeset-fixed.mjs — no YAML dependency.
 *
 * @param {string} root
 * @returns {string[]}
 */
function readWorkspacePatterns(root) {
  const text = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
  const patterns = [];
  let inPackages = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^packages\s*:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const m = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (m) {
      patterns.push(m[1]);
      continue;
    }
    if (/^\S/.test(line)) inPackages = false;
  }
  return patterns;
}

/**
 * Expand a `packages/*`-style pattern (single `*` per segment).
 *
 * @param {string} root
 * @param {string} pattern
 * @returns {string[]}
 */
function expandPattern(root, pattern) {
  let dirs = [root];
  for (const seg of pattern.split('/')) {
    const next = [];
    for (const dir of dirs) {
      if (seg === '*') {
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) next.push(join(dir, entry.name));
        }
      } else {
        const candidate = join(dir, seg);
        try {
          if (statSync(candidate).isDirectory()) next.push(candidate);
        } catch {
          /* missing — skip */
        }
      }
    }
    dirs = next;
  }
  return dirs;
}

/**
 * Every non-private workspace package, by name.
 *
 * @param {string} [root]
 * @returns {Map<string, { name: string; version: string; dir: string }>}
 */
export function listWorkspacePackages(root = REPO_ROOT) {
  /** @type {Map<string, { name: string; version: string; dir: string }>} */
  const byName = new Map();
  for (const pattern of readWorkspacePatterns(root)) {
    for (const dir of expandPattern(root, pattern)) {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      if (!pkg.name || pkg.private === true) continue;
      if (byName.has(pkg.name)) continue;
      byName.set(pkg.name, { name: pkg.name, version: pkg.version, dir });
    }
  }
  return byName;
}

/**
 * Decide which `<pkg>@<version>` releases this run owes.
 *
 * `PUBLISHED` (the action's own `publishedPackages`) is authoritative when
 * present. `RELEASE_VERSION` is the recovery path's input: that path runs
 * `changeset publish` itself and produces no such JSON, so the release set is
 * the whole publishable workspace at one version — correct here precisely
 * because the Changesets `fixed` group bumps every public package in lockstep
 * (`scripts/check-changeset-fixed.mjs` is the gate that keeps it true).
 *
 * @param {object} opts
 * @param {string} [opts.publishedJson]
 * @param {string} [opts.releaseVersion]
 * @param {Map<string, { name: string; version: string; dir: string }>} opts.packages
 * @returns {{ name: string; version: string; dir: string }[]}
 */
export function resolveReleaseTargets({ publishedJson, releaseVersion, packages }) {
  const trimmed = (publishedJson ?? '').trim();
  if (trimmed && trimmed !== '[]') {
    /** @type {{ name: string; version: string }[]} */
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`PUBLISHED is not valid JSON: ${err instanceof Error ? err.message : err}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('PUBLISHED parsed to an empty or non-array value');
    }
    return parsed.map(({ name, version }) => {
      const pkg = packages.get(name);
      if (!pkg) throw new Error(`published package "${name}" is not in the workspace`);
      return { name, version, dir: pkg.dir };
    });
  }

  if (releaseVersion) {
    return [...packages.values()].map((pkg) => ({ ...pkg, version: releaseVersion }));
  }

  return [];
}

/**
 * Assemble the Release payload for one target. Returns null (with a reason)
 * when the package ships no CHANGELOG.md — changesets/action skips those too.
 *
 * @param {object} opts
 * @param {{ name: string; version: string; dir: string }} opts.target
 * @param {string} opts.serverUrl
 * @param {string} opts.repository `owner/repo`
 * @param {string} opts.ref commit-ish for the CHANGELOG permalink
 * @param {string} [opts.root]
 * @returns {{ tagName: string; body: string; prerelease: boolean; truncated: boolean; originalLength: number } | { skipped: string }}
 */
export function planRelease({ target, serverUrl, repository, ref, root = REPO_ROOT }) {
  const tagName = `${target.name}@${target.version}`;
  const changelogPath = join(target.dir, 'CHANGELOG.md');
  let changelog;
  try {
    changelog = readFileSync(changelogPath, 'utf8');
  } catch {
    return { skipped: `${target.name} ships no CHANGELOG.md` };
  }

  const entry = getChangelogEntry(changelog, target.version);
  if (entry === null) {
    throw new Error(`no changelog entry for ${tagName} in ${relative(root, changelogPath)}`);
  }

  const changelogLabel = relative(root, changelogPath).split('\\').join('/');
  const changelogHref = `${serverUrl}/${repository}/blob/${ref}/${changelogLabel}#${headingAnchor(target.version)}`;

  const { body, truncated, originalLength } = buildReleaseBody({
    entry,
    tagName,
    changelogLabel,
    changelogHref,
  });

  return {
    tagName,
    body,
    // Same rule as changesets/action: any version carrying a prerelease tag.
    prerelease: target.version.includes('-'),
    truncated,
    originalLength,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thin Releases client. `fetchImpl` is injected so the self-test drives the
 * real request/response handling without a network.
 *
 * @param {object} opts
 * @param {string} opts.apiUrl
 * @param {string} opts.repository `owner/repo`
 * @param {string} opts.token
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createReleasesClient({ apiUrl, repository, token, fetchImpl = fetch }) {
  const base = `${apiUrl}/repos/${repository}/releases`;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  };

  const readError = async (res) => {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      /* body already consumed or unreadable */
    }
    return `${res.status} ${res.statusText || ''} ${detail}`.trim();
  };

  return {
    /**
     * Look a release up by tag. The tag contains `/` and `@`; both must be
     * percent-encoded to survive the path segment (verified against the live
     * API: `%40objectstack%2Ftypes%4017.0.0-rc.2` resolves).
     *
     * @param {string} tagName
     * @returns {Promise<{ id: number } | null>}
     */
    async findByTag(tagName) {
      const res = await fetchImpl(`${base}/tags/${encodeURIComponent(tagName)}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET release by tag ${tagName} failed: ${await readError(res)}`);
      return await res.json();
    },

    /**
     * @param {{ tagName: string; body: string; prerelease: boolean; targetCommitish: string }} rel
     */
    async create({ tagName, body, prerelease, targetCommitish }) {
      const res = await fetchImpl(base, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tag_name: tagName,
          name: tagName,
          body,
          prerelease,
          target_commitish: targetCommitish,
        }),
      });
      if (!res.ok) throw new Error(`POST release ${tagName} failed: ${await readError(res)}`);
      return await res.json();
    },

    /**
     * @param {{ id: number; tagName: string; body: string; prerelease: boolean }} rel
     */
    async update({ id, tagName, body, prerelease }) {
      const res = await fetchImpl(`${base}/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: tagName, body, prerelease }),
      });
      if (!res.ok) throw new Error(`PATCH release ${tagName} failed: ${await readError(res)}`);
      return await res.json();
    },
  };
}

/**
 * Create or update every release in `plans`, sequentially, isolating failures.
 *
 * @param {object} opts
 * @param {ReturnType<typeof createReleasesClient>} opts.client
 * @param {{ tagName: string; body: string; prerelease: boolean; truncated: boolean; originalLength: number }[]} opts.plans
 * @param {string} opts.targetCommitish
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ created: string[]; updated: string[]; failed: { tagName: string; error: string }[] }>}
 */
export async function publishReleases({ client, plans, targetCommitish, log = console.log }) {
  const created = [];
  const updated = [];
  const failed = [];

  for (const plan of plans) {
    const size = plan.truncated
      ? `truncated ${plan.originalLength} -> ${measure(plan.body)} chars`
      : `${measure(plan.body)} chars`;
    try {
      const existing = await client.findByTag(plan.tagName);
      if (existing) {
        await client.update({ id: existing.id, ...plan });
        updated.push(plan.tagName);
        log(`updated  ${plan.tagName} (${size})`);
      } else {
        await client.create({ ...plan, targetCommitish });
        created.push(plan.tagName);
        log(`created  ${plan.tagName} (${size})`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ tagName: plan.tagName, error });
      log(`::error::GitHub Release for ${plan.tagName} failed: ${error}`);
    }
  }

  return { created, updated, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main({ dryRun = false } = {}) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error('GITHUB_REPOSITORY is required');
  const ref = process.env.GITHUB_SHA || 'main';
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';

  const packages = listWorkspacePackages();
  const targets = resolveReleaseTargets({
    publishedJson: process.env.PUBLISHED,
    releaseVersion: process.env.RELEASE_VERSION,
    packages,
  });

  if (targets.length === 0) {
    console.log('No published packages reported — nothing to release.');
    return;
  }

  /** @type {{ tagName: string; body: string; prerelease: boolean; truncated: boolean; originalLength: number }[]} */
  const plans = [];
  /** @type {{ tagName: string; error: string }[]} */
  const planFailures = [];
  for (const target of targets) {
    try {
      const plan = planRelease({ target, serverUrl, repository, ref });
      if ('skipped' in plan) {
        console.log(`skipped  ${plan.skipped}`);
        continue;
      }
      plans.push(plan);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      planFailures.push({ tagName: `${target.name}@${target.version}`, error });
      console.log(`::error::cannot build a release body for ${target.name}@${target.version}: ${error}`);
    }
  }

  if (dryRun) {
    for (const plan of plans) {
      console.log(
        `${plan.tagName}\t${measure(plan.body)} chars${plan.truncated ? `\t(truncated from ${plan.originalLength})` : ''}`,
      );
    }
    console.log(`\n${plans.length} release(s) planned, ${planFailures.length} failed to plan.`);
    if (planFailures.length) process.exit(1);
    return;
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required');

  const client = createReleasesClient({ apiUrl, repository, token });
  const { created, updated, failed } = await publishReleases({
    client,
    plans,
    targetCommitish: ref,
  });

  const truncatedCount = plans.filter((p) => p.truncated).length;
  console.log(
    `\n${created.length} created, ${updated.length} updated, ${failed.length + planFailures.length} failed ` +
      `(${truncatedCount} body/bodies truncated to fit the ${BODY_LIMIT}-character limit).`,
  );

  const allFailures = [...planFailures, ...failed];
  if (allFailures.length) {
    console.error(`::error::${allFailures.length} GitHub Release(s) could not be published.`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-test
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A `Response`-shaped stub, so the client's real request/response handling —
 * status branching, error text, JSON decoding — is what gets exercised.
 *
 * @param {number} status
 * @param {unknown} [payload]
 */
function stubResponse(status, payload) {
  const text = JSON.stringify(payload ?? {});
  return {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    async json() {
      return JSON.parse(text);
    },
    async text() {
      return text;
    },
  };
}

/**
 * Records every call and answers from a set of pre-existing releases.
 *
 * @param {object} opts
 * @param {Record<string, number>} [opts.existing] tag -> release id
 * @param {Set<string>} [opts.failCreateFor]
 */
function stubFetch({ existing = {}, failCreateFor = new Set() } = {}) {
  /** @type {{ method: string; url: string; body: any }[]} */
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: String(url), body });

    if (method === 'GET') {
      const m = /\/releases\/tags\/(.+)$/.exec(String(url));
      const tag = decodeURIComponent(m[1]);
      return tag in existing ? stubResponse(200, { id: existing[tag] }) : stubResponse(404, { message: 'Not Found' });
    }
    if (method === 'POST') {
      if (failCreateFor.has(body.tag_name)) {
        return stubResponse(422, { message: 'Validation Failed', errors: [{ field: 'body' }] });
      }
      return stubResponse(201, { id: 999 });
    }
    return stubResponse(200, { id: body?.id ?? 1 });
  };
  return { impl, calls };
}

async function selfTest() {
  /** @type {string[]} */
  const failures = [];
  let assertions = 0;
  const assert = (cond, msg) => {
    assertions += 1;
    if (!cond) failures.push(msg);
  };

  const CTX = {
    serverUrl: 'https://github.com',
    repository: 'objectstack-ai/objectstack',
    ref: 'deadbeef',
  };
  const specChangelog = readFileSync(join(REPO_ROOT, 'packages/spec/CHANGELOG.md'), 'utf8');

  // ── 1. The real #4900 repro: spec's 17.0.0-rc.2 section ────────────────────
  const rc2 = getChangelogEntry(specChangelog, '17.0.0-rc.2');
  assert(rc2 !== null, 'the 17.0.0-rc.2 entry is found in packages/spec/CHANGELOG.md');
  assert(
    rc2 !== null && measure(rc2) > 340_000,
    `#4900's section is still the oversized repro (measured ${rc2 === null ? 'n/a' : measure(rc2)}, expected >340,000)`,
  );

  const specLabel = 'packages/spec/CHANGELOG.md';
  const specHref = `${CTX.serverUrl}/${CTX.repository}/blob/${CTX.ref}/${specLabel}#1700-rc2`;
  const big = buildReleaseBody({
    entry: rc2 ?? '',
    tagName: '@objectstack/spec@17.0.0-rc.2',
    changelogLabel: specLabel,
    changelogHref: specHref,
  });
  assert(big.truncated, 'the oversized entry is reported as truncated');
  assert(
    measure(big.body) <= BODY_LIMIT,
    `the truncated body fits the API limit (got ${measure(big.body)}, limit ${BODY_LIMIT})`,
  );
  assert(big.body.includes(specHref), 'the truncated body links the full CHANGELOG entry, anchor included');
  assert(big.body.includes('truncated'), 'the truncated body says it was truncated');
  assert(
    big.body.trimEnd().endsWith(`${specLabel}\`](${specHref}).`),
    'the closing pointer to CHANGELOG.md is the last thing in the body',
  );
  assert(
    big.body.split('\n').filter((l) => /^ {0,3}```/.test(l)).length % 2 === 0,
    'the truncated body leaves no code fence open',
  );
  assert(
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(big.body),
    'the truncated body contains no lone surrogate',
  );

  // ── 2. A short entry is passed through untouched ───────────────────────────
  const small = getChangelogEntry(specChangelog, '16.1.0');
  assert(small !== null && measure(small) < BODY_LIMIT, 'the 16.1.0 entry is under the limit to begin with');
  const smallBuilt = buildReleaseBody({
    entry: small ?? '',
    tagName: '@objectstack/spec@16.1.0',
    changelogLabel: specLabel,
    changelogHref: specHref,
  });
  assert(!smallBuilt.truncated, 'an under-limit entry is not marked truncated');
  assert(smallBuilt.body === small, 'an under-limit entry is byte-identical to the changelog section');

  // ── 3. Fence balancing when the cut lands inside a code block ──────────────
  const fenced = [
    ...Array.from({ length: 20 }, (_, i) => `line ${i} ${'x'.repeat(44)}`),
    '```ts',
    ...Array.from({ length: 400 }, (_, i) => `const v${i} = ${'y'.repeat(40)};`),
    '```',
  ].join('\n');
  const fencedBuilt = buildReleaseBody({
    entry: fenced,
    tagName: 'pkg@1.0.0',
    changelogLabel: specLabel,
    changelogHref: specHref,
    limit: 4_000,
  });
  assert(fencedBuilt.truncated, 'the fenced fixture is large enough to truncate');
  assert(measure(fencedBuilt.body) <= 4_000, 'the fenced fixture respects the limit it was given');
  assert(
    fencedBuilt.body.split('\n').filter((l) => /^ {0,3}```/.test(l)).length % 2 === 0,
    'a cut inside a code fence is closed so the notice renders as markdown',
  );

  // ── 4. Surrogate pairs are never split ─────────────────────────────────────
  const astral = '🚀'.repeat(5_000);
  const astralBuilt = buildReleaseBody({
    entry: astral,
    tagName: 'pkg@1.0.0',
    changelogLabel: specLabel,
    changelogHref: specHref,
    limit: 3_000,
  });
  assert(
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(astralBuilt.body),
    'a single oversized line is cut without splitting a surrogate pair',
  );
  assert(measure(astralBuilt.body) <= 3_000, 'the astral fixture respects its limit');
  assert(measure(astral) >= [...astral].length, 'measure() never under-counts against code points');

  // ── 5. Anchors and fence-aware heading parsing ─────────────────────────────
  // Expectations below are github-slugger's own output for these inputs.
  assert(headingAnchor('17.0.0-rc.2') === '1700-rc2', 'the version anchor matches GitHub heading slugs');
  assert(headingAnchor('16.1.0') === '1610', 'a stable version anchor drops its dots');
  assert(headingAnchor('1.2.3-beta.10') === '123-beta10', 'a prerelease anchor keeps only its hyphen');
  const tricky = ['## 1.0.0', '', '```md', '## 0.9.0', '```', '', 'real content', '', '## 0.9.0', '', 'older'].join(
    '\n',
  );
  assert(
    getChangelogEntry(tricky, '1.0.0')?.includes('real content') === true,
    'a `##` inside a fenced block does not end the entry',
  );
  assert(getChangelogEntry(tricky, '0.9.0') === 'older', 'the following entry is still found after a fenced decoy');
  assert(getChangelogEntry(tricky, '2.0.0') === null, 'a missing version yields null rather than a wrong section');

  // ── 6. Target resolution: both producers, and neither ──────────────────────
  const packages = listWorkspacePackages();
  assert(packages.has('@objectstack/spec'), 'the workspace scan finds @objectstack/spec');
  const fromPublished = resolveReleaseTargets({
    publishedJson: JSON.stringify([
      { name: '@objectstack/spec', version: '17.0.0-rc.2' },
      { name: '@objectstack/cli', version: '17.0.0-rc.2' },
    ]),
    packages,
  });
  assert(fromPublished.length === 2, 'PUBLISHED drives exactly the packages it lists');
  assert(
    fromPublished.every((t) => typeof t.dir === 'string' && t.dir.length > 0),
    'each published package resolves to its workspace directory',
  );
  const fromVersion = resolveReleaseTargets({ releaseVersion: '17.0.0-rc.9', packages });
  assert(
    fromVersion.length === packages.size && fromVersion.length > 50,
    `the recovery path covers the whole publishable workspace (got ${fromVersion.length})`,
  );
  assert(
    fromVersion.every((t) => t.version === '17.0.0-rc.9'),
    'the recovery path releases every package at the one fixed-group version',
  );
  assert(resolveReleaseTargets({ packages }).length === 0, 'no input means no releases, not a crash');
  assert(
    resolveReleaseTargets({ publishedJson: '[]', releaseVersion: '1.2.3', packages }).length === packages.size,
    'an empty PUBLISHED array falls through to the recovery version',
  );

  // ── 7. Planning is per package, and a missing entry is loud ────────────────
  const specPlan = planRelease({
    target: { name: '@objectstack/spec', version: '17.0.0-rc.2', dir: join(REPO_ROOT, 'packages/spec') },
    ...CTX,
  });
  assert('tagName' in specPlan && specPlan.tagName === '@objectstack/spec@17.0.0-rc.2', 'the tag is `<pkg>@<version>`');
  assert('prerelease' in specPlan && specPlan.prerelease === true, 'an rc version is marked prerelease');
  assert('truncated' in specPlan && specPlan.truncated === true, 'the spec plan truncates');
  assert(
    'body' in specPlan && measure(specPlan.body) <= BODY_LIMIT,
    'the planned spec body is within the API limit end to end',
  );
  const gaPlan = planRelease({
    target: { name: '@objectstack/spec', version: '16.1.0', dir: join(REPO_ROOT, 'packages/spec') },
    ...CTX,
  });
  assert('prerelease' in gaPlan && gaPlan.prerelease === false, 'a GA version is not marked prerelease');
  let threw = false;
  try {
    planRelease({
      target: { name: '@objectstack/spec', version: '99.99.99', dir: join(REPO_ROOT, 'packages/spec') },
      ...CTX,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'a version with no changelog entry fails loudly instead of releasing an empty body');

  // ── 8. Every package gets a release; existing ones are updated, not retried ─
  const plans = ['@objectstack/spec', '@objectstack/cli', '@objectstack/runtime'].map((name) => {
    const plan = planRelease({ target: { name, version: '17.0.0-rc.2', dir: packages.get(name).dir }, ...CTX });
    if (!('tagName' in plan)) throw new Error(`fixture package ${name} produced no plan`);
    return plan;
  });
  const mixed = stubFetch({ existing: { '@objectstack/cli@17.0.0-rc.2': 4242 } });
  const mixedResult = await publishReleases({
    client: createReleasesClient({
      apiUrl: 'https://api.github.com',
      repository: CTX.repository,
      token: 't',
      fetchImpl: mixed.impl,
    }),
    plans,
    targetCommitish: CTX.ref,
    log: () => {},
  });
  assert(
    mixedResult.created.length === 2 && mixedResult.updated.length === 1 && mixedResult.failed.length === 0,
    `every package is released — 2 created, 1 updated (got ${mixedResult.created.length}/${mixedResult.updated.length}/${mixedResult.failed.length})`,
  );
  assert(
    mixedResult.updated[0] === '@objectstack/cli@17.0.0-rc.2',
    'the package that already had a release is the one updated',
  );
  assert(
    mixed.calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/releases/4242')),
    'an existing release is PATCHed by id rather than re-POSTed',
  );
  assert(
    mixed.calls.filter((c) => c.method === 'POST').length === 2,
    'exactly the two absent releases are POSTed',
  );
  assert(
    mixed.calls.every((c) => c.method !== 'GET' || c.url.includes('%2F')),
    'the by-tag lookup percent-encodes the slash in a scoped package tag',
  );
  assert(
    mixed.calls
      .filter((c) => c.method !== 'GET')
      .every((c) => measure(c.body.body) <= BODY_LIMIT),
    'no request ever carries a body over the API limit',
  );
  assert(
    mixed.calls.filter((c) => c.method === 'POST').every((c) => c.body.target_commitish === CTX.ref),
    'a created release is pinned to the release commit',
  );

  // ── 9. Idempotent re-run ───────────────────────────────────────────────────
  const allExist = stubFetch({
    existing: Object.fromEntries(plans.map((p, i) => [p.tagName, 100 + i])),
  });
  const rerun = await publishReleases({
    client: createReleasesClient({
      apiUrl: 'https://api.github.com',
      repository: CTX.repository,
      token: 't',
      fetchImpl: allExist.impl,
    }),
    plans,
    targetCommitish: CTX.ref,
    log: () => {},
  });
  assert(
    rerun.created.length === 0 && rerun.updated.length === 3 && rerun.failed.length === 0,
    're-running against fully-created releases updates all and fails none',
  );
  assert(
    allExist.calls.every((c) => c.method !== 'POST'),
    'a re-run never POSTs, so it cannot hit `already_exists`',
  );

  // ── 10. One package's failure does not abandon the others ──────────────────
  const partial = stubFetch({ failCreateFor: new Set(['@objectstack/cli@17.0.0-rc.2']) });
  const partialResult = await publishReleases({
    client: createReleasesClient({
      apiUrl: 'https://api.github.com',
      repository: CTX.repository,
      token: 't',
      fetchImpl: partial.impl,
    }),
    plans,
    targetCommitish: CTX.ref,
    log: () => {},
  });
  assert(
    partialResult.created.length === 2 && partialResult.failed.length === 1,
    'a rejected release does not stop the remaining packages (the Promise.all defect)',
  );
  assert(
    partialResult.created.includes('@objectstack/spec@17.0.0-rc.2'),
    '@objectstack/spec still gets its release — the ADR-0087 D4 mount point survives a sibling failure',
  );
  assert(
    partialResult.failed[0].error.includes('422'),
    'the failure carries the API status through to the log',
  );

  if (failures.length) {
    console.error(`✗ release-github-releases --self-test — ${failures.length} of ${assertions} assertion(s) failed\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ release-github-releases --self-test: ${assertions} assertions ` +
      `(real packages/spec/CHANGELOG.md 17.0.0-rc.2 section = ${measure(rc2 ?? '')} chars -> ${measure(big.body)}, limit ${BODY_LIMIT})`,
  );
}

const invokedDirectly = isEntrypoint(import.meta.url);
if (invokedDirectly) {
  try {
    if (process.argv.includes('--self-test')) {
      await selfTest();
    } else {
      await main({ dryRun: process.argv.includes('--dry-run') });
    }
  } catch (err) {
    // A stack trace in an Actions log buries the one line that matters.
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

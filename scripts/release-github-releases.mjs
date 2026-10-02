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
 *   - **Safe under a concurrent writer.** The read and the POST are two
 *     requests, and release.yml has two writers of one version's Releases —
 *     the publish job's own step and the push lane's backfill — that are not
 *     mutually excluded. On 17.6.0 they overlapped for a minute: nine POSTs
 *     answered `422 {"code":"already_exists","field":"tag_name"}` because the
 *     other writer created the release between this script's read and its
 *     POST, and both runs went red. That 422 now means what it says — the
 *     release exists — so the script re-reads it by tag and PATCHes it, and
 *     two writers converge on one release per tag. Any OTHER 422 (the body
 *     limit above) still fails the release exactly as before.
 *   - **Duplicates are reported, never deleted.** The same race also proved
 *     the API will ACCEPT two creates for one tag inside one second: 17.6.0
 *     has five tags carrying two Release objects each. No request sequence on
 *     this side can prevent that, so after its writes the script reads the
 *     Releases list and names every tag it released that has more than one.
 *     A duplicate this run CREATED one of fails the run (`::error::`) — the
 *     race was this run's, and without the failure the convergence above
 *     would turn a red race into a green run with a duplicate in it. A
 *     duplicate that predates this run's writes is a `::warning::`: it was
 *     the creating run's to fail, and failing every later backfill over it
 *     would hold that lane's ADR-0087 D4 step on a state only the maintainer
 *     can clear. Either way the report names each Release id, its assets and
 *     the id the by-tag endpoint resolves to. Deleting a Release is a release
 *     act (AGENTS.md Prime Directive 15) — this script never sends a DELETE.
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

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { workspacePackages } from './workspace-enumerator.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  '1. The real #4900 repro: spec\'s 17.0.0-rc.2 section': 9,
  '2. A short entry is passed through untouched': 3,
  '3. Fence balancing when the cut lands inside a code block': 3,
  '4. Surrogate pairs are never split': 3,
  '5. Anchors and fence-aware heading parsing': 6,
  '6. Target resolution: both producers, and neither': 7,
  '7. Planning is per package, and a missing entry is loud': 6,
  '8. Every package gets a release; existing ones are updated, not retried ─': 7,
  '9. Idempotent re-run': 2,
  '10. One package\'s failure does not abandon the others': 3,
  '11. A racing writer\'s create converges instead of failing (422 already_exists)': 8,
  '12. Two concurrent invocations leave exactly one release per tag': 6,
  '13. Any other 422 still fails; a racer the read cannot see fails loudly, bounded': 8,
  '14. Duplicate releases for one tag are reported, never deleted': 14,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 14;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

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
//
// The gate family this script contributes is `check:release-body`, and that
// script is `--self-test` ALONE: lint.yml runs the renderer against fixtures,
// never against the tree. The workspace read below and the CHANGELOG reads
// belong to the RELEASE run, which no pull request schedules. So there is no
// card whose file surface should name this family except one editing this file,
// and identity matching already covers that. The zero hints have a second cause
// worth keeping straight, recorded in `isNonPathNamespace`: the one pathy
// literal this module body used to contribute was a media type, refused as a
// non-filesystem namespace. Both are true, and neither is a missing declaration.
//
// dispatch-gates: no-path-population -- check:release-body runs this renderer's --self-test against fixtures only; the workspace and CHANGELOG reads belong to the release run, which no pull request schedules

/**
 * Every non-private workspace package, by name.
 *
 * @param {string} [root]
 * @returns {Map<string, { name: string; version: string; dir: string }>}
 */
export function listWorkspacePackages(root = REPO_ROOT) {
  /** @type {Map<string, { name: string; version: string; dir: string }>} */
  const byName = new Map();
  // Membership comes from scripts/workspace-enumerator.mjs (#11510) — this
  // repo's one parse of `pnpm-workspace.yaml`, and one of nine private copies
  // before it. That module declares NO path population of its own, which is
  // load-bearing HERE specifically: this file carries a `no-path-population`
  // marker a few lines up, and dispatch-gates' self-test fails any family that
  // both declares one and names paths anyway. An enumerator that spelled the
  // workspace globs as literals would have handed this gate 5395 inherited
  // pairs and turned check:release-body red. Measured after this change:
  // zero hints inherited, marker intact.
  for (const { dir, manifest } of workspacePackages(root)) {
    if (!manifest.name || manifest.private === true) continue;
    if (byName.has(manifest.name)) continue;
    byName.set(manifest.name, { name: manifest.name, version: manifest.version, dir: join(root, dir) });
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
 * Thrown by `create` when the POST answered `422` because a Release for the tag
 * already exists — `{"code":"already_exists","field":"tag_name"}` in the
 * response's `errors[]`, exactly as the 17.6.0 runs logged it. Nothing else
 * raises it: a 422 for any other field or code stays a plain failure.
 */
export class ReleaseAlreadyExistsError extends Error {
  /**
   * @param {string} tagName
   * @param {string} detail the API's answer, for the log
   */
  constructor(tagName, detail) {
    super(`POST release ${tagName} failed: ${detail}`);
    this.name = 'ReleaseAlreadyExistsError';
    this.tagName = tagName;
  }
}

/**
 * Whether a failed POST's answer is the Releases API saying the tag already
 * has a Release. Judged on the structured `errors[]` entry, never on prose.
 *
 * @param {number} status
 * @param {string} text the response body
 * @returns {boolean}
 */
export function isTagAlreadyExists(status, text) {
  if (status !== 422) return false;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
  return errors.some((e) => e && e.code === 'already_exists' && e.field === 'tag_name');
}

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

  const readText = async (res) => {
    try {
      return await res.text();
    } catch {
      return ''; /* body already consumed or unreadable */
    }
  };
  const describe = (res, text) => `${res.status} ${res.statusText || ''} ${text.slice(0, 500)}`.trim();
  const readError = async (res) => describe(res, await readText(res));

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
     * @throws {ReleaseAlreadyExistsError} when the tag already has a Release
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
      if (!res.ok) {
        const text = await readText(res);
        if (isTagAlreadyExists(res.status, text)) throw new ReleaseAlreadyExistsError(tagName, describe(res, text));
        throw new Error(`POST release ${tagName} failed: ${describe(res, text)}`);
      }
      return await res.json();
    },

    /**
     * One page of the repository's Releases, newest first. The list orders by
     * `created_at`, which for a Release on a pushed tag is the TAG's date —
     * measured on 17.6.0: all 74 Release objects carry 02:49:42Z, the tagger
     * date `changeset publish` wrote, while their `published_at` spans two
     * minutes — so one version's Releases sit in one contiguous run of the
     * list, duplicates beside their twins.
     *
     * @param {{ page: number; perPage: number }} opts
     * @returns {Promise<{ id: number; tag_name: string; assets?: { name: string }[] }[]>}
     */
    async listPage({ page, perPage }) {
      const res = await fetchImpl(`${base}?per_page=${perPage}&page=${page}`, { headers });
      if (!res.ok) throw new Error(`GET releases page ${page} failed: ${await readError(res)}`);
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
 * After a `422 already_exists`, how long to wait before each by-tag re-read.
 * The 422 proves the other writer's Release is in the store; the first read is
 * immediate, and the two later ones absorb a read path that has not caught up
 * with that write yet. Bounded: a Release the by-tag read still cannot see
 * after the last one fails that package loudly rather than retrying forever.
 */
export const RACE_REREAD_DELAYS_MS = Object.freeze([0, 1_000, 3_000]);

/**
 * Create or update every release in `plans`, sequentially, isolating failures.
 *
 * A POST that answers `422 already_exists` lost a race with a concurrent
 * writer (see the header): the Release it meant to create now exists, so the
 * package converges by re-reading it by tag and PATCHing it, and is counted
 * as updated (and in `converged`), not failed.
 *
 * @param {object} opts
 * @param {ReturnType<typeof createReleasesClient>} opts.client
 * @param {{ tagName: string; body: string; prerelease: boolean; truncated: boolean; originalLength: number }[]} opts.plans
 * @param {string} opts.targetCommitish
 * @param {(msg: string) => void} [opts.log]
 * @param {(ms: number) => Promise<void>} [opts.sleep] injected so the self-test does not wait
 * @param {readonly number[]} [opts.rereadDelaysMs]
 * @returns {Promise<{ created: string[]; updated: string[]; converged: string[]; createdIds: number[]; failed: { tagName: string; error: string }[] }>}
 */
export async function publishReleases({
  client,
  plans,
  targetCommitish,
  log = console.log,
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  rereadDelaysMs = RACE_REREAD_DELAYS_MS,
}) {
  const created = [];
  const updated = [];
  const converged = [];
  /** @type {number[]} */
  const createdIds = [];
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
        continue;
      }
      let release;
      try {
        release = await client.create({ ...plan, targetCommitish });
      } catch (err) {
        if (!(err instanceof ReleaseAlreadyExistsError)) throw err;
        // Another writer created this tag's Release between the read above and
        // this POST. It exists, so this package's job is now an update of it.
        let racing = null;
        for (const delay of rereadDelaysMs) {
          if (delay > 0) await sleep(delay);
          racing = await client.findByTag(plan.tagName);
          if (racing) break;
        }
        if (!racing) {
          throw new Error(
            `${err.message} — the tag already has a Release, but ${rereadDelaysMs.length} by-tag ` +
              're-read(s) still answered 404, so there is nothing this run can update.',
          );
        }
        await client.update({ id: racing.id, ...plan });
        updated.push(plan.tagName);
        converged.push(plan.tagName);
        log(
          `updated  ${plan.tagName} (${size}) — a concurrent writer created release ${racing.id} between ` +
            "this run's read and its POST (422 already_exists); converged onto it",
        );
        continue;
      }
      created.push(plan.tagName);
      if (release && typeof release.id === 'number') createdIds.push(release.id);
      log(`created  ${plan.tagName} (${size})`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ tagName: plan.tagName, error });
      log(`::error::GitHub Release for ${plan.tagName} failed: ${error}`);
    }
  }

  return { created, updated, converged, createdIds, failed };
}

/** Releases per list page the duplicate audit asks for — the API's maximum. */
export const AUDIT_PER_PAGE = 100;

/**
 * How many list pages the duplicate audit reads at most: a thousand Releases,
 * about fourteen versions of 69 packages back from the newest.
 */
export const AUDIT_MAX_PAGES = 10;

/**
 * Find every tag in `tagNames` that carries more than one Release object.
 *
 * Reads the Releases list newest first. One version's Releases are one
 * contiguous run of that list (see `listPage`), so the walk stops at the first
 * page holding none of `tagNames` after one that did, or at the end of the
 * list, and is `complete` only when it stopped for one of those two reasons.
 * Every tag it never saw is returned in `unseen`: the audit cannot vouch for
 * those. Read-only — it never deletes, and nothing in this file does.
 *
 * @param {object} opts
 * @param {ReturnType<typeof createReleasesClient>} opts.client
 * @param {string[]} opts.tagNames
 * @param {number[]} [opts.createdIds] ids this run's own POSTs created
 * @param {number} [opts.perPage]
 * @param {number} [opts.maxPages]
 * @returns {Promise<{
 *   duplicates: { tagName: string; releases: { id: number; assets: string[] }[]; byTagId: number | null; createdByThisRun: number[] }[];
 *   unseen: string[];
 *   pagesRead: number;
 *   complete: boolean;
 * }>}
 */
export async function auditDuplicateReleases({
  client,
  tagNames,
  createdIds = [],
  perPage = AUDIT_PER_PAGE,
  maxPages = AUDIT_MAX_PAGES,
}) {
  const wanted = new Set(tagNames);
  /** @type {Map<string, { id: number; assets: string[] }[]>} */
  const byTag = new Map();
  let seenAny = false;
  let complete = false;
  let pagesRead = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const releases = await client.listPage({ page, perPage });
    pagesRead += 1;
    let hits = 0;
    for (const rel of Array.isArray(releases) ? releases : []) {
      if (!wanted.has(rel.tag_name)) continue;
      hits += 1;
      const list = byTag.get(rel.tag_name) ?? [];
      list.push({ id: rel.id, assets: (rel.assets ?? []).map((a) => a.name) });
      byTag.set(rel.tag_name, list);
    }
    if (hits > 0) seenAny = true;
    else if (seenAny) {
      complete = true; // walked past this version's run of the list
      break;
    }
    if (!Array.isArray(releases) || releases.length < perPage) {
      complete = true; // the end of the list
      break;
    }
  }

  const ours = new Set(createdIds);
  const duplicates = [];
  for (const tagName of tagNames) {
    const releases = byTag.get(tagName);
    if (!releases || releases.length < 2) continue;
    releases.sort((a, b) => a.id - b.id);
    // Which one `gh release view` / `gh release upload` resolve the tag to,
    // and so where the ADR-0087 D4 asset lands: the report's cleanup anchor.
    let byTagId = null;
    try {
      byTagId = (await client.findByTag(tagName))?.id ?? null;
    } catch {
      byTagId = null;
    }
    duplicates.push({
      tagName,
      releases,
      byTagId,
      createdByThisRun: releases.filter((r) => ours.has(r.id)).map((r) => r.id),
    });
  }

  return { duplicates, unseen: tagNames.filter((t) => !byTag.has(t)), pagesRead, complete };
}

/**
 * Turn an audit into the lines `main` prints: `errors` fail the run,
 * `warnings` do not. A duplicate this run created one of is an error; one that
 * predates this run's writes is a warning (the header says why).
 *
 * @param {Awaited<ReturnType<typeof auditDuplicateReleases>>} audit
 * @returns {{ errors: string[]; warnings: string[] }}
 */
export function describeDuplicates(audit) {
  const errors = [];
  const warnings = [];
  for (const d of audit.duplicates) {
    const list = d.releases
      .map((r) => `${r.id} (${r.assets.length ? `assets: ${r.assets.join(', ')}` : 'no assets'})`)
      .join(', ');
    const anchor =
      d.byTagId === null
        ? 'The by-tag endpoint could not be read, so which one `gh release view` resolves the tag to is unknown.'
        : `The by-tag endpoint — what \`gh release view\` and \`gh release upload\` resolve the tag to, and so ` +
          `where the ADR-0087 D4 asset is attached — answers ${d.byTagId}; the other(s), ` +
          `${d.releases.filter((r) => r.id !== d.byTagId).map((r) => r.id).join(', ')}, are the surplus.`;
    const head = `${d.tagName} has ${d.releases.length} GitHub Releases: ${list}. ${anchor}`;
    const tail =
      'This script never deletes a Release; deleting the surplus is a release act and the maintainer\'s call ' +
      '(AGENTS.md Prime Directive 15).';
    if (d.createdByThisRun.length > 0) {
      errors.push(
        `${head} This run created ${d.createdByThisRun.join(', ')}: the Releases API accepted a second create ` +
          `for one tag from a concurrent writer. ${tail}`,
      );
    } else {
      warnings.push(
        `${head} None of them was created by this run, so it is reported, not failed: the run that created ` +
          `them was the place to fail. ${tail}`,
      );
    }
  }
  if (audit.unseen.length > 0 || !audit.complete) {
    const unseen = audit.unseen.length
      ? `${audit.unseen.length} tag(s) this run released never appeared in it (${audit.unseen.slice(0, 5).join(', ')}` +
        `${audit.unseen.length > 5 ? ', …' : ''})`
      : `it stopped at its ${audit.pagesRead}-page cap before walking past this version's Releases`;
    warnings.push(
      `the duplicate-Release audit read ${audit.pagesRead} page(s) of the Releases list and ${unseen}; ` +
        'whether those tags carry more than one Release is UNVERIFIED by this run.',
    );
  }
  return { errors, warnings };
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
  const { created, updated, converged, createdIds, failed } = await publishReleases({
    client,
    plans,
    targetCommitish: ref,
  });

  // After the writes, never instead of them: a duplicate is made by a
  // concurrent writer's create, and this run's last POST may be the one that
  // completed the pair.
  /** @type {{ errors: string[]; warnings: string[] }} */
  let duplicateReport = { errors: [], warnings: [] };
  try {
    const audit = await auditDuplicateReleases({ client, tagNames: plans.map((p) => p.tagName), createdIds });
    duplicateReport = describeDuplicates(audit);
  } catch (err) {
    duplicateReport.warnings.push(
      `could not read the Releases list to audit for duplicate Releases ` +
        `(${err instanceof Error ? err.message : String(err)}); whether any tag this run released carries ` +
        'more than one Release is UNVERIFIED by this run.',
    );
  }
  for (const w of duplicateReport.warnings) console.log(`::warning::${w}`);
  for (const e of duplicateReport.errors) console.log(`::error::${e}`);

  const truncatedCount = plans.filter((p) => p.truncated).length;
  console.log(
    `\n${created.length} created, ${updated.length} updated ` +
      `(${converged.length} after a concurrent writer's create), ${failed.length + planFailures.length} failed, ` +
      `${duplicateReport.errors.length} duplicated by this run ` +
      `(${truncatedCount} body/bodies truncated to fit the ${BODY_LIMIT}-character limit).`,
  );

  const allFailures = [...planFailures, ...failed];
  if (allFailures.length || duplicateReport.errors.length) {
    if (allFailures.length) console.error(`::error::${allFailures.length} GitHub Release(s) could not be published.`);
    if (duplicateReport.errors.length) {
      console.error(
        `::error::${duplicateReport.errors.length} tag(s) carry more than one GitHub Release after this run's ` +
          'creates (named above). Nothing was deleted.',
      );
    }
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

/** The tag date every stub Release of the version under test carries. */
const STUB_TAG_DATE = '2026-10-02T02:49:42Z';

/**
 * A stateful Releases store behind a `fetch`: records every call, answers the
 * by-tag read, the list, POST and PATCH from the store, and enforces the tag's
 * uniqueness the way the API usually does — a POST for a tag that already has
 * a Release answers `422 already_exists`.
 *
 * @param {object} opts
 * @param {Record<string, number>} [opts.existing] tag -> release id, present before the run
 * @param {Set<string>} [opts.failCreateFor] POST answers the body-limit 422 (a non-race 422)
 * @param {Set<string>} [opts.raceCreateFor] a concurrent writer creates the tag's Release
 *   between this run's by-tag read and its POST
 * @param {Set<string>} [opts.acceptDuplicateCreateFor] the API accepts a second create for the
 *   tag instead of answering 422 — the same-second case 17.6.0 measured
 * @param {Map<string, number>} [opts.hideAfterRace] the racing writer's Release stays invisible
 *   to this many by-tag reads after the race (Infinity: never visible to them)
 * @param {{ id: number; tag_name: string; created_at: string; assets?: { name: string }[] }[]} [opts.seed]
 *   further Releases already in the store (older versions, pre-existing duplicates)
 * @param {boolean} [opts.tick] yield a macrotask per request, so two concurrent runs interleave
 */
function stubFetch({
  existing = {},
  failCreateFor = new Set(),
  raceCreateFor = new Set(),
  acceptDuplicateCreateFor = new Set(),
  hideAfterRace = new Map(),
  seed = [],
  tick = false,
} = {}) {
  /** @type {{ method: string; url: string; body: any }[]} */
  const calls = [];
  /** @type {{ id: number; tag_name: string; created_at: string; assets: { name: string }[]; by: string; name?: string; body?: string; prerelease?: boolean }[]} */
  const releases = [];
  let nextId = 5000;
  const insert = (tagName, by, extra = {}) => {
    const rel = { id: nextId, tag_name: tagName, created_at: STUB_TAG_DATE, assets: [], by, ...extra };
    nextId += 1;
    releases.push(rel);
    return rel;
  };
  for (const [tag, id] of Object.entries(existing)) releases.push({ id, tag_name: tag, created_at: STUB_TAG_DATE, assets: [], by: 'before the run' });
  for (const rel of seed) releases.push({ assets: [], by: 'seed', ...rel });
  const forTag = (tagName) => releases.filter((r) => r.tag_name === tagName).sort((a, b) => a.id - b.id);
  const hidden = new Map();

  const impl = async (url, init = {}) => {
    if (tick) await new Promise((resolveTick) => setImmediate(resolveTick));
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const u = String(url);
    calls.push({ method, url: u, body });

    if (method === 'GET') {
      const byTag = /\/releases\/tags\/(.+)$/.exec(u);
      if (byTag) {
        const tag = decodeURIComponent(byTag[1]);
        if ((hidden.get(tag) ?? 0) > 0) {
          hidden.set(tag, hidden.get(tag) - 1);
          return stubResponse(404, { message: 'Not Found' });
        }
        // The lowest id — what the live by-tag endpoint answered for all three
        // 17.6.0 duplicate pairs read while writing this.
        const [first] = forTag(tag);
        return first ? stubResponse(200, first) : stubResponse(404, { message: 'Not Found' });
      }
      const list = /\/releases\?per_page=(\d+)&page=(\d+)$/.exec(u);
      if (list) {
        const perPage = Number(list[1]);
        const page = Number(list[2]);
        const ordered = [...releases].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
        return stubResponse(200, ordered.slice((page - 1) * perPage, page * perPage));
      }
      return stubResponse(404, { message: 'Not Found' });
    }
    if (method === 'POST') {
      const tag = body.tag_name;
      if (failCreateFor.has(tag)) {
        return stubResponse(422, {
          message: 'Validation Failed',
          errors: [{ resource: 'Release', code: 'custom', field: 'body', message: 'body is too long (maximum is 125000 characters)' }],
        });
      }
      if (raceCreateFor.has(tag) && forTag(tag).length === 0) {
        insert(tag, 'racing writer');
        if (hideAfterRace.has(tag)) hidden.set(tag, hideAfterRace.get(tag));
      }
      if (forTag(tag).length > 0 && !acceptDuplicateCreateFor.has(tag)) {
        return stubResponse(422, {
          message: 'Validation Failed',
          errors: [{ resource: 'Release', code: 'already_exists', field: 'tag_name' }],
        });
      }
      return stubResponse(201, insert(tag, 'this run', { name: body.name, body: body.body, prerelease: body.prerelease }));
    }
    if (method === 'PATCH') {
      const id = Number(/\/releases\/(\d+)$/.exec(u)?.[1]);
      const rel = releases.find((r) => r.id === id);
      if (!rel) return stubResponse(404, { message: 'Not Found' });
      Object.assign(rel, { name: body.name, body: body.body, prerelease: body.prerelease });
      return stubResponse(200, rel);
    }
    return stubResponse(405, { message: `stub: ${method} is not a request this script may send` });
  };
  return { impl, calls, releases, forTag };
}

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'release-github-releases self-test reached its verdict';

async function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };

  /** @type {string[]} */
  const failures = [];
  let assertions = 0;
  const assert = (cond, msg) => {
    registerCase();
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
  battery('1. The real #4900 repro: spec\'s 17.0.0-rc.2 section');
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
  battery('2. A short entry is passed through untouched');
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
  battery('3. Fence balancing when the cut lands inside a code block');
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
  battery('4. Surrogate pairs are never split');
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
  battery('5. Anchors and fence-aware heading parsing');
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
  battery('6. Target resolution: both producers, and neither');
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
  battery('7. Planning is per package, and a missing entry is loud');
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
  battery('8. Every package gets a release; existing ones are updated, not retried ─');
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
  battery('9. Idempotent re-run');
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
  battery('10. One package\'s failure does not abandon the others');
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

  const clientOver = (stub) =>
    createReleasesClient({ apiUrl: 'https://api.github.com', repository: CTX.repository, token: 't', fetchImpl: stub.impl });
  const noSleep = async () => {};
  const [specTag, cliTag, runtimeTag] = plans.map((p) => p.tagName);

  // ── 11. A racing writer's create converges instead of failing ───────────
  // The 17.6.0 shape: this run reads the tag (404), the other writer's create
  // lands, this run's POST answers 422 already_exists on tag_name.
  battery('11. A racing writer\'s create converges instead of failing (422 already_exists)');
  const raced = stubFetch({ raceCreateFor: new Set([cliTag]) });
  /** @type {string[]} */
  const racedLog = [];
  const racedResult = await publishReleases({
    client: clientOver(raced),
    plans,
    targetCommitish: CTX.ref,
    log: (m) => racedLog.push(m),
    sleep: noSleep,
  });
  const [racer] = raced.forTag(cliTag);
  assert(
    raced.calls.some((c) => c.method === 'POST' && c.body.tag_name === cliTag),
    'the fixture really raced: this run POSTed the tag the other writer created first',
  );
  assert(
    racedResult.failed.length === 0,
    `a 422 already_exists from a racing writer fails no release (got ${racedResult.failed.length}: ${racedResult.failed.map((f) => f.error).join(' | ')})`,
  );
  assert(
    racedResult.converged.length === 1 && racedResult.converged[0] === cliTag,
    `the raced tag is reported as converged (got ${JSON.stringify(racedResult.converged)})`,
  );
  assert(
    racedResult.created.length === 2 && racedResult.updated.length === 1 && racedResult.updated[0] === cliTag,
    'the two unraced tags are created and the raced one is counted as an update',
  );
  assert(
    raced.calls.some((c) => c.method === 'PATCH' && c.url.endsWith(`/releases/${racer?.id}`)),
    "it converges by PATCHing the racing writer's own release, found by a by-tag re-read",
  );
  assert(
    plans.every((p) => raced.forTag(p.tagName).length === 1),
    'the run converges to exactly one release per tag',
  );
  assert(
    racer?.body === plans[1].body && racer?.by === 'racing writer',
    "the racing writer's release now carries this run's body",
  );
  assert(
    racedLog.some((l) => l.includes(cliTag) && l.includes('422 already_exists') && l.includes(String(racer?.id))),
    'the log names the convergence, the 422 and the release it converged onto',
  );

  // ── 12. Two concurrent invocations leave exactly one release per tag ────
  // Both writers over ONE store, interleaved request by request — release.yml's
  // publish-job step and push-lane backfill, minus the clock.
  battery('12. Two concurrent invocations leave exactly one release per tag');
  const shared = stubFetch({ tick: true });
  const writer = () =>
    publishReleases({ client: clientOver(shared), plans, targetCommitish: CTX.ref, log: () => {}, sleep: noSleep });
  const [writerA, writerB] = await Promise.all([writer(), writer()]);
  assert(
    writerA.failed.length + writerB.failed.length === 0,
    `neither concurrent writer fails a release (got ${writerA.failed.length} + ${writerB.failed.length}: ` +
      `${[...writerA.failed, ...writerB.failed].map((f) => f.error).join(' | ')})`,
  );
  assert(
    plans.every((p) => shared.forTag(p.tagName).length === 1),
    `two concurrent invocations leave exactly one release per tag (got ${plans.map((p) => shared.forTag(p.tagName).length).join('/')})`,
  );
  assert(
    writerA.converged.length + writerB.converged.length > 0,
    'the two invocations really raced — at least one POST answered 422 already_exists (otherwise this battery proves nothing)',
  );
  assert(
    writerA.created.length + writerB.created.length === plans.length,
    'across both writers every tag is created exactly once',
  );
  assert(
    writerA.created.length + writerA.updated.length === plans.length &&
      writerB.created.length + writerB.updated.length === plans.length,
    'each writer accounts for every tag as created or updated',
  );
  assert(
    shared.calls.every((c) => c.method !== 'DELETE'),
    'converging never deletes anything',
  );

  // ── 13. Any other 422 still fails; an invisible racer fails loudly ──────
  battery('13. Any other 422 still fails; a racer the read cannot see fails loudly, bounded');
  const tooLong = stubFetch({ failCreateFor: new Set([cliTag]) });
  const tooLongResult = await publishReleases({
    client: clientOver(tooLong),
    plans,
    targetCommitish: CTX.ref,
    log: () => {},
    sleep: noSleep,
  });
  assert(
    tooLongResult.failed.length === 1 &&
      tooLongResult.failed[0].tagName === cliTag &&
      tooLongResult.failed[0].error.includes('422') &&
      tooLongResult.failed[0].error.includes('"field":"body"'),
    'the body-limit 422 still fails that package, with the API answer in the error',
  );
  assert(tooLongResult.converged.length === 0, 'the body-limit 422 is not mistaken for a race');
  assert(
    tooLong.calls.filter((c) => c.method === 'GET' && c.url.includes(encodeURIComponent(cliTag))).length === 1 &&
      tooLong.calls.every((c) => c.method !== 'PATCH'),
    'the body-limit 422 triggers no re-read and no PATCH',
  );
  assert(
    isTagAlreadyExists(422, JSON.stringify({ errors: [{ code: 'already_exists', field: 'tag_name' }] })),
    'the classifier recognises the 17.6.0 answer, 422 already_exists on tag_name',
  );
  assert(
    !isTagAlreadyExists(422, JSON.stringify({ errors: [{ code: 'already_exists', field: 'name' }] })) &&
      !isTagAlreadyExists(409, JSON.stringify({ errors: [{ code: 'already_exists', field: 'tag_name' }] })) &&
      !isTagAlreadyExists(422, 'already_exists tag_name'),
    'only the structured tag_name entry on a 422 counts — another field, another status or bare prose does not',
  );
  /** @type {number[]} */
  const slept = [];
  const ghost = stubFetch({ raceCreateFor: new Set([cliTag]), hideAfterRace: new Map([[cliTag, Infinity]]) });
  const ghostResult = await publishReleases({
    client: clientOver(ghost),
    plans,
    targetCommitish: CTX.ref,
    log: () => {},
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  assert(
    ghostResult.failed.length === 1 &&
      ghostResult.failed[0].tagName === cliTag &&
      ghostResult.failed[0].error.includes('already_exists') &&
      ghostResult.failed[0].error.includes('404'),
    'a 422 already_exists whose release no by-tag re-read can see fails that package, saying both',
  );
  assert(
    ghost.calls.filter((c) => c.method === 'GET' && c.url.includes(encodeURIComponent(cliTag))).length ===
      1 + RACE_REREAD_DELAYS_MS.length &&
      JSON.stringify(slept) === JSON.stringify(RACE_REREAD_DELAYS_MS.filter((d) => d > 0)),
    `the re-read is bounded: ${RACE_REREAD_DELAYS_MS.length} attempts after the first read, waiting the declared delays`,
  );
  const lagging = stubFetch({ raceCreateFor: new Set([cliTag]), hideAfterRace: new Map([[cliTag, 1]]) });
  const laggingResult = await publishReleases({
    client: clientOver(lagging),
    plans,
    targetCommitish: CTX.ref,
    log: () => {},
    sleep: noSleep,
  });
  assert(
    laggingResult.failed.length === 0 && laggingResult.converged.length === 1 && lagging.forTag(cliTag).length === 1,
    'a racer the first re-read misses is found by a later one, and the run converges',
  );

  // ── 14. Duplicate releases are reported, never deleted ──────────────────
  // The other 17.6.0 shape: the API ACCEPTED both creates. Older versions'
  // Releases sit below this version's in the list, so the walk has to stop.
  battery('14. Duplicate releases for one tag are reported, never deleted');
  const OLDER_TAG_DATE = '2026-09-29T07:54:50Z';
  const olderVersion = Array.from({ length: 12 }, (_, i) => ({
    id: 100 + i,
    tag_name: `@objectstack/older-${i}@17.5.0`,
    created_at: OLDER_TAG_DATE,
  }));
  const dup = stubFetch({
    raceCreateFor: new Set([specTag]),
    acceptDuplicateCreateFor: new Set([specTag]),
    seed: olderVersion,
  });
  const dupResult = await publishReleases({
    client: clientOver(dup),
    plans,
    targetCommitish: CTX.ref,
    log: () => {},
    sleep: noSleep,
  });
  // The ADR-0087 D4 step attaches onto whichever release the tag resolves to.
  const [specFirst, specSecond] = dup.forTag(specTag);
  specFirst.assets = [{ name: 'spec-changes.json' }];
  const dupAudit = await auditDuplicateReleases({
    client: clientOver(dup),
    tagNames: plans.map((p) => p.tagName),
    createdIds: dupResult.createdIds,
    perPage: 2,
  });
  assert(
    dupResult.failed.length === 0 && dup.forTag(specTag).length === 2,
    'the fixture really holds a duplicate: the API accepted a second create for the spec tag',
  );
  assert(
    dupAudit.duplicates.length === 1 && dupAudit.duplicates[0].tagName === specTag,
    `the audit names exactly the duplicated tag (got ${JSON.stringify(dupAudit.duplicates.map((d) => d.tagName))})`,
  );
  assert(
    JSON.stringify(dupAudit.duplicates[0]?.releases.map((r) => r.id)) === JSON.stringify([specFirst.id, specSecond.id]),
    'the audit lists both release ids of the pair',
  );
  assert(
    dupAudit.duplicates[0]?.byTagId === specFirst.id,
    'the audit names the id the by-tag endpoint resolves to — where the D4 asset lands',
  );
  assert(
    JSON.stringify(dupAudit.duplicates[0]?.createdByThisRun) === JSON.stringify([specSecond.id]),
    'the audit knows which release of the pair this run created',
  );
  assert(
    dupAudit.unseen.length === 0 && dupAudit.complete,
    'every tag this run released was seen and the walk completed',
  );
  assert(
    dupAudit.pagesRead === 3,
    `the walk stops at the first page past this version's releases, never reading the whole list (read ${dupAudit.pagesRead} of 8 pages)`,
  );
  const dupReport = describeDuplicates(dupAudit);
  assert(
    dupReport.errors.length === 1 &&
      dupReport.errors[0].includes(specTag) &&
      dupReport.errors[0].includes(`${specFirst.id} (assets: spec-changes.json)`) &&
      dupReport.errors[0].includes(`${specSecond.id} (no assets)`) &&
      dupReport.errors[0].includes(`are the surplus`),
    'a duplicate this run created one of is an ERROR naming both ids, their assets and the surplus',
  );
  assert(
    dupReport.errors[0]?.includes('never deletes') && dupReport.warnings.length === 0,
    'the error says nothing was deleted, and there is no stray warning',
  );
  assert(
    [...shared.calls, ...dup.calls, ...raced.calls, ...ghost.calls].every((c) => ['GET', 'POST', 'PATCH'].includes(c.method)),
    'no request this script sends is anything but GET, POST or PATCH — it never DELETEs a release',
  );
  const preexisting = stubFetch({
    seed: [
      { id: 7001, tag_name: specTag, created_at: STUB_TAG_DATE, assets: [{ name: 'spec-changes.json' }] },
      { id: 7002, tag_name: specTag, created_at: STUB_TAG_DATE },
      ...olderVersion,
    ],
  });
  const preResult = await publishReleases({
    client: clientOver(preexisting),
    plans,
    targetCommitish: CTX.ref,
    log: () => {},
    sleep: noSleep,
  });
  const preReport = describeDuplicates(
    await auditDuplicateReleases({
      client: clientOver(preexisting),
      tagNames: plans.map((p) => p.tagName),
      createdIds: preResult.createdIds,
    }),
  );
  assert(
    preResult.updated.includes(specTag) &&
      preexisting.calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/releases/7001')) &&
      preexisting.calls.every((c) => c.method !== 'PATCH' || !c.url.endsWith('/releases/7002')),
    'a run over a pre-existing pair updates the one the tag resolves to and leaves the other alone',
  );
  assert(
    preReport.errors.length === 0 && preReport.warnings.length === 1 && preReport.warnings[0].includes('7002'),
    'a duplicate that predates this run is a WARNING naming the surplus, not a failure',
  );
  const capped = describeDuplicates(
    await auditDuplicateReleases({
      client: clientOver(dup),
      tagNames: plans.map((p) => p.tagName),
      createdIds: dupResult.createdIds,
      perPage: 1,
      maxPages: 2,
    }),
  );
  assert(
    capped.warnings.some((w) => w.includes('UNVERIFIED')),
    'an audit that ran out of pages before seeing every tag says what it could not verify',
  );
  assert(
    describeDuplicates(
      await auditDuplicateReleases({ client: clientOver(stubFetch({ seed: olderVersion })), tagNames: [specTag], perPage: 5 }),
    ).warnings.some((w) => w.includes('never appeared')),
    'a tag the list never shows is reported unseen, not silently cleared',
  );

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => {
    failures.push(message);
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }

  if (failures.length) {
    console.error(`✗ release-github-releases --self-test — ${failures.length} of ${assertions} assertion(s) failed\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ release-github-releases --self-test: ${assertions} assertions ` +
      `(real packages/spec/CHANGELOG.md 17.0.0-rc.2 section = ${measure(rc2 ?? '')} chars -> ${measure(big.body)}, limit ${BODY_LIMIT})`,
  );

  return SELF_TEST_VERDICT;
}

const invokedDirectly = isEntrypoint(import.meta.url);
if (invokedDirectly) {
  try {
    if (process.argv.includes('--self-test')) {
      if ((await selfTest()) !== SELF_TEST_VERDICT) {
        console.error(
          '\n✗ release-github-releases self-test: selfTest() returned without reaching its verdict,\n'
            + 'so no success line was printed. Exiting 0 here would report a self-test\n'
            + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
      }
    } else {
      await main({ dryRun: process.argv.includes('--dry-run') });
    }
  } catch (err) {
    // A stack trace in an Actions log buries the one line that matters.
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

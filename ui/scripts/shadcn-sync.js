#!/usr/bin/env node

/**
 * Shadcn Components Sync Script
 * 
 * This script compares ObjectUI components with the latest Shadcn UI components
 * and provides options to update them to the latest version.
 * 
 * Usage:
 *   node scripts/shadcn-sync.js [options]
 * 
 * Options:
 *   --check           Check for component differences (default)
 *   --update <name>   Update specific component from Shadcn registry
 *   --update-all      Update all components from Shadcn registry
 *   --diff <name>     Show detailed diff for a component
 *   --list            List all components
 *   --backup          Create backup before updating
 *   --force           Overwrite even when local edits would be lost
 *   --no-verify       Skip the type-check that runs after an update
 *   --no-cache        Bypass cached registry responses (--check / --diff)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { isEntrypoint } from './invoked-as.mjs';
import https from 'https';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import {
  LOCAL_PATCHES,
  applyLocalPatches,
  verifyLocalPatches,
  describePatchFailure,
} from './shadcn-local-patches.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.join(__dirname, '..');
const COMPONENTS_DIR = path.join(REPO_ROOT, 'packages/components/src/ui');
const MANIFEST_PATH = path.join(REPO_ROOT, 'packages/components/shadcn-components.json');
const BACKUP_DIR = path.join(REPO_ROOT, 'packages/components/.backup');

/**
 * Registry response cache.
 *
 * `--check` makes one request per tracked component — 46 round trips for a
 * run that is otherwise pure I/O wait (28.6s wall, 0.13s of it user time).
 * That is enough friction to stop people running it, which defeats the point
 * of having a status command at all.
 *
 * Lives under `node_modules/.cache/` by convention: already gitignored, and a
 * clean install discards it, which is the right lifetime for a cache.
 */
const CACHE_DIR = path.join(REPO_ROOT, 'node_modules/.cache/shadcn-sync');
const CACHE_TTL_MS = 60 * 60 * 1000;
/**
 * `hits`     served from a valid cached entry
 * `misses`   fetched live and the response came back
 * `failures` fetched live and the request failed (non-2xx, unparseable, socket)
 * `evicted`  cached entries dropped on read because they were not registry data
 *
 * `failures`/`evicted` exist so a poisoned or blocked run cannot look like a
 * quiet success in the summary line — under an egress block the old counters
 * printed "46 fetched" for 46 error pages (objectstack#5803).
 */
const cacheStats = { hits: 0, misses: 0, failures: 0, evicted: 0 };

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function log(message, color = 'white') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60) + '\n');
}

/**
 * One-line excerpt of a response body, for an error message.
 *
 * Control characters are replaced by spaces (tested by code point, so this
 * source file carries none itself): these strings end up in a terminal and in
 * CI logs, and an error page carrying a stray NUL or an ANSI escape would
 * otherwise be pasted straight through. The body is also sliced before the
 * scan, so a multi-megabyte HTML error page costs nothing to summarise.
 */
function bodySnippet(body, max = 120) {
  const flat = Array.from(String(body).slice(0, max * 8))
    .map((ch) => (ch.codePointAt(0) < 0x20 || ch.codePointAt(0) === 0x7f ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Fetch one registry URL and resolve its parsed JSON.
 *
 * Two failure modes used to resolve as if they had succeeded (objectstack#5803):
 *
 *  1. **A non-2xx response.** `https.get` emits `error` only for TRANSPORT
 *     failures. A 403 from an egress allowlist, a 502 from a CDN, a 404 from a
 *     moved endpoint — each arrives as a perfectly ordinary response whose
 *     *body* is the error text. Never looking at `statusCode` meant that text
 *     was handed back as though it were the component.
 *  2. **A 2xx that is not JSON.** The old code caught the `JSON.parse` throw
 *     and resolved the raw string instead, so an HTML interstitial flowed on to
 *     consumers that all read `data.files?.[0]?.content` and quietly saw
 *     `undefined` — the lenient read that hid the failure.
 *
 * Both now reject. Every caller already has an error path (`--check` marks the
 * component `error`, `--update` refuses to write); what they did not have was
 * anything telling them the fetch had failed at all.
 *
 * Redirects are deliberately NOT followed: a 3xx to a login or interstitial
 * page is the same class of poison. The registry endpoints are direct JSON, so
 * if upstream ever starts redirecting, this fails loudly with the status in the
 * message instead of ingesting whatever the redirect target serves.
 *
 * `get` is injectable so the tests can drive a real fixture server over plain
 * `http` — the status/parse logic under test is transport-independent.
 *
 * ## No response at all (objectstack#5968 / objectui#4031)
 *
 * The two failure modes above are both *response-shaped* — something came
 * back and was wrong. A black-holed connection (a dropped SYN, or a peer that
 * completes the TCP handshake and then never writes a byte) produces neither
 * `error` nor `end`; the request just sits there forever. `--check` fires 46
 * of these in series, so one hang stalls the whole command until whatever
 * wraps it (a CI job timeout, a person hitting Ctrl-C) gives up — with
 * nothing in the log naming which of the 46 URLs was the one that stuck.
 *
 * `req.setTimeout` is armed unconditionally and fires on `timeoutMs` of
 * inactivity on the request's socket. Node arms that idle timer as soon as a
 * socket is assigned to the request — which happens before the TCP handshake
 * resolves — so the same callback covers both a connection that never
 * completes and one that completes and then goes quiet; there is no distinct
 * "connecting" vs "connected" case to branch on here. On fire it calls
 * `req.destroy(error)`, which the existing `req.on('error', reject)` below
 * already catches (`destroy(error)` re-emits `error` on the request) — so the
 * timeout reuses the same rejection path as a transport failure, rather than
 * adding a second one. Deliberately no retry: a black hole does not resolve
 * itself in seconds, so retrying only doubles the worst-case wait while
 * every caller's error path already degrades gracefully (`--check` marks the
 * component, `--update` refuses to write).
 */
async function fetchUrl(url, { get = https.get, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = get(url, (res) => {
      const status = res.statusCode ?? 0;
      let data = '';
      // Decode as UTF-8 across chunk boundaries. Concatenating raw Buffers
      // stringifies each chunk on its own, which corrupts any multi-byte
      // character split across a boundary — harmless while a mangled body was
      // silently tolerated, but now it would surface as a hard parse error.
      res.setEncoding('utf-8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        if (status < 200 || status >= 300) {
          const where = res.statusMessage ? `HTTP ${status} ${res.statusMessage}` : `HTTP ${status}`;
          reject(new Error(`${where} from ${url}${data ? ` — ${bodySnippet(data)}` : ''}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Malformed JSON (HTTP ${status}) from ${url} — ${bodySnippet(data)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`shadcn-sync: registry request timed out after ${timeoutMs}ms: ${url}`));
    });
  });
}

/**
 * Is this parsed response an actual registry entry we can act on?
 *
 * The bar is exactly what every consumer reads: a `files` array whose first
 * entry carries non-empty `content`. A 200 that parses but carries an error
 * envelope (`{"error":"…"}`), or an entry with no files, fails it.
 *
 * This is the *semantic* half of the defence, independent of the transport
 * check in `fetchUrl`: a proxy that answers 200 with a JSON error object is
 * still not something to write into the cache.
 */
function isRegistryEntry(data) {
  const content = data?.files?.[0]?.content;
  return Array.isArray(data?.files) && typeof content === 'string' && content.trim().length > 0;
}

function cacheFileFor(url, cacheDir = CACHE_DIR) {
  return path.join(cacheDir, `${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}.json`);
}

/**
 * Fetch a registry entry, optionally serving it from the on-disk cache.
 *
 * ⚠️ `allowCache` controls READING only. Writes always refresh the entry, so a
 * command that must see live data (`--update`) still warms the cache for the
 * next `--check`.
 *
 * The read/write split is the safety property: read-only commands may answer
 * from a cached copy, but nothing that writes a component file ever does.
 * A stale `--check` is a mildly out-of-date status line; a stale `--update`
 * would put hour-old code on disk under a message saying it is current.
 *
 * ## Only registry data is ever cached (objectstack#5803)
 *
 * The cache used to store whatever `fetchUrl` resolved, which under an egress
 * block was the string `Host not in allowlist: ui.shadcn.com…`. All 46 entries
 * were written, and for the next hour every `--check` answered from them
 * without retrying — one moment of network trouble degraded the command for an
 * hour, while reporting "46 cached" as if all were well.
 *
 * So the entry is validated on BOTH sides of the disk:
 *
 * - **write**: only a response that passes `isRegistryEntry` is persisted. A
 *   rejected fetch or a junk payload leaves the cache untouched, so the next
 *   run retries for real.
 * - **read**: an entry that does not pass is not served, and is deleted. Read
 *   validation is what makes recovery immediate — a cache already poisoned by
 *   an older build (or by any future write path) is dropped on first contact
 *   instead of being trusted until its hour is up. Validating only on write
 *   would leave every existing poisoned tree serving garbage for the rest of
 *   its TTL, with no way to tell the user beyond "wait".
 *
 * `cacheDir` and `get` exist for the tests (a throwaway directory and a local
 * fixture server). Both carry real defaults rather than being left undeclared:
 * once `scripts/` is type-checked with `allowJs` (objectui#3494), a destructured
 * option with no default is absent from this function's INFERRED signature, so
 * passing it from a `.ts` caller is a hard error. Declaring the injection point
 * is the fix; suppressing it at the call site would not be.
 *
 * `timeoutMs` passes straight through to `fetchUrl` (see its doc comment for
 * why a black-holed connection is now bounded) — declared here too so tests
 * can drive it down to milliseconds without waiting out the real 10s default.
 */
async function fetchRegistry(url, { allowCache = false, cacheDir = CACHE_DIR, get = https.get, timeoutMs = 10_000 } = {}) {
  const cacheFile = cacheFileFor(url, cacheDir);

  if (allowCache) {
    let entry;
    try {
      entry = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
    } catch {
      /* absent, unreadable or corrupt — fall through and refetch */
    }
    if (entry !== undefined) {
      if (isRegistryEntry(entry?.data)) {
        // Well-formed but expired entries are left alone: they are simply
        // refetched, and the write below replaces them.
        if (typeof entry?.fetchedAt === 'number' && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
          cacheStats.hits++;
          return entry.data;
        }
      } else {
        // Poison: an error page, an error envelope, or a shape we cannot use.
        // Drop it now so a repeat run cannot be tempted by it again.
        try {
          await fs.rm(cacheFile, { force: true });
          cacheStats.evicted++;
        } catch {
          /* read-only cache dir — the entry is ignored either way */
        }
      }
    }
  }

  let data;
  try {
    data = await fetchUrl(url, { get, timeoutMs });
  } catch (error) {
    // Counted, then rethrown untouched: the caller decides what a failed fetch
    // means (`--check` reports the component, `--update` refuses to write).
    cacheStats.failures++;
    throw error;
  }
  cacheStats.misses++;

  if (isRegistryEntry(data)) {
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify({ url, fetchedAt: Date.now(), data }));
    } catch {
      /* the cache is an optimisation; never fail a run because it can't be written */
    }
  }

  // Junk that parsed as JSON is still handed back — callers already report it
  // ("Registry returned no usable file content"). It is only barred from disk.
  return data;
}

async function loadManifest() {
  try {
    const content = await fs.readFile(MANIFEST_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    log(`Error loading manifest: ${error.message}`, 'red');
    process.exit(1);
  }
}

async function getLocalComponents() {
  try {
    const files = await fs.readdir(COMPONENTS_DIR);
    return files
      .filter(f => f.endsWith('.tsx'))
      .map(f => f.replace('.tsx', ''));
  } catch (error) {
    log(`Error reading components directory: ${error.message}`, 'red');
    process.exit(1);
  }
}

/**
 * Registry `@/…` alias → ObjectUI relative path.
 *
 * Shadcn ships components with alias specifiers that assume its own repo
 * layout, and it has changed that layout at least once: the older generation
 * was `@/components/ui/x`, while every endpoint this manifest points at now
 * serves `@/registry/<style>/{ui,hooks,lib}/x`. Both forms are listed so a
 * pinned or re-pointed source keeps working.
 *
 * Synced files land in `packages/components/src/ui/`, so `ui/` resolves to a
 * sibling (`./x`) while `hooks/` and `lib/` step up one level (`../hooks/x`).
 *
 * Matching is on the quoted specifier rather than on `from "…"`, so
 * `export … from`, dynamic `import()` and `vi.mock()` are covered too. The
 * backreference keeps the original quote style.
 */
const IMPORT_REWRITES = [
  [/(["'])@\/registry\/[^/"']+\/ui\/([^"']+)\1/g, '$1./$2$1'],
  [/(["'])@\/registry\/[^/"']+\/hooks\/([^"']+)\1/g, '$1../hooks/$2$1'],
  [/(["'])@\/registry\/[^/"']+\/lib\/([^"']+)\1/g, '$1../lib/$2$1'],
  [/(["'])@\/components\/ui\/([^"']+)\1/g, '$1./$2$1'],
  [/(["'])@\/hooks\/([^"']+)\1/g, '$1../hooks/$2$1'],
  [/(["'])@\/lib\/([^"']+)\1/g, '$1../lib/$2$1'],
];

function rewriteRegistryImports(content) {
  return IMPORT_REWRITES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), content);
}

/**
 * Any `@/…` specifier the table above did not map. These do not resolve from
 * `src/ui/`, so writing a file that still contains one produces a component
 * that cannot compile — which is how `resizable` reached `customComponents`.
 * Callers must treat a non-empty result as a hard failure, not a warning:
 * this is the only thing standing between a Shadcn layout change and a
 * broken build.
 */
function findUnmappedAliases(content) {
  return [...new Set([...content.matchAll(/["'](@\/[^"']+)["']/g)].map((m) => m[1]))];
}

/** The header `updateComponent` prepends, so it isn't counted as a local edit. */
const OBJECTUI_HEADER = /^\/\*\*\n \* ObjectUI\n(?: \*.*\n)* \*\/\n+/;

/**
 * Lines the local file has that the incoming upstream version does not.
 *
 * These are what an overwrite destroys, and a type-check cannot see them:
 * upstream drops a local addition *and* its usages consistently, so the result
 * still compiles. `command.tsx` is the worked example — it carries a local
 * `sr-only` `DialogTitle`/`DialogDescription` on `CommandDialog` (Radix
 * requires an accessible name). Syncing it deletes 38 lines, removes the
 * accessibility fix, and type-checks clean.
 *
 * Comments count. A local comment explaining why we diverged is exactly the
 * kind of thing that must not evaporate silently.
 *
 * Measured across the 46 registry entries: 29 have none of these and sync
 * cleanly; 17 do. So this discriminates rather than crying wolf.
 */
function localOnlyLines(localContent, upstreamContent) {
  const norm = (t) =>
    t
      .replace(OBJECTUI_HEADER, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  const upstream = new Set(norm(upstreamContent));
  return norm(localContent).filter((l) => !upstream.has(l));
}

/**
 * Type-check the package after writing to it, and say plainly whether the sync
 * left it compiling.
 *
 * The `findUnmappedAliases` guard above only catches import paths. The other
 * way a sync breaks things is by discarding local edits: several components
 * have picked up named imports upstream does not have (`command` added
 * `DialogTitle`/`DialogDescription`, `sonner` added `toast`), and overwriting
 * them wholesale drops those. That surfaces as a type error, not a bad path —
 * so nothing short of actually compiling will catch it.
 *
 * Reporting only. Rolling back automatically would throw away a sync the user
 * may want to fix by hand, so this prints the command instead.
 */
function verifyPackageCompiles({ backup } = {}) {
  logSection('Verifying the package still compiles');
  log('Running: pnpm --filter @object-ui/components type-check', 'dim');
  log('(skip with --no-verify)\n', 'dim');

  const result = spawnSync('pnpm', ['--filter', '@object-ui/components', 'type-check'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    encoding: 'utf-8',
  });

  if (result.error) {
    log(`\n⚠ Could not run the type-check: ${result.error.message}`, 'yellow');
    log('  Verify by hand before committing.', 'yellow');
    return null;
  }

  if (result.status === 0) {
    log('\n✓ Type-check passed — the synced components still compile.', 'green');
    return true;
  }

  log(`\n✗ Type-check FAILED (exit ${result.status}). The sync broke the package.`, 'red');
  log('  Most likely a local edit was overwritten — upstream does not carry every', 'yellow');
  log('  named export we import (e.g. command/DialogTitle, sonner/toast).', 'yellow');
  log('\n  To roll back everything this run wrote:', 'cyan');
  log('    git checkout -- packages/components/src/ui/', 'dim');
  if (backup) {
    log(`  Backups from this run are also in ${path.relative(REPO_ROOT, BACKUP_DIR)}/`, 'dim');
  } else {
    log('  (Re-run with --backup next time to keep copies outside git.)', 'dim');
  }
  return false;
}

async function checkComponent(name, manifest, options = {}) {
  const componentInfo = manifest.components[name];
  if (!componentInfo) {
    return {
      name,
      status: 'custom',
      message: 'Custom ObjectUI component (not in Shadcn)',
    };
  }

  const localPath = path.join(COMPONENTS_DIR, `${name}.tsx`);
  try {
    const localContent = await fs.readFile(localPath, 'utf-8');
    const localLines = localContent.split('\n').length;

    // Fetch latest from registry
    try {
      const registryData = await fetchRegistry(componentInfo.source, { allowCache: options.allowCache });
      // Rewrite before comparing, so import-path style alone does not read as
      // a difference — the local file has already been through this transform.
      const rawShadcnContent = rewriteRegistryImports(registryData.files?.[0]?.content || '');

      // A registry response we could not parse (proxy error page, 403 from an
      // egress allowlist, schema change) yields empty content. Treat that as a
      // fetch error rather than letting it flow into the comparisons below:
      // against empty upstream EVERY local line reads as local-only and EVERY
      // declared patch reads as unappliable, which would fire the patch gate
      // for a network problem. The gate must only ever accuse real drift.
      if (!rawShadcnContent.trim()) {
        return {
          name,
          status: 'error',
          missingPatches: verifyLocalPatches(name, localContent),
          unappliablePatches: [],
          message: 'Registry returned no usable file content (offline, blocked, or schema change)',
        };
      }

      // Preflight the declared patches against what upstream serves RIGHT NOW.
      // This is the early-warning half of the contract: it answers "would the
      // next `--update` still be able to re-apply our required edits?" before
      // anyone runs one. A failure here means upstream moved the anchor, and
      // the patch must be re-targeted.
      const upstreamPatched = applyLocalPatches(name, rawShadcnContent);
      // Compare against upstream WITH the declared patches applied, so a
      // component whose only divergence is a declared, mechanically-reapplied
      // patch reads as `synced` rather than as mystery drift. Undeclared local
      // edits still show up exactly as before.
      const shadcnContent = upstreamPatched.content;
      const shadcnLines = shadcnContent.split('\n').length;

      // `localOnlyLines` is directional — lines in the first argument that the
      // second lacks — so calling it both ways answers the two questions that
      // actually decide whether to sync: what would a sync DESTROY, and what
      // would it GAIN?
      //
      // The previous heuristic (`lineDiff > 10 || includes('ObjectUI')`) could
      // not answer either. Every synced file carries the ObjectUI header this
      // script prepends, so the second clause was true for all 46 of them and
      // `--check` reported the entire set as "modified" — no signal at all.
      const localOnly = localOnlyLines(localContent, shadcnContent);
      const upstreamOnly = localOnlyLines(shadcnContent, localContent);

      let status;
      let message;
      if (localOnly.length > 0) {
        // `--update` refuses these; the local lines would be deleted.
        status = 'modified';
        message = `${localOnly.length} local line(s) upstream lacks — --update would refuse`;
        // Deliberately NOT "N updates available". Both counts are set
        // differences, so a line we edited locally appears on both sides: once
        // as ours, once as the upstream original it replaced. For a modified
        // component this number is mostly the mirror image of its own local
        // edits, not new upstream work waiting to be collected.
        if (upstreamOnly.length > 0) message += `, ${upstreamOnly.length} not matching upstream verbatim`;
        // Divergence with a recorded reason is a decision; divergence without
        // one is an open question. Surfacing the split makes the untriaged
        // components a visible to-do instead of undifferentiated noise.
        message += componentInfo.localEdits ? '  [documented]' : '  [UNDOCUMENTED]';
      } else if (upstreamOnly.length > 0) {
        status = 'outdated';
        message = `${upstreamOnly.length} upstream line(s) to pick up — safe to sync`;
      } else {
        status = 'synced';
        message = 'Identical to upstream';
      }

      return {
        name,
        status,
        localLines,
        shadcnLines,
        localOnly: localOnly.length,
        upstreamOnly: upstreamOnly.length,
        documented: Boolean(componentInfo.localEdits),
        // Declared patches missing from the file ON DISK (offline signal).
        missingPatches: verifyLocalPatches(name, localContent),
        // Declared patches that would NOT re-apply to current upstream.
        unappliablePatches: upstreamPatched.failed,
        message,
      };
    } catch (fetchError) {
      return {
        name,
        status: 'error',
        // The local-patch check needs no network, so it still reports even
        // when the registry is unreachable (offline CI, egress allowlist).
        missingPatches: verifyLocalPatches(name, localContent),
        unappliablePatches: [],
        message: `Error fetching from registry: ${fetchError.message}`,
      };
    }
  } catch (error) {
    return {
      name,
      status: 'error',
      message: `Error reading local file: ${error.message}`,
    };
  }
}

async function checkAllComponents(options = {}) {
  logSection('Checking Components Status');
  
  const manifest = await loadManifest();
  const localComponents = await getLocalComponents();
  
  log(`Found ${localComponents.length} local components`, 'cyan');
  log(`Tracking ${Object.keys(manifest.components).length} Shadcn components`, 'cyan');
  log(`Tracking ${Object.keys(manifest.customComponents).length} custom components\n`, 'cyan');
  
  const results = {
    synced: [],
    outdated: [],
    modified: [],
    custom: [],
    error: [],
  };

  for (const component of localComponents) {
    const result = await checkComponent(component, manifest, options);
    results[result.status].push(result);

    const symbol = {
      synced: '✓',
      outdated: '↑',
      modified: '⚠',
      custom: '●',
      error: '✗',
    }[result.status];

    const color = {
      synced: 'green',
      outdated: 'cyan',
      modified: 'yellow',
      custom: 'blue',
      error: 'red',
    }[result.status];

    log(`${symbol} ${result.name.padEnd(25)} ${result.message}`, color);
  }

  // Summary
  logSection('Summary');
  log(`✓ Identical: ${results.synced.length} components`, 'green');
  log(`↑ Outdated:  ${results.outdated.length} components (no local edits — safe to sync)`, 'cyan');
  log(`⚠ Modified:  ${results.modified.length} components (local edits — --update refuses)`, 'yellow');
  log(`● Custom:    ${results.custom.length} components (not tracked upstream)`, 'blue');
  log(`✗ Errors:    ${results.error.length} components`, 'red');

  // A run that returns in under a second is otherwise indistinguishable from
  // one that silently fetched nothing, so always say where the data came from.
  // Failed and evicted are reported separately and only when non-zero: a run
  // whose fetches all failed must not read as "46 fetched" (objectstack#5803).
  if (cacheStats.hits > 0 || cacheStats.misses > 0 || cacheStats.failures > 0 || cacheStats.evicted > 0) {
    const ttlMin = Math.round(CACHE_TTL_MS / 60000);
    const parts = [`${cacheStats.hits} cached`, `${cacheStats.misses} fetched`];
    if (cacheStats.failures > 0) parts.push(`${cacheStats.failures} FAILED`);
    if (cacheStats.evicted > 0) parts.push(`${cacheStats.evicted} unusable entries evicted`);
    log(
      `\nRegistry: ${parts.join(', ')} ` + `(cache TTL ${ttlMin}min — --no-cache to force live)`,
      'dim',
    );
  }

  // The actionable bucket: upstream moved and nothing local is at risk.
  if (results.outdated.length > 0) {
    log('\nSafe to sync now:', 'cyan');
    log(`  node scripts/shadcn-sync.js --update ${results.outdated[0].name}`, 'dim');
    if (results.outdated.length > 1) {
      log(`  (${results.outdated.length} in total: ${results.outdated.map((r) => r.name).join(', ')})`, 'dim');
    }
  }

  // ── Declared local patches ────────────────────────────────────────────────
  // Two independent failures, both fatal. Everything above this point is
  // advisory status reporting; this block is a gate, and `main()` turns a
  // non-empty result into a non-zero exit. Silent reversion of a required edit
  // is the failure mode the patch manifest exists to close, so it must never
  // be reported as just another yellow line in a 46-component list.
  const all = Object.values(results).flat();
  const reverted = all.filter((r) => r.missingPatches?.length > 0);
  const unappliable = all.filter((r) => r.unappliablePatches?.length > 0);

  if (reverted.length > 0 || unappliable.length > 0) {
    logSection('DECLARED LOCAL PATCHES — FAILED');
  }

  if (reverted.length > 0) {
    log('✗ Required local patches are MISSING from the file on disk:', 'red');
    reverted.forEach((r) =>
      r.missingPatches.forEach((p) => describePatchFailure(r.name, p).forEach((l) => log(l, 'red'))),
    );
    log('\n  These edits are declared in scripts/shadcn-local-patches.mjs and are', 'yellow');
    log('  supposed to be re-applied by every sync. Finding them absent means the', 'yellow');
    log('  file was overwritten by `--force`, hand-edited, or mis-merged.', 'yellow');
    log(`  Restore with: node scripts/shadcn-sync.js --update ${reverted[0].name}`, 'cyan');
  }

  if (unappliable.length > 0) {
    log('\n✗ Required local patches NO LONGER APPLY to current upstream:', 'red');
    unappliable.forEach((r) =>
      r.unappliablePatches.forEach((p) => describePatchFailure(r.name, p).forEach((l) => log(l, 'red'))),
    );
    log('\n  The file on disk is still correct — but the next `--update` cannot', 'yellow');
    log('  re-apply these, so it will refuse to write rather than drop them.', 'yellow');
    log('  Re-target the anchors in scripts/shadcn-local-patches.mjs.', 'cyan');
  }

  if (results.modified.length > 0) {
    const undocumented = results.modified.filter((r) => !r.documented);
    const documented = results.modified.filter((r) => r.documented);

    log('\nThese carry local edits a sync would delete:', 'yellow');
    if (documented.length > 0) {
      log(`  documented (${documented.length}): ${documented.map((r) => `${r.name}(${r.localOnly})`).join(', ')}`, 'dim');
      log('    → reason recorded in `localEdits` in shadcn-components.json', 'dim');
    }
    if (undocumented.length > 0) {
      log(`  UNDOCUMENTED (${undocumented.length}): ${undocumented.map((r) => `${r.name}(${r.localOnly})`).join(', ')}`, 'yellow');
      log('    → nobody has written down why these diverge. Until someone does,', 'dim');
      log('      there is no way to tell a deliberate fix from stale drift.', 'dim');
      log('      Triage with `--diff <name>`, then add a `localEdits` note.', 'dim');
    }
  }

  // Unique components, not the sum: one component can be in BOTH lists (its
  // file lost the patch AND upstream moved the anchor), and reporting that as
  // "2 components" would be wrong.
  results.patchFailures = new Set([...reverted, ...unappliable].map((r) => r.name)).size;
  return results;
}

async function createBackup(componentName) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const sourcePath = path.join(COMPONENTS_DIR, `${componentName}.tsx`);
  const backupPath = path.join(BACKUP_DIR, `${componentName}.tsx.${Date.now()}.backup`);
  
  try {
    await fs.copyFile(sourcePath, backupPath);
    log(`Created backup: ${path.basename(backupPath)}`, 'dim');
  } catch (error) {
    log(`Warning: Could not create backup: ${error.message}`, 'yellow');
  }
}

async function updateComponent(name, manifest, options = {}) {
  const componentInfo = manifest.components[name];
  
  if (!componentInfo) {
    log(`Component "${name}" not found in Shadcn registry (might be custom)`, 'red');
    return false;
  }
  
  log(`\nUpdating ${name}...`, 'cyan');
  
  try {
    // Fetch from registry
    // allowCache omitted on purpose: a write must never come from a cached copy.
    const registryData = await fetchRegistry(componentInfo.source);

    if (!registryData.files || registryData.files.length === 0) {
      log(`No files found in registry for ${name}`, 'red');
      return false;
    }

    // Only files[0] is written. Say so rather than truncating silently — a
    // multi-file entry (e.g. `toast`) needs its extra files placed by hand.
    if (registryData.files.length > 1) {
      const extra = registryData.files.slice(1).map((f) => f.path || f.name || '?');
      log(`  ⚠ Registry ships ${registryData.files.length} files; only the first is written.`, 'yellow');
      log(`    Not written: ${extra.join(', ')}`, 'yellow');
    }

    // Transform imports to match ObjectUI structure
    let content = rewriteRegistryImports(registryData.files[0].content);

    // Re-apply the declared local patches (scripts/shadcn-local-patches.mjs).
    //
    // This is what makes a required edit survive regeneration instead of being
    // something a human has to remember to re-do. It runs BEFORE the local-edit
    // refusal below on purpose: with the patches re-applied, a component whose
    // only divergence is a declared patch compares equal to upstream and syncs
    // cleanly, so the refusal keeps signalling only UNDECLARED divergence.
    const patched = applyLocalPatches(name, content);
    if (patched.failed.length > 0) {
      // The anchor a patch needs is gone (or ambiguous) — upstream restructured
      // the code it depends on. Writing anyway would produce a file that
      // compiles and looks fine while silently missing the fix, which is the
      // exact regression the patch manifest exists to prevent. Refuse.
      log(`✗ Refusing to write ${name}.tsx — ${patched.failed.length} declared local patch(es) no longer apply:`, 'red');
      patched.failed.forEach((p) => describePatchFailure(name, p).forEach((l) => log(l, 'yellow')));
      log(`  Upstream changed the code these patches anchor on. Re-target them in`, 'yellow');
      log(`  scripts/shadcn-local-patches.mjs, then re-run. Do NOT --force past this:`, 'yellow');
      log(`  --force writes upstream verbatim and the patched behaviour is lost.`, 'yellow');
      return false;
    }
    content = patched.content;
    if (patched.applied.length > 0) {
      log(`  ↺ Re-applied ${patched.applied.length} declared local patch(es): ${patched.applied.map((p) => p.id).join(', ')}`, 'cyan');
    }

    // Fail closed. An unmapped `@/…` specifier does not resolve from src/ui/,
    // so writing the file would swap working code for code that cannot
    // compile. Better to refuse and have someone extend IMPORT_REWRITES.
    const unmapped = findUnmappedAliases(content);
    if (unmapped.length > 0) {
      log(`✗ Refusing to write ${name}.tsx — unmapped registry import path(s):`, 'red');
      unmapped.forEach((spec) => log(`    ${spec}`, 'red'));
      log(`  Shadcn's alias layout changed. Add a rule to IMPORT_REWRITES in this script.`, 'yellow');
      return false;
    }

    // Don't clobber local edits silently. A type-check will not catch this —
    // see localOnlyLines — so refusing is the only thing that makes the loss
    // a decision rather than an accident.
    const targetPathForCheck = path.join(COMPONENTS_DIR, `${name}.tsx`);
    let existing = null;
    try {
      existing = await fs.readFile(targetPathForCheck, 'utf-8');
    } catch {
      /* new component — nothing to lose */
    }

    if (existing && !options.force) {
      const lost = localOnlyLines(existing, content);
      if (lost.length > 0) {
        log(`✗ Refusing to overwrite ${name}.tsx — ${lost.length} local line(s) upstream does not have:`, 'red');
        lost.slice(0, 8).forEach((l) => log(`    ${l.length > 96 ? l.slice(0, 96) + '…' : l}`, 'dim'));
        if (lost.length > 8) log(`    … and ${lost.length - 8} more`, 'dim');
        if (componentInfo.localEdits) {
          // Someone already worked out why this diverges. Say so here rather
          // than making the next person re-derive it from a wall of diff.
          log(`  Why it diverges (localEdits in shadcn-components.json):`, 'cyan');
          log(`    ${componentInfo.localEdits}`, 'dim');
        }
        log(`  Overwriting deletes these. Port them onto the new upstream version by hand,`, 'yellow');
        log(`  or re-run with --force if they are genuinely obsolete.`, 'yellow');
        return 'skipped';
      }
    }

    // Add ObjectUI header
    const header = `/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

`;
    
    content = header + content;
    
    // Create backup if requested
    if (options.backup) {
      await createBackup(name);
    }
    
    // Write updated component
    const targetPath = path.join(COMPONENTS_DIR, `${name}.tsx`);
    await fs.writeFile(targetPath, content, 'utf-8');

    // Post-write assertion. `applyLocalPatches` already guarantees this, so a
    // hit here means the engine itself regressed — still worth saying out loud
    // rather than trusting an invariant we never check.
    const missingAfterWrite = verifyLocalPatches(name, content);
    if (missingAfterWrite.length > 0) {
      log(`✗ ${name}.tsx was written WITHOUT ${missingAfterWrite.length} declared patch(es):`, 'red');
      missingAfterWrite.forEach((p) => describePatchFailure(name, p).forEach((l) => log(l, 'red')));
      log(`  Roll back with: git checkout -- packages/components/src/ui/${name}.tsx`, 'cyan');
      return false;
    }

    log(`✓ Updated ${name}.tsx`, 'green');
    
    // Check and log dependencies
    if (componentInfo.dependencies.length > 0) {
      log(`  Dependencies: ${componentInfo.dependencies.join(', ')}`, 'dim');
    }
    if (componentInfo.registryDependencies.length > 0) {
      log(`  Registry deps: ${componentInfo.registryDependencies.join(', ')}`, 'dim');
    }
    
    return true;
  } catch (error) {
    log(`✗ Error updating ${name}: ${error.message}`, 'red');
    return false;
  }
}

async function updateAllComponents(options = {}) {
  logSection('Updating All Components from Shadcn Registry');
  
  const manifest = await loadManifest();
  const componentNames = Object.keys(manifest.components);
  
  if (options.backup) {
    log('Creating backups...', 'cyan');
  }
  
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const name of componentNames) {
    const result = await updateComponent(name, manifest, options);
    if (result === true) {
      updated++;
    } else if (result === 'skipped') {
      skipped++;
    } else {
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logSection('Update Complete');
  log(`✓ Updated: ${updated} components`, 'green');
  if (skipped > 0) {
    log(`⊘ Skipped: ${skipped} components (local edits would be lost — see above)`, 'yellow');
    log(`  Port those edits by hand, or re-run with --force to take upstream as-is.`, 'dim');
  }
  if (failed > 0) {
    log(`✗ Failed:  ${failed} components`, 'red');
  }
  
  // Only worth compiling if something was actually written.
  const compiles = updated > 0 && options.verify !== false ? verifyPackageCompiles(options) : undefined;

  log('\nNext steps:', 'cyan');
  log('1. Review the changes: git diff packages/components/src/ui/', 'dim');
  if (compiles === false) {
    log('2. Fix or roll back — the type-check above failed.', 'dim');
  } else {
    log('2. Test the components: pnpm test', 'dim');
    log('3. Build the package: turbo run build --filter=@object-ui/components', 'dim');
  }
}

async function showDiff(name, options = {}) {
  logSection(`Component Diff: ${name}`);
  
  const manifest = await loadManifest();
  const componentInfo = manifest.components[name];
  
  if (!componentInfo) {
    log(`Component "${name}" not found in registry`, 'red');
    return;
  }
  
  try {
    const localPath = path.join(COMPONENTS_DIR, `${name}.tsx`);
    const localContent = await fs.readFile(localPath, 'utf-8');
    const registryData = await fetchRegistry(componentInfo.source, { allowCache: options.allowCache });
    // Same transform `--update` would apply, so the two sides are comparable.
    const shadcnContent = rewriteRegistryImports(registryData.files?.[0]?.content || '');

    log('Local version:', 'cyan');
    console.log(localContent.substring(0, 500) + '...\n');

    log('Shadcn version (import paths rewritten):', 'cyan');
    console.log(shadcnContent.substring(0, 500) + '...\n');

    log(`Local:  ${localContent.split('\n').length} lines`, 'dim');
    log(`Shadcn: ${shadcnContent.split('\n').length} lines`, 'dim');

    const unmapped = findUnmappedAliases(shadcnContent);
    if (unmapped.length > 0) {
      log(`\n⚠ Unmapped registry import path(s) — \`--update ${name}\` would refuse:`, 'yellow');
      unmapped.forEach((spec) => log(`    ${spec}`, 'yellow'));
    }
  } catch (error) {
    log(`Error: ${error.message}`, 'red');
  }
}

async function listComponents() {
  logSection('Component List');
  
  const manifest = await loadManifest();
  
  log('Shadcn Components:', 'cyan');
  Object.keys(manifest.components).sort().forEach(name => {
    console.log(`  • ${name}`);
  });
  
  log('\nCustom ObjectUI Components:', 'blue');
  Object.entries(manifest.customComponents).sort().forEach(([name, info]) => {
    console.log(`  • ${name.padEnd(20)} ${colors.dim}${info.description}${colors.reset}`);
  });
}

// Main CLI
async function main() {
  const args = process.argv.slice(2);
  // Read-only commands may answer from cache; --no-cache forces live fetches.
  const allowCache = !args.includes('--no-cache');

  if (args.length === 0 || args.includes('--check')) {
    const results = await checkAllComponents({ allowCache });
    // Exit non-zero on a declared-patch failure ONLY. Ordinary drift
    // (outdated/modified/undocumented) stays exit 0: it is status, and making
    // it fatal would turn this command into noise nobody runs. A required edit
    // that vanished, or one that can no longer be re-applied, is different in
    // kind — it is a broken contract, so it breaks the build.
    if (results.patchFailures > 0) {
      log(`\n✗ ${results.patchFailures} component(s) with declared local patch failures — see above.`, 'red');
      process.exitCode = 1;
    }
  } else if (args.includes('--update-all')) {
    const backup = args.includes('--backup');
    const verify = !args.includes('--no-verify');
    const force = args.includes('--force');
    await updateAllComponents({ backup, verify, force });
  } else if (args.includes('--update')) {
    const idx = args.indexOf('--update');
    const componentName = args[idx + 1];
    if (!componentName) {
      log('Error: --update requires a component name', 'red');
      process.exit(1);
    }
    const manifest = await loadManifest();
    const backup = args.includes('--backup');
    const verify = !args.includes('--no-verify');
    const force = args.includes('--force');
    const written = await updateComponent(componentName, manifest, { backup, force });
    // A single component can break the package just as thoroughly as a bulk
    // run, so it gets the same compile check.
    if (written === true && verify) verifyPackageCompiles({ backup });
  } else if (args.includes('--diff')) {
    const idx = args.indexOf('--diff');
    const componentName = args[idx + 1];
    if (!componentName) {
      log('Error: --diff requires a component name', 'red');
      process.exit(1);
    }
    await showDiff(componentName, { allowCache });
  } else if (args.includes('--list')) {
    await listComponents();
  } else if (args.includes('--help') || args.includes('-h')) {
    logSection('Shadcn Components Sync Script');
    console.log('Usage: node scripts/shadcn-sync.js [options]\n');
    console.log('Options:');
    console.log('  --check              Check for component differences (default)');
    console.log('  --update <name>      Update specific component from Shadcn');
    console.log('  --update-all         Update all components from Shadcn');
    console.log('  --diff <name>        Show detailed diff for a component');
    console.log('  --list               List all components');
    console.log('  --backup             Create backup before updating');
    console.log('  --force              Overwrite even if local edits would be lost');
    console.log('  --no-verify          Skip the post-update type-check');
    console.log('  --no-cache           Bypass the cached registry responses (--check/--diff)');
    console.log('  --help, -h           Show this help message\n');
  } else {
    log('Unknown option. Use --help for usage information.', 'red');
    process.exit(1);
  }
}

// This file is the ONE of objectui#6092's 29 hand-typed guards that was not
// wrong: the deleted `invokedAsCli()` compared through `realpathSync`, so it
// already answered correctly through a symlink. Replacing it with the shared
// predicate is therefore a SIMPLIFICATION, not a fix — one spelling fewer for a
// reader to re-derive, and one fewer place for the realpath leg to be dropped
// by a later edit. `scripts/invoked-as.mjs` carries the rationale, and adds the
// `node <dir>` case this hand-typed copy never had.
if (isEntrypoint(import.meta.url)) {
  main().catch(error => {
    log(`Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });
}

// Exported for scripts/__tests__/shadcn-sync-fetch-cache.test.ts and
// scripts/__tests__/shadcn-local-patches.test.ts (OBJECTUI_HEADER, so the
// round-trip assertion strips the header this script prepends rather than
// keeping a second spelling of it; `rewriteRegistryImports`, so the vendored
// registry fixtures are transformed by the SAME code the sync runs — a test
// that re-typed the rewrite table would be asserting against its own copy of
// the transform, and a drift between the two would make the fixtures agree
// with the test while disagreeing with what `--update` actually writes).
// The CLI is the only production consumer; nothing else imports this module.
export {
  fetchUrl,
  fetchRegistry,
  isRegistryEntry,
  cacheFileFor,
  cacheStats,
  bodySnippet,
  CACHE_TTL_MS,
  OBJECTUI_HEADER,
  rewriteRegistryImports,
};

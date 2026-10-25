// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#4016 ratchet — nothing in this repo reaches the metadata LAYERED
 * projection by hanging a query flag on the ordinary item read.
 *
 * The projection (packaged baseline / tenant overlay / merged effective, which
 * is what Studio's metadata-editor comparison tabs render) has a path and a
 * response schema of its own: `GET /meta/:type/:name/layers`, declared by
 * `@objectstack/spec` with `GetMetaItemLayeredResponseSchema`
 * (objectstack#5882, ruled B by the maintainer; server half objectstack#6596).
 * Before that ruling, one route answered two unrelated representations chosen
 * by a query parameter while the spec declared only the unflagged one, so any
 * client generated from the route table was simply wrong for the flagged call.
 *
 * The retired spelling still answers the same body during a deprecation window,
 * advertised with RFC 9745 `Deprecation: true` and an RFC 8288
 * `Link: rel="successor-version"` pointing at the new path — which means a
 * regression here CANNOT be caught by anything failing. It would keep working,
 * quietly, until the maintainer closes the window; and closing the window is
 * exactly what this repo moving off the flag is supposed to unblock. Hence a
 * ratchet rather than trust.
 *
 * Why it lives in `scripts/__tests__` rather than beside the client: its scan
 * surface is the whole repo (the packages that build metadata requests, the apps
 * that could hand-roll one, and the skills guides that teach AI agents how). The
 * transport-level cases — that `MetadataClient.layered()` requests the
 * spec-declared path, leads the query string with `?package=`, and reports the
 * declared body unchanged — live in
 * `packages/data-objectstack/src/metadata-client.layeredRoute.test.ts`.
 *
 * Reverse verification (direction predicted before running, then measured):
 * restoring the retired spelling in `MetadataClient.layered()` turns this RED by
 * naming that file in `offenders` — the assertion fails because it PRODUCED a
 * finding, not because it produced nothing. The two floors below exist for the
 * other direction: a walk that silently scanned zero files would otherwise pass
 * with an empty `offenders` and report the repo clean.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Source files that could construct a metadata request, tests excluded. */
function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Skills guides — what an AI agent reads before writing console code. */
function walkMarkdown(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkMarkdown(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * The retired spelling as a QUERY parameter. Deliberately broader than the one
 * value this repo used: the first version of this projection was reached with a
 * layer LIST rather than a boolean, and either form is the same mistake now.
 *
 * Matching on `[?&]` is what keeps it off the many legitimate uses of the word —
 * the editor's `'layers'` sheet id, `engine.edit.layers` i18n keys, and prose
 * about "three layers" are all untouched. CHANGELOG files are out of the scan
 * surface by construction: they are history, and history did use the flag.
 */
const RETIRED_FLAG = /[?&]layers=/;

describe('objectui#4016 ratchet · nothing reaches the layered projection by query flag', () => {
  it('no shipped source file and no skills guide names the retired flag', () => {
    // Both halves of the consumption radius: the packages that build the
    // request and the apps that could hand-roll one beside them.
    const sources = ['packages', 'apps']
      .flatMap((group) => {
        const groupDir = path.join(repoRoot, group);
        return readdirSync(groupDir).map((pkg: string) => path.join(groupDir, pkg, 'src'));
      })
      .filter((src) => {
        try {
          return statSync(src).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap((src) => walkSources(src));
    const guides = walkMarkdown(path.join(repoRoot, 'skills'));

    // A scan that scanned nothing passes for the wrong reason. Both floors sit
    // far below the real counts (1327 sources / 18 guides when this was
    // written) — they fail a broken walk, not a growing repo.
    expect(sources.length).toBeGreaterThan(800);
    expect(guides.length).toBeGreaterThan(5);

    const offenders = [...sources, ...guides]
      .filter((file) => RETIRED_FLAG.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(repoRoot, file));

    // If this fails: call `client.layered(type, name)` from
    // `@object-ui/data-objectstack`, which reads the declared
    // `GET /meta/:type/:name/layers`. The flag it replaced answers the same body
    // only until the maintainer closes the deprecation window, and the response
    // already says so in its `Deprecation` / `Link` headers.
    expect(offenders).toEqual([]);
  });
});

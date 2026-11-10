// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Keeps the blank template's TREE and its README telling the same story about
// whether a scaffolded project renders in the Console.
//
// ## What was measured
//
// Scaffolded with the real CLI (`create-objectstack my-app -t blank`), installed
// against the published 17.1.0 packages, and booted with `objectstack dev --ui`:
//
//     GET /api/v1/meta/app        -> 200, items: [setup, account]   (2, both platform)
//     GET /api/v1/data/my_app_note-> 200  {"records":[],"total":0}
//
// The scaffolder's own object is live over REST for the whole session and is in
// no app's navigation, because `src/` ships `objects/` and nothing else. Adding
// a single `*.app.ts` to the scaffolded project and rebooting takes the same
// endpoint to three items, the third being the project's own app — so the empty
// `src/apps/` is the entire cause, and an app is the entire remedy.
//
// The empty `src/apps/` was once kept on purpose: apps were what the agent
// authors in step 2 of the README loop, and the README disclosed the empty
// Console instead. The maintainer's card #32152 (2026-11-10, filed on
// 「立卡处理」) reversed that: a newcomer who opens the Console the dev banner
// points to must see their own project, so the template now ships the starter
// app `src/apps/main.app.ts` and the sample object's list view
// `src/views/note.view.ts` — the files `objectstack generate app main --object
// note` and `objectstack generate view note` write, with the object referenced
// as `Note.name` because scaffolding renames it. The README keeps the rule
// (an object appears in Console navigation only when an app lists it) and how
// to add more, and no longer claims an empty Console.
//
// The assertion is deliberately BIDIRECTIONAL. A one-way "README must say X"
// check rots the moment someone adds an app to the template — the README would
// keep claiming an empty starting point and the test would stay green on a
// sentence that had become false. So the tree decides which claim is required.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const blankRoot = path.resolve(HERE, 'templates', 'blank');
const readme = fs.readFileSync(path.join(blankRoot, 'README.md'), 'utf8');

/** Every file under `dir`, recursively, as paths relative to `dir`. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = entry.name;
    if (entry.isDirectory()) {
      out.push(...listFiles(path.join(dir, rel)).map((f) => path.join(rel, f)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

const srcFiles = listFiles(path.join(blankRoot, 'src'));
const appFiles = srcFiles.filter((f) => f.endsWith('.app.ts'));

describe('blank template — tree and README agree about the Console', () => {
  // Vacuity guard. Every assertion below is conditioned on the template's own
  // tree, so a test that read the wrong directory would silently assert
  // nothing. This proves the tree really was read.
  it('reads the real template tree', () => {
    expect(srcFiles).toContain(path.join('objects', 'note.object.ts'));
  });

  it('ships the starter app and the sample object\'s list view', () => {
    // The measured starting point the README section is written against:
    // the first Console visit lists this project's app. Removing it is a
    // product decision, and the failure message says so rather than inviting
    // a quiet re-baseline.
    expect(
      appFiles,
      'The blank template no longer ships its starter app. That is a product ' +
        'change, not a test failure to silence: update the README section ' +
        '"The Console" to describe what actually renders, then update this ' +
        'expectation.',
    ).toEqual([path.join('apps', 'main.app.ts')]);
    expect(srcFiles).toContain(path.join('views', 'note.view.ts'));
  });

  it('discloses that no app means no Console navigation', () => {
    if (appFiles.length > 0) {
      // The template ships an app — the "no app" claim must be gone, and the
      // rule plus the app it names must be there for the reader adding more.
      expect(readme).not.toMatch(/ships no app|no app and no views/i);
      expect(readme, 'README must name the Console path').toMatch(/\/_console\//);
      expect(
        readme,
        'README must state the app -> navigation rule',
      ).toMatch(/Console navigation only when an app lists it/i);
      for (const app of appFiles) {
        expect(readme, `README must name src/${app}`).toContain(`src/${app}`);
      }
      return;
    }

    // Points the reader at the Console they are about to be sent to by the
    // `pnpm dev` banner.
    expect(readme, 'README must name the Console path').toMatch(/\/_console\//);

    // States the consequence, so an empty Console does not read as "it broke".
    expect(
      readme,
      'README must say this starter ships no app',
    ).toMatch(/ships no app|no app and no views/i);

    // Names the remedy concretely enough to act on.
    expect(
      readme,
      'README must name *.app.ts / src/apps/ as the remedy',
    ).toMatch(/src\/apps\/|\*\.app\.ts/);

    // Ties the two together — the rule itself, not just the two nouns.
    expect(
      readme,
      'README must state the app -> navigation rule',
    ).toMatch(/Console navigation only when an app lists it/i);
  });

  it('does not hard-code the rewritten object name', () => {
    // `rewrite-identity.ts` rewrites `.ts` files only, so a README naming the
    // template's own `blank_note` would ship literally into `my-app`, where the
    // object is `my_app_note`. The README must stay generic.
    expect(readme).not.toMatch(/\bblank_note\b/);
  });
});

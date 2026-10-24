/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui check`'s unknown-type warning (objectui#5115).
 *
 * `scripts/__tests__/known-schema-types-derivation-5115.test.ts` pins that the
 * shipped key set equals the registry derivation. This file pins the other
 * half — that the COMMAND actually consults that set, and reports what it
 * finds — over real files in a temporary directory.
 *
 * Fixtures live under `os.tmpdir()`, never in the repo tree: `check()` globs
 * every JSON file under the directory it is handed, so a fixture committed
 * inside this workspace would be scanned by every other run of the command as
 * well — including the repo's own `pnpm check`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { check, closingLine } from '../commands/check.js';

let cwd: string;
let lines: string[];
let restoreLog: () => void;

/**
 * Every fixture carries `className` — a STRUCTURAL marker key — because
 * objectui#5127 gated type judgement behind a positive ObjectUI marker: a bare
 * `{"type": ...}` file is not judged at all now. Without a marker the warning
 * assertions below would fail and — worse — the SILENCE assertion would keep
 * passing while measuring nothing, which is the shape of a test that survives
 * the deletion of the feature it covers.
 *
 * That is not assumed here, it is measured: dropping the injection from this
 * helper turns the warning tests red and leaves the silence test GREEN, which
 * is precisely why that test carries its own counter-probe below rather than
 * trusting this comment.
 *
 * `className` is the least semantically loaded key in the marker set — it says
 * nothing about a node's children, visibility or interaction state — so it
 * perturbs no fixture's meaning. An earlier revision declared a `$schema` URL
 * instead; the maintainer's 2026-08-20 ruling removed that arm, and a marker
 * that names a way in the build no longer honours is a fixture that admits
 * nothing. The gate itself is pinned separately, in
 * `check-schema-marker.test.ts`; this file is about the derived key set.
 */
function writeSchema(name: string, body: Record<string, unknown>): void {
  writeFileSync(join(cwd, name), JSON.stringify({ className: 'p-0', ...body }));
}

/** Warnings only, with the ANSI colouring chalk may add stripped off. */
function unknownTypeWarnings(): string[] {
  // eslint-disable-next-line no-control-regex -- matching the CSI sequences chalk emits
  const ansi = /\u001b\[[0-9;]*m/g;
  return lines.map((l) => l.replace(ansi, '')).filter((l) => l.includes('Unknown schema type'));
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'objectui-check-'));
  lines = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  restoreLog = () => {
    console.log = original;
  };
});

afterEach(() => {
  restoreLog();
  rmSync(cwd, { recursive: true, force: true });
});

describe('objectui check — unknown schema types', () => {
  it('warns about `crud`, a RETIRED spelling that must never re-enter the key set', async () => {
    // The defect objectui#5115 was filed for: this file passed in silence, and
    // then rendered the OBJUI-001 "Unknown component type" panel in the browser.
    //
    // This pin was flipped by objectui#5373, which retired `CRUDSchema` under
    // ADR-0049. Its old name said `crud` was a type "four declaration faces
    // describe and no renderer registers" — true when it was written, false
    // now: the interface, the zod mirror, the validator branch and the builder
    // are all gone, and `type: 'crud'` is refused BY NAME by
    // `validateSchema` in `@object-ui/core`.
    //
    // What this pin can and cannot witness, stated so the next reader does not
    // over-read it: `KNOWN_SCHEMA_TYPES` is derived from the REGISTRATION calls,
    // and `crud` never had one — so this assertion held before the retirement
    // and holds after it, and would keep holding if the retirement were
    // reverted. It is a regression pin against `crud` being REGISTERED back
    // into the key set, not a witness of the declarations being gone. The
    // witnesses that do distinguish those two worlds are the refusal test in
    // `@object-ui/core`'s `schema-validator.test.ts` and the union/barrel pins
    // in `@object-ui/types`' `crud-retirement-5373.test.ts`.
    writeSchema('crud-page.json', { type: 'crud', resource: '/api/accounts' });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([
      expect.stringContaining('Unknown schema type "crud" in crud-page.json'),
    ]);
  });

  it('warns about `gallery`, whose registered spelling is `object-gallery`', async () => {
    writeSchema('gallery.json', { type: 'gallery' });
    await check(cwd);
    expect(unknownTypeWarnings()).toHaveLength(1);
    expect(unknownTypeWarnings()[0]).toContain('"gallery"');
  });

  it('is silent for registered types the old hand-written list did not carry', async () => {
    // `object-grid` (plugin-grid) and `view:grid` (the namespaced spelling of
    // the same registration) were both reported as unknown before objectui#5115.
    writeSchema('grid.json', { type: 'object-grid', objectApiName: 'account' });
    writeSchema('ns-grid.json', { type: 'view:grid', objectApiName: 'account' });
    writeSchema('gallery-ok.json', { type: 'object-gallery' });
    // Counter-probe. Written by the same helper, so it carries the same marker
    // and travels the same admission path; its warning is what makes the three
    // silences above VERDICTS rather than a judgement that never ran. Without
    // it this assertion holds equally well when nothing is judged at all —
    // measured, and the reason it is here (objectui#5127).
    writeSchema('probe.json', { type: 'totally-made-up-xyz' });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([
      expect.stringContaining('Unknown schema type "totally-made-up-xyz" in probe.json'),
    ]);
  });

  it('still warns for a type nothing registers', async () => {
    writeSchema('bogus.json', { type: 'totally-made-up-xyz' });
    await check(cwd);
    expect(unknownTypeWarnings()).toHaveLength(1);
  });

  it('reports an unknown type as a warning, never as a failure', async () => {
    // The check cannot know what a user project registers on its own, so an
    // unrecognised type must not fail the run. Pinned because tightening the
    // list would otherwise be free to become a breaking change by accident.
    writeSchema('bogus.json', { type: 'totally-made-up-xyz' });
    await check(cwd);
    // Both halves of this test's own sentence. Asserting only the exit
    // neutrality would keep passing if the type were never REPORTED either,
    // which is the state a lost marker puts this fixture in.
    expect(unknownTypeWarnings()).toHaveLength(1);
    // The run reached the no-error close. That close is a tally, not a pass
    // (objectui#11007): the fixture's `className` admits it without a parse.
    expect(
      lines.some((l) =>
        l.includes(closingLine({ validated: 0, notValidated: 1, didNotValidate: 0 }))
      )
    ).toBe(true);
  });
});

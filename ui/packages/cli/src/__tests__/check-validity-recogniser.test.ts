/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui check`'s validity arm and the three-bucket report (objectui#6075).
 *
 * The structural marker (objectui#5127) bought precision with recall: a leaf
 * schema that carries only its own vocabulary — `{ "type": "statistic",
 * "label": …, "value": … }`, the majority shape of the real corpus — has no
 * `children`, no `className` and no `body`, so nothing validated it. The
 * maintainer's 2026-08-25 ruling on objectui#5392 (Option B, no shipped schema
 * artifact) selected `safeValidateSchema` as the second recogniser arm.
 *
 * ## What this file exists to stop
 *
 * A recogniser built on validation answers ONE question ("does this document
 * parse as an ObjectUI component?") with TWO meanings: "not ours" and "ours,
 * and broken". Collapsing them files every broken ObjectUI schema as a foreign
 * file — and the symptom of that bug is an ABSENCE. The file stops being
 * mentioned; no count moves in a direction anyone would question; nothing
 * prompts a re-read. It is precisely the defect `check` exists to catch,
 * hidden by the mechanism meant to catch it.
 *
 * So the command reports three buckets, and half of the tests below are
 * negative: they fail if a future simplification back to two buckets swallows
 * the broken-schema case. A suite that only proved the newly-recognised files
 * are judged would pass that simplification without a murmur.
 *
 * Fixtures live under `os.tmpdir()`, never in the repo tree: `check()` globs
 * every JSON file under the directory it is handed, so a fixture committed
 * inside this workspace would be scanned by every other run of the command,
 * the repo's own `pnpm check` included.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateAuthoredDocument } from '../utils/authoring-face.js';

import { check, closingLine } from '../commands/check.js';

let cwd: string;
let lines: string[];
let exitCodes: number[];
let restoreLog: () => void;

function writeSchema(name: string, body: unknown): void {
  writeFileSync(join(cwd, name), JSON.stringify(body));
}

/**
 * The CSI sequences chalk may add. The escape byte is built with
 * `String.fromCharCode` rather than spelled into the source, so this file holds
 * no raw control character and no escape a tooling pass could materialise into
 * one (objectui AGENTS.md byte discipline).
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function plainLines(): string[] {
  return lines.map((l) => l.replace(ANSI, ''));
}

function unknownTypeWarnings(): string[] {
  return plainLines().filter((l) => l.includes('Unknown schema type'));
}

/** The count of files no recogniser arm admitted, or 0 when the line is absent. */
function skippedCount(): number {
  const line = plainLines().find((l) => l.startsWith('Skipped '));
  if (!line) return 0;
  const match = /^Skipped (\d+) file/.exec(line);
  if (!match) throw new Error(`skip line present but unparseable: ${line}`);
  return Number(match[1]);
}

/** The headline count of the unvalidated-candidate report, or 0 if silent. */
function candidateCount(): number {
  const line = plainLines().find((l) => l.includes('did not validate as an ObjectUI schema'));
  if (!line) return 0;
  const match = /(\d+) files? carr/.exec(line);
  if (!match) throw new Error(`candidate line present but unparseable: ${line}`);
  return Number(match[1]);
}

/** The per-file lines of that report — the part a bare count cannot replace. */
function candidateLines(): string[] {
  return plainLines().filter((l) => /^ {3}\S.*\(type "/.test(l));
}

/** Every printed line that names this file, whatever bucket named it. */
function mentionsOf(file: string): string[] {
  return plainLines().filter((l) => l.includes(file));
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'objectui-check-validity-'));
  lines = [];
  exitCodes = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    return undefined as never;
  }) as never);
  restoreLog = () => {
    console.log = original;
    exitSpy.mockRestore();
  };
});

afterEach(() => {
  restoreLog();
  rmSync(cwd, { recursive: true, force: true });
});

describe('objectui check — the validity arm repays the recall debt', () => {
  it('judges a leaf schema that carries no structural key at all', async () => {
    // Copied from `examples/schema-catalog/.../with-description.json`. No
    // `children`, no `className`, no `body`: invisible to the structural arm,
    // and one of the 209 files this change moves into judgement.
    writeSchema('with-description.json', {
      type: 'statistic',
      label: 'Total Sales',
      value: '145,892',
      description: 'Across all products this quarter',
    });
    await check(cwd);
    expect(skippedCount()).toBe(0);
    expect(candidateCount()).toBe(0);
    // Judged and clean: `statistic` is registered, so nothing is warned about.
    expect(unknownTypeWarnings()).toEqual([]);
  });

  it('still refuses the manifest the marker gate was built for', async () => {
    // The precision half. `"type": "module"` names no component the protocol
    // models, so the validity arm rejects it exactly as the structural arm did
    // — and `module` is not a registered type either, so it stays in the skip
    // count rather than being reported as a broken schema.
    writeSchema('package.json', { name: 'x', version: '1.0.0', type: 'module' });
    await check(cwd);
    expect(unknownTypeWarnings()).toEqual([]);
    expect(candidateCount()).toBe(0);
    expect(skippedCount()).toBe(1);
  });
});

describe('objectui check — a broken ObjectUI schema is never filed as a foreign file', () => {
  it('names the file, rather than counting it as skipped', async () => {
    // ⭐ The load-bearing test of objectui#6075. Copied verbatim from
    // `examples/schema-catalog/.../components-basic-text/small.json`: real
    // corpus content, and genuinely invalid — `TextSchema.variant` is an enum
    // of `h1`…`overline`, and `small` is not in it. Under a two-bucket
    // recogniser this file would be reported as "not ObjectUI".
    writeSchema('small.json', { type: 'text', content: 'Small text', variant: 'small' });
    await check(cwd);
    expect(candidateCount()).toBe(1);
    expect(candidateLines()).toEqual([
      expect.stringContaining('small.json (type "text")'),
    ]);
    // ⛔ The negative half, and the one that catches the failure mode: it must
    // not have been absorbed into the skip count.
    expect(skippedCount()).toBe(0);
  });

  it('mentions it by name even when it is the only file in the project', async () => {
    // The absence-detector. If a later change collapses the report back to two
    // buckets, this run goes quiet about the file entirely — which is the whole
    // hazard, expressed as an assertion rather than a paragraph.
    writeSchema('small.json', { type: 'text', content: 'Small text', variant: 'small' });
    await check(cwd);
    expect(mentionsOf('small.json').length).toBeGreaterThan(0);
  });

  it('reports a registered component type the bundled schemas do not model', async () => {
    // The other half of the bucket, and why its wording says "off-spec OR not
    // modelled". `plugin-dashboard:metric-card` is a real registered type — the
    // node key of objectui's dashboard widget-slot component, registered by
    // `apps/console/src/register-plugins.ts` and `@object-ui/plugin-dashboard` —
    // and `AnyComponentSchema` is a union of COMPONENT schemas that has no member
    // for it. So the well-formed document
    // below fails the validity arm. Reporting it is right (a registered type the
    // shipped validator cannot validate is itself a finding) but calling it
    // INVALID would overclaim: nothing about this document is wrong.
    //
    // ## Pick this type by measurement, not memory (objectui#6939)
    //
    // Re-measured on this tree (objectui#8499): `KNOWN_SCHEMA_TYPES` carries 656
    // registered types and `AnyComponentSchema` declares 154 distinct literal
    // `type` values, so 505 registered types have no member. The probe was
    // controlled in both directions — `kanban`, `text` and `tree-view` all read
    // as MODELLED (so it is not blind to real members) and a nonsense type reads
    // as unmodelled.
    //
    // ## Why it is no longer `abbr`
    //
    // This sample was `abbr` on the reasoning that "the raw HTML primitives are
    // the stable inhabitants of this bucket". They were not: objectui#8499 armed
    // the whole registered HTML passthrough set (`h1`…`h6`, `p`, `a`, `abbr`, …)
    // together with the seven semantic sectioning tags, precisely because a
    // registered renderer the validator cannot name is a defect rather than a
    // stable state of affairs. The 47 literals that card added are what took 102
    // to 154 above, and they took this fixture with them.
    //
    // The replacement is chosen for a stronger property than "nobody has got to
    // it yet": `metric-card`'s absence from this union is RULED. It is objectui's
    // CLOSED dashboard-widget-slot extension, admitted by the 2026-08-14 ruling
    // (objectstack#8593), and `packages/types/src/zod/complex.zod.ts` records in
    // as many words that it is "DELIBERATELY not an arm of `AnyComponentSchema`".
    // So this fixture cannot rot the way `abbr` did without a maintainer
    // reversing that ruling — which is exactly when this test SHOULD be re-read.
    //
    // ## Why it is now the NAMESPACED key (objectui#10859 batch 8)
    //
    // Phase 2b of that batch gave the `metric-card` registration
    // `skipFallback: true` (the dashboard surfaces emit the namespaced key), so
    // the bare `metric-card` is no longer a registered type at all and `check`
    // stopped counting it here. `plugin-dashboard:metric-card` is the same
    // component under the key it still registers, and the same ruling keeps it
    // out of the node union — measured: `KNOWN_SCHEMA_TYPES` carries it and
    // `safeValidateSchema` refuses it at `type`.
    //
    // ## Why it is no longer `kanban`
    //
    // This sample used to be a kanban board authoring `cards`, and the comment
    // here claimed `AnyComponentSchema` "has no member for" kanban. That claim
    // was FALSE, and was false before objectui#6939 touched anything —
    // `ComplexSchema` has carried `KanbanSchema` throughout. The real mechanism
    // was a required-key mismatch: `KanbanColumnSchema` demanded `items` while
    // every board, and this sample, writes `cards`. objectui#6939 repaired that
    // fork, the board started validating, and this case measured 0 candidates.
    // The defect this file's own subject matter exists to catch had been frozen
    // into an assertion of expected behaviour.
    writeSchema('metric-card.json', {
      type: 'plugin-dashboard:metric-card',
      title: 'Total Revenue',
      value: '$123,456',
    });
    // The precondition, asserted rather than assumed, so that the day someone
    // models `plugin-dashboard:metric-card` this file says WHY it went red instead of reporting a
    // bare `expected +0 to be 1`. If this fires: the objectstack#8593 ruling has
    // been revisited — re-read this case, then pick another registered type with
    // no member in `AnyComponentSchema` and update the counts above.
    // Read through the door `check` recognises with — the strict authoring
    // face since objectui#5250 — so this precondition is about `check` itself.
    expect(
      validateAuthoredDocument({ type: 'plugin-dashboard:metric-card', title: 'Total Revenue', value: '$123,456' }).success,
      '`plugin-dashboard:metric-card` now validates as a root document — this fixture needs a type that still does not; see the comment above',
    ).toBe(false);
    await check(cwd);
    expect(candidateCount()).toBe(1);
    expect(candidateLines()).toEqual([
      expect.stringContaining('metric-card.json (type "plugin-dashboard:metric-card")'),
    ]);
    expect(skippedCount()).toBe(0);
  });

  it('separates the two refusals in one run', async () => {
    // Both refusals side by side, because either bucket alone could be produced
    // by a predicate that got the OTHER one wrong.
    writeSchema('package.json', { name: 'x', type: 'module' });
    writeSchema('small.json', { type: 'text', content: 'Small text', variant: 'small' });
    await check(cwd);
    expect(candidateCount()).toBe(1);
    expect(candidateLines()).toEqual([
      expect.stringContaining('small.json (type "text")'),
    ]);
    expect(skippedCount()).toBe(1);
    expect(mentionsOf('package.json')).toEqual([]);
  });

  it('is a report, not a failure — the run still passes', async () => {
    // Deliberate: `errors` still counts parse failures only. Escalating a
    // validation finding to a non-zero exit would change the contract of a
    // released command for every consumer's CI at once, which is a different
    // decision from this one.
    writeSchema('small.json', { type: 'text', content: 'Small text', variant: 'small' });
    await check(cwd);
    expect(candidateCount()).toBe(1);
    // The no-error close (objectui#11007) counts the file as one that did not
    // validate — reported, and still not a failure.
    expect(plainLines()).toContain(
      closingLine({ validated: 0, notValidated: 0, didNotValidate: 1 })
    );
    expect(exitCodes).toEqual([]);
  });
});

describe('objectui check — the buckets close over the eligible files', () => {
  it('puts every eligible file in exactly one of judged, candidate or skipped', async () => {
    // The accounting assertion. Each bucket is reachable and no file appears in
    // two of them, so a future arm cannot quietly move files into a bucket
    // nobody prints — the objectui#6075 hazard restated as arithmetic.
    writeSchema('package.json', { name: 'x', type: 'module' }); // skipped
    writeSchema('leaf.json', { type: 'statistic', label: 'a', value: '1' }); // judged, clean
    writeSchema('node.json', { type: 'totally-made-up-xyz', children: [] }); // judged, warned
    writeSchema('broken.json', { type: 'text', content: 'x', variant: 'small' }); // candidate
    await check(cwd);
    const judged = unknownTypeWarnings().length + 1; // the warned node, plus the clean leaf
    expect(judged).toBe(2);
    expect(candidateCount()).toBe(1);
    expect(skippedCount()).toBe(1);
    expect(judged + candidateCount() + skippedCount()).toBe(4);
  });

  it('leaves the one shape no signal can separate from a foreign file in the skip count', async () => {
    // ⚠️ The honest limit, pinned so it is not mistaken for an oversight.
    // An unregistered root `type`, no structural key, and a document that does
    // not validate is byte-for-byte the same evidence a foreign file offers.
    // This fixture is real — `examples/schema-catalog/.../core-schema-renderer/
    // unknown-component-type.json` — and it is the single real corpus file
    // still counted as skipped after this change. Admitting it would mean
    // admitting `package.json`, which is the trade objectui#5127 already made.
    writeSchema('unknown-component-type.json', { type: 'unknown-component', someData: {} });
    await check(cwd);
    expect(candidateCount()).toBe(0);
    expect(skippedCount()).toBe(1);
    expect(unknownTypeWarnings()).toEqual([]);
  });
});

describe('objectui check — the printed explanation describes the predicate it runs', () => {
  it('states both arms under the skip count', async () => {
    // objectui#6074 removed a comment in this command that promised something
    // the code did not do. The same defect in the user-facing hint would be
    // worse: the reader acts on it. Both arms are advertised because both are
    // honoured.
    writeSchema('package.json', { name: 'x', type: 'module' });
    await check(cwd);
    const hint = plainLines().filter((l) => l.includes('checked when')).join('\n');
    // Both advisory lines, not one: the sentence that names the structural keys
    // and the sentence that names the validity arm.
    expect(hint.split('\n')).toHaveLength(2);
    expect(hint).toContain('structural key');
    expect(hint).toContain('validates as an ObjectUI component schema');
    // ⛔ No `$schema` URL exists to advertise (maintainer ruling 2026-08-20,
    // verbatim C; objectui#5392 Option B on 2026-08-25 removed the artifact
    // that would have justified minting one).
    expect(hint).not.toContain('$schema');
    expect(hint).not.toContain('http');
  });
});

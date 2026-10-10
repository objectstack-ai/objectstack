// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22661] Every read that reaches a SECOND object — the record a lookup
 * points at, rather than the object a request addresses — asks that object's
 * own declared exposure through the spec's one decision
 * (`apiExposureDenialReason` or its boolean face `canServeApiOperation`,
 * `@objectstack/spec/data`, ADR-0049), or is named here as a read that does
 * not yet, with the reason.
 *
 * The data routes judge the ADDRESSED object. A read that follows a lookup
 * reaches an object nobody addressed: the data door's `$expand` served the row
 * fields of a target every data route refuses, and the dataset door's label
 * passes rendered its display names. Both now ask the target (behaviour-pinned
 * in their own packages and on a real stack in `@objectstack/dogfood`). This
 * file is the ENUMERATION: it names the census of such reads, holds each
 * decided one to the decision, and goes red when a new one appears without
 * being classified here.
 *
 * ## How a second-object read is found, mechanically
 *
 * Following a lookup means asking which object the reference field points at,
 * and the spec declares ONE arbiter of that answer, `referenceTargetOf`
 * (`@objectstack/spec/data`; a raw `field.reference` read gets `user` wrong,
 * cloud#983). A CALL of it is the discriminator: every non-test `.ts` source
 * under `packages/` that calls it must be classified in {@link CALLERS} below —
 * as a read that asks the decision (where, for which operation, and the
 * behaviour pin), as the executor of a read another file decides, as a census
 * read that does not ask yet (with what was measured and who carries it), or
 * as something that serves no field of the target (with the reason). An
 * unclassified caller, or a classified file that no longer calls it, turns
 * this red.
 *
 * ⛔ What the discriminator does NOT see, stated rather than discovered later:
 * a read whose target is not resolved through `referenceTargetOf`. Read on
 * `origin/main` at eae3368a, those are the analytics relationship hop
 * (`service-analytics/src/hop-object.ts` — its target comes from the host's
 * relationship resolver; the analytics door already judges every hop's object
 * for `aggregate` over `queryObjects`), and the reads whose target is a FIXED
 * platform object rather than an authored one (a file field's `sys_file`
 * hydration, the `sys_user` display names the approvals and audit surfaces
 * resolve). They are named here, not held.
 *
 * The scan surface and its prefilter follow `row-serving-door-exposure.pin.test.ts`
 * in this directory: git's authored-file list, never a directory crawl, and `.ts`
 * only, the radius this package declares in the cross-package test-inputs table.
 * That is also why this file is listed in this package's `repo` vitest project.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/core/src/security → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');

/** The reference-target arbiter, as data. */
const ARBITER = 'referenceTargetOf';

/** A CALL of the arbiter. Its own declaration (`function referenceTargetOf(`) is not one. */
const arbiterCall = (line: string): boolean =>
  new RegExp(`\\b${ARBITER}\\s*\\(`).test(line) && !new RegExp(`function\\s+${ARBITER}\\b`).test(line);

/** A CALL of the spec's exposure decision, either face. */
const DECISION_CALL = /\b(?:apiExposureDenialReason|canServeApiOperation)\s*\(/;

type Classification =
  | {
      kind: 'decided';
      /** The read, in words. */
      read: string;
      /** The operation the target is judged as. */
      operation: 'get';
      /** The function that asks the decision, and the file it lives in. */
      decision: { file: string; fn: string };
      /** Where the read takes its answer from that function: a call site that must exist. */
      wiring: { file: string; call: string };
      /** The behaviour pin that holds the read to it. */
      pin: string;
    }
  | {
      kind: 'executes';
      read: string;
      /** The classified file whose door decides this read. */
      decidedIn: string;
      /** What else in this file calls the arbiter, and why it serves no field. */
      also: string;
    }
  | {
      kind: 'open';
      read: string;
      /** What the census measured, on a real stack. */
      measured: string;
      /** Why it is not decided in the card that took the census, and who carries it. */
      carrier: string;
    }
  | { kind: 'not-a-served-read'; reason: string };

/** Every non-test caller of the arbiter, classified. */
const CALLERS: Record<string, Classification> = {
  'packages/metadata-protocol/src/protocol.ts': {
    kind: 'decided',
    read: "the data door's `$expand` (the list, single-record, query and export routes, every level of the tree)",
    operation: 'get',
    decision: { file: 'packages/metadata-protocol/src/protocol.ts', fn: 'servesExpansionTarget' },
    wiring: { file: 'packages/metadata-protocol/src/protocol.ts', call: 'this.servedExpand(' },
    pin: 'packages/metadata-protocol/src/protocol.expand-target-exposure.test.ts',
  },
  'packages/objectql/src/engine.ts': {
    kind: 'executes',
    read: "the expansion sub-read (`ObjectQL.expandRelatedRecords`), for the data door's `$expand`",
    decidedIn: 'packages/metadata-protocol/src/protocol.ts',
    also:
      'the write-path reference-existence probe (`referenceExists`: whether a stored id resolves, no field) and ' +
      'the validation-predicate reads (`resolvePredicateRelated`: a pass/fail verdict, the value never served). ' +
      "The engine's privileged callers (a flow's `config.expand`, a hook's read) never pass the door, by design.",
  },
  'packages/services/service-analytics/src/dimension-labels.ts': {
    kind: 'decided',
    read: "the dataset door's dimension-label passes (display and sort-key)",
    operation: 'get',
    decision: { file: 'packages/services/service-analytics/src/api-exposure-door.ts', fn: 'servesLabelTarget' },
    wiring: { file: 'packages/services/service-analytics/src/analytics-service.ts', call: 'servesLabelTarget(' },
    pin: 'packages/services/service-analytics/src/__tests__/dimension-label-exposure.test.ts',
  },
  'packages/objectql/src/relation-filter-lowering.ts': {
    kind: 'open',
    read: "the data door's nested-relation filter condition (`ObjectQL.lowerRelationConditions` reads the related object to lower it)",
    measured: 'evaluated for an unexposed target, for an administrator and a member: the source row comes back only when the related value matches',
    carrier:
      'a filter cannot be withheld, so its answer is a refusal in the data door\'s exposure codes, which needs a ' +
      'provenance row for the door and touches a filter position; carried by a follow-up of #22661',
  },
  'packages/plugins/plugin-approvals/src/approval-service.ts': {
    kind: 'open',
    read: "the approvals inbox's `payload_display` (`ApprovalService.enrichRows` reads referenced records' titles under a system context)",
    measured: "an unexposed target's title is served on the inbox list, to an administrator and a member",
    carrier: 'outside the card that took the census (another package and lane); carried by a follow-up of #22661',
  },
  'packages/plugins/plugin-audit/src/audit-writers.ts': {
    kind: 'open',
    read: "the activity timeline's tracked-change summary (`resolveLookupTitles` writes referenced records' titles at write time)",
    measured: "an unexposed target's title is served in the summary on the activity read, to an administrator and a member",
    carrier: 'outside the card that took the census (another package and lane); carried by a follow-up of #22661',
  },
  'packages/lint/src/object-graph.ts': {
    kind: 'not-a-served-read',
    reason: 'authoring-time static analysis of metadata; reads no record',
  },
  'packages/lint/src/validate-field-consumers.ts': {
    kind: 'not-a-served-read',
    reason: 'authoring-time static analysis of metadata; reads no record',
  },
  'packages/lint/src/validate-object-references.ts': {
    kind: 'not-a-served-read',
    reason: 'authoring-time static analysis of metadata; reads no record',
  },
  'packages/metadata-protocol/src/seed-loader.ts': {
    kind: 'not-a-served-read',
    reason: "resolves a seed's references at install, under the system identity; serves nothing to a caller",
  },
  'packages/objectql/src/integrity/dangling-reference-audit.ts': {
    kind: 'not-a-served-read',
    reason: 'an integrity audit: it probes whether a stored id resolves and reports ids, never a field of the target',
  },
  'packages/objectql/src/no-operator-object-door.ts': {
    kind: 'not-a-served-read',
    reason: "names the related object in a refusal's wording; reads no record",
  },
  'packages/objectql/src/record-title.ts': {
    kind: 'not-a-served-read',
    reason: "the hook-body title accessor: author code inside a hook reads it, privileged like any engine call, not an API door",
  },
  'packages/objectql/src/validation/rule-validator.ts': {
    kind: 'not-a-served-read',
    reason: 'validation-rule analysis and evaluation on the write path; the verdict is pass/fail and no target field is served',
  },
};

const SCAN_TIMEOUT_MS = 60_000;

function git(args: string[]): string[] {
  let stdout: string;
  try {
    stdout = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    // `git grep` exits 1 for "found nothing", which is data. Anything else is a
    // broken scan and must not read as "no callers".
    if (failure.status === 1) return [];
    throw new Error(`git ${args.join(' ')} failed with status ${String(failure.status)}: ${failure.stderr ?? ''}`);
  }
  return stdout.split('\0').filter((line) => line.length > 0);
}

const isScannedSource = (path: string) =>
  path.endsWith('.ts') && !path.endsWith('.d.ts') && !/\.(test|spec)\.ts$/.test(path);

/** Code lines only: a docblock or line comment that names a call is not one. */
const codeLines = (file: string) =>
  readFileSync(join(REPO_ROOT, file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));

const callsArbiter = (file: string) => codeLines(file).some(arbiterCall);

/** Fixed-string prefilter over tracked plus untracked sources; the matcher decides. */
function filesMentioningTheArbiter(): string[] {
  return git(['grep', '--files-with-matches', '-z', '--untracked', '--fixed-strings', '-e', ARBITER, '--', 'packages'])
    .filter(isScannedSource);
}

function arbiterCallers(): string[] {
  return filesMentioningTheArbiter().filter(callsArbiter).sort();
}

/**
 * The code lines of one named function or method, from its declaration to the
 * line its braces close on. Enough for the small decision functions this pin
 * reads; it refuses (throws) rather than guessing when the name is not declared.
 */
function functionBody(file: string, fn: string): string[] {
  const lines = codeLines(file);
  const start = lines.findIndex((line) =>
    new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?(?:function\\s+|private\\s+|public\\s+|protected\\s+)?${fn}\\s*\\(`).test(line),
  );
  if (start < 0) throw new Error(`${fn} is not declared in ${file}`);
  let depth = 0;
  let opened = false;
  const body: string[] = [];
  for (const line of lines.slice(start)) {
    body.push(line);
    for (const ch of line) {
      if (ch === '{') { depth += 1; opened = true; }
      if (ch === '}') depth -= 1;
    }
    if (opened && depth <= 0) break;
  }
  return body;
}

describe('[#22661] every read that reaches a second object asks that object its exposure, or is named', () => {
  it(
    'every caller of the reference-target arbiter is classified, and every classified file still calls it',
    () => {
      const found = arbiterCallers();
      const unclassified = found.filter((file) => !(file in CALLERS));
      const stale = Object.keys(CALLERS).filter((file) => !found.includes(file));

      expect(
        unclassified,
        [
          'These sources resolve which object a reference field points at, which is how a read that',
          'reaches a SECOND object starts, and this pin does not know them:',
          ...unclassified.map((f) => `  - ${f}`),
          '',
          'Classify each in CALLERS. A read that serves anything of the target (a field, a display name,',
          'an order or a match) must ask `canServeApiOperation` / `apiExposureDenialReason`',
          "(`@objectstack/spec/data`) of the TARGET's `enable` block before reading it, and carry a",
          'behaviour pin in its own package.',
        ].join('\n'),
      ).toEqual([]);
      expect(stale, 'These classified files no longer call the arbiter; re-classify or remove them.').toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'each decided read asks the decision in its decision function, takes its answer from it, and is pinned',
    () => {
      const decided = Object.values(CALLERS).filter(
        (c): c is Extract<Classification, { kind: 'decided' }> => c.kind === 'decided',
      );
      expect(decided.map((d) => d.decision.fn).sort()).toEqual(['servesExpansionTarget', 'servesLabelTarget']);

      for (const d of decided) {
        const body = functionBody(d.decision.file, d.decision.fn);
        expect(body.some((line) => DECISION_CALL.test(line)), `${d.decision.fn} (${d.decision.file}) does not ask the exposure decision`).toBe(true);
        expect(
          readFileSync(join(REPO_ROOT, d.decision.file), 'utf8'),
          `${d.decision.file} does not import the decision from the spec`,
        ).toMatch(/from '@objectstack\/spec\/data'/);
        expect(
          codeLines(d.wiring.file).some((line) => line.includes(d.wiring.call)),
          `${d.read}: no call site \`${d.wiring.call}\` in ${d.wiring.file}`,
        ).toBe(true);
        expect(existsSync(join(REPO_ROOT, d.pin)), `the behaviour pin of ${d.read} is missing: ${d.pin}`).toBe(true);
      }
    },
    SCAN_TIMEOUT_MS,
  );

  it('each executed read names the classified door that decides it', () => {
    for (const [file, c] of Object.entries(CALLERS)) {
      if (c.kind !== 'executes') continue;
      expect(CALLERS[c.decidedIn]?.kind, `${file}: ${c.decidedIn} is not a decided door`).toBe('decided');
    }
  });

  it(
    'the scan cannot pass vacuously: the prefilter reaches every classified file and the matcher fires on each',
    () => {
      const mentioning = filesMentioningTheArbiter();
      for (const file of Object.keys(CALLERS)) {
        expect(mentioning, `the prefilter did not reach ${file}`).toContain(file);
        expect(callsArbiter(file), `the call matcher does not fire on ${file}`).toBe(true);
      }
      // The arbiter's own declaration names it, and is not a call of it.
      const declaration = 'packages/spec/src/data/field-value.zod.ts';
      expect(mentioning).toContain(declaration);
      expect(callsArbiter(declaration)).toBe(false);
      // The body reader reads the right function: the decision lives in it, not beside it.
      expect(functionBody('packages/metadata-protocol/src/protocol.ts', 'servedExpand').some((line) => DECISION_CALL.test(line))).toBe(false);
    },
    SCAN_TIMEOUT_MS,
  );
});

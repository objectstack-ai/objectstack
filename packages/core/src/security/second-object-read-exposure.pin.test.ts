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
 * fields of a target every data route refuses, the dataset door's label
 * passes rendered its display names, the import door matched cells against
 * it (#22739), and the data door's nested-relation filter condition evaluated
 * a predicate on it (#22737). Each read classified `decided` below now asks the
 * target (behaviour-pinned in its own package). This
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
 * for `aggregate` over `queryObjects`); and the reads whose target is a FIXED
 * platform object rather than an authored one (a file field's `sys_file`
 * hydration, the `sys_user` display names the approvals and audit surfaces
 * resolve). They are named here, not held. Nor does it see a door that reaches a
 * classified read through the shared condition walk rather than calling the
 * arbiter itself: the MCP stdio data bridge hands a caller's filter to the
 * engine's relation lowering (the `relation-filter-lowering.ts` row), and its
 * targets are resolved inside `relationConditionSites` (`@objectstack/core`),
 * which is the caller classified below. The bridge asks each target the
 * decision for `list` (`enforceRelationTargetExposure`, #22777), held by its
 * own package's pin rather than by a row here. The runtime's `callData` is a
 * third such door: its `query` fallback (no protocol service resolved) and its
 * `aggregate` arm hand a caller's `where` to the same engine lowering, and
 * `refuseUnservedRelationTargets` (`runtime/src/action-execution.ts`) asks each
 * target the gate the addressed object is asked, for `list`, through the same
 * walk (#22823, census row 10), held by its own package's pin
 * (`runtime/src/action-execution-calldata-relation-target-exposure.test.ts`)
 * rather than by a row here. Nor, for the same reason, a
 * door that drives `runImport` with a protocol of its own: plugin-auth's
 * identity import takes its cells' targets from the `import-field-meta.ts` map
 * classified below, and its run protocol carries the declaration reader the
 * import already holds, so `servesReferenceTarget` asks each target the
 * decision for `list` there too (#22800), held by its own package's pin
 * (`plugin-auth/src/admin-import-users.test.ts`, its `[#22800]` block) rather
 * than by a row here.
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

import { beforeAll, describe, it, expect } from 'vitest';

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
      operation: 'get' | 'list';
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
  'packages/core/src/utils/import-field-meta.ts': {
    kind: 'decided',
    read: "the import door's reference resolution (`resolveRef` matches a cell against the target; the export and template doors read the same map, the export's expansion decided in protocol.ts)",
    operation: 'list',
    decision: { file: 'packages/core/src/utils/import-runner.ts', fn: 'servesReferenceTarget' },
    wiring: { file: 'packages/core/src/utils/import-runner.ts', call: 'servesReferenceTarget(p, referenceObject' },
    pin: 'packages/core/src/utils/import-runner-reference-exposure.test.ts',
  },
  'packages/objectql/src/relation-filter-lowering.ts': {
    kind: 'decided',
    read: "the data door's nested-relation filter condition (`ObjectQL.lowerRelationConditions` reads the related object to lower it), refused rather than withheld",
    operation: 'list',
    decision: { file: 'packages/metadata-protocol/src/protocol.ts', fn: 'refuseUnservedRelationTarget' },
    wiring: { file: 'packages/metadata-protocol/src/protocol.ts', call: 'this.refuseUnservedRelationTarget(' },
    pin: 'packages/metadata-protocol/src/protocol.relation-condition-target-exposure.test.ts',
  },
  'packages/plugins/plugin-approvals/src/approval-service.ts': {
    kind: 'decided',
    read: "the approvals inbox's `payload_display` (`ApprovalService.enrichRows` reads referenced records' titles under a system context)",
    operation: 'get',
    decision: { file: 'packages/plugins/plugin-approvals/src/approval-service.ts', fn: 'servesPayloadDisplayTarget' },
    wiring: { file: 'packages/plugins/plugin-approvals/src/approval-service.ts', call: 'this.servesPayloadDisplayTarget(' },
    pin: 'packages/plugins/plugin-approvals/src/payload-display-target-exposure.test.ts',
  },
  'packages/plugins/plugin-audit/src/audit-writers.ts': {
    kind: 'decided',
    read: "the activity timeline's tracked-change and milestone summaries (`resolveLookupTitles` writes referenced records' titles at write time)",
    operation: 'get',
    decision: { file: 'packages/plugins/plugin-audit/src/audit-writers.ts', fn: 'servesSummaryTitleTarget' },
    wiring: { file: 'packages/plugins/plugin-audit/src/audit-writers.ts', call: 'servesSummaryTitleTarget(objectName' },
    pin: 'packages/plugins/plugin-audit/src/audit-lookup-summary.test.ts',
  },
  'packages/core/src/utils/relation-condition-sites.ts': {
    kind: 'not-a-served-read',
    reason:
      "finds a filter's nested-relation conditions and each one's target; reads no record. Every door that calls it asks " +
      "each target the decision before the engine reads it: the data door's `refuseUnservedRelationTarget`, the MCP " +
      "stdio data bridge's `enforceRelationTargetExposure` and the runtime `callData`'s `refuseUnservedRelationTargets`",
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
  // [#24410] A formula's one-hop read judged against its target's declared fields.
  'packages/lint/src/validate-expressions.ts': {
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
  'packages/verify/src/reference-shape.ts': {
    kind: 'not-a-served-read',
    reason:
      "the verification harness's reference-value shape family: the target only picks, from the ids of records the " +
      'family itself created through the REST door, the id its embedded-record probe carries. It writes probe values ' +
      "to the SOURCE object (the REST data routes, which judge that object's exposure, and the engine's system write) " +
      'and reads no record of the target',
  },
  'packages/verify/src/delete-behavior.ts': {
    kind: 'not-a-served-read',
    reason:
      "the verification harness's delete-behaviour family: the target names the object whose records the family " +
      'itself creates and then deletes, through the REST data routes (where that object is the ADDRESSED one, ' +
      "judged as such) and the engine's system delete. It reads those records back only through the harness's " +
      'system read, to see whether the delete removed them, and serves no field of the target to any caller',
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
function scanTree(): string[] {
  return git(['grep', '--files-with-matches', '-z', '--untracked', '--fixed-strings', '-e', ARBITER, '--', ':(glob)packages/**/*.ts'])
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

/** Shared by the census and its reach control; each file pays for one grep. */
let treeMentions: string[];

function filesMentioningTheArbiter(): string[] {
  return treeMentions;
}

describe('[#22661] every read that reaches a second object asks that object its exposure, or is named', () => {
  beforeAll(() => {
    treeMentions = scanTree();
  }, SCAN_TIMEOUT_MS);

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
      expect(decided.map((d) => d.decision.fn).sort()).toEqual([
        'refuseUnservedRelationTarget',
        'servesExpansionTarget',
        'servesLabelTarget',
        'servesPayloadDisplayTarget',
        'servesReferenceTarget',
        'servesSummaryTitleTarget',
      ]);

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

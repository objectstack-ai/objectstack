// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { ObjectStackDefinitionSchema, formatZodIssue, normalizeStackInput } from '@objectstack/spec';
import {
  applyMetaMigrations,
  composeSpecChanges,
  MigrationFloorError,
  MIGRATION_MAJORS,
  MIGRATION_SUPPORT_FLOOR,
  type MigrationApplication,
  type MigrationChainResult,
  type MigrationHopResult,
  type MigrationTodo,
} from '@objectstack/spec/migrations';
import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from '@objectstack/spec/kernel';
import { FILE_REFERENCE_TYPES, REFERENCE_VALUE_TYPES, STRUCTURED_JSON_TYPES } from '@objectstack/spec/data';
import { FILE_REFERENCES_MIGRATION_ID, VALUE_SHAPES_MIGRATION_ID } from '@objectstack/spec/system';
import { loadConfig } from '../../utils/config.js';
import { authoringRuleUnionStack } from '../../utils/stack-collections.js';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
  emitJson,
  errorCodeFields,
  isExitSignal,
  isReportedError,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { absentTableReads } from '../../utils/absent-table-reads.js';
import type { StoredMigrationReport } from '@objectstack/metadata-protocol';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';
import { checkProtocolCompat, type ProtocolHandshakeManifest } from '@objectstack/metadata-core';
import {
  planAuthoredSourceWrite,
  restoreAuthoredSources,
  verifyAuthoredSourceWrite,
  writeAuthoredSources,
  type AuthoredSourceWritePlan,
  type RangeOutcome,
  type RangeRewrite,
  type WriteVerification,
} from '../../utils/authored-source-codemod.js';

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false; // non-interactive → require --yes
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((res) => rl.question(question, res));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** The protocol major that introduced the per-deployment value-shape gates. */
const VALUE_SHAPE_GATE_MAJOR = 17;

/**
 * Where the chain ENDS when the author does not say — the highest major this
 * build of `@objectstack/spec` carries a migration step for, never below the
 * protocol major the runtime implements.
 *
 * ## Why not `PROTOCOL_MAJOR` (the answer this replaces)
 *
 * A tombstone closes with the house sentence "Run `os migrate meta --from N`
 * to list the mechanical edits for existing sources", and its `N` is the major
 * the source was AUTHORED against — one below the `toMajor` of the ADR-0087
 * conversion that performs the rename. That template presumes the default
 * terminus is at least the conversion's own `toMajor`.
 *
 * The presumption held only AFTER the next major shipped. Retirements land
 * throughout a major's line: `@objectstack/spec@17.4.0` tombstones keys whose
 * conversion is registered `toMajor: 18` and whose semantic siblings are
 * already removed from its own exports — the build's authorable surface is
 * ahead of the version it calls itself. Defaulting `--to` to `PROTOCOL_MAJOR`
 * (17) then composed `17 → 17`, which selects NO step at all
 * (`composeMigrationChain` keeps `m > fromMajor`), so the invocation 29
 * shipped tombstones prescribe replayed an empty chain and reported
 * `Nothing to migrate` — for the very conversions that sent the author here.
 *
 * Reading the terminus off `MIGRATION_MAJORS` makes the template's presumption
 * true in every window instead of only after a major release, and it stays
 * true one major later by construction: when 18 ships, `PROTOCOL_MAJOR`
 * becomes 18, the 19 entries accumulating in the registry become the terminus,
 * and `--from 18` lists them the same way.
 *
 * ⛔ Not "migrating past what the runtime runs": every conversion in the
 * registry maps a shape the installed schemas REFUSE onto the one they accept
 * (that is what makes it a conversion), so the terminus is the only target
 * for which the command's own `schemaValid` verdict is reachable. `Math.max`
 * keeps `PROTOCOL_MAJOR` as the floor for the reverse case — a runtime whose
 * major moved past the last registered step.
 */
const CHAIN_TERMINUS_MAJOR = Math.max(PROTOCOL_MAJOR, ...MIGRATION_MAJORS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The migration chain over a stack AND each package body it carries — what
 * `applyMetaMigrations` is for this command, at every call site.
 *
 * ## Why the bodies need their own run
 *
 * The conversions walk a stack's own collections (`objects[]`, `views[]`,
 * `pages[]`, …) and do not descend into `packages[]`. A multi-package
 * artifact built by `composeStacks(…, { manifest: 'preserve' })` carries each
 * definition ONCE, under the package that owns it (ADR-0130 D4 addendum): its
 * top level holds `manifest` and `packages` and no flattened copy. So a
 * retired spelling inside a package was reached by no conversion — `applied`
 * came back empty and the schema verdict refused the very spelling the chain
 * exists to convert.
 *
 * A body (`packages[i].manifest`) is a stack-shaped bag — manifest fields and
 * collections side by side — so the chain runs over each body as a stack, and
 * each of its applications is listed under the body's own path
 * (`packages[0].manifest.objects[0]…`), which names the package and is the
 * path `--write` traces to the input that authored it. A conversion whose
 * reach already includes `packages[].manifest` (the manifest's permission
 * list) runs in the stack's own run and finds no `manifest` key in a body,
 * so nothing is applied twice.
 *
 * ## The merged result
 *
 * - `applied` keeps application order hop by hop: the stack's own edits of a
 *   hop, then each body's, in package order.
 * - `todos` is the stack's own list — every semantic entry of every hop
 *   crossed is in it whatever the stack holds, so a body's run lists the same
 *   entries again.
 * - `absentTodos` keeps an entry only when every run names it — the stack's
 *   own and each body's — matched by hop and id. The relevance question
 *   already reads `packages[]` itself; what a body's run adds is its own
 *   applications, and an entry that judges a conversion which applied an
 *   edit is never named absent.
 * - A stack without a `packages` list, which is every one-package project,
 *   gets the plain chain result back unchanged.
 */
export function applyMetaMigrationsToPackages(
  stack: Record<string, unknown>,
  fromMajor: number,
  toMajor: number,
): MigrationChainResult {
  const own = applyMetaMigrations(stack, fromMajor, toMajor);
  const entries = own.stack.packages;
  if (!Array.isArray(entries)) return own;

  const bodies: Array<{ index: number; prefix: string; run: MigrationChainResult }> = [];
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry) || !isRecord(entry.manifest)) continue;
    bodies.push({
      index,
      prefix: `packages[${index}].manifest`,
      run: applyMetaMigrations(entry.manifest, fromMajor, toMajor),
    });
  }
  if (bodies.length === 0) return own;

  const located = (prefix: string) => (application: MigrationApplication): MigrationApplication => ({
    ...application,
    path: application.path ? `${prefix}.${application.path}` : prefix,
  });
  const todoKey = (todo: MigrationTodo) => `${todo.toMajor}:${todo.id}`;
  const absentEverywhere = (absent: readonly MigrationTodo[], bodyAbsent: (run: MigrationChainResult) => readonly MigrationTodo[]) => {
    const bodySets = bodies.map(({ run }) => new Set(bodyAbsent(run).map(todoKey)));
    return absent.filter((todo) => bodySets.every((set) => set.has(todoKey(todo))));
  };
  /** `base` with each body replaced by its stack from `pick`, copied only where one changed. */
  const withBodies = (base: Record<string, unknown>, pick: (run: MigrationChainResult) => Record<string, unknown>) => {
    const list = base.packages;
    if (!Array.isArray(list)) return base;
    let changed = false;
    const next = list.slice();
    for (const { index, run } of bodies) {
      const entry = next[index];
      const body = pick(run);
      if (!isRecord(entry) || entry.manifest === body) continue;
      next[index] = { ...entry, manifest: body };
      changed = true;
    }
    return changed ? { ...base, packages: next } : base;
  };

  const hops: MigrationHopResult[] = own.hops.map((hop, k) => ({
    ...hop,
    stack: withBodies(hop.stack, (run) => run.hops[k]!.stack),
    applied: [...hop.applied, ...bodies.flatMap(({ prefix, run }) => run.hops[k]!.applied.map(located(prefix)))],
    absentTodos: absentEverywhere(hop.absentTodos, (run) => run.hops[k]!.absentTodos),
  }));

  return {
    ...own,
    stack: withBodies(own.stack, (run) => run.stack),
    applied: hops.flatMap((hop) => hop.applied),
    absentTodos: absentEverywhere(own.absentTodos, (run) => run.absentTodos),
    hops,
  };
}

/** Flags that mean something only in `--stored` mode (#4327). */
const STORED_ONLY_FLAGS = ['apply', 'yes', 'force', 'type', 'database-url'] as const;

/**
 * Which stored-only flags the operator actually TYPED.
 *
 * oclif's own `dependsOn` cannot answer this: a boolean with `default: false`
 * and an `env`-backed string both read as "provided" to it, so declaring
 * `dependsOn: ['stored']` on `--database-url` would make a merely-exported
 * `OS_DATABASE_URL` break `os migrate meta --from N`. The raw argv is the only
 * signal for intent, so the guard reads that.
 */
export function storedOnlyFlagsIn(argv: readonly string[]): string[] {
  const typed = STORED_ONLY_FLAGS.filter((f) =>
    argv.some((a) => a === `--${f}` || a.startsWith(`--${f}=`)),
  ) as string[];
  if (argv.includes('-y') && !typed.includes('yes')) typed.push('yes');
  return typed;
}

export interface PendingDataMigration {
  /** `sys_migration` row id the run records. */
  id: string;
  command: string;
  /** What staying un-run costs, in this deployment's terms. */
  unlocks: string;
}

/**
 * The DATA migrations a metadata chain crossing into {@link VALUE_SHAPE_GATE_MAJOR}
 * leaves for the operator (ADR-0104's 2026-07-30 addendum, #3438).
 *
 * Metadata migration and data migration are different jobs with different
 * subjects: this command reports the edits an author's source needs, while
 * these two rewrite (or vouch for) a deployment's rows, one deployment at a
 * time. Nothing here can run them, and — with no database in reach — nothing
 * here can say whether they have run; the booting server reports that. What
 * this can do is make sure the upgrade never *ends* without naming them,
 * because a gate nobody is told about is served by nobody.
 *
 * Listed only when the author's own metadata declares the field classes each
 * gate is about, so the advice is never noise.
 */
function pendingDataMigrations(stack: any, fromMajor: number, toMajor: number): PendingDataMigration[] {
  if (!(fromMajor < VALUE_SHAPE_GATE_MAJOR && toMajor >= VALUE_SHAPE_GATE_MAJOR)) return [];

  let media = false;
  let covered = false;
  for (const obj of (Array.isArray(stack?.objects) ? stack.objects : []) as any[]) {
    for (const def of Object.values(obj?.fields ?? {}) as any[]) {
      if (!def?.type) continue;
      if (FILE_REFERENCE_TYPES.has(def.type)) media = true;
      else if (REFERENCE_VALUE_TYPES.has(def.type) || STRUCTURED_JSON_TYPES.has(def.type)) covered = true;
    }
    if (media && covered) break;
  }

  const pending: PendingDataMigration[] = [];
  if (media) {
    pending.push({
      id: FILE_REFERENCES_MIGRATION_ID,
      command: 'os migrate files-to-references',
      unlocks:
        'converts legacy file values to sys_file references, then enforces media value shapes ' +
        'and lets released files be collected. Until it passes here, media values only warn and ' +
        'released files are kept forever.',
    });
  }
  if (covered) {
    pending.push({
      id: VALUE_SHAPES_MIGRATION_ID,
      command: 'os migrate value-shapes',
      unlocks:
        'scans stored reference and structured-JSON values against their field contracts. ' +
        'Until it passes here, a malformed value only warns.',
    });
  }
  return pending;
}

/**
 * The answer a range holding NO migration step owes the author (#17134).
 *
 * `composeMigrationChain` keeps the majors `m > fromMajor && m <= toMajor`, so
 * `--from 17 --to 17` composes zero steps and every stack — canonical or not —
 * comes back with an empty `applied` and an empty `todos`. Reporting that as
 * `✓ Nothing to migrate — the metadata is already canonical for this range` is
 * not merely unhelpful: it is a green verdict on a check that never ran, and
 * it is the SECOND signal an upgrading author has already been told to trust
 * (the first was the tombstone that named this command). So an empty range is
 * answered as an empty range, and — when a wider one would rewrite this very
 * stack — with the range that lists them, because "which `--to` do I need" is
 * the question the author is left holding.
 *
 * The probe is exact rather than advisory: it replays the widest chain this
 * build carries against the SAME normalized stack, so it can only speak up
 * when there is real work for THIS source. A genuinely canonical stack in an
 * empty range is still told its range was empty — that much is a fact about
 * the invocation — but is offered no phantom conversions.
 */
function printEmptyRangeAnswer(
  stack: Record<string, unknown>,
  fromMajor: number,
  toMajor: number,
): void {
  printWarning(
    `No migration step exists for protocol ${fromMajor} → ${toMajor}, so this run replayed nothing `
    + '— that is not a finding that the metadata is canonical.',
  );

  if (toMajor >= CHAIN_TERMINUS_MAJOR) {
    printInfo(
      `Protocol ${CHAIN_TERMINUS_MAJOR} is the highest major this build carries a step for, so no `
      + 'wider range is available; check `--from` against the major the metadata was authored '
      + 'against.',
    );
    return;
  }

  const wider = applyMetaMigrationsToPackages(stack, fromMajor, CHAIN_TERMINUS_MAJOR);
  const widerListed = listedTodos(wider.todos, wider.absentTodos);
  if (wider.applied.length === 0 && widerListed.length === 0) {
    printInfo(
      `The widest range this build carries (protocol ${fromMajor} → ${CHAIN_TERMINUS_MAJOR}) has `
      + 'nothing for this stack either.',
    );
    return;
  }

  printWarning(
    `Protocol ${fromMajor} → ${CHAIN_TERMINUS_MAJOR} has ${wider.applied.length} mechanical and `
    + `${widerListed.length} manual change(s) for this stack — re-run with `
    + `\`--to ${CHAIN_TERMINUS_MAJOR}\` to list them.`,
  );
}

/**
 * The semantic TODOs the default list prints: every entry of `todos` except
 * the ones `absentTodos` names (ADR-0087 D3 — an entry leaves the default list
 * only on the chain's structured, stack-derived proof). Matched by hop and id,
 * so a copy of a TODO is recognised as well as the chain's own object.
 */
function listedTodos(todos: readonly MigrationTodo[], absentTodos: readonly MigrationTodo[]): MigrationTodo[] {
  if (absentTodos.length === 0) return [...todos];
  const absent = new Set(absentTodos.map((t) => `${t.toMajor}:${t.id}`));
  return todos.filter((t) => !absent.has(`${t.toMajor}:${t.id}`));
}

/** Print the data-migration advice — the last thing a crossing upgrade sees. */
function printPendingDataMigrations(pending: readonly PendingDataMigration[]): void {
  if (pending.length === 0) return;
  console.log(chalk.bold('  Then, against each deployment\'s database:'));
  for (const m of pending) {
    console.log(`    ${chalk.cyan('→')} ${chalk.white(m.command)}`);
    console.log(chalk.dim(`        ${m.unlocks}`));
  }
  console.log(
    chalk.dim(
      '    Both are dry-run by default and report what they would do; `--apply` is the only ' +
        'writing mode. Not running them is safe — enforcement simply stays off here.',
    ),
  );
  console.log('');
}

/**
 * `--out`: write the migrated stack as a JSON snapshot, and print the line that
 * names it. The one writer for both exits of {@link printMigrationReport}: the
 * main path, and the early return of a run with nothing to migrate (#22116).
 * An operator or a CI step keeps this file as the record of the run, so a run
 * that returned without it left no file, or an earlier run's file read as this
 * one's, behind an exit 0. `--json` writes the same bytes on its own branch.
 */
function writeStackSnapshot(out: string, stack: Record<string, unknown>): void {
  writeFileSync(out, JSON.stringify(stack, null, 2));
  printInfo(`Wrote migrated stack snapshot → ${chalk.white(out)}`);
}

/**
 * What the run owes the manifest's declared protocol range (#22219).
 *
 * `rewrite`: the load refuses the range under the major this run migrated the
 * source to, so `--write` rewrites it (and a dry run names the edit).
 * `behind-from`: the load refuses it, but the chain started ABOVE the major the
 * range declares, so it never replayed the majors in between; the range is
 * left as written, and the report says which `--from` would move it.
 */
export type ProtocolRangePlan =
  | { kind: 'rewrite'; rewrite: RangeRewrite }
  | { kind: 'behind-from'; path: string; range: string; declaredMajor: number };

/** A manifest value narrowed to the strings the handshake reads; anything else reads as absent. */
function handshakeSlice(manifest: Record<string, unknown>): ProtocolHandshakeManifest {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);
  const engines = obj(manifest.engines);
  const engine = obj(manifest.engine);
  return {
    ...(engines ? { engines: { protocol: str(engines.protocol), platform: str(engines.platform) } } : {}),
    ...(engine ? { engine: { objectstack: str(engine.objectstack) } } : {}),
  };
}

/**
 * The declared protocol range a migrated source owes, judged by the load's
 * own handshake (#22219).
 *
 * ## Why this exists
 *
 * The load refuses a manifest whose range excludes the runtime's major, and the
 * refusal names `objectstack migrate meta --from N` as the command that resolves
 * it (`ProtocolIncompatibleDiagnostic.migrateCommand`, ADR-0087 P2). No
 * conversion touches the range, so `--write` used to write the chain's edits,
 * leave `'^N'` as it was, and hand the author back the same refusal.
 *
 * ## Which major the range is moved to
 *
 * `--to`, capped at the protocol this runtime implements. `--to` defaults to
 * {@link CHAIN_TERMINUS_MAJOR}, which runs AHEAD of {@link PROTOCOL_MAJOR} while
 * this build carries the next major's conversions — measured on a protocol-17
 * build, `--from 16` replays 16 → 18. Those conversions map shapes the
 * installed schemas refuse onto ones they accept, so the migrated source is
 * what THIS runtime loads, and `'^18'` would be refused by the same handshake
 * (measured: "targets protocol ^18 … Run: objectstack migrate meta --from 18").
 * A `--to` below this runtime's major stops there, and so does the range: the
 * source was not migrated past it.
 *
 * ## Where, and in what spelling
 *
 * At the key the handshake READ (`resolveDeclaredRange`: `engines.protocol`,
 * else `engines.platform`, else the legacy `engine.objectstack`), in place. No
 * chain step moves a range between those keys, and the schema accepts all three,
 * so moving one would be a conversion the chain has not declared; the key the
 * handshake read is the key it reads again. The spelling is the scaffold's and
 * `os lint`'s, `'^N'` — except under `engine.objectstack`, whose schema refuses
 * anything short of a full version, so `'^N.0.0'` there.
 *
 * ## What it never does
 *
 * It never lowers a range: one declaring a major at or above the target is
 * left for the handshake to refuse, since moving it down would silence a real
 * mismatch. It never touches a range the load admits, an absent one, or one
 * the handshake cannot parse (the load admits those too). And it moves a range
 * only across majors the chain replayed: when `--from` starts above the major
 * the range declares (and above the chain's floor), the range is left and the
 * report names the `--from` that would move it.
 */
export function planProtocolRange(
  stack: Record<string, unknown>,
  fromMajor: number,
  toMajor: number,
): ProtocolRangePlan | undefined {
  // The slice the load's handshake reads: the bundle's `manifest`, else the
  // bundle itself (`AppPlugin`: `bundle.manifest || bundle`).
  const nested = stack.manifest && typeof stack.manifest === 'object';
  const manifest = (nested ? stack.manifest : stack) as Record<string, unknown>;
  const slice = handshakeSlice(manifest);
  const major = Math.min(toMajor, PROTOCOL_MAJOR);
  const compat = checkProtocolCompat(slice, `${major}.0.0`);
  if (compat.status !== 'incompatible') return undefined;
  const declaredMajor = compat.diagnostic.targetMajor;
  if (declaredMajor === null || declaredMajor >= major) return undefined;

  const path = `${nested ? 'manifest.' : ''}${compat.source}`;
  const authored = compat.source === 'engines.protocol'
    ? slice.engines?.protocol
    : compat.source === 'engines.platform' ? slice.engines?.platform : slice.engine?.objectstack;
  const from = authored ?? compat.requiredRange;
  if (fromMajor > Math.max(declaredMajor, MIGRATION_SUPPORT_FLOOR)) {
    return { kind: 'behind-from', path, range: from, declaredMajor };
  }
  const to = compat.source === 'engine.objectstack' ? `^${major}.0.0` : `^${major}`;
  return { kind: 'rewrite', rewrite: { path, from, to, major } };
}

/** A range string as the report quotes it. */
function quotedRange(range: string): string {
  return `'${range}'`;
}

/** A dry run's range line (#22219): the edit `--write` would make, and why it is owed. */
function printRangeDryRun(rewrite: RangeRewrite): void {
  printWarning(
    `${rewrite.path} ${quotedRange(rewrite.from)} does not admit protocol ${rewrite.major}, so the load `
    + `refuses this stack even after migrating; --write rewrites it to ${quotedRange(rewrite.to)}.`,
  );
  console.log('');
}

/** The range a run left because it started above the major the range declares (#22219). */
function printRangeLeft(plan: Extract<ProtocolRangePlan, { kind: 'behind-from' }>, fromMajor: number): void {
  // The lowest `--from` that replays every major the range missed — never under the chain's floor.
  const start = Math.max(plan.declaredMajor, MIGRATION_SUPPORT_FLOOR);
  printWarning(
    `${plan.path} ${quotedRange(plan.range)} declares protocol ${plan.declaredMajor}, below --from ${fromMajor}: `
    + `this run did not replay protocol ${start} → ${fromMajor}, so the range is left as written and `
    + `the load still refuses it. Run with --from ${start}.`,
  );
  console.log('');
}

/** What `--write` did with the declared range (#22219): written at its site, or left with the reason. */
function printRangeOutcome(range: RangeOutcome): void {
  const { rewrite } = range;
  const edit = `${rewrite.path}: ${quotedRange(rewrite.from)} → ${quotedRange(rewrite.to)}`;
  if (range.status === 'written') {
    console.log(chalk.bold(`  Rewrote the declared protocol range, so the load admits protocol ${rewrite.major}:`));
    console.log(`    ${chalk.white(range.file)}${chalk.dim(`:${range.line}`)} ${edit}`);
    console.log('');
    return;
  }
  console.log(chalk.bold(chalk.yellow(
    `  The declared protocol range was left for you to change by hand; until then the load refuses it under protocol ${rewrite.major}:`,
  )));
  console.log(`    ${chalk.yellow('•')} ${edit}`);
  console.log(chalk.dim(`        not written [${range.refusal.kind}]: ${range.refusal.reason}`));
  console.log('');
}

/** One schema refusal of the migrated stack, in the shape `formatZodIssue` renders. */
export type MigrationRefusal = Parameters<typeof formatZodIssue>[0];

/** What `--write` did with the authored sources (#9591). */
export interface WriteOutcome {
  plan: AuthoredSourceWritePlan;
  /**
   * `written` — the plan's files were written and the re-run agreed with it;
   * `restored` — they were written, the re-run disagreed, and every one was
   * put back; `unwritten` — writing was refused before any file changed.
   * A plan with no file to write is `written` with an empty `rewrites`.
   */
  status: 'written' | 'restored' | 'unwritten';
  /** The re-run's verdict, when files were written. */
  verification?: WriteVerification;
  /** Why the write was refused or undone. */
  error?: string;
}

/** The `--json` face of a {@link WriteOutcome}. */
export function writeOutcomeJson(outcome: WriteOutcome) {
  const { plan } = outcome;
  return {
    status: outcome.status,
    files: plan.rewrites.map((r) => ({
      file: r.file,
      sites: plan.written.filter((w) => w.file === r.file).length,
    })),
    written: plan.written.map((w) => ({
      conversionId: w.application.conversionId,
      path: w.application.path,
      file: w.file,
      line: w.line,
    })),
    manual: plan.manual.map((m) => ({
      conversionId: m.application.conversionId,
      path: m.application.path,
      kind: m.refusal.kind,
      reason: m.refusal.reason,
    })),
    unexplained: plan.unexplained,
    // The declared protocol range (#22219), only when the run owed it an edit.
    // Not one of `written` / `manual`: those list the chain's `applied`
    // entries, and the range is not one.
    ...(plan.range ? { range: rangeOutcomeJson(plan.range) } : {}),
    ...(outcome.verification ? { verification: outcome.verification } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

/** The `--json` face of a {@link RangeOutcome}. */
function rangeOutcomeJson(range: RangeOutcome) {
  const { path, from, to } = range.rewrite;
  return range.status === 'written'
    ? { status: range.status, path, from, to, file: range.file, line: range.line }
    : { status: range.status, path, from, to, kind: range.refusal.kind, reason: range.refusal.reason };
}

/**
 * The `--write` group: what was written where, what was left and why, and
 * whether the re-run over the written sources agreed. Printed after the
 * semantic notices and before the data-migration advice, which stays last.
 */
function printWriteOutcome(outcome: WriteOutcome, appliedCount: number): void {
  const { plan } = outcome;
  if (appliedCount === 0 && !plan.range) {
    printInfo('--write: the chain made no mechanical change here, so no file was written.');
    console.log('');
    return;
  }
  if (outcome.status === 'unwritten') {
    printError(`--write wrote nothing: ${outcome.error}`);
    console.log('');
    return;
  }
  const files = plan.rewrites.length;
  if (outcome.status === 'restored') {
    printError(
      `--write wrote ${files} file(s), but re-running the chain over them did not match this report, so `
      + `every one was restored to its previous bytes: ${outcome.error}`,
    );
    console.log('');
    return;
  }
  if (appliedCount === 0) {
    // #22219: a stack with nothing to convert still owes the range its refusal names.
    printInfo('--write: the chain made no mechanical change here; the declared protocol range is the one edit it owes.');
    console.log('');
  } else {
    // The files holding the chain's edits; a file holding only the range is the range group's.
    const chainFiles = plan.rewrites.filter((r) => plan.written.some((w) => w.file === r.file));
    console.log(chalk.bold(
      `  Wrote ${plan.written.length} of ${appliedCount} mechanical change(s) into ${chainFiles.length} file(s):`,
    ));
    for (const r of chainFiles) {
      console.log(`    ${chalk.white(r.file)}`);
      for (const w of plan.written.filter((x) => x.file === r.file)) {
        console.log(`      ${chalk.dim(`:${w.line}`)} ${w.application.path} ${chalk.dim(`(${w.application.conversionId})`)}`);
      }
    }
    console.log('');
  }
  if (plan.range) printRangeOutcome(plan.range);
  if (plan.manual.length > 0) {
    console.log(chalk.bold(chalk.yellow(`  ${plan.manual.length} mechanical change(s) left for you to apply by hand:`)));
    for (const m of plan.manual) {
      const a = m.application;
      console.log(`    ${chalk.yellow('•')} ${a.path}: ${a.from} → ${a.to} ${chalk.dim(`(${a.conversionId})`)}`);
      console.log(chalk.dim(`        not written [${m.refusal.kind}]: ${m.refusal.reason}`));
    }
    console.log('');
  }
  if (plan.unexplained.length > 0) {
    printWarning(
      `${plan.unexplained.length} change(s) in the migrated stack are named by no applied entry and were not `
      + `written: ${plan.unexplained.join(', ')}`,
    );
  }
  if (files > 0) {
    // The re-check holds the range as it holds the chain's edits (#22219).
    const range = plan.range?.status === 'written'
      ? ` The declared protocol range now admits protocol ${plan.range.rewrite.major}.`
      : '';
    printSuccess(
      `Re-ran the chain over the written sources: ${plan.manual.length === 0
        ? 'no mechanical change remains.'
        : `only the ${plan.manual.length} change(s) left above remain.`}${range}`,
    );
    console.log('');
  }
}

/**
 * Group ⑤: with `--write`, what it wrote; without it, the range edit it would
 * make (#22219). A range the run left alone says so either way.
 */
function printWriteGroup(report: MigrationReport, appliedCount: number): void {
  if (report.range?.kind === 'behind-from') printRangeLeft(report.range, report.result.fromMajor);
  if (report.write) printWriteOutcome(report.write, appliedCount);
  else if (report.range?.kind === 'rewrite') printRangeDryRun(report.range.rewrite);
}

/** Everything the human report prints after the `Config:` / `Chain:` preamble. */
export interface MigrationReport {
  /** The chain's result. Every group prints in chain order — never re-sorted, filtered or merged. */
  result: MigrationChainResult;
  /** The stack the chain started from — the empty-range answer replays a wider chain over it. */
  normalized: Record<string, unknown>;
  /** Whether the migrated stack parses under the installed schema (`--json`'s `schemaValid`). */
  schemaValid: boolean;
  /** The migrated stack's schema refusals, in parse order; empty when it parses. */
  refusals: readonly MigrationRefusal[];
  dataMigrations: readonly PendingDataMigration[];
  /** `--step`: a checkpoint per hop, between the applied edits and the semantic notices. */
  step: boolean;
  /**
   * `--all`: list the notices the chain proved irrelevant (`absentTodos`)
   * after the listed ones, instead of only counting them.
   */
  all: boolean;
  /** `--out`, resolved — the snapshot is written here so its line keeps its place. */
  out?: string;
  /** `--write`: what was written into the authored sources (absent without the flag). */
  write?: WriteOutcome;
  /** What the run owes the declared protocol range, when anything (#22219). */
  range?: ProtocolRangePlan;
  /** Printed beside a schema-valid verdict. */
  elapsed: string;
}

/**
 * Group ① — the verdict, and every refusal that blocks the migrated stack.
 *
 * One header line carries the verdict and counts the group. The refusals are
 * the MIGRATED stack's, read off the same parse `--json` reports as
 * `schemaValid`, and rendered by `formatZodIssue` — the renderer behind the
 * loader's own `defineX() validation failed` block, so a refusal reads the same
 * here as everywhere else. They are not the loader's list: that one is printed
 * while the config is evaluated, of the stack as AUTHORED, and still names every
 * key the chain goes on to convert.
 */
function printSchemaVerdict(report: MigrationReport): void {
  if (report.schemaValid) {
    printSuccess(`Migrated stack is schema-valid ${chalk.dim(`(${report.elapsed})`)}`);
    console.log('');
    return;
  }
  const count = report.refusals.length;
  const counted = `${count} refusal${count === 1 ? '' : 's'}`;
  printWarning(
    report.result.hops.length === 0
      // The range held no step, so this run rewrote nothing: the refusals are
      // exactly the ones the source had before it (#17134).
      ? 'Stack does not pass schema validation, and this run replayed no conversion — nothing here '
        + `has been fixed; ${counted}, exactly as the source has them:`
      : `Migrated stack does not yet pass schema validation — ${counted} left after the chain. `
        + 'Resolve them, then run `os validate`:',
  );
  for (const refusal of report.refusals) {
    for (const line of formatZodIssue(refusal).split('\n')) console.log(chalk.red(`  ${line}`));
  }
  console.log('');
}

/**
 * The semantic entries that judge each conversion, keyed by conversion id —
 * read off the entries' declared `conversionIds` (`SemanticMigration`), in the
 * order the chain reports the entries.
 *
 * ⛔ Declared links only. An entry's prose naming a conversion id is not a
 * link: prose also names incidental analogues, so the spec lane authors a link
 * only after reading both sides, and this printer pairs nothing it was not
 * told to.
 *
 * The join runs over the whole chain result, not hop by hop: a link may name a
 * conversion an EARLIER step replays than the entry's own, and both halves sit
 * in the flat `applied` / `todos` arrays whichever hop produced them.
 */
function judgesByConversion(todos: readonly MigrationTodo[]): ReadonlyMap<string, readonly MigrationTodo[]> {
  const judges = new Map<string, MigrationTodo[]>();
  for (const todo of todos) {
    for (const conversionId of todo.conversionIds ?? []) {
      const list = judges.get(conversionId);
      if (!list) judges.set(conversionId, [todo]);
      else if (!list.includes(todo)) list.push(todo);
    }
  }
  return judges;
}

/**
 * Group ② — every applied edit, and beside the edits a semantic entry judges,
 * that entry's headline marked **review**.
 *
 * The edit lines are the chain's, one per edit, unchanged. A review line is
 * printed once under each RUN of consecutive edits by one conversion — the
 * chain replays one conversion at a time, so a conversion's edits arrive
 * together — and counts the edits above it that it judges. Once per run rather
 * than once per edit: a real upgrade wrote 13 edits by one judged conversion,
 * and repeating a paragraph-long judgment 13 times is the noise this report is
 * ordered to cut. Nothing is lost by it — every edit line still names its
 * conversion, and the review line says how many of the lines above it covers.
 *
 * The review line is a COPY of the entry's `[protocol N] surface → replacement`
 * headline, not the entry: ③ still prints that entry in full, in its place, so
 * its `why` and `verify` are found there by the same headline, and ③'s count
 * and lines do not change (ADR-0087 D3, "never silence").
 */
function printAppliedEdits(result: MigrationChainResult): void {
  const judges = judgesByConversion(listedTodos(result.todos, result.absentTodos));
  console.log(chalk.bold(`  Applied ${result.applied.length} mechanical change(s):`));
  let run = 0;
  for (const [i, a] of result.applied.entries()) {
    console.log(`    • ${a.path}: ${chalk.red(a.from)} → ${chalk.green(a.to)} ${chalk.dim(`(${a.conversionId})`)}`);
    run += 1;
    if (result.applied[i + 1]?.conversionId === a.conversionId) continue; // the run goes on
    const subject = run === 1 ? 'the edit above' : `the ${run} edits above`;
    for (const judge of judges.get(a.conversionId) ?? []) {
      console.log(
        `      ${chalk.yellow('↳ review')} ${subject} against the manual change `
        + `[protocol ${judge.toMajor}] ${judge.surface} → ${judge.replacement}`,
      );
    }
    run = 0;
  }
  console.log('');
}

/** One semantic notice, as ③ prints it: the headline, then `why:` and `verify:`. */
function printNotice(t: MigrationTodo): void {
  console.log(`    ${chalk.yellow('⚠')} [protocol ${t.toMajor}] ${t.surface} → ${t.replacement}`);
  console.log(chalk.dim(`        why:    ${t.reason}`));
  console.log(chalk.dim(`        verify: ${t.acceptanceCriteria}`));
}

/** The keys an absent notice's relevance question found empty, each in backticks, joined by ` / `. */
function absentKeysText(t: MigrationTodo): string {
  const keys = t.relevantWhen?.kind === 'stack-declares' ? t.relevantWhen.keys : [];
  return keys.map((k) => `\`${k}\``).join(' / ');
}

/**
 * Group ④ — the semantic entries the chain PROVED irrelevant to this stack:
 * each carries a structured relevance question (`relevantWhen`) that the chain
 * answered `absent` over the stack it loaded and every checkpoint it made of it
 * (`absentTodos`).
 *
 * By default one line counts them and names `--all`, and a second says what
 * the proof covers: the definition this run loaded, not the rows a deployment
 * stores. With `--all` each is printed in full, exactly as ③ prints a notice,
 * followed by the keys it was proven absent under. Nothing reaches this group
 * by matching prose, and nothing in it is unreachable (ADR-0087 D3).
 */
function printAbsentNotices(result: MigrationChainResult, all: boolean): void {
  const count = result.absentTodos.length;
  if (count === 0) return;
  if (!all) {
    console.log(
      chalk.dim(
        `  ${count} more manual change(s) not listed: their surfaces are absent from this stack `
        + '(run with --all to list them).',
      ),
    );
    console.log(
      chalk.dim(
        '    Absent is proven over the stack this run loaded; metadata a deployment stores '
        + '(Studio, the metadata API) is not read here.',
      ),
    );
    console.log('');
    return;
  }
  console.log(chalk.bold(`  ${count} manual change(s) whose surfaces are absent from this stack (listed by --all):`));
  for (const t of result.absentTodos) {
    printNotice(t);
    console.log(chalk.dim(`        absent: nothing is declared under ${absentKeysText(t)}`));
  }
  console.log('');
}

/**
 * The human report of an authored-source run, in the order an upgrader acts on
 * it, each group under one header line that counts it (ADR-0087 D3):
 *
 *  ① the VERDICT and the REFUSALS — whether the migrated stack parses and, when
 *    it does not, every refusal left after the chain: what still blocks it;
 *  ② the APPLIED mechanical edits — the diff the chain has already made, with
 *    the semantic entry that judges an edit printed beside it, marked review
 *    (see {@link printAppliedEdits});
 *  ③ the SEMANTIC notices — every semantic entry of every hop crossed that the
 *    chain could not prove irrelevant to this stack (`todos` minus
 *    `absentTodos`, see {@link listedTodos});
 *  ④ the ABSENT notices — the entries whose structured relevance question
 *    (`SemanticMigration.relevantWhen`) the chain answered `absent` over this
 *    stack (`absentTodos`): one line counting them, or with `--all` each one
 *    in full (see {@link printAbsentNotices});
 *  ⑤ with `--write`, what was written into the authored sources and what was
 *    left (see {@link printWriteOutcome}) — mechanical changes only, so it
 *    reads `applied` and never ③ or ④ — plus the declared protocol range the
 *    load would otherwise still refuse; without `--write`, that range edit
 *    named as the one `--write` would make (see {@link printWriteGroup}).
 *
 * ## Why this order
 *
 * The chain hands the printer every semantic entry of every hop it crosses —
 * the whole catalogue of each major crossed, 300-odd notices for protocol 18 —
 * and only a structured question proves one irrelevant. ③ used to be printed
 * first and the verdict last, where it told the author to "resolve the manual
 * changes above"; and the refusals that block the stack were printed nowhere.
 * Measured on a real upgrade: 874 lines, whose 41 refusals were buried under
 * 240 notices about surfaces the stack never used.
 *
 * ## What it must not do
 *
 * ⛔ Drop, filter, collapse or summarise a notice. ADR-0087 D3 is "never
 * silence": an entry leaves ③ only on a structured, stack-derived proof that
 * its surface is absent — the chain's `absentTodos`, which ④ always counts and
 * `--all` always lists — and matching the prose of `surface` against the stack
 * is never one. So every line ② and ③ printed is the chain's, byte-identical
 * and in chain order. The one addition to them is ②'s review lines, each a
 * copy of an entry ③ still prints.
 */
export function printMigrationReport(report: MigrationReport): void {
  const { result } = report;

  // ① The verdict and the refusals — first, whatever else the run found.
  printSchemaVerdict(report);

  if (result.applied.length === 0 && result.todos.length === 0) {
    // ⚠️ Two different facts wear the same empty result, and only one of them
    // is good news (#17134). A range that CONTAINS steps and rewrote nothing
    // is a finding about the metadata. A range that contains no step at all
    // replayed nothing and therefore found nothing — saying "already
    // canonical" over it is a claim about a check that never ran.
    if (result.hops.length === 0) {
      printEmptyRangeAnswer(report.normalized, result.fromMajor, result.toMajor);
    } else {
      printSuccess('Nothing to migrate — the metadata is already canonical for this range.');
    }
    // Still advertise: metadata needing no rewrite says nothing about whether
    // this deployment's DATA has been migrated. And still write `--out`, in the
    // main path's order — the snapshot, then `--write`, then the data
    // migrations: the snapshot is this run's record whatever the run found, and
    // `--json` writes it regardless (#22116).
    console.log('');
    if (report.out) writeStackSnapshot(report.out, result.stack);
    printWriteGroup(report, 0);
    printPendingDataMigrations(report.dataMigrations);
    // Returning is safe only because ① has already printed: the schema verdict
    // is the one line that can contradict a "nothing to do" answer, and
    // returning past it was the second half of #17134 — on a stack authoring a
    // tombstoned key, `--json` reported `schemaValid: false` while the human
    // output said the metadata was canonical and stopped.
    return;
  }

  // ② The mechanical rewrites (auto-applied), a judged edit's judge beside it.
  if (result.applied.length > 0) printAppliedEdits(result);

  // Per-hop checkpoints.
  if (report.step) {
    for (const hop of result.hops) {
      console.log(chalk.bold(`  ── protocol ${hop.toMajor} ──`));
      console.log(chalk.dim(`     ${hop.rationale}`));
      const listed = listedTodos(hop.todos, hop.absentTodos).length;
      const absent = hop.absentTodos.length > 0 ? `, ${hop.absentTodos.length} not listed (surface absent)` : '';
      console.log(chalk.dim(`     ${hop.applied.length} mechanical, ${listed} manual${absent}`));
    }
    console.log('');
  }

  // ③ The semantic TODOs (delegated to the agent — never auto-applied).
  const listed = listedTodos(result.todos, result.absentTodos);
  if (listed.length > 0) {
    console.log(chalk.bold(chalk.yellow(`  ${listed.length} manual change(s) require your judgment:`)));
    for (const t of listed) printNotice(t);
    console.log('');
  }

  // ④ The notices the chain proved irrelevant to this stack — counted, or listed under --all.
  printAbsentNotices(result, report.all);

  if (report.out) {
    writeStackSnapshot(report.out, result.stack);
  }

  // ⑤ `--write`: the mechanical changes written into the sources, and the rest;
  // or, on a dry run, the declared-range edit `--write` would make (#22219).
  printWriteGroup(report, result.applied.length);

  printPendingDataMigrations(report.dataMigrations);
}

/**
 * `os migrate meta --from N` — replay the ADR-0087 D3 migration chain.
 *
 * Composes the per-major steps N+1 → … → {@link CHAIN_TERMINUS_MAJOR} (the
 * highest major this build has a step for, which is where `--to` defaults) and
 * applies each major's mechanical transforms (the graduated D2 conversions) to
 * the loaded stack in one run — cross-major is the designed-for case, not an
 * edge. It reports a
 * generated, schema-validated diff (the mechanical rewrites) plus the structured
 * TODOs for the semantic changes the chain cannot apply, so the consumer agent
 * reviews a provably-valid change instead of hand-porting from prose.
 *
 * By default it writes no source file: `--out` writes the canonicalized stack as
 * a JSON snapshot the agent can diff and adopt. `--write` (#9591) writes the
 * mechanical changes into the authored sources in place — only at sites it can
 * trace to one literal in one project file, every other byte left as it was —
 * and lists each change it could not trace, with the reason; it never writes a
 * semantic TODO. It also rewrites the manifest's declared protocol range when
 * the load would still refuse the migrated source under it (#22219, see
 * {@link planProtocolRange}). See `utils/authored-source-codemod.ts` for what it proves
 * before writing and the closed set of reasons it refuses. `--step` prints a
 * per-hop checkpoint so a failure can be bisected to the exact major.
 *
 * ## `--stored`: the same chain, over data at rest (#4327)
 *
 * The default mode above has one subject — the **author's source**, read from a
 * config file, with no database in reach. `--stored` has the other: the
 * `sys_metadata` rows of **one deployment**. Same chain, same canonical target,
 * opposite ends of the contract, which is why they share a command rather than
 * splitting into two that would both be called "migrate the metadata".
 *
 * They are mutually exclusive for the same reason: `--from` describes a
 * protocol major an author wrote against, and a stored row already carries its
 * own history — the stored pass replays the full chain (retired entries
 * included) because a row at rest has no author to ask. See
 * {@link MigrateMeta.runStored}.
 */
export default class MigrateMeta extends Command {
  static override description =
    'Replay the metadata protocol migration chain from a past major to current (ADR-0087 D3). ' +
    'With --stored, replay it over this deployment\'s sys_metadata rows instead of an authored config.';

  // Derived from the chain's own floor, never typed: every `--from N` below is
  // a command a reader copies, and `applyMetaMigrations` throws
  // `MigrationFloorError` for any N under the floor. Written as literals these
  // went stale the moment the floor moved 10 -> 16 (#19056), advertising four
  // commands that all refuse.
  static override examples = [
    `$ os migrate meta --from ${MIGRATION_SUPPORT_FLOOR}`,
    `$ os migrate meta --from ${MIGRATION_SUPPORT_FLOOR} --step`,
    `$ os migrate meta --from ${MIGRATION_SUPPORT_FLOOR} --all`,
    `$ os migrate meta --from ${MIGRATION_SUPPORT_FLOOR} --to ${MIGRATION_SUPPORT_FLOOR + 1} --json`,
    `$ os migrate meta --from ${MIGRATION_SUPPORT_FLOOR} --out migrated.stack.json`,
    `$ os migrate meta --from ${MIGRATION_SUPPORT_FLOOR} --write`,
    '$ os migrate meta --stored',
    '$ os migrate meta --stored --apply',
    '$ os migrate meta --stored --apply --yes --json',
    '$ os migrate meta --stored --type view --type object',
  ];

  static override args = {
    config: Args.string({ description: 'Path to the stack config (defaults to auto-detected).' }),
  };

  static override flags = {
    from: Flags.integer({
      description: 'The protocol major the metadata was authored against (required without --stored).',
      exclusive: ['stored'],
    }),
    to: Flags.integer({
      description:
        `Target protocol major (defaults to ${CHAIN_TERMINUS_MAJOR}, the highest major this build `
        + `has a migration step for; this runtime implements protocol ${PROTOCOL_MAJOR}).`,
      exclusive: ['stored'],
    }),
    step: Flags.boolean({
      description: 'Print a per-hop checkpoint (for per-major verify / bisection).',
      default: false,
      exclusive: ['stored'],
    }),
    out: Flags.string({
      description: 'Write the migrated stack as a JSON snapshot to this path.',
      exclusive: ['stored'],
    }),
    all: Flags.boolean({
      description:
        'Also list, in full, the manual changes whose surfaces this stack provably does not declare '
        + '(by default they are only counted). --json always reports them in todos and names them in absentTodos.',
      default: false,
      exclusive: ['stored'],
    }),
    write: Flags.boolean({
      description:
        'Rewrite the authored source files in place for each mechanical change traced to one literal in one '
        + 'project file, and the manifest\'s declared protocol range when the load would still refuse it; every '
        + 'other change is listed with the reason it was not written. Never writes the manual (semantic) changes.',
      default: false,
      exclusive: ['stored'],
    }),
    stored: Flags.boolean({
      description:
        "Canonicalize this deployment's sys_metadata rows in place instead of an authored config "
        + '(read-only preview unless --apply).',
      default: false,
    }),
    'database-url': Flags.string({
      description: '--stored: database to canonicalize (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: '--stored: rewrite the rows (default is a read-only preview)',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: '--stored: skip the --apply confirmation prompt',
      default: false,
    }),
    force: Flags.boolean({
      description: '--stored: apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    type: Flags.string({
      description: '--stored: restrict to this metadata type (repeatable; default: every type)',
      multiple: true,
    }),
    json: Flags.boolean({ description: 'Output the machine-readable migration result as JSON.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MigrateMeta);
    const timer = createTimer();

    if (flags.stored) {
      await this.runStored(flags, timer);
      return;
    }

    // A stored-only flag typed without `--stored` is refused rather than
    // ignored: `--apply` in particular reads as "and write it", and the
    // authored-source mode has nothing to write to.
    const typed = storedOnlyFlagsIn(this.argv);
    if (typed.length > 0) {
      const message =
        `${typed.map((f) => `--${f}`).join(', ')} only appl${typed.length > 1 ? 'y' : 'ies'} to `
        + '`os migrate meta --stored` (the pass over a deployment\'s sys_metadata rows). '
        + 'The authored-source chain reads a config file and writes only the --out snapshot and, '
        + 'with --write, the authored sources.';
      if (flags.json) {
        await emitJson({ error: 'stored_only_flag', flags: typed, message }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(message);
      this.exit(1);
      return;
    }

    // `--from` is required for the authored-source chain and meaningless for
    // `--stored` (a row carries its own history), so it is validated here
    // rather than declared `required` — oclif would reject `--stored` runs.
    if (flags.from === undefined) {
      const message =
        'Missing required flag --from (the protocol major your metadata was authored against). '
        + 'To canonicalize a deployment\'s stored rows instead, run `os migrate meta --stored`.';
      if (flags.json) {
        await emitJson({ error: 'missing_from_major', message }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(message);
      this.exit(1);
      return;
    }
    const fromMajor = flags.from;
    const toMajor = flags.to ?? CHAIN_TERMINUS_MAJOR;

    if (!flags.json) printHeader('Migrate · meta');

    try {
      if (!flags.json) printStep('Loading configuration…');
      // `authoredSource`: read the config as the author WROTE it, not as the
      // current schema would have it (#9418). A retired key is a `retiredKey()`
      // tombstone — the schema rejects it rather than stripping it — and a real
      // config runs that schema itself: `os init` scaffolds
      // `export default defineStack({ … })`, and every `define*` helper is a
      // `Schema.parse()`. So the refusal used to happen while the config module
      // was being EVALUATED, inside the load, before this command reached its
      // first conversion — leaving the codemod unable to open the one input
      // class it exists for, while the message it printed was the prescription
      // telling the author to run it.
      //
      // This is where "convert before validating" has to land, because the CLI
      // has no validation step of its own to move: the load is tolerant, and
      // the schema verdict is taken below on the MIGRATED stack instead
      // (`schemaValid`), which is the stack the author is being asked to adopt.
      const { config, absolutePath, namedExports } = await loadConfig(args.config, { authoredSource: true });

      // Map→array normalization ONLY (convert:false): the chain must replay the
      // conversions itself against the raw authored source so each rewrite is
      // attributed to a chain hop, not silently pre-applied by the load-time
      // D2 pass. Running the D2 pass here would leave the chain's diff empty.
      //
      // `convert: false` reaches only THIS call. The stack's own `defineStack`
      // call runs the D2 pass inside the config module whenever the schema
      // accepts its input, so `config` is the raw source only because the
      // load starts it from the argument that call was given (`loadConfig`,
      // `authoredSource`). A composed project's inputs are produced again from
      // their authored arguments with that pass skipped before they are
      // composed, so its package bodies are raw source too (#22256).
      const normalized = normalizeStackInput(config as Record<string, unknown>, { convert: false });

      if (!flags.json) printStep(`Replaying chain: protocol ${fromMajor} → ${toMajor}…`);
      const result = applyMetaMigrationsToPackages(normalized, fromMajor, toMajor);

      // Prove the migrated stack is schema-valid — the "generated, provably valid
      // diff" the consumer agent reviews (ADR-0087 D3/D5).
      const parsed = ObjectStackDefinitionSchema.safeParse(result.stack);
      const specChanges = composeSpecChanges(fromMajor, toMajor);
      // [#22288] Asked of the folded stack: the advice is about field classes
      // the author's objects declare, and a multi-package `preserve` stack
      // carries its objects in its package bodies, none at its top level, so
      // the advice was never listed for such an app. A stack with no
      // `packages[]` comes back by identity.
      const dataMigrations = pendingDataMigrations(
        authoringRuleUnionStack(result.stack as Record<string, unknown>), result.fromMajor, result.toMajor);

      // The declared protocol range the load would still refuse after this
      // run (#22219): `--write` rewrites it, a dry run names the edit.
      const range = planProtocolRange(normalized, result.fromMajor, result.toMajor);

      // `--write` (#9591): the mechanical changes go into the authored sources
      // where they can be proved, and the write is held to a re-run of the chain.
      const write = flags.write
        ? await this.writeSources({
            configArg: args.config,
            configPath: absolutePath,
            config: config as Record<string, unknown>,
            namedExports,
            normalized,
            result,
            ...(range?.kind === 'rewrite' ? { range: range.rewrite } : {}),
            json: Boolean(flags.json),
          })
        : undefined;

      if (flags.json) {
        await emitJson({
              from: result.fromMajor,
              to: result.toMajor,
              // The key names what the value IS. `PROTOCOL_VERSION` is the
              // protocol major padded to a semver ('17.0.0') and is never the
              // installed package version -- emitted under the key `runtime`,
              // as it was until this release, a machine consumer read it as
              // the runtime's own version with no prose to disambiguate, which
              // is the half of #15585 that the human-line repair could not
              // reach. `runtime` is gone outright: no alias, no dual-key
              // window. The pin in `test/migrate-meta.e2e.test.ts` asserts BOTH
              // halves -- the new key carries the value AND the old spelling is
              // absent -- so a future silent rename reddens instead of passing.
              protocolVersion: PROTOCOL_VERSION,
              applied: result.applied,
              todos: result.todos,
              // `todos` keeps every semantic entry; `absentTodos` NAMES the
              // subset the chain proved irrelevant to this stack (ADR-0087 D3),
              // so a machine consumer reads the default list as the difference.
              absentTodos: result.absentTodos,
              hops: flags.step
                ? result.hops.map((h) => ({
                    toMajor: h.toMajor,
                    rationale: h.rationale,
                    applied: h.applied,
                    todos: h.todos,
                    absentTodos: h.absentTodos,
                  }))
                : undefined,
              specChanges,
              schemaValid: parsed.success,
              // Per-deployment data migrations this chain leaves to the
              // operator — the metadata is only half of a crossing upgrade.
              dataMigrations,
              // Only with `--write`: without it the payload is what it always was.
              ...(write ? { write: writeOutcomeJson(write) } : {}),
              duration: timer.elapsed(),
            });
        if (flags.out) writeFileSync(resolve(flags.out), JSON.stringify(result.stack, null, 2));
        if (write && write.status !== 'written') this.exit(1);
        return;
      }

      printInfo(`Config: ${chalk.white(absolutePath)}`);
      // State this build's protocol major in the protocol's own units.
      // `PROTOCOL_VERSION` is that major padded to a semver ('17.0.0'), never
      // the installed package version -- printed as a bare semver under the
      // word "runtime" it read as one, so on a 17.3.0 install the operator saw
      // an apparent downgrade next to the real package versions of the same
      // upgrade session. The fact itself is worth keeping: with `--to` below
      // this build's major it is the only line saying where the runtime
      // actually stands. So it is relabelled and de-padded, not dropped.
      printInfo(`Chain:  protocol ${fromMajor} → ${toMajor} (this runtime implements protocol ${PROTOCOL_MAJOR})`);
      console.log('');

      // The verdict and the refusals lead, then the applied edits, then the
      // semantic notices — see printMigrationReport for why, and for what it
      // must never do to a notice.
      printMigrationReport({
        result,
        normalized,
        schemaValid: parsed.success,
        refusals: parsed.success ? [] : parsed.error.issues,
        dataMigrations,
        step: flags.step,
        all: flags.all,
        ...(flags.out ? { out: resolve(flags.out) } : {}),
        ...(write ? { write } : {}),
        ...(range ? { range } : {}),
        elapsed: timer.display(),
      });
      // A write refused or undone is a failed run, reported above.
      if (write && write.status !== 'written') this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (error instanceof MigrationFloorError) {
        if (flags.json) {
          await emitJson({ error: 'unsupported_from_major', message: error.message }, 0, { compact: true });
          this.exit(1);
        }
        printError(error.message);
        this.exit(1);
        return;
      }
      if (flags.json) {
        await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
        this.exit(1);
      }
      // [#15547] `resolveConfigPath()` already wrote its refusal and hint
      // lines to stderr before throwing; printing the sentence again here
      // would put a second copy on stdout.
      if (!isReportedError(error)) printError(error.message || String(error));
      this.exit(1);
    }
  }

  /**
   * `--write`: plan the source edits, write them, re-run the chain over the
   * written sources, and restore every file when the re-run disagrees with
   * the plan (#9591). The declared protocol range rides the same plan, write
   * and re-check (#22219). Writes nothing when neither the chain nor the range
   * owes an edit.
   */
  private async writeSources(input: {
    configArg: string | undefined;
    configPath: string;
    config: Record<string, unknown>;
    namedExports: readonly string[];
    normalized: Record<string, unknown>;
    result: MigrationChainResult;
    range?: RangeRewrite;
    json: boolean;
  }): Promise<WriteOutcome> {
    const { result } = input;
    if (!input.json && (result.applied.length > 0 || input.range)) {
      printStep('Writing the mechanical changes into the authored sources…');
    }
    const plan = await planAuthoredSourceWrite({
      configPath: input.configPath,
      config: input.config,
      namedExports: input.namedExports,
      normalized: input.normalized,
      migrated: result.stack,
      applied: result.applied,
      ...(input.range ? { range: input.range } : {}),
    });
    if (plan.rewrites.length === 0) return { plan, status: 'written' };
    try {
      writeAuthoredSources(plan);
    } catch (error: any) {
      return { plan, status: 'unwritten', error: error.message || String(error) };
    }

    let verification: WriteVerification;
    // The re-load hands the remaining refused artifacts through the
    // authored-source shim again, and it would announce each of them a second
    // time; the first load already said so, and the verdict below is the one
    // thing this load is for.
    const warn = console.warn;
    console.warn = () => {};
    try {
      const reloaded = await loadConfig(input.configArg, { authoredSource: true });
      const rerunInput = normalizeStackInput(reloaded.config as Record<string, unknown>, { convert: false });
      const rerun = applyMetaMigrationsToPackages(rerunInput, result.fromMajor, result.toMajor);
      // The range the written sources still owe, judged as it was before the write.
      const rerunRange = planProtocolRange(rerunInput, result.fromMajor, result.toMajor);
      verification = verifyAuthoredSourceWrite(
        plan,
        rerun.applied,
        rerunRange?.kind === 'rewrite' ? rerunRange.rewrite : undefined,
      );
    } catch (error: any) {
      restoreAuthoredSources(plan);
      return { plan, status: 'restored', error: `the re-run over the written sources failed: ${error.message || String(error)}` };
    } finally {
      console.warn = warn;
    }
    if (!verification.ok) {
      restoreAuthoredSources(plan);
      const parts = [
        ...(verification.stillApplied.length > 0 ? [`still converted: ${verification.stillApplied.join(', ')}`] : []),
        ...(verification.vanished.length > 0 ? [`no longer converted: ${verification.vanished.join(', ')}`] : []),
      ];
      return { plan, status: 'restored', verification, error: parts.join('; ') };
    }
    return { plan, status: 'written', verification };
  }

  /**
   * `os migrate meta --stored` — canonicalize this deployment's `sys_metadata`
   * rows so the read-path conversion chain has a finish line (#4327).
   *
   * #4317 made every stored-row rehydration seam replay the full ADR-0087 chain,
   * so a row written under any past protocol *reads* canonical forever. The rows
   * stayed legacy, though: the chain re-lowers them on every load and each one
   * warns once per boot. This run ends that — same chain, same policy, but the
   * result is written back through the normal write path (history row, checksum,
   * mutation projectors) with `source: 'migrate-stored'`.
   *
   * **Preview by default; `--apply` is the only writing mode.** That is the
   * house rule its two siblings already keep (`os migrate value-shapes`,
   * `os migrate files-to-references`, #3617's "a dry run changes nothing"), and
   * the reason applies with more force here: this rewrites *metadata*, so a
   * surprise run would move every affected row's checksum and mint a history
   * entry against each.
   *
   * Nothing gates on this having run — #3855's conclusion that operator-run
   * migrations cannot be relied on still holds, and the read path stays the
   * guarantee. What a run buys is hygiene plus one thing that was previously
   * unobtainable: **an operator can now assert it.** A second pass reporting
   * every row canonical exits 0; a deployment with work left exits 1, so "my
   * metadata is on protocol N" becomes a CI check instead of a belief.
   */
  private async runStored(
    flags: {
      json: boolean;
      apply: boolean;
      yes: boolean;
      force: boolean;
      type?: string[];
      'database-url'?: string;
    },
    timer: { elapsed: () => number; display: () => string },
  ): Promise<void> {
    const apply = flags.apply;
    if (!flags.json) printHeader('Migrate · meta --stored');

    // Occupancy gate — an apply run rewrites rows, so a live writer on the same
    // SQLite file is the same hazard `os migrate files-to-references --apply`
    // refuses for. Probed BEFORE boot (afterwards our own pool is what the probe
    // finds) and before the prompt, so nobody confirms something we then refuse.
    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && apply && !flags.force) {
      if (flags.json) {
        await emitJson({
          error: 'database_busy',
          database: occupancy.filename,
          signal: occupancy.signal,
          detail: occupancy.detail,
          hint: OCCUPANCY_HINT,
        }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(describeOccupancy(occupancy));
      printWarning(OCCUPANCY_HINT);
      this.exit(1);
      return;
    }
    if (occupancy.status === 'busy' && !flags.json) {
      printWarning(apply
        ? `--force: ${describeOccupancy(occupancy)} Rewriting anyway — the live process may save metadata mid-run.`
        : `${describeOccupancy(occupancy)} The preview below writes nothing, but a live process may `
          + 'be saving metadata while it runs.');
    }
    if (occupancy.status === 'unknown' && !flags.json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    if (apply && !flags.yes) {
      if (flags.json || !process.stdin.isTTY) {
        if (flags.json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true });
          this.exit(1);
          return;
        }
        printWarning(
          'Apply mode rewrites sys_metadata rows in place — each rewritten row gets a new checksum '
          + 'and a history entry. Re-run with --yes to confirm, or run without --apply to preview.',
        );
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nRewrite the stored metadata rows that carry a pre-protocol shape? [y/N] '),
      );
      if (!ok) {
        printInfo('Aborted — nothing written.');
        return;
      }
    }

    if (!flags.json) {
      printStep(apply ? 'Booting data stack (APPLY mode)…' : 'Booting data stack (preview only)…');
    }

    let stack;
    try {
      // `PlatformObjectsPlugin` for `sys_metadata` and its history/audit
      // siblings, plus the automation engine in INERT mode so `flow` rows are
      // covered too (#4454) — flow-node conversions need its executor registry
      // for the conflict guard, and `armRuntime: false` means taking it arms
      // nothing. No storage adapter: unlike the file migration, nothing here
      // reads bytes.
      //
      // [#21349] The preview boots READ-ONLY — the same boot `os migrate plan`
      // takes. A plain boot runs schema sync and the artifact's inline seed
      // loader, and the seed upserts every seeded row of the app's tables
      // (`updated_at` bumped, `organization_id` stamped, relative-date values
      // re-evaluated) before the report says "writes nothing". `deferSchemaDdl`
      // holds the DDL back and suppresses the seed; `readOnlyProbe` keeps a
      // missing sqlite file from being created. `--apply` keeps the plain boot:
      // it is the writing mode, and its behaviour is unchanged.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        extraPlugins: await buildDataMigrationPlugins({ automation: true }),
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); return; }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    // Collected rather than thrown: `this.exit()` raises an oclif ExitError,
    // which the catch below would then report as a bare "EEXIT: 1" over the
    // real message. Decide the code here, exit after the stack is down.
    let exitCode = 0;
    try {
      const protocol: any = stack.kernel.getService('protocol');
      if (typeof protocol?.migrateStoredMetadata !== 'function') {
        throw new Error(
          'No metadata protocol on this stack — cannot walk sys_metadata. '
          + 'Run this from a project root whose stack registers the ObjectQL engine.',
        );
      }

      const { formatStoredMigrationReport, storedMigrationClean } =
        await import('@objectstack/metadata-protocol');

      // No `canonicalizeFlow` is threaded from here. The automation engine
      // canonicalizes `flow` rows — it holds the executor registry ADR-0078's
      // conflict guard needs (#4454) — and the protocol resolves it from the
      // kernel's service table itself (#4498), which is the same table the
      // inert engine this command boots registers into. Passing it again would
      // be a second route to one capability, and the two would drift.
      // Absent (an older stack, or a boot that skipped it), flow rows keep
      // reporting `skipped` with the reason rather than being counted done.
      // [#21552] Not asked: the preview's read-only boot measured whether
      // `sys_metadata` exists, and a table that does not exist stores no row to
      // canonicalize. The protocol reads that table through an engine this
      // command cannot wrap, so the preview answers the true contents of an
      // absent table itself: a walk over zero rows, the report the protocol
      // returns for a booted database that holds none. Read anyway, a project
      // whose database does not exist yet was refused here with exit 1.
      // `--apply` booted plain, so there the table exists and the read is real.
      // ⛔ Only a table the boot MEASURED absent: any other refused read still
      // lands in the catch below and still exits 1.
      const reads = absentTableReads(stack);
      const noStoredRows: StoredMigrationReport = {
        apply,
        protocol: PROTOCOL_VERSION,
        scanned: 0,
        canonical: 0,
        pending: 0,
        rewritten: 0,
        skipped: 0,
        failed: 0,
        rows: [],
        decisionModeReview: [],
      };
      const report: StoredMigrationReport = reads.absent('sys_metadata')
        ? noStoredRows
        : await protocol.migrateStoredMetadata({
            apply,
            ...(flags.type && flags.type.length > 0 ? { types: flags.type } : {}),
            actor: 'os migrate meta --stored',
          });
      const clean = storedMigrationClean(report);
      if (!clean) exitCode = 1;

      if (flags.json) {
        reads.notice(true);
        await emitJson({ database: stack.dbLabel, ...report, clean, duration: timer.elapsed() });
      } else {
        printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
        reads.notice(false);
        console.log('');
        console.log(formatStoredMigrationReport(report).join('\n'));
        console.log('');

        if (report.scanned === 0) {
          // Exits 0 — nothing is wrong — but does not claim a clean bill for a
          // database it never read a row from.
          printInfo(`No stored metadata to examine ${chalk.dim(`(${timer.display()})`)}`);
        } else if (clean && apply) {
          printSuccess(
            `Stored metadata is on protocol ${report.protocol} — rewrote ${report.rewritten} row(s) `
            + `${chalk.dim(`(${timer.display()})`)}`,
          );
        } else if (clean) {
          printSuccess(
            `Stored metadata is already on protocol ${report.protocol} — nothing to rewrite `
            + `${chalk.dim(`(${timer.display()})`)}`,
          );
        } else if (report.failed > 0) {
          printError(
            `${report.failed} row(s) could not be rewritten. They keep reading canonically through the `
            + 'chain, so nothing is broken — but their stored bytes stay legacy until the reason above is fixed.',
          );
        } else {
          printWarning(
            `${report.pending} row(s) carry a pre-protocol shape. They read canonically today (the chain `
            + 'runs on every load); re-run with --apply to persist it.',
          );
        }
      }
    } catch (error: any) {
      exitCode = 1;
      if (flags.json) await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
      else printError(error.message || String(error));
    } finally {
      await stack.shutdown();
    }
    if (exitCode !== 0) this.exit(exitCode);
  }
}

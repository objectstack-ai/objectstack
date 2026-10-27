// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Compose and apply the migration chain (ADR-0087 D3).
 *
 * `objectstack migrate meta --from N` calls {@link applyMetaMigrations}, which
 * folds the steps N+1 → … → current and applies each major's *mechanical*
 * transforms (the graduated D2 conversions) to the consumer's stack in one run,
 * collecting a review diff and the semantic TODOs the agent must resolve. Every
 * hop is checkpointed (`hops[]`) so an agent can run its verify loop per major
 * and bisect a failure to the exact hop — the agent's `git bisect` for an
 * upgrade.
 */

import { PROTOCOL_MAJOR } from '../kernel/protocol-version.js';
import { ALL_CONVERSIONS } from '../conversions/registry.js';
import type { MetadataConversion } from '../conversions/types.js';
import { MIGRATIONS_BY_MAJOR, MIGRATION_MAJORS, MIGRATION_SUPPORT_FLOOR } from './registry.js';
import type {
  MigrationApplication,
  MigrationChainResult,
  MigrationHopResult,
  MigrationStep,
  MigrationTodo,
  SemanticRelevance,
} from './types.js';

const CONVERSION_BY_ID: ReadonlyMap<string, MetadataConversion> = new Map(
  ALL_CONVERSIONS.map((c) => [c.id, c]),
);

/**
 * The ordered steps that migrate a `fromMajor` source up to `toMajor`
 * (defaults to the running protocol major). Only majors that carry a step
 * appear; a major with no break contributes nothing (a no-op hop is elided).
 */
export function composeMigrationChain(
  fromMajor: number,
  toMajor: number = PROTOCOL_MAJOR,
): MigrationStep[] {
  return MIGRATION_MAJORS
    .filter((m) => m > fromMajor && m <= toMajor)
    .map((m) => MIGRATIONS_BY_MAJOR[m]!);
}

/**
 * The answer to a {@link SemanticRelevance} question over a stack. Only
 * `absent` names an entry in `absentTodos`; `unknown` keeps it off that list,
 * so a question the evaluation cannot answer never reads as a proof.
 */
export type SemanticRelevanceVerdict = 'present' | 'absent' | 'unknown';

function isPlainDict(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** One collection value, as authored: an array, or the map form `defineStack` also accepts. */
function collectionVerdict(value: unknown): SemanticRelevanceVerdict {
  if (value === undefined) return 'absent';
  if (Array.isArray(value)) return value.length > 0 ? 'present' : 'absent';
  if (isPlainDict(value)) return Object.keys(value).length > 0 ? 'present' : 'absent';
  // A function, a promise, a class instance, a scalar or null: not a value the
  // question can read, so it proves nothing either way.
  return 'unknown';
}

/** Fold verdicts: any `present` wins, then any `unknown`; `absent` only when every one is. */
function foldVerdicts(verdicts: Iterable<SemanticRelevanceVerdict>): SemanticRelevanceVerdict {
  let unknown = false;
  for (const v of verdicts) {
    if (v === 'present') return 'present';
    if (v === 'unknown') unknown = true;
  }
  return unknown ? 'unknown' : 'absent';
}

/**
 * The `stack-declares` question over ONE stack: does it declare anything under
 * any of `keys`, at the top level or inside an assembled `packages[].manifest`
 * body?
 *
 * Conservative by construction (ADR-0087 D3, "never silence"): `absent` is a
 * positive proof — the stack is a plain object, no `plugins` / `devPlugins`
 * entry and no `tiers` preset could contribute what it does not show, every
 * carrier of the keys was read, and none held anything. Whatever the evaluation cannot read answers
 * `unknown`, and a read that throws (a getter, a proxy) answers `unknown` too.
 */
function stackDeclaresVerdict(stack: unknown, keys: readonly string[]): SemanticRelevanceVerdict {
  if (!isPlainDict(stack)) return 'unknown';
  try {
    const verdicts: SemanticRelevanceVerdict[] = keys.map((key) => collectionVerdict(stack[key]));

    // An assembled multi-package stack (`composeStacks(…, { manifest: 'preserve' })`)
    // carries its collections in each package body rather than at the top level.
    const packages = stack.packages;
    if (packages !== undefined) {
      if (!Array.isArray(packages)) {
        verdicts.push('unknown');
      } else {
        for (const entry of packages) {
          if (!isPlainDict(entry) || !isPlainDict(entry.manifest)) {
            verdicts.push('unknown');
            continue;
          }
          const body = entry.manifest;
          for (const key of keys) verdicts.push(collectionVerdict(body[key]));
        }
      }
    }

    // A plugin is handed to the kernel, not read by this chain, and it can
    // register metadata of any type at boot; a `tiers` preset names platform
    // plugins the host loads the same way. So while one is listed, no key can
    // be proven absent from what this stack deploys (a key the stack visibly
    // declares is still present).
    for (const carrier of ['plugins', 'devPlugins', 'tiers']) {
      if (collectionVerdict(stack[carrier]) !== 'absent') verdicts.push('unknown');
    }

    return foldVerdicts(verdicts);
  } catch {
    return 'unknown';
  }
}

/**
 * Evaluate a {@link SemanticRelevance} question over every stack the chain
 * saw — the stack it was handed and each hop's checkpoint — and fold the
 * answers: present in any of them is present, and the surface is `absent` only
 * when it is absent from all of them. Reading every checkpoint keeps a key a
 * conversion renames or removes from reading as absent on either side of it.
 *
 * Exported for the chain's own tests; not part of the published entry.
 */
export function semanticRelevanceVerdict(
  relevance: SemanticRelevance,
  stacks: readonly unknown[],
): SemanticRelevanceVerdict {
  switch (relevance.kind) {
    case 'stack-declares':
      return stacks.length === 0
        ? 'unknown'
        : foldVerdicts(stacks.map((s) => stackDeclaresVerdict(s, relevance.keys)));
    default:
      // A question this build does not know how to answer proves nothing.
      return 'unknown';
  }
}

/**
 * Whether one semantic TODO is named in `absentTodos`: it carries a relevance
 * question, it judges no conversion that applied an edit in this run (an
 * applied edit is itself a proof its surface is there), and the question
 * answers `absent` over every checkpoint.
 *
 * Exported for the chain's own tests; not part of the published entry.
 */
export function semanticTodoAbsent(
  todo: MigrationTodo,
  checkpoints: readonly unknown[],
  appliedConversionIds: ReadonlySet<string>,
): boolean {
  if (!todo.relevantWhen) return false;
  if (todo.conversionIds?.some((id) => appliedConversionIds.has(id))) return false;
  return semanticRelevanceVerdict(todo.relevantWhen, checkpoints) === 'absent';
}

/** Thrown when `--from N` is below the documented support floor. */
export class MigrationFloorError extends Error {
  constructor(
    public readonly fromMajor: number,
    public readonly floor: number,
  ) {
    super(
      `Cannot migrate from protocol ${fromMajor}: the chain's support floor is ${floor} ` +
        `(ADR-0087 D3). Upgrade to protocol ${floor} by another path first, then re-run.`,
    );
    this.name = 'MigrationFloorError';
  }
}

/**
 * Apply the migration chain from `fromMajor` up to `toMajor` to a stack.
 *
 * Pure and immutable: reuses the D2 conversion transforms (copy-on-write), so
 * the input is never mutated. Mechanical rewrites are applied; semantic changes
 * are reported as {@link MigrationTodo}s, never auto-applied. Never throws on
 * stack content — only {@link MigrationFloorError} when `fromMajor` is
 * unsupported.
 *
 * Every semantic entry of every hop crossed is reported in `todos`, whatever
 * the stack holds. `absentTodos` additionally names — as the same objects, a
 * subset of `todos` in chain order — the entries whose `relevantWhen` question
 * proves their surface absent from the stack and from every checkpoint the
 * chain made of it (ADR-0087 D3: an entry may leave a printer's default list
 * only on a structured, stack-derived proof). An entry that judges a
 * conversion which applied an edit in this run is never named there, whatever
 * its question answers.
 */
export function applyMetaMigrations(
  stack: Record<string, unknown>,
  fromMajor: number,
  toMajor: number = PROTOCOL_MAJOR,
): MigrationChainResult {
  if (fromMajor < MIGRATION_SUPPORT_FLOOR) {
    throw new MigrationFloorError(fromMajor, MIGRATION_SUPPORT_FLOOR);
  }

  const steps = composeMigrationChain(fromMajor, toMajor);
  const applied: MigrationApplication[] = [];
  const replayed: Array<{ step: MigrationStep; stack: Record<string, unknown>; applied: MigrationApplication[] }> = [];
  let current = stack;

  for (const step of steps) {
    const hopApplied: MigrationApplication[] = [];
    for (const conversionId of step.conversionIds) {
      const conversion = CONVERSION_BY_ID.get(conversionId);
      // A step referencing an unknown conversion id is a registry authoring bug,
      // caught by `migrations.test.ts`; skip defensively rather than crash a
      // consumer's upgrade run.
      if (!conversion) continue;
      current = conversion.apply(current, (detail) => {
        hopApplied.push({
          toMajor: step.toMajor,
          conversionId,
          surface: conversion.surface,
          from: detail.from,
          to: detail.to,
          path: detail.path,
        });
      });
    }
    applied.push(...hopApplied);
    replayed.push({ step, stack: current, applied: hopApplied });
  }

  // The semantic entries are judged once every hop has run, so a question is
  // asked of the whole sequence of stacks the chain produced.
  const checkpoints: readonly unknown[] = [stack, ...replayed.map((r) => r.stack)];
  const appliedConversionIds: ReadonlySet<string> = new Set(applied.map((a) => a.conversionId));

  const todos: MigrationTodo[] = [];
  const absentTodos: MigrationTodo[] = [];
  const hops: MigrationHopResult[] = replayed.map(({ step, stack: hopStack, applied: hopApplied }) => {
    const hopTodos: MigrationTodo[] = step.semantic.map((s) => ({ ...s, toMajor: step.toMajor }));
    // The same objects, never copies: `absentTodos` is a subset of `todos`.
    const hopAbsent = hopTodos.filter((todo) => semanticTodoAbsent(todo, checkpoints, appliedConversionIds));
    todos.push(...hopTodos);
    absentTodos.push(...hopAbsent);
    return {
      toMajor: step.toMajor,
      rationale: step.rationale,
      stack: hopStack,
      applied: hopApplied,
      todos: hopTodos,
      absentTodos: hopAbsent,
    };
  });

  return { fromMajor, toMajor, stack: current, applied, todos, absentTodos, hops };
}

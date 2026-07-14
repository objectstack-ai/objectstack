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
  const todos: MigrationTodo[] = [];
  const hops: MigrationHopResult[] = [];
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
    const hopTodos: MigrationTodo[] = step.semantic.map((s) => ({ ...s, toMajor: step.toMajor }));

    applied.push(...hopApplied);
    todos.push(...hopTodos);
    hops.push({
      toMajor: step.toMajor,
      rationale: step.rationale,
      stack: current,
      applied: hopApplied,
      todos: hopTodos,
    });
  }

  return { fromMajor, toMajor, stack: current, applied, todos, hops };
}

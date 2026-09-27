// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17518 — the two JSON stages of a package body, declared beside the assembled
 * one, and pinned as three genuinely different shapes rather than three names
 * for one.
 *
 * ## The defect, stated as the measurement that found it
 *
 * ADR-0130 D4 says an artifact is inert JSON: 「a plugin written inside
 * `packages[i].manifest` could never be constructed by a loader, so a reader
 * that resolved it there would register garbage where it used to skip in
 * silence.」 Of {@link AssembledPackageBodySchema}'s 55 members exactly two
 * declare that they accept a callable — `functions` (a `z.function()` branch)
 * and `hooks` (a `z.custom()` branch) — and one unrepresentable member costs
 * EVERY embedder its whole JSON Schema. That is why the installed-package read
 * responses could only carry the body with both keys written `z.unknown()`:
 * accepted without being checked.
 *
 * ⛔ The remedy is NOT narrowing the assembled body. Those callables are LIVE
 * on the stage that schema declares itself for — `composeStacks(stacks, {
 * manifest: 'preserve' })` builds exactly such a body and the load path
 * registers it — so narrowing in place would refuse a published composition
 * function's own output. The stages get their own declarations instead, and
 * this file's job is to keep them from collapsing back into one.
 *
 * ## The four stages, and which two are new
 *
 * | stage | declaration | `functions` entry |
 * |---|---|---|
 * | authoring | `ManifestSchema` + the stack's collections | anything the author writes |
 * | in-memory assembled | {@link AssembledPackageBodySchema} | a live callable, or lowered |
 * | on-disk artifact | {@link ArtifactStagePackageBodySchema} | lowered ONLY |
 * | registry record | {@link RecordStagePackageBodySchema} | lowered, `handler` optional |
 *
 * The last two are new. They differ from each other in exactly one thing —
 * whether `handler` is required — because that is the whole distance between
 * what `objectstack build` writes (it lowers every callable to a ref) and what
 * `toRecordManifest` projects (it DROPS the callable and mints nothing in its
 * place, which is correct: a ref minted anywhere but `build` is not guaranteed
 * to be the ref `build` mints).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  ArtifactStagePackageBodySchema,
  AssembledPackageBodySchema,
  RecordStagePackageBodySchema,
} from './stack.zod';
import * as Automation from './automation';
import { FlowFunctionLoweredDeclarationSchema } from './automation/flow-function.zod';

/** Does this schema have a JSON Schema form at all? */
const emits = (schema: unknown): boolean => {
  try {
    z.toJSONSchema(schema as never, { io: 'input' } as never);
    return true;
  } catch {
    return false;
  }
};

const shapeKeys = (schema: unknown): string[] =>
  Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();

const IDENTITY = {
  id: 'com.example.stages',
  name: 'Stages',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'stages',
};

const liveCallable = () => 'ran';

/** What a `defineStack()` host hands the load path: the callable is still there. */
const IN_MEMORY_BODY = {
  ...IDENTITY,
  functions: {
    summarizeCompletedTask: liveCallable,
    sweepProjectHealth: { handler: liveCallable, effect: 'writes' as const },
  },
  hooks: [{ name: 'on_insert', object: 'task', events: ['beforeInsert' as const], handler: liveCallable }],
};

/** What `objectstack build` writes into `dist/objectstack.json`: refs only. */
const ARTIFACT_BODY = {
  ...IDENTITY,
  functions: {
    summarizeCompletedTask: 'summarizeCompletedTask',
    sweepProjectHealth: { handler: 'sweepProjectHealth', effect: 'writes' as const },
  },
  hooks: [{ name: 'on_insert', object: 'task', events: ['beforeInsert' as const], handler: 'on_insert' }],
};

/**
 * What `toRecordManifest` leaves behind: each declaration MINUS its callable.
 * The bare entry reaches this shape because `installPackage` normalises it to
 * the declared form first — see `withDeclaredFunctionEntries` in
 * `@objectstack/objectql`'s registry, which is what stops the record
 * under-reporting a package's functions.
 */
const RECORD_BODY = {
  ...IDENTITY,
  functions: {
    summarizeCompletedTask: { effect: 'pure' as const },
    sweepProjectHealth: { effect: 'writes' as const },
  },
  hooks: [{ name: 'on_insert', object: 'task', events: ['beforeInsert' as const] }],
};

describe('#17518 the two JSON stages CONVERT, which is the whole point of declaring them', () => {
  it('both new bodies convert under `z.toJSONSchema` — over the WHOLE body, not two members', () => {
    // Stated over the whole body on purpose: the tax this closes is paid by
    // EMBEDDERS, and an embedder loses its JSON Schema to any one
    // unrepresentable member anywhere beneath it.
    expect(emits(ArtifactStagePackageBodySchema)).toBe(true);
    expect(emits(RecordStagePackageBodySchema)).toBe(true);
  });

  it('CONTROL: the assembled body still does NOT convert, and that is correct', () => {
    // Without this half the pin above could pass while measuring nothing. The
    // assembled body keeps its callables because `composeStacks` really builds
    // one; ⛔ it is not the schema to narrow.
    expect(emits(AssembledPackageBodySchema)).toBe(false);
  });

  it('LIT and DARK controls on the probe itself', () => {
    expect(emits(z.string())).toBe(true);
    expect(emits(z.object({ a: z.function() as never }))).toBe(false);
  });

  it('the lowered declaration is REACHABLE from the `automation` namespace', () => {
    // Step 1 of the ruling, and the reason
    // `unemitted-schemas.baseline.json`'s entry for
    // `Automation.FlowFunctionDeclarationSchema` can say the lowered record
    // 「publishes normally」 without lying: `export *` only re-exports bindings
    // that are already exported, so a module-local const was reachable by
    // nobody.
    expect(Object.keys(Automation)).toContain('FlowFunctionLoweredDeclarationSchema');
    expect(emits(FlowFunctionLoweredDeclarationSchema)).toBe(true);
  });
});

describe('#17518 the three stages have the SAME key set — they narrow, they do not drop', () => {
  it('artifact and record carry every member the assembled body carries', () => {
    const assembled = shapeKeys(AssembledPackageBodySchema);
    expect(shapeKeys(ArtifactStagePackageBodySchema)).toEqual(assembled);
    expect(shapeKeys(RecordStagePackageBodySchema)).toEqual(assembled);
    // Anti-vacuity: the body really is the wide one, not an empty shape.
    expect(assembled.length).toBeGreaterThan(40);
  });

  it('exactly `functions` and `hooks` are the members with no JSON form', () => {
    // The set the two JSON stages have to re-declare is MEASURED, never
    // hand-picked. A new collection with no JSON form reddens HERE, naming
    // itself, instead of silently unpublishing the read-API responses.
    const shape = (AssembledPackageBodySchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape).filter((k) => !emits(shape[k])).sort()).toEqual(['functions', 'hooks']);
  });

  it('the JSON stages\' ARRAY member declares the same keys as the authoring one', () => {
    // `functions`' array member is declared INLINE inside the assembled body's
    // own shape, and narrowing it in place is the one thing this pair may not
    // do — so the JSON stages transcribe it. This is the drift guard that
    // transcription owes: a key added to the authoring array entry and not to
    // the lowered one reddens by name.
    const arrayEntryKeys = (body: unknown): string[] => {
      const functions = (body as { shape: Record<string, { def: { innerType: unknown } }> }).shape.functions;
      const union = (functions as unknown as { def: { innerType: { def: { options: unknown[] } } } }).def.innerType;
      const arrayMember = union.def.options.find(
        (option) => (option as { def: { type: string } }).def.type === 'array',
      );
      const element = (arrayMember as { def: { element: unknown } }).def.element;
      return Object.keys((element as { shape: Record<string, unknown> }).shape).sort();
    };
    const authored = arrayEntryKeys(AssembledPackageBodySchema);
    expect(authored).toEqual(['effect', 'handler', 'name', 'packageId']);
    expect(arrayEntryKeys(ArtifactStagePackageBodySchema)).toEqual(authored);
    expect(arrayEntryKeys(RecordStagePackageBodySchema)).toEqual(authored);
  });
});

describe('#17518 each stage accepts ITS OWN payload and refuses the neighbouring ones', () => {
  it('assembled accepts the live composed body; both JSON stages refuse it', () => {
    expect(AssembledPackageBodySchema.safeParse(IN_MEMORY_BODY).success).toBe(true);
    expect(ArtifactStagePackageBodySchema.safeParse(IN_MEMORY_BODY).success).toBe(false);
    expect(RecordStagePackageBodySchema.safeParse(IN_MEMORY_BODY).success).toBe(false);
  });

  it('artifact accepts what `objectstack build` writes — BOTH lowered spellings', () => {
    // `build` emits `{ myFn: 'myFn' }` for a bare entry and
    // `{ myFn: { handler: 'myFn', effect } }` for a declared one, so a stage
    // admitting only the record form would refuse artifacts this repo writes.
    expect(ArtifactStagePackageBodySchema.safeParse(ARTIFACT_BODY).success).toBe(true);
    expect(RecordStagePackageBodySchema.safeParse(ARTIFACT_BODY).success).toBe(true);
  });

  it('record accepts the handler-less declaration; ⛔ the ARTIFACT stage refuses it', () => {
    // This asymmetry IS the fourth stage. An artifact always has a ref, because
    // `build` mints one; a record never does, because the projection drops the
    // callable and the registry ⛔ mints nothing.
    expect(RecordStagePackageBodySchema.safeParse(RECORD_BODY).success).toBe(true);
    expect(ArtifactStagePackageBodySchema.safeParse(RECORD_BODY).success).toBe(false);
  });

  it('⛔ neither JSON stage became tolerant — globs and unknown keys are still refused', () => {
    // The two keys moved from `unknown` (accepts anything) to a declaration.
    // ⛔ Nothing else moved, and this is where a future widening reddens.
    for (const schema of [ArtifactStagePackageBodySchema, RecordStagePackageBodySchema]) {
      expect(schema.safeParse({ ...IDENTITY, objects: ['./src/*.object.yml'] }).success).toBe(false);
      expect(schema.safeParse({ ...IDENTITY, namesapce: 'typo' }).success).toBe(false);
      expect(schema.safeParse({ ...IDENTITY, functions: { f: liveCallable } }).success).toBe(false);
      expect(schema.safeParse({ ...IDENTITY, hooks: [{ name: 'h', object: 'task', events: ['beforeInsert'], handler: liveCallable }] }).success).toBe(false);
    }
  });
});

describe('#17518 `effect` is READ off the declaration schema, never minted here', () => {
  it('a lowered entry with no `effect` materialises the declaration default', () => {
    // `FlowFunctionDeclarationSchema.effect` is
    // `FlowFunctionEffectSchema.default(DEFAULT_FLOW_FUNCTION_EFFECT)` — a
    // DEFAULT, not a requirement — and both JSON stages inherit that by
    // deriving from it rather than restating it.
    const parsed = ArtifactStagePackageBodySchema.parse({
      ...IDENTITY,
      functions: { probeSweep: { handler: 'probeSweep' } },
    }) as { functions: Record<string, { effect: string }> };
    expect(parsed.functions.probeSweep.effect).toBe('pure');
  });

  it('the ARRAY member states no default, so nothing is written where none is declared', () => {
    const parsed = ArtifactStagePackageBodySchema.parse({
      ...IDENTITY,
      functions: [{ name: 'probeSweep', handler: 'probeSweep' }],
    }) as { functions: Array<Record<string, unknown>> };
    expect('effect' in parsed.functions[0]).toBe(false);
  });

  it('a misspelled `effect` is still refused by name on the lowered record', () => {
    // The strictness travels with the derivation: the lowered form is
    // `FlowFunctionDeclarationSchema.extend(...)`, so it keeps the named
    // surface and the `` `efect` → `effect` `` prescription.
    const verdict = ArtifactStagePackageBodySchema.safeParse({
      ...IDENTITY,
      functions: { probeSweep: { handler: 'probeSweep', efect: 'writes' } },
    });
    expect(verdict.success).toBe(false);
  });
});

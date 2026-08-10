// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A stand-in for `objectstack build`, for fixtures that need "the stack as a
// deployment receives it" (#6293).
//
// ## The trap this exists to close
//
// A fixture that wants a built-shaped artifact reaches for the one line that
// looks like the build — `JSON.stringify(stack)` — and gets something that is
// only half of it, in the half that is silent:
//
//   bare callable      `fn: () => …`               → **key omitted entirely**
//   declared callable  `{ handler: fn, effect }`   → `{ effect }`, a headless husk
//
// Measured on the showcase, whose `functions:` block holds one of each:
//
//   JSON.parse(JSON.stringify(showcaseStack)).functions
//     === { sweepProjectHealth: { effect: 'writes' } }
//
// The declared entry made a noise ONCE, on the path where the residue is fed
// straight to the parse: `FlowFunctionEntrySchema` refuses an entry declaring an
// effect for a function it does not carry, and that red CI job is the only
// reason anybody learned about this (#4976). Putting the same husk back through
// the lowering used to silence even that — the map branch deleted the entry
// before the schema saw it — until #7318 taught the lowering to hand an
// unrecognised entry on unchanged, so the refusal now happens on both paths.
// The BARE entry still makes no noise anywhere: it vanishes key and all before
// this module is ever called, the artifact holds `functions: {}`, and the
// fixture parses green carrying zero of what it advertises.
// `showcase-declarative-endpoints.dogfood.test.ts` shipped exactly that for its
// whole existence. AGENTS.md, "Absence must be loud": a verifier that silently
// degrades is worse than no verifier.
//
// ## What this module does instead
//
// It runs the REAL pipeline `packages/cli/src/commands/compile.ts` runs, in the
// same order, reusing the same functions — `normalizeStackInput` →
// `lowerCallables` → `ObjectStackDefinitionSchema` → `JSON.stringify`. It does
// not re-implement the lowering: a second copy of it would agree with the build
// only by re-derivation, which is the very failure this file is named after.
//
// ## What it deliberately does NOT do, and why
//
// Two things the real build writes are not pure functions of the stack, so they
// are out of reach here and stated rather than faked:
//
//   `docs`          collected by `collectAndLintDocs` from the package's
//                   `src/docs/` directory — filesystem input, not stack input.
//   `runtimeModule` the esbuild-emitted `objectstack-runtime.{hash}.mjs` sibling
//                   and its hash. The callables themselves ARE returned here as
//                   `functions` (ref → fn), which is that module's content; what
//                   is missing is the bundling, not the mapping.
//
// Measured against a real `objectstack build` of `examples/app-showcase`
// (2026-08-10): the output of this module is byte-identical to
// `examples/app-showcase/dist/objectstack.json` for every top-level collection
// except those two keys, and two `plugins[]` entries whose options carry
// absolute paths baked in from the cwd of whichever process imported the config.
//
// ## Loudness
//
// Every callable the input carries must come out the other side as a string
// ref, or this throws. It cannot detect a callable the CALLER already lost
// (an input that was itself `JSON.stringify`-ed has nothing left to notice) —
// so a fixture that cares which callables reach its artifact must still ASSERT
// them by name. `showcase-declarative-endpoints.dogfood.test.ts` does.

import { writeFileSync } from 'node:fs';

import { normalizeStackInput, ObjectStackDefinitionSchema } from '@objectstack/spec';
// The lowering itself, not a copy of it. `@objectstack/cli` declares no
// `exports` map, so this deep path is an ordinary internal import into a
// PRIVATE package — no published surface is added or widened by it (#6293's
// ruling: reach the goal without growing `@objectstack/cli`'s public entry).
import { lowerCallables } from '@objectstack/cli/dist/utils/lower-callables.js';

type AnyFn = (...args: unknown[]) => unknown;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface BuildShapedArtifact {
  /** The JSON-safe artifact, as `objectstack build` would write it. */
  artifact: Record<string, unknown>;
  /** ref → the original callable. This is what the sibling `.mjs` bundle holds. */
  functions: Record<string, AnyFn>;
  /** Every ref the lowering minted, sorted. */
  refs: string[];
}

/**
 * Every slot in a stack where `lowerCallables` binds a callable, as a
 * human-readable address (`functions.sweepProjectHealth`, `hooks[2].handler`, …).
 *
 * This is a list of PLACES, deliberately not a second implementation of the
 * lowering — its only job is to disagree out loud. The count it produces is
 * reconciled against `lowering.count` below, in BOTH directions, so a lowering
 * that grows a slot this walk cannot see fails here rather than shipping a
 * stand-in that quietly represents less than the build does.
 */
function callableSlots(stack: Record<string, unknown>): string[] {
  const slots: string[] = [];

  if (Array.isArray(stack.hooks)) {
    stack.hooks.forEach((hook, i) => {
      if (isPlainObject(hook) && typeof hook.handler === 'function') slots.push(`hooks[${i}].handler`);
    });
  }

  const pushActions = (actions: unknown, label: string) => {
    if (!Array.isArray(actions)) return;
    actions.forEach((action, i) => {
      // `target` is the ONLY handler slot; a function on the removed `execute`
      // alias is left for the parse to reject by name (#3855), and the lowering
      // leaves it alone too — so it must not be counted here either.
      if (isPlainObject(action) && typeof action.target === 'function') slots.push(`${label}[${i}].target`);
    });
  };
  pushActions(stack.actions, 'actions');
  if (Array.isArray(stack.objects)) {
    stack.objects.forEach((obj, i) => {
      if (isPlainObject(obj)) pushActions(obj.actions, `objects[${i}].actions`);
    });
  }

  const fns = stack.functions;
  if (Array.isArray(fns)) {
    fns.forEach((entry, i) => {
      if (isPlainObject(entry) && typeof entry.handler === 'function') slots.push(`functions[${i}].handler`);
    });
  } else if (isPlainObject(fns)) {
    for (const [key, value] of Object.entries(fns)) {
      if (typeof value === 'function') slots.push(`functions.${key}`);
      else if (isPlainObject(value) && typeof value.handler === 'function') slots.push(`functions.${key}.handler`);
    }
  }

  return slots;
}

/** Anything still function-valued after the lowering can never survive JSON. */
function survivingCallables(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'function') {
    out.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => survivingCallables(v, `${path}[${i}]`, out));
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) survivingCallables(v, `${path}.${k}`, out);
  }
}

/**
 * Lower, validate and serialize `stack` the way `objectstack build` does.
 *
 * Throws — loudly, naming what went missing — rather than returning a
 * degraded artifact.
 */
export function buildShapedArtifact(stack: Record<string, unknown>): BuildShapedArtifact {
  const normalized = normalizeStackInput(stack);
  const expected = callableSlots(normalized);

  const lowering = lowerCallables(normalized);

  if (lowering.count !== expected.length) {
    throw new Error(
      `build-shaped artifact: the lowering bound ${lowering.count} callable(s) but this stack ` +
        `declares ${expected.length} (${expected.join(', ') || 'none'}). Either a callable was ` +
        `dropped, or \`lowerCallables\` grew a slot \`callableSlots\` in ` +
        `packages/qa/dogfood/test/build-shaped-artifact.ts does not know about — fix the walk, ` +
        `never the assertion (#6293).`,
    );
  }

  // Key-for-key on the `functions` MAP. This was the live gate until #7318: the
  // lowering rebuilt the map and admitted an entry only in the three shapes it
  // knew (a callable, `{ handler: callable }`, a string ref), dropping anything
  // else — no error, no warning, no key. Measured on this exact stack then:
  // hand the lowering the `{ effect: 'writes' }` husk `JSON.stringify` leaves
  // behind and the artifact came out `functions: {}`, parsing green, which is
  // the #6293 failure wearing a different hat; the parse below could not see it,
  // because by the time it ran the evidence had been deleted.
  //
  // The producer was fixed at the source — an entry `lowerCallables` does not
  // recognise now rides through under its own key and the parse below refuses
  // it by name — so this check no longer has anything to catch on that path.
  // It is KEPT as the backstop it always was: it is the only assertion that
  // reconciles the input's `functions` keys against the output's, so a future
  // lowering that starts deleting again fails here, named, instead of shrinking
  // this stand-in in silence.
  const inputFns = normalized.functions;
  if (isPlainObject(inputFns)) {
    const kept = new Set(Object.keys((lowering.lowered.functions ?? {}) as Record<string, unknown>));
    const refs = Object.keys(lowering.functions);
    const dropped = Object.keys(inputFns).filter(
      (k) => !kept.has(k) && !refs.some((r) => r === k || r.startsWith(`${k}__`)),
    );
    if (dropped.length > 0) {
      throw new Error(
        `build-shaped artifact: the lowering dropped ${dropped.length} \`functions\` entr(ies) ` +
          `without a sound — ${dropped.join(', ')}. An entry it does not recognise is deleted ` +
          `rather than handed to the schema, so the artifact would parse green carrying nothing ` +
          `where these were. Most likely the entry is a headless husk (an object with an effect ` +
          `and no handler), which is what a plain \`JSON.stringify\` of the stack leaves (#6293).`,
      );
    }
  }

  // The build refuses to EMIT an artifact that does not parse, so this stand-in
  // must refuse too — otherwise a fixture learns about a malformed stack deep
  // inside a boot, or not at all.
  const parsed = ObjectStackDefinitionSchema.safeParse(lowering.lowered);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `build-shaped artifact: the lowered stack does not satisfy ObjectStackDefinitionSchema, so ` +
        `\`objectstack build\` would refuse to write it:\n${issues}`,
    );
  }

  // Last gate, and the one that needs no list of slots: NOTHING that reaches
  // the artifact may still be a function, because `JSON.stringify` is the very
  // next step and it removes those without a sound.
  //
  // `plugins` is the one exemption, and it is a measured one rather than a
  // convenience. That array holds live plugin INSTANCES whose methods are own
  // properties (28 of them on the showcase), and what a real
  // `dist/objectstack.json` carries for each is the data-only descriptor —
  // `{ name, version, options, … }`, methods gone. The drop there is the
  // build's own behaviour, not a loss, so flagging it would make this gate cry
  // wolf on every stack that composes a plugin, and a gate that cries wolf gets
  // deleted by the next reader.
  const leftover: string[] = [];
  for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (key === 'plugins') continue;
    survivingCallables(value, `<artifact>.${key}`, leftover);
  }
  if (leftover.length > 0) {
    throw new Error(
      `build-shaped artifact: ${leftover.length} value(s) are still functions after lowering and ` +
        `would be dropped by JSON.stringify without a sound: ${leftover.join(', ')} (#6293).`,
    );
  }

  const artifact = JSON.parse(JSON.stringify(parsed.data)) as Record<string, unknown>;
  return { artifact, functions: lowering.functions, refs: Object.keys(lowering.functions).sort() };
}

/** {@link buildShapedArtifact}, written to `filePath` as the build writes it. */
export function writeBuildShapedArtifact(
  stack: Record<string, unknown>,
  filePath: string,
): BuildShapedArtifact {
  const result = buildShapedArtifact(stack);
  writeFileSync(filePath, JSON.stringify(result.artifact, null, 2));
  return result;
}

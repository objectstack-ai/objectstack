// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20158] The CLI door's engine judge — the ENGINE's own filter admission,
 * built from the stack's own objects, handed to the shared authoring rules.
 *
 * ## Why an engine, and why no driver
 *
 * `validateRlsPredicateEnforceability` (`@objectstack/lint`) judges every
 * read-scope RLS `using` with `IObjectQLEngine.judgeFilter` (ADR-0058 D2,
 * #19995 ruling C). At the runtime publish gate that is the live engine's
 * method. `os validate` / `os build` / `os lint` have no live engine, and the
 * rule may not model the engine's walks in its place — so this door builds the
 * engine itself and asks it.
 *
 * It can, because the admission reads nothing a driver or a kernel supplies:
 * `judgeFilter` runs the engine's `where` admission against the `where`, the
 * registry's field map and the context, and stops before any driver is
 * resolved. Measured on #20158: an `ObjectQL` constructed with no driver and no
 * kernel, the stack's objects registered through its own registry, answered
 * every class the runtime engine answers — including the registry-injected
 * system columns (`created_at` compared against an unreadable value is refused
 * here exactly as it is there), because registration is the registry's own
 * code path, `applySystemFields` included.
 *
 * ## What it answers for an object it does not know
 *
 * The engine's own answer: for an object its registry does not hold, the
 * field-map doors answer nothing and the schema-free doors (placeholders,
 * comparand shape) still judge. Two populations get that answer here and a
 * fuller one at runtime, where the live registry holds the whole universe:
 * an object another package or the platform defines, and an object the
 * registry itself refuses to register (a field type it rejects, a name
 * collision) — refused at boot by that same registry, and simply not
 * registered here rather than turned into a verdict this door invents.
 *
 * ## Cost
 *
 * Built on the FIRST judgement and reused after it, so a stack that declares no
 * read-scope RLS policy never constructs an engine at all. The objects are
 * COPIED before registration: `registerObject` stamps `name` onto nameless
 * field entries, and the rules that run after this one read the same stack.
 */

import { createLogger } from '@objectstack/core';
import type { AuthoringRuleContext } from '@objectstack/lint';
import { ObjectQL } from '@objectstack/objectql';

type AnyRec = Record<string, unknown>;

/** The engine's judge-only filter admission, as the rules take it. */
type FilterJudge = NonNullable<AuthoringRuleContext['judgeFilter']>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The stack's object declarations, from either spelling a stack carries: the
 * array, or the name-keyed map (whose key is the name when the entry omits it).
 */
function objectsOf(value: unknown): AnyRec[] {
  if (Array.isArray(value)) return value.filter(isRec);
  if (!isRec(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, AnyRec] => isRec(entry[1]))
    .map(([key, obj]) => (typeof obj.name === 'string' && obj.name ? obj : { ...obj, name: key }));
}

/** A copy registration may stamp without touching the stack the other rules read. */
function registrationCopy(obj: AnyRec): AnyRec {
  if (!isRec(obj.fields)) return { ...obj };
  const fields: AnyRec = {};
  for (const [key, def] of Object.entries(obj.fields)) fields[key] = isRec(def) ? { ...def } : def;
  return { ...obj, fields };
}

/**
 * The judge for `stack`: `ObjectQL.judgeFilter`, bound to a driverless engine
 * whose registry holds the stack's objects. Hand it to `runAuthoringRules` /
 * `runPerPackageAuthoringRules` as `judgeFilter`.
 */
export function stackFilterJudge(stack: AnyRec): FilterJudge {
  let engine: ObjectQL | undefined;
  const build = (): ObjectQL => {
    const ql = new ObjectQL({ logger: createLogger({ level: 'silent' }) });
    // The registry's own housekeeping log ("Registered object: …") is for a
    // booting server, not for an authoring command's output.
    ql.registry.logLevel = 'silent';
    for (const obj of objectsOf(stack.objects)) {
      try {
        ql.registerObject(registrationCopy(obj) as Parameters<ObjectQL['registerObject']>[0]);
      } catch {
        // Refused by the registry — see the header: that object gets the
        // engine's unknown-object answer, never a verdict made up here.
      }
    }
    return ql;
  };
  return (objectName, where, options) => (engine ??= build()).judgeFilter(objectName, where, options);
}

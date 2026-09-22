// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';

import { AssignmentConfigSchema } from '../automation/builtin-node-config.zod';

/**
 * A VERSION FLOOR pin on zod's three error formatters — `treeifyError`,
 * `formatError` (`error.format()`) and `flattenError` (`error.flatten()`).
 *
 * Unlike `record-proto-key-guard.test.ts` next door, which pins the BEHAVIOUR
 * of our own guards and is deliberately version-agnostic, this file exists to
 * fail on a zod below the fixed line. It is the regression pin for the bump
 * away from 4.4.3, and it is the only thing in the tree that notices a
 * downgrade.
 *
 * ## The defect it pins (measured on zod 4.4.3, both directions)
 *
 * All three formatters walked an issue's `path` by reading `curr[el]` and
 * testing it for truthiness (`curr[el] = curr[el] || {...}`, or `??=`) before
 * creating a node. A path element naming a member of `Object.prototype` is
 * therefore answered BY THE PROTOTYPE, and no node is ever created. Two
 * distinct failure modes follow, and they need separate assertions because
 * they present in opposite ways:
 *
 *   - TERMINAL element (`['assignments','__proto__']`, `['x','toString']`):
 *     the inherited member — a function — is adopted as the node, and the very
 *     next statement does `node._errors.push(...)` on it. It CRASHES:
 *     `TypeError: Cannot read properties of undefined (reading 'push')`.
 *
 *   - NON-TERMINAL element (`['__proto__','anything']`): the walk continues
 *     INTO `Object.prototype` and writes the next segment onto it. The
 *     refusal message is silently lost from the returned tree, and the process
 *     gets a global prototype key it never asked for. Nothing throws, nothing
 *     logs; the caller renders an empty error list for a document that was
 *     refused. This is the mode nothing else in the tree would catch.
 *
 * 4.6.1 fixed it with a `node()` helper that guards the read with
 * `Object.prototype.hasOwnProperty.call(obj, key)` and creates a `__proto__`
 * node through `Object.defineProperty` (a bare assignment would hit the
 * prototype SETTER instead of creating an own key).
 *
 * ## Why this repo is exposed, and not hypothetically
 *
 * The landed `__proto__` refusals (#17852 / #18847 / #19151) exist precisely
 * because zod's open-key branches silently DROP a `__proto__` key. Those
 * guards turned a silent drop into a loud refusal — and the loud refusal's
 * issue path is `['assignments','__proto__']`, which is exactly the terminal
 * shape the formatters crashed on. A consumer that formatted our own refusal
 * crashed on it. The first test below drives that real schema rather than a
 * modelled one.
 *
 * ## Reading these assertions
 *
 * Every lookup of a prototype-member key goes through {@link ownValue}, never
 * `node.__proto__` or `node[key]`: on a bare read `node.__proto__` is answered
 * by the prototype accessor and `node.toString` by the inherited function, so
 * a plain read cannot tell "the formatter created this node" from "JavaScript
 * answered from the prototype" — which is the very confusion the defect is
 * made of. `getOwnPropertyDescriptor` asks the only question that
 * discriminates: is there an OWN key here?
 */

/** The refusal message the process must never be able to invent on its own. */
const MESSAGE = 'pin: the refusal text that must survive formatting';

/**
 * Keys these tests would see appear on `Object.prototype` under the defect.
 * Cleaned after every test so one failure cannot cascade into the next file.
 */
const CANARY_KEYS = ['polluted', '_errors', 'errors'] as const;

afterEach(() => {
  for (const key of CANARY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(Object.prototype, key)) {
      delete (Object.prototype as Record<string, unknown>)[key];
    }
  }
});

/**
 * Read `key` as an OWN property of `node`, or `undefined` if it is not one.
 *
 * @param node - the formatter output node to read.
 * @param key - the path element, including one naming an `Object.prototype`
 *   member.
 * @returns the own value, never an inherited one.
 */
function ownValue(node: unknown, key: string): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  return Object.getOwnPropertyDescriptor(node, key)?.value;
}

/** Own keys `Object.prototype` did not have before the formatters ran. */
function prototypePollution(): string[] {
  return CANARY_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(Object.prototype, key),
  );
}

/** A `ZodError` carrying exactly one issue at `path`, for path shapes no landed schema emits yet. */
function errorAtPath(path: (string | number)[]): z.ZodError {
  return new z.ZodError([{ code: 'custom', path, message: MESSAGE, input: undefined }]);
}

describe("zod renders a refusal whose path names an Object.prototype member (the bump's regression pin)", () => {
  it("formats the repo's OWN landed `__proto__` refusal instead of crashing on it", () => {
    // `JSON.parse` is what makes `__proto__` an own enumerable key — an object
    // literal's `{ __proto__: ... }` sets the actual prototype instead, and the
    // guard would never see a key at all.
    const config = JSON.parse('{"assignments":{"__proto__":"x"}}') as unknown;

    const result = AssignmentConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (result.success) return;

    // The shape this pin exists for: a TERMINAL `__proto__`, emitted by a
    // guard that is live in this package today.
    const [issue] = result.error.issues;
    expect(issue.path).toEqual(['assignments', '__proto__']);
    const refusal = issue.message;
    expect(refusal).toContain('__proto__');

    // Each of the three formatters must RETURN, and must carry the refusal at
    // the path the issue named. On 4.4.3 every one of these three throws
    // `TypeError: Cannot read properties of undefined (reading 'push')`.
    const tree = z.treeifyError(result.error);
    const assignments = ownValue(tree.properties, 'assignments');
    expect(ownValue(ownValue(assignments, 'properties'), '__proto__')).toEqual({
      errors: [refusal],
    });

    const formatted = result.error.format();
    expect(ownValue(ownValue(formatted, 'assignments'), '__proto__')).toEqual({
      _errors: [refusal],
    });

    const flattened = result.error.flatten();
    expect(ownValue(flattened.fieldErrors, 'assignments')).toEqual([refusal]);

    expect(prototypePollution()).toEqual([]);
  });

  it('keeps the message and leaves `Object.prototype` alone on a NON-TERMINAL `__proto__` — the silent mode', () => {
    // The mode with no crash to notice: on 4.4.3 the walk steps INTO
    // `Object.prototype`, writes `polluted` onto it, and returns a tree with
    // the refusal missing. Both halves are asserted, because a fix that
    // stopped the pollution while still dropping the message would be no fix.
    const error = errorAtPath(['__proto__', 'polluted']);

    const tree = z.treeifyError(error);
    const treeNode = ownValue(tree.properties, '__proto__');
    expect(ownValue(ownValue(treeNode, 'properties'), 'polluted')).toEqual({
      errors: [MESSAGE],
    });

    const formatted = z.formatError(error);
    const formattedNode = ownValue(formatted, '__proto__');
    expect(ownValue(formattedNode, 'polluted')).toEqual({ _errors: [MESSAGE] });

    expect(prototypePollution()).toEqual([]);
  });

  it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty'])(
    'formats a terminal path element named `%s` as an own key',
    (member) => {
      const error = errorAtPath(['config', member]);

      const tree = z.treeifyError(error);
      const treeParent = ownValue(tree.properties, 'config');
      expect(ownValue(ownValue(treeParent, 'properties'), member)).toEqual({
        errors: [MESSAGE],
      });

      const formatted = z.formatError(error);
      expect(ownValue(ownValue(formatted, 'config'), member)).toEqual({
        _errors: [MESSAGE],
      });

      // `flattenError` reads only the FIRST path element, so it is pinned on a
      // single-element path rather than through `config` above.
      const flattened = z.flattenError(errorAtPath([member]));
      expect(ownValue(flattened.fieldErrors, member)).toEqual([MESSAGE]);

      expect(prototypePollution()).toEqual([]);
    },
  );

  it('positive control — an ORDINARY path renders the same way, so the assertions above are not vacuous', () => {
    // Every assertion in this file is `ownValue(...) === {errors:[MESSAGE]}`.
    // If that spelling were simply wrong, the tests would fail for a reason
    // having nothing to do with zod's version. This leg proves the spelling
    // reads a real formatter node on a path the defect never touched.
    const error = errorAtPath(['assignments', 'ordinary']);

    const tree = z.treeifyError(error);
    const parent = ownValue(tree.properties, 'assignments');
    expect(ownValue(ownValue(parent, 'properties'), 'ordinary')).toEqual({
      errors: [MESSAGE],
    });

    expect(z.formatError(error)).toMatchObject({
      assignments: { ordinary: { _errors: [MESSAGE] } },
    });
    expect(z.flattenError(errorAtPath(['ordinary'])).fieldErrors).toEqual({
      ordinary: [MESSAGE],
    });
  });
});

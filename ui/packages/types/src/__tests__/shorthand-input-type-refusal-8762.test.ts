/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `inputType` is refused BY NAME on the `email` / `password` shorthands, and the
 * neighbour that HONOURS the key still parses (objectui#8762).
 *
 * ## The defect
 *
 * `packages/components/src/renderers/form/input.tsx` registers both shorthands by
 * wrapping the `input` renderer and spreading its own `inputType` LAST, so an
 * authored value is overwritten before the renderer reads it. objectui#8499 gave
 * the arm its declared face with the key OMITTED, and recorded that omission is
 * not refusal while `BaseSchema` is `.passthrough()`. Measured on this card's base
 * (681d3f10e) before the change:
 *
 *     ACCEPT  { type: 'password', inputType: 'text' }   parsed data KEPT inputType: 'text'
 *     ACCEPT  { type: 'input',    inputType: 'text' }   <- the control, where the key IS read
 *
 *     DOM     { type: 'password', inputType: 'text' } -> <input type="password">   DISCARDED
 *     DOM     { type: 'input',    inputType: 'text' } -> <input type="text">       HONOURED
 *
 * So the author wrote a key, every check passed, and the runtime threw the value
 * away — the class-(c) trap. This file pins the repair and, just as importantly,
 * the CONTROL: a narrowing with nothing proving the neighbour still parses is not
 * a measurement.
 *
 * ## What is deliberately NOT pinned here
 *
 * ⛔ Not the wrapper's precedence being flipped so the author wins — that would
 * render `{ type: 'password', inputType: 'text' }` as an UNMASKED field under a
 * `password` key, which is worse than refusing it. The runtime half of the
 * evidence (both precedences, in the DOM) lives beside the renderer, in
 * `packages/components/src/renderers/form/__tests__/shorthand-input-type-discarded-8762.test.tsx`;
 * this package cannot render React.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { AnyComponentSchema } from '../zod/index.zod.js';
import { InputSchema, InputShorthandSchema } from '../zod/form.zod.js';

// Root the file reads on THIS FILE, never on `process.cwd()` — the two test
// invocation forms give cwd two different values (AGENTS.md §怎么跑测试).
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const INPUT_RENDERER = 'packages/components/src/renderers/form/input.tsx';
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

/** The `type` literals a schema declares to Zod's discriminator dispatch. */
function literalsOf(schema: unknown): string[] {
  const values = (schema as { _zod?: { propValues?: { type?: Set<string> } } })._zod?.propValues
    ?.type;
  return values === undefined ? [] : [...values];
}

const SHORTHANDS = ['email', 'password'] as const;

function issuesFor(doc: unknown, schema: z.ZodType = AnyComponentSchema) {
  const result = schema.safeParse(doc);
  return result.success ? [] : result.error.issues;
}

describe('objectui#8762 — the shorthands refuse `inputType` BY NAME', () => {
  it.each(SHORTHANDS)('refuses `inputType` on `%s` at the document root', (type) => {
    const issues = issuesFor({ type, inputType: 'text' });
    expect(issues.length, 'the trap still parses green').toBeGreaterThan(0);
    // BY NAME: the issue is addressed at the key's own path, so a consumer that
    // reports paths blames `inputType` and nothing else.
    const own = issues.filter((i) => i.path.join('.') === 'inputType');
    expect(own.length, JSON.stringify(issues)).toBe(1);
    expect(own[0].code).toBe('invalid_type');
    // WITH GUIDANCE: and the guidance names the spelling that IS honoured. A
    // refusal that only says "invalid" sends the author to delete the node.
    expect(own[0].message).toContain('`inputType`');
    expect(own[0].message).toContain('{ "type": "input", "inputType": "email" }');
  });

  it.each(SHORTHANDS)('refuses it nested at a declared node slot too, on `%s`', (type) => {
    // objectui#8344 pointed the node recursion point at this union, so a nested
    // node is judged by its own component schema. A root-only refusal would leave
    // every real document — where inputs live inside a form or a stack — untouched.
    expect(issuesFor({ type: 'div', children: [{ type, inputType: 'text' }] }).length)
      .toBeGreaterThan(0);
  });

  it('refuses it on the arm read directly, not only through the union', () => {
    const issues = issuesFor({ type: 'password', inputType: 'text' }, InputShorthandSchema);
    expect(issues.map((i) => i.path.join('.'))).toEqual(['inputType']);
  });

  it('feeds ONE string into both author-facing channels', () => {
    // The `./zod/tombstone.zod.ts` discipline: the parse-time message and the
    // `.describe()` metadata generated docs publish cannot drift apart, because
    // there is only one string. Compared here rather than asserted separately.
    const described = (InputShorthandSchema.shape.inputType as z.ZodType).description;
    const parseMessage = issuesFor({ type: 'password', inputType: 'text' }, InputShorthandSchema)[0]
      ?.message;
    expect(described, 'the member lost its `.describe()`').toBeTruthy();
    expect(parseMessage).toBe(described);
  });

  it('addresses the author it is actually addressed to — the message keeps its FIELD carve-out', () => {
    // A form FIELD is a different position with the OPPOSITE precedence
    // (`renderers/form/form.tsx`: `inputType || NATIVE_INPUT_FIELD_TYPES[…]`), and
    // this refusal does not reach there. Without the sentence, an author who meets
    // this message while looking at `fields: [{ type: 'email', inputType: 'text' }]`
    // is told their working document is wrong. Pinned because it is a claim about
    // a surface this file does not otherwise touch.
    const described = (InputShorthandSchema.shape.inputType as z.ZodType).description ?? '';
    expect(described).toContain('form FIELD');
    expect(described).toContain('fields:');
  });
});

describe('objectui#8762 — the controls that keep the narrowing honest', () => {
  it('the neighbour that HONOURS `inputType` still parses', () => {
    // ⭐ THE FIRING CONTROL. `input` is where the key is read, and it must be
    // untouched — a narrowing that also broke the spelling the guidance points at
    // would be worse than the defect.
    for (const inputType of ['text', 'email', 'password']) {
      expect(issuesFor({ type: 'input', inputType }), `input/${inputType}`).toEqual([]);
      expect(issuesFor({ type: 'input', inputType }, InputSchema), `input/${inputType}`).toEqual([]);
    }
  });

  it.each(SHORTHANDS)('`%s` without `inputType` is untouched', (type) => {
    expect(issuesFor({ type })).toEqual([]);
    expect(issuesFor({ type, label: 'X', name: 'x', required: true, placeholder: 'p' })).toEqual([]);
    expect(issuesFor({ type: 'div', children: [{ type }] })).toEqual([]);
  });

  it.each(SHORTHANDS)('`%s` still JUDGES its other values — this is not a dead arm', (type) => {
    // An arm that refused one key and validated nothing else would satisfy every
    // assertion above. One green reading and one red reading on the same key.
    expect(issuesFor({ type, required: true })).toEqual([]);
    expect(issuesFor({ type, required: 'yes' }).length).toBeGreaterThan(0);
  });

  it('`BaseSchema` is still passthrough — so this is a DECLARED refusal, not strictness', () => {
    // The premise the repair rests on, re-measured rather than inherited: if the
    // base had become strict, every undeclared key would already be refused and
    // this arm would be solving a problem that had moved. It has not — an
    // undeclared key still rides through on the very same document.
    expect(issuesFor({ type: 'password', zzzUndeclaredKey: 1 })).toEqual([]);
    expect(issuesFor({ type: 'input', zzzUndeclaredKey: 1 })).toEqual([]);
  });

  it('stays representable as JSON Schema, and does not make the arm any less so', () => {
    // Why the `z.never` primitive and not `z.custom`: `z.toJSONSchema` THROWS on
    // a `z.custom` arm and represents a `z.never` arm as `{ not: {} }` carrying
    // the description — the reading `aliasKeyRefusal`'s docblock records. The
    // docs surface is generated from these schemas.
    const alone = z.toJSONSchema(InputShorthandSchema.shape.inputType as z.ZodType, {
      io: 'input',
    }) as { not?: unknown; description?: string };
    expect(alone.not, 'the member stopped converting on its own').toEqual({});
    expect(alone.description).toContain('objectui#8762');

    // ⚠️ MEASURED, not assumed, and it corrected this file's first draft: the
    // WHOLE arm does not convert under bare options, and did not before this card
    // either. `InputSchema` — untouched here — throws the same way, because
    // `handlerKeyRefusal('onChange', …)` is a `z.custom` and `ZodUndefined` has no
    // JSON Schema form. Every live caller in this repo
    // (`app-shell/src/views/metadata-admin/*-schema.ts`) passes
    // `unrepresentable: 'any'`, so this is the reading that describes production.
    const opts = { io: 'input', unrepresentable: 'any' } as const;
    expect(() => z.toJSONSchema(InputSchema, opts)).not.toThrow();
    const json = z.toJSONSchema(InputShorthandSchema, opts) as {
      properties?: Record<string, { description?: string }>;
    };
    expect(json.properties?.inputType?.description).toContain('objectui#8762');
  });
});

describe('objectui#8762 — ONE rule, and the next shorthand cannot slip past it', () => {
  it('the refusal is one member on one arm, covering every literal the arm claims', () => {
    // Not an enumeration: `InputShorthandSchema` is a single arm over a `type`
    // enum, so a literal added to that enum inherits the refusal with no second
    // edit. That is what makes a future sibling covered BY CONSTRUCTION.
    expect([...literalsOf(InputShorthandSchema)].sort()).toEqual([...SHORTHANDS].sort());
    expect(Object.keys(InputShorthandSchema.shape)).toContain('inputType');
  });

  it('the arm names exactly the shorthands `input.tsx` registers with a pinned `inputType`', () => {
    // ⭐ THE COMPARISON INSTRUMENT, the shape objectui#8499 established for the
    // two family arms. The two faces can only diverge where nothing compares
    // them: register a third shorthand and forget the enum, and this goes red
    // instead of leaving a literal that renders and validates nowhere.
    const source = read(INPUT_RENDERER);
    const pinned = [
      ...source.matchAll(
        /ComponentRegistry\.register\(\s*'([^']+)'\s*,[\s\S]{0,200}?inputType:\s*'([^']+)'/g,
      ),
    ]
      .filter((m) => m[1] === m[2])
      .map((m) => m[1]);
    // Non-vacuity: a reader that has stopped reading must not be able to pass.
    expect(pinned.length, 'the registration read went vacuous — check `input.tsx`').toBe(2);
    expect([...pinned].sort()).toEqual([...literalsOf(InputShorthandSchema)].sort());
  });

  it('detects a registered-but-unarmed shorthand, and fails closed on an unreadable source', () => {
    // ⚠️ What this control must NOT be: comparing a list against itself plus an
    // element. Both halves below run the REAL reader. `input` is registered in
    // the same file WITHOUT a pinned inputType, so the reader must not pick it up
    // — that is the same instrument answering a case it must exclude.
    const source = read(INPUT_RENDERER);
    const allRegistered = [...source.matchAll(/ComponentRegistry\.register\(\s*'([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(allRegistered.length, 'the registration read went vacuous').toBe(3);
    expect(allRegistered).toContain('input');
    expect([...literalsOf(InputShorthandSchema)]).not.toContain('input');
    // And the reader must throw rather than fabricate a pass when the file moves.
    expect(() => read('packages/components/src/renderers/form/not-a-file.tsx')).toThrow();
  });
});

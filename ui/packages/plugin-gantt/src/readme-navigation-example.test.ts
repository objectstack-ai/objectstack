/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `packages/plugin-gantt/README.md`'s record-navigation example is PARSED by
 * the schema that validates it — `@objectstack/spec`'s `NavigationConfigSchema`
 * (objectui#6050).
 *
 * ## Why this file exists
 *
 * The example documented `{ mode: 'page', basePath: '/console/apps/.../campaign' }`.
 * `basePath` is not a `NavigationConfig` member, and no read site consumes it:
 * `useNavigationOverlay` — where a gantt's `navigation` lands — builds no URL
 * out of the config at all, and `ObjectGantt` calls it with no `onNavigate`, so
 * a page-mode click falls through to the host's `onRowClick`. The destination
 * route was never authorable through that key, by any spelling.
 *
 * That made the snippet worse than inert. `NavigationConfigSchema` is a strict
 * object, so the undeclared key did not fall away quietly — it REJECTED the
 * whole config (`unrecognized_keys`), and the `mode: 'page'` the sentence was
 * actually teaching never took effect. An author copying the documented snippet
 * got a rejected navigation config.
 *
 * It was found exactly this way: objectui#5903's pin test used this README's
 * example verbatim as its "well-typed" fixture, and the fixture failed.
 *
 * ⚠️ The mechanism sentence above is objectui#6050's, and objectui#7334
 * overtook it: `ObjectGantt` now hands the hook its own `onNavigate`, so a
 * `page` click navigates to the record-page address the gantt derives from
 * the page it is on (measured by objectui#11168 slice 4, and pinned in
 * `__tests__/objectGanttInputs-11168.test.tsx`). The conclusion stands: no
 * `navigation` member authors that address, `basePath` included. Since that
 * slice the example is the AUTHORED node, so `navigation` is read from its
 * `properties` bag.
 *
 * ## No gate in this repo can catch it, which is the point
 *
 * `check-doc-snippet-types` compiles `ts`/`tsx` fences and
 * `check-doc-component-types` reads `type` literals; both are structurally
 * blind to a metadata key in a README. That gate's own header names the hole:
 * schema-key validity is "a different question with a different answer …
 * left unruled on purpose". A README example can be rejected by the spec while
 * every gate stays green. This test is the measurement that closes it for this
 * one example.
 *
 * ## The example is EXTRACTED, never retyped
 *
 * The fence is read out of the README on every run and parsed as JSON. A hand
 * copy drifts from the file it claims to pin and therefore pins nothing — a
 * snippet nobody re-measured is the defect this test exists to prevent, so
 * reproducing it inside the test would be self-defeating. A moved heading, a
 * removed fence or a non-JSON body throws out of the extractor rather than
 * vacuously passing on an empty fixture.
 *
 * ## The green carries its own control
 *
 * A `safeParse` that succeeds proves nothing on its own if the schema accepts
 * everything, so the historical shape is parsed alongside and must be REJECTED
 * by name. The pair is the measurement; neither half alone is one.
 *
 * ## The PROSE is pinned too, not only the fence (objectui#9987)
 *
 * The fence was clean and the paragraph around it was not. It INSTRUCTED the
 * reader to write `navigation.view` -- the member objectstack#18619 retired
 * under ADR-0049 -- and then, in the same breath, explained the mechanism by
 * which an undeclared key rejects the whole config. The first sentence caused
 * what the second diagnosed, and a reader who stops at the instruction never
 * reaches the contradiction. This README ships inside the npm tarball
 * (`files: ["dist", "README.md", ...]`), so the instruction was published.
 *
 * The fence tests above could not see it: they extract the ```json block and
 * the block never carried the key. An instruction can live entirely in prose,
 * which is why the prose is measured here too.
 *
 * WARNING: `declaredMembers()` cannot derive that key's retirement. When this
 * was written the spec in the lockfile (17.4.0) still DECLARED `view` as a live
 * member. The installed `@objectstack/spec` 18.1.0 lands it as a tombstone,
 * as 17.5.0 through 17.7.0 did (objectui#11073 measured it, objectui#11438,
 * objectui#11717 and objectui#12030 again: a `never`
 * schema, and `{ view: 'detail' }` is
 * refused at `view` with "`view.list.navigation.view` was removed in
 * @objectstack/spec 17.5.0") -- but a tombstone is still a KEY of the shape,
 * so the key-set reading below lists it exactly as it listed the live member.
 * It is therefore named by hand, exactly as `basePath` already is -- and the
 * absence carries its own control: the same detector is run over the sentence
 * that used to carry the instruction, in the same file, and must find it there.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NavigationConfigSchema } from '@objectstack/spec/ui';
import { uiRoot } from '../../../scripts/ui-root.mjs';

const README = join(uiRoot(), 'packages/plugin-gantt/README.md');

/** The bullet that documents the override, and the sentence that introduces it. */
const SECTION_HEADING = '\n### Create / Edit / Delete / View\n';
const ANCHOR = 'Override it with `navigation` in the `properties` bag';

/**
 * The declared member names, read out of the schema's OWN shape. Restating them
 * here would fork the vocabulary — the drift `ObjectGanttSchema.navigation`'s
 * doc comment (objectui#5903) exists to prevent — so they are derived instead.
 */
interface ShapeCarrier {
  shape?: Record<string, unknown>;
  _def?: {
    getter?: () => ShapeCarrier;
    innerType?: ShapeCarrier;
    shape?: Record<string, unknown> | (() => Record<string, unknown>);
  };
}

function declaredMembers(): Set<string> {
  let node = NavigationConfigSchema as unknown as ShapeCarrier;
  for (let hop = 0; hop < 6; hop += 1) {
    if (node.shape) return new Set(Object.keys(node.shape));
    const def = node._def;
    if (def?.getter) { node = def.getter(); continue; }
    if (def?.innerType) { node = def.innerType; continue; }
    if (typeof def?.shape === 'function') return new Set(Object.keys(def.shape()));
    if (def?.shape) return new Set(Object.keys(def.shape));
    break;
  }
  throw new Error('NavigationConfigSchema no longer exposes an object shape — cannot derive its members');
}

/** The README section this example lives in, bounded to its own heading. */
function navigationSection(): string {
  const src = readFileSync(README, 'utf8');
  const start = src.indexOf(SECTION_HEADING);
  if (start < 0) throw new Error(`"${SECTION_HEADING.trim()}" heading not found in ${README}`);
  const next = src.indexOf('\n### ', start + 1);
  const section = src.slice(start, next < 0 ? undefined : next);

  const anchors = section.split(ANCHOR).length - 1;
  if (anchors !== 1) {
    throw new Error(`expected exactly one "${ANCHOR}" in the section, found ${anchors}`);
  }
  return section;
}

/** The `json` fence that follows the anchor sentence — the example itself. */
function readmeExample(): Record<string, unknown> {
  const section = navigationSection();
  const after = section.slice(section.indexOf(ANCHOR));
  const fence = /^[ \t]*```json[ \t]*\n([\s\S]*?)\n[ \t]*```/m.exec(after);
  if (!fence) throw new Error('no ```json fence follows the navigation-override sentence in the README');

  // Not wrapped in a try/catch: `JSON.parse`'s own `SyntaxError` names the
  // offending token and is thrown from this line, which is louder than anything
  // a re-throw could add. (A wrapper would also have to attach the caught error
  // as a `cause` to satisfy `preserve-caught-error`, and `Error.cause` is ES2022
  // — above this project's ES2020 lib.)
  const parsed: unknown = JSON.parse(fence[1]);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('the README\'s navigation example is not a JSON object');
  }
  const bag = (parsed as Record<string, unknown>).properties;
  if (typeof bag !== 'object' || bag === null || Array.isArray(bag)) {
    throw new Error('the README\'s navigation example is no longer an authored node with a `properties` bag');
  }
  const nav = (bag as Record<string, unknown>).navigation;
  if (typeof nav !== 'object' || nav === null || Array.isArray(nav)) {
    throw new Error('the README\'s navigation example no longer carries a `navigation` object in its bag');
  }
  return nav as Record<string, unknown>;
}

const MEMBERS = declaredMembers();
const EXAMPLE = readmeExample();

/** The historical shape, kept only as the control's input. */
const REJECTED_KEY = 'basePath';

/**
 * The retired member (objectstack#18619, ADR-0049) the README used to instruct.
 * Named by hand because this tree's pinned spec still declares it -- see the
 * warning in the header.
 */
const RETIRED_KEY = 'view';

/** The form-view name the retired instruction offered as its worked value. */
const RETIRED_KEY_SAMPLE = 'summary_view';

/**
 * The replacement route, by the identifiers that carry it. `@object-ui/react`'s
 * `useNavigationOverlay` docblock states it: assign a `record` page to the
 * object and let `isDefault` pick the one that opens. The README has to keep
 * ANSWERING the question the retired instruction answered -- deleting the
 * instruction alone sends the reader looking, and the retired key is what they
 * find. These are identifiers, not wording: the sentence may be rewritten
 * freely as long as it still hands the reader these two.
 */
const REPLACEMENT_ROUTE = ['record', 'isDefault'] as const;

/** Every inline code span in a markdown fragment, in order. */
function codeSpans(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
}

/**
 * The sentence this section carried until objectui#9987, verbatim. It is the
 * control's input and nothing else: it is what lights `codeSpans` so that the
 * empty result below reads as a measurement rather than as a detector that
 * cannot fire.
 */
const RETIRED_INSTRUCTION =
  'To choose *which* detail view opens, use the declared `view` member (a ' +
  'form-view name, e.g. `"summary_view"`).';

function unrecognizedKeys(issues: readonly { code: string }[]): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      out.push(...((issue as { keys?: string[] }).keys ?? []));
    }
  }
  return out;
}

describe('plugin-gantt README: the record-navigation example', () => {
  it('is a shape `NavigationConfigSchema` ACCEPTS', () => {
    const result = NavigationConfigSchema.safeParse(EXAMPLE);
    expect(
      result.success ? [] : result.error.issues.map((i) => `${i.code} ${JSON.stringify(i.path)}: ${i.message}`),
      'The documented example must survive the schema that validates it. An author who copies ' +
        'this snippet is handing it to exactly this parse — a rejected config renders nothing ' +
        'the snippet promises, including the `mode` beside the offending key.',
    ).toEqual([]);
  });

  it('CONTROL: the same parse still REJECTS an undeclared key by name', () => {
    const result = NavigationConfigSchema.safeParse({ ...EXAMPLE, [REJECTED_KEY]: '/console/apps/.../campaign' });
    expect(
      result.success,
      'This control is what makes the assertion above a measurement rather than a schema that ' +
        'accepts anything. If this ever passes, `NavigationConfigSchema` has stopped being ' +
        'strict and the green above no longer says what it claims.',
    ).toBe(false);
    expect(result.success ? [] : unrecognizedKeys(result.error.issues)).toContain(REJECTED_KEY);
  });

  it('names only members the schema declares', () => {
    const undeclared = Object.keys(EXAMPLE).filter((k) => !MEMBERS.has(k));
    expect(
      undeclared,
      `The README example must not teach a key \`NavigationConfigSchema\` does not declare. ` +
        `\`${REJECTED_KEY}\` was the original offender: a route prefix, in a config that owns no route.`,
    ).toEqual([]);
  });

  it('still teaches the thing its sentence promises — page mode', () => {
    expect(
      EXAMPLE.mode,
      'The example shows `page` opening the record page in the same tab. `mode` is what ' +
        'delivers that; an example that lost it would be valid and useless.',
    ).toBe('page');
  });

  it('does not reintroduce the route-prefix key anywhere in the section', () => {
    expect(
      navigationSection().includes(REJECTED_KEY),
      `\`${REJECTED_KEY}\` is not authorable here in any spelling — prose or fence. ` +
        'No member of this config authors the address: the gantt derives it from the page it is on.',
    ).toBe(false);
  });

  it('does not INSTRUCT the retired detail-view key, in prose or fence', () => {
    const section = navigationSection();
    expect(
      codeSpans(section).filter((span) => span === RETIRED_KEY),
      `The section must not tell an author to write \`${RETIRED_KEY}\`. It is retired ` +
        '(objectstack#18619, ADR-0049): once the spec pin moves it is typed `never` and a ' +
        'value reaching the parse raises the prescription — which is the paragraph’s own ' +
        'next sentence, turned on the reader who followed the paragraph’s first one.',
    ).toEqual([]);
    expect(
      section.includes(RETIRED_KEY_SAMPLE),
      `\`${RETIRED_KEY_SAMPLE}\` was the worked value the instruction offered. A sample ` +
        'left behind still teaches the key, with the member name only implied.',
    ).toBe(false);
  });

  it('CONTROL: the same detector finds the key in the sentence that carried it', () => {
    expect(
      codeSpans(RETIRED_INSTRUCTION).filter((span) => span === RETIRED_KEY),
      'This control is what makes the empty result above a measurement. If `codeSpans` ' +
        'stops finding the key HERE — in the sentence that indisputably carries it — then ' +
        'the clean section above says nothing at all.',
    ).toEqual([RETIRED_KEY]);
    expect(RETIRED_INSTRUCTION.includes(RETIRED_KEY_SAMPLE)).toBe(true);
  });

  it('still answers the question the retired instruction answered', () => {
    const spans = new Set(codeSpans(navigationSection()));
    expect(
      REPLACEMENT_ROUTE.filter((name) => !spans.has(name)),
      'Deleting the instruction is not the repair on its own: it answered a real authoring ' +
        'question — which detail layout opens — and a reader who loses the answer goes ' +
        'looking and finds the retired key elsewhere. The section must name the replacement ' +
        'route `@object-ui/react`\'s `useNavigationOverlay` docblock states.',
    ).toEqual([]);
  });
});

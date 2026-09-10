// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two consumers of one walk are asked for the SAME KEYS — equality, not
 * "no duplicates".
 *
 * `collectExpectedEntries`' own docblock states the invariant this file
 * measures:
 *
 * > This is the single place the gate lives, so `os lint`'s coverage report and
 * > `os i18n extract`'s skeleton can never disagree about which keys an author
 * > is being asked for.
 *
 * They disagreed, and the shape of the disagreement is why it survived so long:
 * the same array reaches two consumers, and only ONE of them de-duplicates.
 * `os i18n extract` materialises a NESTED TREE, where writing one path twice
 * collapses onto one leaf; the coverage report counts `expected.length` on the
 * FLAT array. A key emitted twice was therefore invisible in the skeleton and
 * load-bearing in the percentage — measured on a real application at 482 keys
 * from the extractor against 492 from `check`, the surplus being exactly ten
 * `objects.*._actions.*` keys.
 *
 * ## Why equality and not "the walk has no repeats"
 *
 * "No duplicate paths" is the property `i18n-duplicate-demand.test.ts` pins at
 * the seam it is caused at, and it is necessary. It is not sufficient, because
 * it is a statement about ONE output. What the docblock promises is a relation
 * BETWEEN the two — and a relation between two outputs is the only assertion
 * that fails when a future change makes one of them drop a key the other still
 * demands. A repair that deleted one of the two action walks would satisfy "no
 * duplicates" perfectly while dropping a whole class of declaration from
 * translation, so the two negative controls below are load-bearing: an app that
 * declares its actions ON THE OBJECT and an app that declares them TOP-LEVEL,
 * BOUND TO AN OBJECT must EACH come out complete.
 *
 * ## How each side is read
 *
 * Both are read from a PUBLISHED face, never from the walker directly — the
 * point is that two consumers agree, and reading the shared upstream would
 * assert only that it equals itself.
 *
 *   extract  the leaves of the skeleton `extractTranslations` builds, narrowed
 *            to the stack's own surface with the extractor's OWN
 *            `stackAuthoredSubtree` — the same function `os i18n extract` uses
 *            to decide what goes in the stack module, not a second definition
 *            of "the stack's own keys".
 *   check    the keys `computeI18nCoverage` reports missing for a locale the
 *            fixture declares and ships no bundle for. With nothing translated
 *            there, that finding set IS the expected set, key for key — the
 *            same list `os i18n check --json` publishes — and reading it this
 *            way keeps the assertion on the command's real output face rather
 *            than on a count that happens to match.
 *
 * The fixtures author every prop they declare, deliberately. An UNAUTHORED
 * optional prop is legitimately absent from both sides (nothing to scaffold,
 * nothing to translate), and an unauthored DERIVED prop is legitimately present
 * in one and not the other — the extractor seeds a fallback so the skeleton
 * stays usable, while coverage does not demand a translation of a string nobody
 * wrote. Neither asymmetry is this invariant, so the fixtures stay clear of
 * both rather than encoding an exception here.
 */

import { describe, it, expect } from 'vitest';
import {
  collectExpectedEntries,
  extractTranslations,
  stackAuthoredSubtree,
} from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';

const LOCALE = 'zh-CN';

/** Every leaf path in a translation tree, dot-joined, sorted. */
function leafPaths(node: unknown, prefix: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return [prefix.join('.')];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafPaths(value, [...prefix, key]),
  );
}

/** What `os i18n extract` would scaffold for this stack, its own surface only. */
function extractKeys(config: any): string[] {
  const { bundles } = extractTranslations(config, { locales: ['en'] });
  return leafPaths(stackAuthoredSubtree(bundles.en)).sort();
}

/**
 * What `os i18n check` asks the author for — read off the published finding
 * list for a declared locale with no bundle, where every expected key is
 * missing by construction.
 */
function checkKeys(config: any): string[] {
  const report = computeI18nCoverage(config, { platformMetadataForms: 'exclude' });
  return report.issues.filter((i) => i.locale === LOCALE).map((i) => i.key).sort();
}

/**
 * The action every fixture declares. One literal object; each fixture decides
 * WHERE it hangs, which is the whole variable under test.
 */
function inquiryAction() {
  return {
    name: 'ats_convert_inquiry',
    label: 'Convert Inquiry',
    objectName: 'inquiry',
    description: 'Turn this inquiry into a candidate.',
    confirmText: 'Convert this inquiry?',
    successMessage: 'Inquiry converted.',
    params: [{ name: 'owner', label: 'New owner' }],
  };
}

/** The surrounding app, identical in every fixture so only the action moves. */
function baseStack() {
  return {
    i18n: { defaultLocale: 'en', supportedLocales: ['en', LOCALE] },
    objects: [
      {
        name: 'inquiry',
        label: 'Inquiry',
        pluralLabel: 'Inquiries',
        description: 'An inbound application.',
        fields: {
          name: { label: 'Name', help: 'Full legal name.', placeholder: 'Ada Lovelace' },
        },
      } as any,
    ],
    apps: [{ name: 'ats', label: 'Hiring', description: 'Applicant tracking.' }],
  };
}

/** Shape ①: the action is declared ON the object (`obj.actions`). */
function actionOnObject(): any {
  const stack = baseStack();
  stack.objects[0].actions = [inquiryAction()];
  return stack;
}

/** Shape ②: the action is declared TOP-LEVEL, bound to the object. */
function actionTopLevel(): any {
  return { ...baseStack(), actions: [inquiryAction()] };
}

/**
 * Shape ③: what the normalizer really hands the walk — ONE action object
 * carried by BOTH lists, by reference. This is the config that produced the
 * measured 492-against-482, and the reference sharing is the point: a copy
 * would not reproduce it faithfully.
 */
function actionOnBothCarriers(): any {
  const stack: any = baseStack();
  const shared = inquiryAction();
  stack.objects[0].actions = [shared];
  stack.actions = [shared];
  return stack;
}

const ACTION_KEYS = [
  'objects.inquiry._actions.ats_convert_inquiry.label',
  'objects.inquiry._actions.ats_convert_inquiry.description',
  'objects.inquiry._actions.ats_convert_inquiry.confirmText',
  'objects.inquiry._actions.ats_convert_inquiry.successMessage',
  'objects.inquiry._actions.ats_convert_inquiry.params.owner.label',
];

describe('os i18n extract and os i18n check ask for the same keys', () => {
  const shapes: Array<[string, () => any]> = [
    ['actions declared on the object', actionOnObject],
    ['actions declared top-level, bound to an object', actionTopLevel],
    ['actions on both carriers, one reference (the normalizer output)', actionOnBothCarriers],
  ];

  for (const [name, build] of shapes) {
    describe(name, () => {
      it('publishes the same key SET from both faces', () => {
        const config = build();
        expect(checkKeys(config)).toEqual(extractKeys(config));
      });

      it('publishes the same key COUNT from both faces', () => {
        // The number the card is about — 482 from the extractor against 492
        // from `check`. Implied by the set equality above and asserted anyway,
        // because the count is the thing an operator reads and the thing the
        // percentage divides by.
        const config = build();
        expect(checkKeys(config).length).toBe(extractKeys(config).length);
      });

      it('asks for the complete action set — the walk is not repaired by deletion', () => {
        // The firing control for both assertions above: equality over an empty
        // intersection would be trivially true, so this pins that the shared
        // population actually CONTAINS the family under test. A fix that
        // deleted either action walk turns the two assertions above green and
        // reddens this one.
        const config = build();
        const keys = extractKeys(config);
        expect(keys).toEqual(expect.arrayContaining(ACTION_KEYS));
        expect(checkKeys(config)).toEqual(expect.arrayContaining(ACTION_KEYS));
      });

      it('emits each action key exactly once in the walk itself', () => {
        // The upstream seam, so a regression is attributable: the collapse
        // belongs to the walker (`dedupeByPath`), not to either consumer.
        const paths = collectExpectedEntries(build()).map((e) => e.path.join('.'));
        for (const key of ACTION_KEYS) {
          expect(paths.filter((p) => p === key)).toHaveLength(1);
        }
      });
    });
  }

  it('reaches the same key set however the action was declared', () => {
    // The two negative controls, stated as one fact: WHERE an action is
    // declared changes nothing about which keys its translator is asked for.
    expect(extractKeys(actionTopLevel())).toEqual(extractKeys(actionOnObject()));
    expect(extractKeys(actionOnBothCarriers())).toEqual(extractKeys(actionOnObject()));
    expect(checkKeys(actionTopLevel())).toEqual(checkKeys(actionOnObject()));
    expect(checkKeys(actionOnBothCarriers())).toEqual(checkKeys(actionOnObject()));
  });
});

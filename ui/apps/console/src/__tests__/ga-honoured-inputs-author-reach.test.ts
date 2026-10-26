/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#4668 — the five @objectstack/spec 17.0.0 GA keys the renderers
 * already honoured, seen from where an AUTHOR stands.
 *
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts` pins the
 * declarations. This file pins what the declarations were FOR: before them, the
 * manifest that gates authoring reported `unknown-prop` on all five —
 *
 *   page:header      maxVisible          "<page:header> has no prop "maxVisible""
 *   page:header      mobileMaxVisible    "<page:header> has no prop "mobileMaxVisible""
 *   page:tabs        alwaysShowStrip     "<page:tabs> has no prop "alwaysShowStrip""
 *   record:details   inlineEdit          "<record:details> has no prop "inlineEdit""
 *   record:details   showHeader          "<record:details> has no prop "showHeader""
 *
 * — measured on this exact `manifestFromConfigs` + `validateTree` pair, while
 * the renderers honoured every one of them. An author was warned off five keys
 * that work, and an author who never tried them could not learn they exist:
 * `gen-manifest.ts` serializes these same `inputs` into `sdui.manifest.json`
 * (the save gate and parser whitelist) and into `sdui-intrinsics.d.ts` (the JSX
 * authoring types), and `page.tsx:462` builds the JSX-page compiler's prop
 * whitelist from `getKnownTypes()` plus the same `inputs`. objectui#3407's
 * complaint verbatim, on five more keys.
 *
 * WHY EVERY POSITIVE COMES WITH A CONTROL. "No diagnostic" is also what a
 * SILENCED check looks like: if `validateTree` stopped reporting `unknown-prop`
 * at all — or if the manifest came up empty and every node resolved to
 * `unknown-component` instead — the five assertions below would pass while the
 * gap sat wide open. So each block is probed with a key nothing declares, which
 * must still be reported, and the manifest's own reachability is asserted
 * first. The same pairing `component-input-union-specimens.test.ts` uses next
 * door for objectui#3832, and for the same reason: this change is a WIDENING.
 *
 * Module-scope registration imports, not a hook (AGENTS.md §测试纪律,
 * objectui#3010): the registrations are the fixture, and paying their cold
 * transform at import time keeps it out of every test and hook timeout budget.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';
import '@object-ui/components';
import '../register-plugins';

/**
 * The manifest built from the WHOLE registry — the same construction
 * `dev/manifest-dump.tsx` and the JSX-page compiler use, rather than a
 * hand-assembled list that could agree with itself and prove nothing.
 */
const manifest = manifestFromConfigs(
  ComponentRegistry.getAllConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
);

const diagnose = (node: unknown): Diagnostic[] =>
  validateTree(node as SchemaElement, manifest).diagnostics;

/** Diagnostics naming a specific prop, by code. */
const codesMentioning = (node: unknown, prop: string): string[] =>
  diagnose(node)
    .filter((d) => d.message.includes(`"${prop}"`))
    .map((d) => d.code);

/** A minimally valid node per block, so `missing-required-prop` never rides along. */
const BASE: Record<string, Record<string, unknown>> = {
  'page:header': { type: 'page:header' },
  'page:tabs': { type: 'page:tabs', items: [{ label: 'Details', children: [] }] },
  'record:details': { type: 'record:details' },
};

const node = (type: string, props: Record<string, unknown>) => ({ ...BASE[type], ...props });

/** The five keys, by the block that publishes them. */
const PUBLISHED: Array<[string, string, unknown]> = [
  ['page:header', 'maxVisible', 4],
  ['page:header', 'mobileMaxVisible', 2],
  ['page:tabs', 'alwaysShowStrip', true],
  ['record:details', 'inlineEdit', false],
  ['record:details', 'showHeader', true],
];

describe('objectui#4668 — the five GA keys are reachable from the authoring manifest', () => {
  it('the manifest resolves all three blocks (reachability before absence)', () => {
    // Without this, every "no unknown-prop" assertion below passes vacuously on
    // a manifest that never knew the block: an unresolved type produces
    // `unknown-component`, a DIFFERENT code, and the per-prop filters here would
    // find nothing to report.
    for (const type of Object.keys(BASE)) {
      expect(manifest.components[type], `${type} missing from the manifest`).toBeTruthy();
      expect(diagnose(BASE[type]).map((d) => d.code)).not.toContain('unknown-component');
    }
  });

  it('each block still reports an undeclared key — the check is live, not silenced', () => {
    // The control half. `unknown-prop` has to be reachable on each of the three
    // blocks for the five positives to mean anything.
    for (const type of Object.keys(BASE)) {
      const probe = node(type, { objectui4668NotAProp: 'x' });
      expect(
        codesMentioning(probe, 'objectui4668NotAProp'),
        `${type} no longer reports undeclared props`,
      ).toContain('unknown-prop');
    }
  });

  it('none of the five draws a diagnostic any more', () => {
    // The acceptance face of this card: the write an author makes, judged by the
    // manifest the platform gates on. Filtered to diagnostics that NAME the key,
    // so an unrelated report elsewhere in the node cannot mask a regression here
    // — nor a regression here hide behind an unrelated pass.
    for (const [type, prop, value] of PUBLISHED) {
      expect(codesMentioning(node(type, { [prop]: value }), prop), `${type}.${prop}`).toEqual([]);
    }
  });

  it('the declared type is the one the value has, so no type-mismatch either', () => {
    // `unknown-prop` was the loud half; `checkType` is the quiet one. A key
    // declared with the wrong coarse arm goes from "undiscoverable" to
    // "discoverable and warned about on every legal write", which is the trap
    // objectui#3832 was filed over. Probing the OFF-arm value proves the arm is
    // narrow enough to be worth having.
    for (const [type, prop, value] of PUBLISHED) {
      expect(codesMentioning(node(type, { [prop]: value }), prop)).not.toContain('type-mismatch');
    }
    // Booleans given a number, and the numeric budget given a boolean.
    expect(codesMentioning(node('page:tabs', { alwaysShowStrip: 1 }), 'alwaysShowStrip')).toContain(
      'type-mismatch',
    );
    expect(codesMentioning(node('record:details', { inlineEdit: 'no' }), 'inlineEdit')).toContain(
      'type-mismatch',
    );
    expect(codesMentioning(node('page:header', { maxVisible: true }), 'maxVisible')).toContain(
      'type-mismatch',
    );
  });
});

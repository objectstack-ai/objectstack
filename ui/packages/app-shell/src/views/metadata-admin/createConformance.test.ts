/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// CONFORMANCE GUARD — every authorable metadata type's DEFAULT create-form
// output must pass spec validation. Catches the recurring "the designer
// produces a minimal shape the spec rejects, so create→save 422s" family
// (dashboard `layout`, report stale anchors, action missing `body`, …) that
// passes every other gate because code-authored examples always supply full
// shapes. Reads the ACTUAL create config from the registry so it cannot drift
// from what the designer emits.

import { describe, it, expect } from 'vitest';
import { registerBuiltinAnchors } from './anchors';
import { listMetadataResources, type MetadataResourceConfig } from './registry';
import { validateMetadataDraft, hasClientValidator } from './clientValidation';
import { buildObjectSkeleton, buildFlowSkeleton, buildAppSkeleton, buildPermissionSkeleton } from '../studio-design/skeletons';

registerBuiltinAnchors();

/** Placeholder value for a create-form field, mirroring what a user types.
 *  Enum-ish fields (type/kind/isProfile) fall back to the create default so we
 *  don't override them with a bogus string; unknown ones stay unset (schema
 *  default applies). */
// Enum createFields the create form forces the user to pick (rendered as a
// required <select>) that carry NO createDefault — the guard supplies a valid
// option to simulate the choice, exactly as the form requires one before save.
// Currently empty: `flow.type` now ships a createDefault ('autolaunched',
// objectui#2326), so its default create output is spec-valid WITHOUT a
// simulated pick — the fall-through below reads it from `createDefaults`, which
// is what actually keeps the guard honest about a create→save that never
// touches the type picker.
const REQUIRED_PICKS: Record<string, Record<string, unknown>> = {};

function placeholderFor(field: string, cfg: MetadataResourceConfig): unknown {
  const pick = REQUIRED_PICKS[cfg.type]?.[field];
  if (pick !== undefined) return pick;
  switch (field) {
    case 'label': return 'Conformance Probe';
    case 'pluralLabel': return 'Conformance Probes';
    case 'name': return `conf_${cfg.type.replace(/[^a-z0-9_]/g, '_')}`;
    case 'object':
    case 'objectName': return 'showcase_task';
    case 'description': return '';
    case 'message': return 'Validation message';
    case 'icon': return 'Zap';
    default:
      return cfg.createDefaults && field in (cfg.createDefaults as Record<string, unknown>)
        ? (cfg.createDefaults as Record<string, unknown>)[field]
        : undefined;
  }
}

/** Reproduce ResourceEditPage.doSave's create body:
 *  createBuildBody(draft) ?? { ...createDefaults, ...draft }. */
function buildCreateOutput(cfg: MetadataResourceConfig): Record<string, unknown> {
  const draft: Record<string, unknown> = {};
  for (const f of cfg.createFields ?? ['label', 'name']) {
    const v = placeholderFor(f, cfg);
    if (v !== undefined) draft[f] = v;
  }
  return cfg.createBuildBody
    ? (cfg.createBuildBody(draft) as Record<string, unknown>)
    : { ...((cfg.createDefaults as Record<string, unknown>) ?? {}), ...draft };
}

// Canvas-create types (mirror ResourceEditPage.CREATE_MODE_CANVAS_TYPES) build
// their save shape INTERACTIVELY on the canvas — e.g. report's dataset/measures
// are picked there — so `createDefaults` alone is intentionally incomplete and
// this name-first-form guard does not apply to them.
const CANVAS_CREATE_TYPES = new Set(['object', 'report']);

// Authorable via the name-first create form: skip synthetic object sub-resources
// (__object_field …), canvas-create types, and anything with no create affordance.
const authorable = listMetadataResources().filter(
  (c) => !c.type.startsWith('__') && !CANVAS_CREATE_TYPES.has(c.type) && (c.createFields || c.createDefaults || c.createBuildBody),
);

describe('create-roundtrip conformance: default create output passes spec validation', () => {
  it('surfaces excluded canvas-create types + types without a client schema (no silent cap)', () => {
    const noSchema = authorable.filter((c) => !hasClientValidator(c.type)).map((c) => c.type);
    console.log(`[conformance] canvas-create (interactive, excluded): ${[...CANVAS_CREATE_TYPES].join(', ')}`);
    console.log(`[conformance] name-first types covered: ${authorable.map((c) => c.type).join(', ')}`);
    if (noSchema.length) console.log(`[conformance] shape-only (no client schema): ${noSchema.join(', ')}`);
    expect(authorable.length).toBeGreaterThan(4);
  });

  it('sanity: discovers the known authorable types', () => {
    const types = new Set(authorable.map((c) => c.type));
    for (const t of ['dashboard', 'action', 'page', 'view', 'flow']) {
      expect(types.has(t), `authorable type '${t}' not discovered`).toBe(true);
    }
  });

  for (const cfg of authorable) {
    const checked = hasClientValidator(cfg.type);
    it(`${cfg.type}: default create output is spec-valid${checked ? '' : ' (no client schema — shape only)'}`, async () => {
      const output = buildCreateOutput(cfg);
      const { issues } = await validateMetadataDraft(cfg.type, output);
      expect(
        issues,
        `${cfg.type} create output rejected by spec: ${JSON.stringify(issues)}\noutput=${JSON.stringify(output)}`,
      ).toHaveLength(0);
    });
  }
});

// The Studio pillars (Data/Automations/Interfaces/Access) build their "New X"
// skeletons INLINE, bypassing the registry the guard above reads — so they need
// their own coverage, from the SAME source the pillars consume (`skeletons.ts`),
// so this can never drift from what the "New" button actually emits. Guards the
// same dead-end family (a minimal shape the spec rejects → create→save 422s).
describe('Studio inline creators: skeletons pass spec validation', () => {
  const STUDIO_SKELETONS: Array<{ type: string; skeleton: Record<string, unknown> }> = [
    { type: 'object', skeleton: buildObjectSkeleton('conf_obj', 'Conformance Object', 'Name', 'private') },
    { type: 'flow', skeleton: buildFlowSkeleton('conf_flow', 'Conformance Flow', 'Start', 'End') },
    { type: 'app', skeleton: buildAppSkeleton('conf_app', 'Conformance App') },
    {
      // Nav-seeded variant (objectui#2262): create-app scaffolds one menu item
      // per package object — the seeded navigation must be spec-valid too. The
      // seeds are names only: a seeded entry carries no label (objectui#11201).
      type: 'app',
      skeleton: buildAppSkeleton('conf_app_nav', 'Conformance App (nav)', [
        { name: 'conf_obj' },
        { name: 'conf_other' },
      ]),
    },
    { type: 'permission', skeleton: buildPermissionSkeleton('conf_perm', 'Conformance Permission') },
  ];

  for (const { type, skeleton } of STUDIO_SKELETONS) {
    it(`${type}: Studio inline "New" skeleton is spec-valid`, async () => {
      const { issues } = await validateMetadataDraft(type, skeleton);
      expect(
        issues,
        `${type} inline skeleton rejected by spec: ${JSON.stringify(issues)}\nskeleton=${JSON.stringify(skeleton)}`,
      ).toHaveLength(0);
    });
  }
});

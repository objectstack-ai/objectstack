// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The standalone `validation` resource stays retired (objectui#4132).
 *
 * ADR-0088 / objectstack#4509 retired `validation` as a metadata KIND. The
 * framework ledger (`packages/spec/liveness/validation.json`) records why, and
 * it is not a deprecation notice — it is a statement that the door never led
 * anywhere:
 *
 *   > a STANDALONE `validation` item (file `*.validation.ts` or Studio) never
 *   > reached any object's write path, because the schema has no object-binding
 *   > key and — every variant being `.strict()` — an author could not add one;
 *   > no merge code existed […] A state machine authored through that door saved
 *   > cleanly and gated nothing.
 *
 * Re-measured here against the INSTALLED `@objectstack/spec` (17.0.0-rc.6):
 * `DEFAULT_METADATA_TYPE_REGISTRY` lists 27 kinds and `validation` is not one of
 * them, and `listUnregisteredKindSchemaTypes()` returns `connector`,
 * `sharing_rule`, `webhook` — also not `validation`. The console nevertheless
 * kept registering a standalone `validation` resource anchored by
 * `anchorByField('object')`, WITH `createFields` / `createSchema`, so the
 * object's Related tab grew a "Validations" group whose `+` navigated to
 * `validation/_new` — an author could author, and save, a rule that nothing
 * evaluates. That is the outcome ADR-0088 retired the kind to prevent.
 *
 * What this pin asserts, and why in two instruments:
 *
 *  • RUNTIME (primary) — the resource registry after `registerBuiltinAnchors()`.
 *    This is the surface `RelatedPanel` and `ResourceListPage` actually read, so
 *    it is the one that decides whether a user can reach the door.
 *  • SOURCE TEXT (secondary) — `anchors.ts`'s own bytes. The registry is a
 *    `Map` merged by `registerMetadataResource`, so a re-added registration is
 *    visible at runtime; the source half additionally pins that the stale
 *    justification comment ("standalone variants do exist") does not come back
 *    with it, and a comment is invisible to every runtime read.
 *
 * The EMBEDDED anchor is the control and must stay: `__object_validation`
 * (`editAs: 'validation'`, `embeddedPath: 'validations'`) is the path the
 * framework does evaluate — rules live in `object.validations`. Retiring it
 * would be the opposite mistake.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { registerBuiltinAnchors } from './anchors';
import { getMetadataResource, listAnchorsFor, listMetadataResources } from './registry';

registerBuiltinAnchors();

const ANCHORS_SOURCE = readFileSync(
  fileURLToPath(new URL('./anchors.ts', import.meta.url)),
  'utf8',
);

const PREVIEW_BARREL_SOURCE = readFileSync(
  fileURLToPath(new URL('./previews/index.ts', import.meta.url)),
  'utf8',
);

const DRAWER_SOURCE = readFileSync(
  fileURLToPath(new URL('./MetadataDetailDrawer.tsx', import.meta.url)),
  'utf8',
);

describe('the standalone `validation` resource is not registered', () => {
  it('has no entry in the resource registry', () => {
    expect(getMetadataResource('validation')).toBeUndefined();
  });

  it('non-vacuity: the registry IS populated and other standalone kinds are in it', () => {
    // Without this, an empty registry (a broken import, a renamed export)
    // would satisfy every assertion in this file forever.
    const types = listMetadataResources().map((c) => c.type);
    expect(types.length).toBeGreaterThan(5);
    expect(types).toContain('hook');
    expect(types).toContain('permission');
  });

  it('offers no create affordance — `createFields` / `createSchema` are gone with it', () => {
    // `ResourceListPage` gates its New button on `config.createFields`, and
    // `ResourceEditPage` drives the create form off `config.createSchema`.
    // Both read the registry entry, so an absent entry is the retirement.
    const entry = listMetadataResources().find((c) => c.type === 'validation');
    expect(entry).toBeUndefined();
    // Control: the affordance is a real thing that other kinds still have.
    expect(getMetadataResource('hook')?.createFields ?? []).not.toHaveLength(0);
  });

  it('the object Related tab has no standalone "Validations" group', () => {
    const groups = listAnchorsFor('object');
    const standalone = groups.filter(
      (g) => g.type === 'validation' || g.anchor.groupLabel === 'Validations',
    );
    expect(
      standalone.map((g) => `${g.type} (${g.anchor.groupLabel ?? '-'})`),
      'A non-embedded validation group re-opens the create door RelatedPanel ' +
        'renders a `+` for — see ADR-0088 / objectstack#4509.',
    ).toEqual([]);
  });

  it('no anchored group anywhere routes standalone validation authoring', () => {
    // Anchors are declared per parent type; sweep them all rather than just
    // `object`, so re-anchoring the same door under another parent is caught.
    const parents = ['object', 'app', 'flow', 'page', 'view', 'datasource', 'package'];
    for (const parent of parents) {
      const offenders = listAnchorsFor(parent)
        .filter((g) => g.type === 'validation')
        .map((g) => `${parent} → ${g.type}`);
      expect(offenders).toEqual([]);
    }
  });
});

describe('the EMBEDDED validation anchor stays (control)', () => {
  it('`__object_validation` is still anchored at object', () => {
    const embedded = listAnchorsFor('object').find((g) => g.type === '__object_validation');
    expect(embedded, 'the embedded anchor is the path the framework evaluates').toBeTruthy();
    expect(embedded?.anchor.source).toBe('embedded');
    expect(embedded?.anchor.editAs).toBe('validation');
    expect(embedded?.anchor.embeddedPath).toBe('validations');
  });

  it('its group is reachable from the object Related tab', () => {
    const labels = listAnchorsFor('object').map((g) => g.anchor.groupLabel);
    expect(labels).toContain('Embedded Validations');
  });
});

describe('anchors.ts source: the retirement is written down, not just absent', () => {
  it('declares no standalone validation resource registration', () => {
    // `type: '__object_validation' as any` is the embedded entry and does not
    // match this pattern — only the standalone spelling does.
    expect(/type:\s*'validation'/.test(ANCHORS_SOURCE)).toBe(false);
  });

  it('does not carry the stale "standalone variants do exist" justification', () => {
    // The phrase WRAPS in the source it is guarding against —
    //   `// validation: usually embedded in the object, but standalone variants`
    //   `// do exist. Match anything whose `object` points back at us.`
    // — so a flat `/standalone variants do exist/` matches nothing and passes
    // for free. Measured on #4132's reverse verification: with the original
    // file restored, the flat spelling stayed GREEN. Anything between the two
    // halves is newline + comment prefix, hence the bounded gap.
    expect(ANCHORS_SOURCE).not.toMatch(/standalone variants[\s\S]{0,24}do exist/i);
  });

  it('records the retirement where the registration used to be', () => {
    // Same shape as the `workflow` (ADR-0020) and `trigger` (ADR-0088)
    // retirement notes already in this file: the next reader learns why there
    // is no group rather than re-adding one. Asserted on wording unique to
    // THIS note — a bare `/ADR-0088/` is already satisfied by the neighbouring
    // `trigger` note, so it would pass on a file that still registers the door
    // (measured on #4132's reverse verification).
    expect(ANCHORS_SOURCE).toMatch(/`validation` retired as a metadata type/);
    expect(ANCHORS_SOURCE).toContain('ADR-0088 / objectstack#4509');
    expect(ANCHORS_SOURCE).toContain('objectui#4132');
  });

  it('non-vacuity: this really is anchors.ts and the embedded entry is in it', () => {
    expect(ANCHORS_SOURCE).toContain("'__object_validation'");
    expect(ANCHORS_SOURCE).toContain("embeddedPath: 'validations'");
  });
});

describe('the retirement does NOT take the preview registration with it (shape B)', () => {
  it('the drawer still hands the embedded editor its `editAs`', () => {
    // `EmbeddedItemEditor.preview.test.tsx` pins that the editor mounts the
    // preview registered for `editAs`; this pins the other half of the path —
    // that the drawer's embedded branch passes `editAs` down at all. Asserted
    // off source text because the drawer wraps the editor in a Radix `Sheet`,
    // which does not settle under the light DOM setup (measured on #4132).
    expect(DRAWER_SOURCE).toMatch(/<EmbeddedItemEditor[\s\S]{0,400}editAs=\{target\.editAs\}/);
  });

  it('previews/index.ts still registers ValidationPreview', () => {
    // The renderer moved to the embedded path (`EmbeddedItemEditor` looks it up
    // by `editAs`), so unregistering it here would delete a working surface
    // from the product rather than close a retired door. Asserted off source
    // text because importing the preview barrel drags every preview module
    // (flow canvas, dashboard, report…) into the test's graph.
    expect(PREVIEW_BARREL_SOURCE).toMatch(
      /registerMetadataPreview\('validation',\s*ValidationPreview\)/,
    );
    expect(PREVIEW_BARREL_SOURCE).toContain('import { ValidationPreview }');
  });
});

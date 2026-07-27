// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Bundle-ownership guard (#2834 ⑤ / ADR-0029 D8): this package's generated
// object-translation bundles must carry ONLY objects its extract config
// (`scripts/i18n-extract.config.ts`) actually imports. When an object moves to
// another package, its translations move with it — a leftover copy here
// silently DIES on the next `os i18n extract` run, taking curated translations
// with it (the sys_audit_log incident). This test turns that silent loss into a
// red build: an object present in the bundle but not in the ownership list below
// means either (a) the extract config gained an object — add it here — or (b) a
// moved/removed object's keys were left behind — remove them from the bundles
// (or migrate them to the owning package), then keep this list in sync.
//
// NB: this package also defines sys_audience_binding_suggestion, which the
// extract config deliberately does NOT translate — an engine-owned suggestion
// queue with no admin UI surface, absent from both the config and the bundles,
// correctly out of scope. `sys_capability` and `sys_user_position` ARE translated
// (curated strings live in the bundles), so they must stay in the extract config;
// this guard is what caught sys_capability being dropped from that list.

import { describe, it, expect } from 'vitest';
import { enObjects } from './en.objects.generated.js';

// Objects the extract config (scripts/i18n-extract.config.ts) imports —
// keep the two lists in sync when adding/moving objects.
const OWNED_OBJECTS = new Set([
  'sys_position',
  'sys_capability',
  'sys_permission_set',
  'sys_user_permission_set',
  'sys_position_permission_set',
  'sys_user_position',
]);

describe('objects translation bundle ownership (ADR-0029 D8)', () => {
  it('the en bundle contains no objects owned by other packages', () => {
    const strays = Object.keys(enObjects).filter((o) => !OWNED_OBJECTS.has(o));
    expect(
      strays,
      `bundle carries objects this package's extract config does not own: ${strays.join(', ')} — ` +
        'their curated translations would be silently deleted on the next `os i18n extract`. ' +
        'Remove the dead block from the four locale bundles, or add the object to the extract config + this list.',
    ).toEqual([]);
  });

  it('every owned object is present in the bundle (extract config regression)', () => {
    const missing = [...OWNED_OBJECTS].filter((o) => !(o in enObjects));
    expect(
      missing,
      `objects the extract config should emit are missing from the bundle: ${missing.join(', ')} — was an import dropped from scripts/i18n-extract.config.ts?`,
    ).toEqual([]);
  });
});

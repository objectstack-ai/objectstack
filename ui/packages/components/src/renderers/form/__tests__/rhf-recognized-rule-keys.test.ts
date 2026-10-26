/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RHF_RECOGNIZED_RULE_KEYS` is pinned against the INSTALLED react-hook-form
 * bundle, not against prose (objectui#5099).
 *
 * The unrecognized-rule-name diagnostic in `form.tsx` is only as truthful as
 * its recognized set. That set is a claim about someone else's code —
 * react-hook-form's field validator destructures a fixed key set off the
 * field descriptor (`…}=e._f`) and silently drops everything else — so a
 * react-hook-form bump that adds or removes a destructured key would rot the
 * diagnostic in the worst direction: it would keep reporting confidently
 * from a stale set, flagging rules that now run or blessing rules that no
 * longer do, and nothing would go red.
 *
 * This test therefore RE-DERIVES the set from the bundle the workspace
 * actually installed, at test time:
 *
 *   1. Resolve `react-hook-form`'s CJS bundle exactly as Node would from this
 *      package (createRequire — no vitest alias applies to it).
 *   2. Extract the validator's `._f` destructure and parse its key names.
 *   3. Subtract the descriptor internals (`RHF_DESCRIPTOR_NON_RULE_KEYS`) and
 *      require exact set equality with `RHF_RECOGNIZED_RULE_KEYS`.
 *
 * On a bump that changes the shape, step 2 or 3 fails loudly and a human
 * re-sorts the new key into rule / non-rule — the one judgment that cannot
 * be automated. The regexes are deliberately shape-based (minifier-safe:
 * they key on `ref:`…`=<ident>._f`, not on the one-letter aliases).
 *
 * Also pinned here: the premise of the #5099 narrowing itself — the bundle's
 * `instanceof RegExp` gate, the reason a string `pattern.value` validates
 * nothing and `FieldValidationRules.pattern.value` is now `RegExp`-only.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  RHF_RECOGNIZED_RULE_KEYS,
  RHF_DESCRIPTOR_NON_RULE_KEYS,
} from '../validationRuleKeys';

const require = createRequire(import.meta.url);
// The "require" export condition resolves to dist/index.cjs.js — the same
// artifact the issue quoted and the one Node actually loads.
const bundlePath = require.resolve('react-hook-form');
const bundle = readFileSync(bundlePath, 'utf8');

describe('RHF_RECOGNIZED_RULE_KEYS matches the installed react-hook-form (objectui#5099)', () => {
  it('the field validator destructures exactly one fixed key set off `._f`', () => {
    const matches = [...bundle.matchAll(/const\{(ref:[^{}]*?)\}=[$\w]+\._f/g)];
    // 0 matches ⇒ the bundle no longer holds the shape this pin greps for
    // (refactor or major bump): re-derive the rule set from the new source by
    // hand and update BOTH lists in validationRuleKeys.ts plus this regex.
    // >1 ⇒ the extraction is ambiguous; disambiguate before trusting it.
    expect(matches.length).toBe(1);

    const destructured = matches[0][1].split(',').map((entry) => entry.split(':')[0]);
    const derivedRuleKeys = destructured.filter(
      (k) => !RHF_DESCRIPTOR_NON_RULE_KEYS.includes(k),
    );

    // Exact set equality, both directions: a key react-hook-form gained that
    // we do not recognize fails here (the diagnostic would wrongly flag it),
    // and a key it dropped that we still recognize fails here too (the
    // diagnostic would wrongly bless it).
    expect([...derivedRuleKeys].sort()).toEqual([...RHF_RECOGNIZED_RULE_KEYS].sort());
  });

  it('pattern only applies to RegExp instances — the premise of the narrowing', () => {
    // The isRegex guard (`Z=e=>e instanceof RegExp` in 7.85.0). If this
    // disappears, the ground under FieldValidationRules.pattern.value being
    // RegExp-only has shifted: re-read the new validator before touching the
    // type.
    expect(bundle).toMatch(/=\(?[$\w]+\)?=>[$\w]+ instanceof RegExp/);
  });
});

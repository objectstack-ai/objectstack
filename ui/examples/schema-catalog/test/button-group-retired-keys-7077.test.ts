/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `button-group` catalog category authors only DECLARED keys (objectui#7077,
 * maintainer ruling 2026-09-04, batch #25 — option 2 under ADR-0049).
 *
 * ## What was retired and why a pin is the only thing that holds it
 *
 * All six fixtures in this category authored keys the shipped types do not
 * declare — `buttons[].value` ×17, `buttons[].icon` ×8, group-level `value` ×2
 * and `selectionMode` ×2, 29 occurrences over six files. Nothing went red:
 * `BaseSchema` is `.passthrough()` and carried `[key: string]: any` until
 * objectui#8347, so all 29 PARSED GREEN and type-checked — admitted unexamined, not refused (the reading
 * `component-fixture-declared-keys.test.ts` and
 * `undeclared-but-consumed-keys-6150.test.ts` both record), and
 * `catalog-gallery-render.test.tsx` fails only on an unregistered `type`. So the
 * demos rendered as inert button rows with every gate green, and re-authoring
 * any of the 29 tomorrow would be equally silent. That is what this file stops.
 *
 * The stakes are not cosmetic: this catalog is the corpus AI authoring tools
 * retrieve from. An author copying the old `single-selection.json` got a schema
 * that validated, published, and did nothing — the worst failure shape, because
 * it carries no signal to self-correct from.
 *
 * ## The ruling this encodes
 *
 * `button-group` stays a PRESENTATIONAL group: no selection state, no
 * `selectionMode`, no `value`, no per-button `icon`. Option 1 (implement
 * selection) was rejected — it is a fallback only if a real consumer, an app or
 * example that needs a segmented control rather than a fixture we authored
 * ourselves, is produced first.
 *
 * ## Why membership is read off the mirror rather than a list of the four keys
 *
 * A hard-coded blacklist of `value` / `icon` / `selectionMode` would pin
 * yesterday's four names and wave through the fifth. The assertions below ask
 * the shipped Zod mirror what is declared, so the rule is "author nothing
 * undeclared" and it keeps holding as the mirror moves. It also picks up the
 * refusal arms for free: `onClick` is a member of `ButtonGroupButtonSchema.shape`
 * but `handlerKeyRefusal('onClick', 'retired', …)` refuses every value, so the
 * `safeValidateSchema` leg below catches an authored `onClick` that shape
 * membership alone would pass.
 *
 * ## The blank-button leg
 *
 * `button-group.tsx` renders `{button.label}` and nothing else, so a button
 * without a label is a blank box. `icon-toolbar.json` really did render three
 * blank buttons until objectui#6318 gave it labels — which is why stripping
 * `icon` from it here is safe and why this leg exists to keep it that way.
 * `catalog-gallery-render.test.tsx` cannot see this: it fails only on an
 * unregistered type, so it renders blanks green.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { safeValidateSchema, ButtonGroupButtonSchema, ButtonGroupSchema } from '@object-ui/types/zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '..', 'src', 'schemas', 'components-basic-button-group');

const BUTTON_KEYS = new Set(Object.keys(ButtonGroupButtonSchema.shape));
const GROUP_KEYS = new Set(Object.keys(ButtonGroupSchema.shape));

interface Fixture {
  readonly name: string;
  readonly json: Record<string, unknown>;
}

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => ({
    name,
    json: JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as Record<string, unknown>,
  }));

const buttonsOf = (f: Fixture): Array<Record<string, unknown>> =>
  (f.json.buttons ?? []) as Array<Record<string, unknown>>;

describe('components-basic-button-group authors only declared keys (objectui#7077)', () => {
  it('the sweep found fixtures to sweep', () => {
    // Non-vacuity. Every `it.each` below is over this list; an empty directory
    // read would make all of them pass while asserting nothing.
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures.every((f) => f.json.type === 'button-group')).toBe(true);
    expect(buttonsOf(fixtures[0]).length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))(
    '%s: names no group-level key the mirror does not declare',
    (_name, f) => {
      expect(Object.keys(f.json).filter((k) => !GROUP_KEYS.has(k))).toEqual([]);
    },
  );

  it.each(fixtures.map((f) => [f.name, f] as const))(
    '%s: names no per-button key the mirror does not declare',
    (_name, f) => {
      const undeclared = buttonsOf(f).flatMap((b) => Object.keys(b).filter((k) => !BUTTON_KEYS.has(k)));
      expect(undeclared).toEqual([]);
    },
  );

  it.each(fixtures.map((f) => [f.name, f] as const))(
    '%s: validates, so no refused key (a retired `onClick`) slipped in',
    (_name, f) => {
      const r = safeValidateSchema(f.json);
      expect(r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
    },
  );

  it.each(fixtures.map((f) => [f.name, f] as const))(
    '%s: every button carries a non-empty `label`, the only key the group renders',
    (_name, f) => {
      const labels = buttonsOf(f).map((b) => b.label);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every((l) => typeof l === 'string' && l.trim().length > 0)).toBe(true);
    },
  );

  it('no fixture names the retired selection surface at all', () => {
    // The specific four the ruling retired, asserted once over the raw bytes so
    // that a key nested somewhere the walkers above do not reach is still
    // caught.
    for (const f of fixtures) {
      const raw = JSON.stringify(f.json);
      for (const key of ['"selectionMode"', '"value"', '"icon"', '"onValueChange"']) {
        expect(`${f.name} ${raw.includes(key) ? `AUTHORS ${key}` : 'clean'}`).toBe(`${f.name} clean`);
      }
    }
  });
});

describe('counter-probes: the readers above can still fail (objectui#7077)', () => {
  it('an undeclared group-level key would be caught', () => {
    const regressed = { type: 'button-group', selectionMode: 'single', value: 'a', buttons: [] };
    expect(Object.keys(regressed).filter((k) => !GROUP_KEYS.has(k)).sort()).toEqual([
      'selectionMode',
      'value',
    ]);
  });

  it('an undeclared per-button key would be caught', () => {
    const regressed = { label: 'Bold', value: 'bold', icon: 'bold' };
    expect(Object.keys(regressed).filter((k) => !BUTTON_KEYS.has(k)).sort()).toEqual(['icon', 'value']);
  });

  it('the undeclared keys really do PARSE GREEN — which is why membership is not read off parse', () => {
    // The whole reason this file exists: acceptance cannot tell "declared" from
    // "admitted unexamined". If this ever goes red, `BaseSchema` stopped being
    // `.passthrough()` and the sweep above could be replaced by the parser.
    expect(safeValidateSchema({ type: 'button-group', selectionMode: 'single', buttons: [] }).success).toBe(
      true,
    );
  });

  it('a retired `onClick` is refused by NAME, which the parse leg is there to catch', () => {
    expect(ButtonGroupButtonSchema.safeParse({ label: 'Copy' }).success).toBe(true);
    expect(ButtonGroupButtonSchema.safeParse({ label: 'Copy', onClick: () => undefined }).success).toBe(
      false,
    );
  });

  it('`disabled` IS declared per button — the key objectui#7077 wired rather than retired', () => {
    expect(BUTTON_KEYS.has('disabled')).toBe(true);
    expect(ButtonGroupButtonSchema.safeParse({ label: 'Cut', disabled: true }).success).toBe(true);
  });
});

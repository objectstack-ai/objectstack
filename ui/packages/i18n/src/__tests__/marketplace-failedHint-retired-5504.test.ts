// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `marketplace.load.failedHint` is retired from all ten packs, and the two keys
 * that replaced it must keep naming a real control plane (objectui#5504).
 *
 * ## What was removed and why
 *
 * One key per pack. `en` read:
 *
 *   "By default this runtime points at the public ObjectStack cloud. Check the
 *    runtime is online, or override <code>OS_CLOUD_URL</code> to point at a
 *    self-hosted control plane."
 *
 * It was rendered unconditionally under every marketplace load failure, so the
 * deployment most likely to read it was the one it was most wrong about:
 * `apps/objectos-ee/deploy/.env.example` ships `OS_CLOUD_URL=off` as its factory
 * default, and on that stack the sentence told an operator who had explicitly
 * disabled the marketplace that the runtime was still on the default, then
 * advised them to set the very variable the template had already told them to
 * set. Two false claims and a circular instruction, in one hint.
 *
 * Its replacements each state something the SERVER actually said:
 * `failedHintConfigured` names the control plane from `runtime-config`'s
 * `cloudUrl`, and `failedHintSameOrigin` covers `cloudUrl: ''`, which says
 * only that requests stay on this origin: the runtime may serve the catalog
 * or proxy a control plane it does not name, so that hint claims neither
 * (objectui#11726). Neither can claim a default the operator overrode,
 * because neither mentions a default.
 *
 * ## Why this pin is NEGATIVE, and why it is needed at all
 *
 * Every i18n gate in this repo runs **call site -> key**, never key -> call site
 * (objectui#4145's mechanism, restated by objectui#4392's retirement pin):
 *
 *   - `scripts/check-i18n-call-site-keys.mjs` asks whether each call site's key
 *     resolves in `en`. A key with no call site is never visited.
 *   - `all-locales-key-parity.test.ts` compares the ten packs' key SETS to each
 *     other. One dead key present in all ten is exactly what it wants.
 *   - `scripts/check-i18n-en-drift.mjs` only fires when an `en` value CHANGES.
 *
 * So the retired sentence can return to all ten packs with every gate green —
 * and a translator restoring "the missing hint" is a plausible way for that to
 * happen, since its replacements read as narrower. Restoring it goes red here.
 *
 * ## What this file does NOT claim
 *
 * `marketplace.load` is a live namespace. Only the one leaf went; the sibling
 * assertions below exist so a green here cannot be bought by deleting the
 * neighbourhood.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales/index';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/** The retired leaf, named rather than counted. */
const RETIRED = 'marketplace.load.failedHint';

/** Its replacements, and the neighbours the deletion swept around. */
const SURVIVING = [
  'marketplace.load.failed',
  'marketplace.load.failedHintConfigured',
  'marketplace.load.failedHintSameOrigin',
  'marketplace.load.packageFailed',
  'marketplace.load.notFound',
] as const;

/** The disabled state the retired sentence used to stand in front of. */
const DISABLED = [
  'marketplace.disabled.title',
  'marketplace.disabled.description',
  'marketplace.disabled.hint',
  'home.template.marketplaceDisabled',
] as const;

describe('`marketplace.load.failedHint` is retired from the ten packs (objectui#5504)', () => {
  it('covers all ten packs and a live `marketplace.load` root', () => {
    // Guards the premise the rest of the file rests on: a pin that iterates an
    // empty pack list, or asserts absence inside a namespace that itself
    // vanished, is green for the wrong reason.
    expect(LANGS).toHaveLength(10);
    for (const lang of LANGS) {
      const load = at(builtInLocales[lang], 'marketplace.load');
      expect(load, `${lang} lost the marketplace.load root`).toBeDefined();
      expect(Object.keys(load as Record<string, unknown>).length, lang).toBeGreaterThanOrEqual(4);
    }
  });

  it('no pack defines the retired hint', () => {
    const revived: string[] = [];
    for (const lang of LANGS) {
      if (at(builtInLocales[lang], RETIRED) !== undefined) revived.push(`${lang} :: ${RETIRED}`);
    }
    // Named, not counted: a half-reverted retirement is repaired pack by pack.
    expect(
      revived,
      'The retired marketplace load hint is back in a locale pack. It claimed ' +
        'this runtime "points at the public ObjectStack cloud by default" under ' +
        'EVERY load failure, including on the runtimes whose operator had set ' +
        '`OS_CLOUD_URL` to something else — and `off` is the EE deploy ' +
        "template's shipped default (objectui#5504). Use " +
        '`failedHintConfigured` / `failedHintSameOrigin`, which describe the ' +
        'control plane the server actually reported.',
    ).toEqual([]);
  });

  it('the deletion swept around its neighbours, and the new keys are real translations', () => {
    for (const lang of LANGS) {
      for (const key of [...SURVIVING, ...DISABLED]) {
        const value = at(builtInLocales[lang], key);
        expect(typeof value, `${lang} :: ${key}`).toBe('string');
        expect((value as string).length, `${lang} :: ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('every pack keeps the `{{url}}` hole — a hint that names no control plane is the vagueness this replaced', () => {
    // The whole point of `failedHintConfigured` is that it says WHICH control
    // plane. A pack that dropped the hole would render a sentence as
    // unfalsifiable as the retired one, and `all-locales-key-parity` reads
    // placeholder shape only against `en`'s — so state it here too, by pack.
    const holeless: string[] = [];
    for (const lang of LANGS) {
      const value = at(builtInLocales[lang], 'marketplace.load.failedHintConfigured') as string;
      if (!value.includes('{{url}}')) holeless.push(lang);
    }
    expect(holeless, 'these packs render the configured-control-plane hint with no URL in it').toEqual([]);
  });
});

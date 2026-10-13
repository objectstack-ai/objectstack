// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Class pin: a retirement prescription names the release that removed it, and
 * the pin DERIVES that release from the ADR-0087 conversion entry instead of
 * trusting the sentence.
 *
 * Governing text, `retiredKey()`'s `@param guidance` (`./retired-key.ts`):
 * "State what replaced the key, the version that removed it, and the one-line
 * fix — this string IS the migration doc for anyone who hits it." A wrong
 * version there is wrong release text: it ships in every refusal, in every
 * JSON Schema `describe`, and in what `os validate` prints.
 *
 * ## The derivation
 *
 * `MetadataConversion.retiredAfter` is the last published `@objectstack/spec`
 * release whose authoring surface still accepted the old shape
 * (`../conversions/types.ts`). So the release that removed it is the first
 * stable release after `retiredAfter`, and the prescription names that
 * release's major:
 *
 *   - `retiredAfter` is the newest published stable release ⇒ nothing published
 *     refuses the shape yet, and the release `main` cuts next does. Its major is
 *     `PROTOCOL_MAJOR`, which `../kernel/protocol-version.ts` keeps in lockstep
 *     with the package major and, in Changesets pre mode with a pending major,
 *     lets name the major that release is about to publish. On the v18 train
 *     that is 18. On the 17.x line, where a retirement shipped as a minor,
 *     the same rule gave 17.
 *   - `retiredAfter` is older ⇒ a published release refuses it: the next one on
 *     the same line when the tree records one, else the first release of the
 *     next line.
 *
 * "The newest published stable release" is read off the tree, with no version
 * written here. It is the highest stable version the tree records: every
 * census release, every `retiredAfter` stamp, and the package label when the
 * label is stable. Under a stable label that is the label: `main` carries the
 * last release's label until the next one is cut, and
 * `retired-after.census.test.ts` holds every stamp and every census release at
 * or below it. Under a prerelease label (`18.0.0-next.N`) it is the highest
 * stamp: every retirement that lands then stamps the newest published stable
 * release (`../conversions/types.ts`). The committed census alone cannot
 * answer it, because the census trails the published line until it is
 * refreshed after a stable publish.
 *
 * ## The join
 *
 * `JOIN` maps a retired conversion id to the prescriptions an author meets for
 * its surface. A tombstone row reads the key's parse refusal and its
 * `[REMOVED]` description, which are the two channels. A refusal row reads the
 * refusal the surface answers, for a value or union-arm retirement that has no
 * key to tombstone. Two guards keep the join honest:
 *
 *   - every retired entry whose `retiredAfter` is the newest published stable
 *     release must have a row, so a future retirement cannot ship its
 *     prescription unjudged;
 *   - the rows must discriminate: at least one derives `PROTOCOL_MAJOR` and at
 *     least one derives an older major, so the derivation is exercised in both
 *     directions on real entries, never vacuously.
 *
 * The three older rows are entries a 17.x minor shipped. Each is `toMajor: 18`
 * like the rest, so `toMajor` cannot be what tells them apart.
 *
 * Out of reach by construction: a retirement with no D2 conversion carries no
 * `retiredAfter`, so nothing here can derive its release (a retired-key-only
 * tombstone, or a value retired with only a D3 entry).
 *
 * Each prescription's `os migrate meta --from N` sentence is derived the same
 * way: `composeMigrationChain` keeps the majors above N, so the step that
 * replays a `toMajor: T` entry is reached by `--from T-1`.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS } from '../conversions/registry';
import { IndexSchema } from '../data/object.zod';
import { ManifestPermissionsSchema } from '../kernel/manifest.zod';
import { PROTOCOL_MAJOR } from '../kernel/protocol-version';
import { EmailTemplateDefinitionSchema } from '../system/email-template.zod';
import {
  ElementNumberPropsSchema,
  ElementRecordPickerPropsSchema,
  ElementRepeaterPropsSchema,
  ObjectGridPropsSchema,
  ObjectKanbanPropsSchema,
  PageHeaderProps,
} from '../ui/component.zod';

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

type Triple = [number, number, number];

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

function triple(v: string): Triple {
  const m = STABLE.exec(v);
  if (!m) throw new Error(`not a stable x.y.z version: '${v}'`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: string, b: string): number {
  const x = triple(a);
  const y = triple(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

const major = (v: string): number => triple(v)[0];

/** What the tree records about the published line, and the major `main` publishes next. */
interface ReleaseFacts {
  /** Every stable version the tree records: census releases, stamps, a stable label. */
  recorded: readonly string[];
  protocolMajor: number;
}

function newestStable(facts: ReleaseFacts): string {
  return facts.recorded.reduce((a, b) => (cmp(a, b) >= 0 ? a : b));
}

/** The major of the first stable release that refuses a shape last accepted by `retiredAfter`. */
function removalMajor(retiredAfter: string, facts: ReleaseFacts): number {
  if (cmp(retiredAfter, newestStable(facts)) >= 0) return facts.protocolMajor;
  const line = major(retiredAfter);
  const laterOnLine = facts.recorded.some((v) => major(v) === line && cmp(v, retiredAfter) > 0);
  return laterOnLine ? line : line + 1;
}

const LABEL = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const CENSUS = JSON.parse(
  readFileSync(new URL('../conversions/retired-after.census.json', import.meta.url), 'utf8'),
) as { precedingRelease: string; releases: { version: string }[] };

const RETIRED = ALL_CONVERSIONS.filter((c) => c.retiredFromLoadPath === true);

const FACTS: ReleaseFacts = {
  recorded: [
    CENSUS.precedingRelease,
    ...CENSUS.releases.map((r) => r.version),
    ...RETIRED.map((c) => c.retiredAfter!),
    ...(STABLE.test(LABEL) ? [LABEL] : []),
  ],
  protocolMajor: PROTOCOL_MAJOR,
};

const NEWEST_STABLE = newestStable(FACTS);

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

interface Prescription {
  where: string;
  text: string;
}

type Renderer = () => Prescription[];

type Parse = { success: boolean; error?: { issues: { message: string }[] } };
type Shaped = { shape: Record<string, { safeParse: (v: unknown) => Parse; description?: string }> };

/** A `retiredKey()` tombstone: its parse refusal and its `[REMOVED]` description. */
const tombstone = (schema: unknown, surface: string, key: string): Renderer => () => {
  const field = (schema as Shaped).shape[key];
  if (!field) throw new Error(`${surface}: no key \`${key}\` on the schema`);
  const refused = field.safeParse(1);
  expect(refused.success, `${surface}.${key} must refuse every value`).toBe(false);
  const description = field.description ?? '';
  expect(description.startsWith('[REMOVED] '), `${surface}.${key}: the description is a tombstone's`).toBe(true);
  return [
    { where: `${surface}.${key} (parse)`, text: refused.error!.issues[0]!.message },
    { where: `${surface}.${key} (describe)`, text: description.slice('[REMOVED] '.length) },
  ];
};

/** The refusal a surface answers for a retired value or union arm. */
const refusal = (where: string, parse: () => Parse): Renderer => () => {
  const refused = parse();
  expect(refused.success, `${where} must be refused`).toBe(false);
  return refused.error!.issues.map((issue) => ({ where, text: issue.message }));
};

const ELEMENTS: readonly (readonly [unknown, string, readonly string[]])[] = [
  [ElementNumberPropsSchema, 'element:number', ['object', 'filter']],
  [ElementRecordPickerPropsSchema, 'element:record_picker', ['object', 'filter', 'sort', 'limit']],
  [ElementRepeaterPropsSchema, 'element:repeater', ['object', 'filter', 'sort', 'limit']],
];

/** Retired conversion id → the prescriptions an author meets for its surface. */
const JOIN: Readonly<Record<string, readonly Renderer[]>> = {
  'element-flat-data-binding-to-data-source': ELEMENTS.flatMap(([schema, surface, keys]) =>
    keys.map((key) => tombstone(schema, surface, key)),
  ),
  'object-grid-default-filters-removed': [tombstone(ObjectGridPropsSchema, 'object-grid', 'defaultFilters')],
  'email-template-category-is-system-removed': [
    tombstone(EmailTemplateDefinitionSchema, 'email_template', 'category'),
    tombstone(EmailTemplateDefinitionSchema, 'email_template', 'isSystem'),
  ],
  'manifest-permissions-string-list-removed': [
    refusal('manifest.permissions as a list of strings', () => ManifestPermissionsSchema.safeParse(['system.user.read'])),
  ],
  'declared-index-unique-scope': [
    refusal('indexes[].unique: true', () => IndexSchema.safeParse({ fields: ['code'], unique: true })),
  ],
  // Shipped by a 17.x minor; `toMajor: 18` like the rows above.
  'page-header-breadcrumb-removed': [tombstone(PageHeaderProps, 'page:header', 'breadcrumb')],
  'object-grid-default-sort-removed': [tombstone(ObjectGridPropsSchema, 'object-grid', 'defaultSort')],
  'object-kanban-quick-add-removed': [tombstone(ObjectKanbanPropsSchema, 'object-kanban', 'quickAdd')],
};

/** Every major a prescription names as a release: `@objectstack/spec N[.x.y]` or `protocol N`. */
function majorsNamed(text: string): number[] {
  return [...text.matchAll(/@objectstack\/spec (\d+)(?:\.\d+\.\d+)?\b|\bprotocol (\d+)\b/g)].map((m) =>
    Number(m[1] ?? m[2]),
  );
}

const byId = new Map(RETIRED.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------

describe('a retirement prescription names the release the registry entry derives', () => {
  it('every joined entry is a retired conversion', () => {
    const stale = Object.keys(JOIN).filter((id) => !byId.has(id));
    expect(stale, 'JOIN names an id that is not a retired conversion').toEqual([]);
  });

  it('every entry retired after the newest published stable release is joined to its prescriptions', () => {
    const unjoined = RETIRED.filter((c) => cmp(c.retiredAfter!, NEWEST_STABLE) >= 0 && !(c.id in JOIN)).map(
      (c) => `${c.id} (retiredAfter ${c.retiredAfter})`,
    );
    expect(
      unjoined,
      `retired after ${NEWEST_STABLE}, the newest published stable release: add each to JOIN in this file, `
        + 'with the tombstones or refusals an author meets for its surface',
    ).toEqual([]);
  });

  it('the joined rows exercise the derivation in both directions', () => {
    const derived = Object.keys(JOIN).map((id) => removalMajor(byId.get(id)!.retiredAfter!, FACTS));
    expect(derived).toContain(PROTOCOL_MAJOR);
    expect(derived.some((m) => m < PROTOCOL_MAJOR)).toBe(true);
  });

  it.each(Object.keys(JOIN))('%s', (id) => {
    const entry = byId.get(id)!;
    const want = removalMajor(entry.retiredAfter!, FACTS);
    const prescriptions = JOIN[id]!.flatMap((render) => render());
    expect(prescriptions.length).toBeGreaterThan(0);
    for (const { where, text } of prescriptions) {
      const named = majorsNamed(text);
      expect(named.length, `${where}: names no release — ${text}`).toBeGreaterThan(0);
      expect(
        named.every((m) => m === want),
        `${where}: retiredAfter ${entry.retiredAfter} (newest published stable ${NEWEST_STABLE}) derives `
          + `@objectstack/spec ${want}, but the prescription names ${named.join(', ')} — ${text}`,
      ).toBe(true);
      for (const [, from] of text.matchAll(/os migrate meta --from (\d+)/g)) {
        expect(Number(from), `${where}: toMajor ${entry.toMajor} is replayed by --from ${entry.toMajor - 1}`).toBe(
          entry.toMajor - 1,
        );
      }
    }
  });
});

describe('the derivation under simulated release facts', () => {
  const at = (recorded: string[], protocolMajor: number): ReleaseFacts => ({ recorded, protocolMajor });

  it('a stable 17.x label on the v18 train: the newest stable is the next major\'s, older stamps keep 17', () => {
    const facts = at(['17.4.0', '17.5.0', '17.7.0', '17.7.0'], 18);
    expect(removalMajor('17.7.0', facts)).toBe(18);
    expect(removalMajor('17.5.0', facts)).toBe(17);
    expect(removalMajor('17.2.0', facts)).toBe(17);
  });

  it('a prerelease label records no label, and the highest stamp answers the same way', () => {
    const facts = at(['17.4.0', '17.5.0', '17.7.0'], 18);
    expect(newestStable(facts)).toBe('17.7.0');
    expect(removalMajor('17.7.0', facts)).toBe(18);
    expect(removalMajor('17.5.0', facts)).toBe(17);
  });

  it('once 18.0.0 is the label, a 17.7.0 stamp still derives 18, and an 18.x stamp stays on 18', () => {
    const facts = at(['17.4.0', '17.5.0', '17.7.0', '18.0.0', '18.1.0'], 18);
    expect(removalMajor('17.7.0', facts)).toBe(18);
    expect(removalMajor('17.5.0', facts)).toBe(17);
    expect(removalMajor('18.0.0', facts)).toBe(18);
    expect(removalMajor('18.1.0', facts)).toBe(18);
  });

  it('on the 17.x line, where a retirement shipped as a minor, the newest stamp derives 17', () => {
    const facts = at(['17.4.0', '17.5.0'], 17);
    expect(removalMajor('17.5.0', facts)).toBe(17);
  });

  it('the tree\'s own reading: the newest published stable is at least every census release', () => {
    for (const r of CENSUS.releases) expect(cmp(NEWEST_STABLE, r.version)).toBeGreaterThanOrEqual(0);
  });
});

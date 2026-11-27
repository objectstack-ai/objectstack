// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The verified builds under `docs/qa/scenarios/builds/` (the scenarios README,
 * Verified builds): each `<id>.json` is the build the ask rounds install for
 * card `<id>`, and its `<id>.provenance.json` names what it was verified
 * against. These pins keep the two from drifting apart without a PR saying so:
 *
 * - the provenance's `sha256` is the build file's own, so a hand edit of the
 *   build carries an `amended` entry naming the sha256 it replaced;
 * - its `cardSha256` is the card file in the tree now, so a card edit re-reads
 *   the build against the new card in the same PR (re-pin with an `amended`
 *   entry when the Build reading is unchanged, else a new build);
 * - the build's protocol range admits the protocol this tree ships, or the
 *   install the round starts with is refused (`OS_PROTOCOL_INCOMPATIBLE`).
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { checkProtocolCompat } from '@objectstack/metadata-core';
import { PROTOCOL_VERSION } from '@objectstack/spec/kernel';

import { formatRefusal, loadScenarios, readCapabilityAreas } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = resolve(HERE, '../../../../docs/qa/scenarios');
const BUILDS_DIR = join(SCENARIOS_DIR, 'builds');
const AREAS_DIR = resolve(HERE, '../../../../docs/qa/platform-checklist/areas');

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

const builds = readdirSync(BUILDS_DIR)
  .filter((name) => name.endsWith('.json') && !name.endsWith('.provenance.json'))
  .sort()
  .map((name) => name.slice(0, -'.json'.length));

interface Provenance {
  card?: unknown;
  cardSha256?: unknown;
  build?: unknown;
  sha256?: unknown;
  amended?: Array<{ on?: unknown; card?: unknown; what?: unknown; why?: unknown }>;
}

describe('verified builds — each build matches its provenance and its card', () => {
  it('the directory holds a build for every dataset card', () => {
    const { cards, refusals } = loadScenarios(SCENARIOS_DIR, { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });
    expect(refusals.map(formatRefusal)).toEqual([]);
    const datasetCards = cards
      .filter((c) => (c.card.run.datasetQuestions ?? []).length > 0)
      .map((c) => c.card.id)
      .sort();
    expect(datasetCards.length).toBeGreaterThan(0);
    expect(builds).toEqual(datasetCards);
  });

  describe.each(builds)('%s', (id) => {
    const buildFile = join(BUILDS_DIR, `${id}.json`);
    const provenanceFile = join(BUILDS_DIR, `${id}.provenance.json`);
    const cardFile = join(SCENARIOS_DIR, `${id}.json`);
    const provenance = (): Provenance => JSON.parse(readFileSync(provenanceFile, 'utf8')) as Provenance;

    it('has a provenance beside it that names this build and this card', () => {
      expect(existsSync(provenanceFile), `${id}.provenance.json is missing`).toBe(true);
      expect(existsSync(cardFile), `no card ${id}.json beside builds/`).toBe(true);
      expect(provenance().card).toBe(id);
      expect(provenance().build).toBe(`${id}.json`);
    });

    it("its provenance's sha256 is the build file's", () => {
      expect(
        sha256(buildFile),
        `builds/${id}.json changed without its provenance: a hand edit records an \`amended\` entry naming the sha256 it replaced, then moves \`sha256\``,
      ).toBe(provenance().sha256);
    });

    it("its provenance's cardSha256 is the card file in the tree", () => {
      expect(
        sha256(cardFile),
        `${id}.json changed since builds/${id}.json was verified: re-score the build against the new card; an unchanged Build reading re-pins \`cardSha256\` with an \`amended\` entry, a changed one needs a new build`,
      ).toBe(provenance().cardSha256);
    });

    it('each amended entry says when, under which card, what changed and why', () => {
      for (const entry of provenance().amended ?? []) {
        expect(entry.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(entry.card).toMatch(/^objectstack-ai\/objectstack#\d+$/);
        expect(typeof entry.what === 'string' && entry.what.length > 0).toBe(true);
        expect(typeof entry.why === 'string' && entry.why.length > 0).toBe(true);
      }
    });

    it(`its protocol range admits this tree's protocol (${PROTOCOL_VERSION})`, () => {
      const artifact = JSON.parse(readFileSync(buildFile, 'utf8')) as { manifest?: Record<string, unknown> };
      const result = checkProtocolCompat(artifact.manifest ?? {}, PROTOCOL_VERSION);
      expect(result.status, `builds/${id}.json: the load-time handshake reads ${JSON.stringify(result)}`).toBe('ok');
    });
  });
});

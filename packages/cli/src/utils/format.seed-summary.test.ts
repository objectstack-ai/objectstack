// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printServerReady, type ServerReadyOptions, type SeedSourceSummary } from './format.js';

/**
 * #3415/#3430 — the boot banner is the ONE place a developer reliably sees seed
 * outcomes: SeedLoader's own result logs are `info`, under the default `warn`
 * level. (They were additionally swallowed by the serve boot-quiet window at
 * every level until framework#4012; the level gate is what still hides them.)
 * Assert the Seeds line prints per source, screams on
 * rejections AND empty marketplace installs, marks fresh-DB heals, and stays
 * silent when nothing was seeded.
 */
describe('printServerReady seed summary (#3415/#3430)', () => {
  const base: ServerReadyOptions = {
    port: 3000,
    configFile: 'objectstack.config.ts',
    isDev: true,
    pluginCount: 1,
  };
  let lines: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lines = [];
    // stderr, not stdout (#7915): the whole banner is a diagnostic, and
    // `serve` keeps stdout clear for the MCP stdio transport.
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
  });
  afterEach(() => spy.mockRestore());

  const seedLines = () => lines.filter((l) => l.includes('Seeds:'));
  const s = (o: Partial<SeedSourceSummary> & { source: string }): SeedSourceSummary => ({
    inserted: 0, updated: 0, skipped: 0, rejected: 0, ...o,
  });

  it('prints a quiet one-liner for a clean config-app seed', () => {
    printServerReady({ ...base, seeds: [s({ source: 'showcase', inserted: 42, updated: 6, skipped: 3 })] });
    expect(seedLines()).toHaveLength(1);
    expect(seedLines()[0]).toContain('showcase 51 rows');
    expect(seedLines()[0]).not.toContain('⚠');
  });

  it('screams when records were rejected, naming the source', () => {
    printServerReady({ ...base, seeds: [s({ source: 'showcase', inserted: 24, rejected: 14 })] });
    expect(seedLines()).toHaveLength(1);
    expect(seedLines()[0]).toContain('showcase 24 ok / 14 errors ⚠');
    expect(lines.some((l) => l.includes('OS_LOG_LEVEL=info'))).toBe(true);
  });

  it('screams about lost links even when every row landed (#3932)', () => {
    // The "wrote the row, lost the link" case: nothing rejected, the row counts
    // look perfect, an association is silently missing. This line used to read
    // `showcase 42 rows` — clean, and wrong.
    printServerReady({ ...base, seeds: [s({ source: 'showcase', inserted: 42, droppedRefs: 3 })] });
    expect(seedLines()).toHaveLength(1);
    expect(seedLines()[0]).toContain('showcase 42 ok / 3 lost links ⚠');
    expect(lines.some((l) => l.includes('OS_LOG_LEVEL=info'))).toBe(true);
  });

  it('reports rejected records and lost links together, singular-aware', () => {
    printServerReady({ ...base, seeds: [s({ source: 'showcase', inserted: 20, rejected: 1, droppedRefs: 1 })] });
    expect(seedLines()[0]).toContain('showcase 20 ok / 1 error / 1 lost link ⚠');
  });

  it('stays quiet when no reference was dropped', () => {
    printServerReady({ ...base, seeds: [s({ source: 'showcase', inserted: 42, droppedRefs: 0 })] });
    expect(seedLines()[0]).toContain('showcase 42 rows');
    expect(seedLines()[0]).not.toContain('lost link');
    expect(seedLines()[0]).not.toContain('⚠');
  });

  it('labels a marketplace package and marks a fresh-DB heal', () => {
    printServerReady({
      ...base,
      seeds: [s({ source: 'hotcrm', marketplace: true, inserted: 157, healed: true })],
    });
    expect(seedLines()).toHaveLength(1);
    expect(seedLines()[0]).toContain('hotcrm(marketplace) 157 rows (healed on fresh db)');
    expect(seedLines()[0]).not.toContain('⚠');
  });

  it('escalates an installed-but-empty marketplace package', () => {
    printServerReady({
      ...base,
      seeds: [s({ source: 'hotcrm', marketplace: true, emptyInstall: true })],
    });
    expect(seedLines()).toHaveLength(1);
    expect(seedLines()[0]).toContain('hotcrm(marketplace) installed but 0 rows ⚠');
  });

  it('combines multiple sources on one line', () => {
    printServerReady({
      ...base,
      seeds: [
        s({ source: 'showcase', inserted: 162 }),
        s({ source: 'hotcrm', marketplace: true, inserted: 157, rejected: 5 }),
      ],
    });
    expect(seedLines()).toHaveLength(1);
    expect(seedLines()[0]).toContain('showcase 162 rows');
    expect(seedLines()[0]).toContain('hotcrm(marketplace) 157 ok / 5 errors ⚠');
  });

  it('stays silent when no summary was collected or nothing ran', () => {
    printServerReady({ ...base });
    printServerReady({ ...base, seeds: [] });
    printServerReady({ ...base, seeds: [s({ source: 'showcase' })] });
    expect(seedLines()).toHaveLength(0);
  });
});

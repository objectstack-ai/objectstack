// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#32153) — the root help page (`os` / `os --help`) lists each topic
 * with a description OF THE TOPIC.
 *
 * oclif takes a topic's line on the root page from `oclif.topics` in
 * package.json and, when that declares none, from the description of the
 * first command it finds in the topic. Measured with 18.3.0, `os --help` read
 * `data  Create a new record`, `meta  Delete a metadata item` and
 * `db  Reclaim SQLite free space…` — one subcommand each, not the topic.
 *
 * Read from the filesystem and package.json only: a topic is a directory under
 * `src/commands`, so a topic added tomorrow without a description is red here
 * on the day it lands.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');

describe('every topic the root help lists describes the topic, not one of its commands', () => {
  // oclif takes a topic's line on the root page from `oclif.topics` in
  // package.json and, when that declares none, from the description of the
  // first command it finds in the topic — so `os --help` read
  // `data  Create a new record` and `meta  Delete a metadata item`. A topic is
  // a directory under src/commands; one with an `index.ts` IS a command
  // (`os migrate`), whose own description is the topic's line.
  const COMMANDS = join(PKG, 'src', 'commands');
  const topicDirs = (dir: string, prefix: string[] = []): string[][] =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const id = [...prefix, entry.name];
        const sub = join(dir, entry.name);
        const commands = readdirSync(sub).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
        return commands.length > 0 ? [id, ...topicDirs(sub, id)] : topicDirs(sub, id);
      });

  it('every topic without an index command declares a description of its own, and none is stale', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
    const declared: Record<string, { description?: string }> = pkg.oclif.topics ?? {};
    const owed = topicDirs(COMMANDS)
      .filter((id) => !existsSync(join(COMMANDS, ...id, 'index.ts')))
      .map((id) => id.join(':'));
    expect(owed.length).toBeGreaterThan(5);
    for (const topic of owed) {
      expect(declared[topic]?.description, `\`os ${topic.replace(/:/g, ' ')}\` has no oclif.topics description`).toMatch(/\S/);
    }
    // A declared topic with no directory behind it describes nothing.
    for (const topic of Object.keys(declared)) {
      expect(owed, `oclif.topics.${topic} names no topic directory`).toContain(topic);
    }
  });

  it('a declared description is not one of the topic\'s command descriptions', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
    for (const [topic, { description }] of Object.entries<{ description: string }>(pkg.oclif.topics ?? {})) {
      const dir = join(COMMANDS, ...topic.split(':'));
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
        const source = readFileSync(join(dir, file), 'utf8');
        expect(source, `oclif.topics.${topic} repeats ${file}'s description`).not.toContain(`'${description}'`);
      }
    }
  });
});


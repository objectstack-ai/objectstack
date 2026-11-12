// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32154] MetadataManager's lines follow the host's logger level.
//
// The manager used to build its own logger at a fixed `info` in its
// constructor. `MetadataPlugin` builds the manager before any kernel exists,
// and `NodeMetadataManager` registers its filesystem loader in its own
// constructor, so `INFO Registered metadata loader: …` printed into every boot,
// whatever level the boot ran at. A host that sets `awaitHostLogger` now gets
// the manager's debug/info lines held and replayed through the logger it hands
// over (`useHostLogger`), so they follow that logger's level; warn and above
// never wait. Without the option nothing changes. The real platform logger
// (`createLogger`, writing to `process.stdout`) is what is read here.

import { describe, it, expect } from 'vitest';
import { createLogger } from '@objectstack/core';
import { MetadataManager } from './metadata-manager.js';
import { MemoryLoader } from './loaders/memory-loader.js';

const REGISTERED = 'Registered metadata loader: memory';

/** Every line written to the process streams while `fn` runs, printing nothing. */
function captureStreams(fn: () => void): string[] {
  const written: string[] = [];
  const restores = [process.stdout, process.stderr].map((stream) => {
    const original = stream.write;
    (stream as any).write = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    return () => {
      (stream as any).write = original;
    };
  });
  try {
    fn();
  } finally {
    for (const restore of restores) restore();
  }
  return written.join('').split('\n').filter((line) => line.trim() !== '');
}

/** A logger that records what reached it, in order. */
function recordingLogger() {
  const lines: Array<{ level: string; message: string }> = [];
  const at = (level: string) => (message: string) => void lines.push({ level, message });
  return { lines, logger: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') } };
}

describe('[#32154] MetadataManager follows the host logger level', () => {
  it('without awaitHostLogger it logs through its own info logger, as before', () => {
    const lines = captureStreams(() => {
      new MetadataManager({ formats: ['json'] }).registerLoader(new MemoryLoader());
    });
    expect(lines.filter((l) => / INFO /.test(l) && l.includes(REGISTERED))).toHaveLength(1);
  });

  it('with awaitHostLogger, a loader registered before the host arrives prints nothing yet', () => {
    const lines = captureStreams(() => {
      new MetadataManager({ formats: ['json'], awaitHostLogger: true }).registerLoader(new MemoryLoader());
    });
    expect(lines).toEqual([]);
  });

  it('a host logger at warn swallows the held INFO line; one at info prints it', () => {
    const quiet = captureStreams(() => {
      const manager = new MetadataManager({ formats: ['json'], awaitHostLogger: true });
      manager.registerLoader(new MemoryLoader());
      manager.useHostLogger(createLogger({ level: 'warn', format: 'pretty' }));
    });
    expect(quiet).toEqual([]);

    const loud = captureStreams(() => {
      const manager = new MetadataManager({ formats: ['json'], awaitHostLogger: true });
      manager.registerLoader(new MemoryLoader());
      manager.useHostLogger(createLogger({ level: 'info', format: 'pretty' }));
    });
    expect(loud.filter((l) => / INFO /.test(l) && l.includes(REGISTERED))).toHaveLength(1);
  });

  it('replays the held lines in order through the host, and later lines go straight to it', () => {
    const host = recordingLogger();
    const manager = new MetadataManager({ formats: ['json'], awaitHostLogger: true });
    const first = new MemoryLoader();
    manager.registerLoader(first);
    manager.useHostLogger(host.logger as any);
    expect(host.lines).toEqual([{ level: 'info', message: REGISTERED }]);

    (manager as any).logger.debug('after the handoff');
    expect(host.lines.at(-1)).toEqual({ level: 'debug', message: 'after the handoff' });
  });

  it('⛔ a warning never waits for the host: it prints at once, through the manager`s own logger', () => {
    const manager = new MetadataManager({ formats: ['json'], awaitHostLogger: true });
    const lines = captureStreams(() => (manager as any).logger.warn('something is wrong'));
    expect(lines.filter((l) => / WARN /.test(l) && l.includes('something is wrong'))).toHaveLength(1);

    const host = recordingLogger();
    manager.useHostLogger(host.logger as any);
    // Not replayed a second time.
    expect(host.lines).toEqual([]);
  });

  it('the logger object the manager hands its loaders is the same one before and after the handoff', () => {
    const manager = new MetadataManager({ formats: ['json'], awaitHostLogger: true });
    const before = (manager as any).logger;
    const host = recordingLogger();
    manager.useHostLogger(host.logger as any);
    expect((manager as any).logger).toBe(before);
    before.info('from a loader holding the early reference');
    expect(host.lines.at(-1)).toEqual({ level: 'info', message: 'from a loader holding the early reference' });
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#4012 — `os dev` / `os serve` swallowed every plugin boot-phase log line.
 *
 * `serve` blanks stdout while the kernel boots so the startup banner is
 * readable. `ObjectLogger` routes `debug`/`info`/`warn` to **stdout** (only
 * `error`/`fatal` go to stderr), so for as long as that window discarded its
 * bytes outright, no plugin's boot-phase `logger.warn` could reach a terminal —
 * on either entrypoint, at any `--log-level`. `os dev` inherits the `serve`
 * child's stdio, so one drain blinded both. Data-phase logging (after the
 * window closes) streamed normally, which is exactly why the hole survived:
 * `--log-level debug` printed thousands of lines and not one of them was from
 * boot.
 *
 * The window is worth keeping, so it became a buffer: kernel-logger records are
 * retained and replayed under the banner, and the rest of the startup chatter is
 * still dropped. These tests pin both halves of that split — including against a
 * REAL `ObjectLogger`, so a change to its line format fails here rather than
 * silently re-opening the hole.
 */

import { describe, it, expect } from 'vitest';
import { ObjectLogger } from '@objectstack/core';
import {
  BootLogCapture,
  classifyBootLogLine,
  isBootDiagnostic,
  isVerboseBootLevel,
  stripAnsi,
} from './boot-log-capture.js';

/** ObjectLogger's `pretty` head, uncolored: `<iso> <LEVEL>`. */
const pretty = (level: string, rest: string) => `2026-07-30T02:41:53.123Z ${level} ${rest}`;

/**
 * Reinstall the interception `serve` puts on stdout during boot, and hand the
 * bytes to `capture` exactly as the command does. Restores on the way out.
 */
function underBootQuietWindow(capture: BootLogCapture, run: () => void): void {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: any, ...rest: any[]) => {
    capture.write(chunk, typeof rest[0] === 'string' ? rest[0] : undefined);
    const cb = rest.find((a) => typeof a === 'function');
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  try {
    run();
  } finally {
    process.stdout.write = original;
  }
}

describe('classifyBootLogLine', () => {
  it('reads the level off every format ObjectLogger renders', () => {
    expect(classifyBootLogLine(pretty('WARN', '[kernel] something degraded'))).toBe('warn');
    expect(classifyBootLogLine(pretty('DEBUG', 'Triggering kernel:ready hook'))).toBe('debug');
    expect(classifyBootLogLine(pretty('INFO', '✅ Bootstrap complete'))).toBe('info');
    // text: `<iso> | LEVEL | message`
    expect(classifyBootLogLine('2026-07-30T02:41:53.123Z | WARN | degraded')).toBe('warn');
    // json
    expect(
      classifyBootLogLine('{"time":"2026-07-30T02:41:53.123Z","level":"warn","msg":"degraded"}'),
    ).toBe('warn');
  });

  it('sees through the color ObjectLogger wraps the head in', () => {
    // `${LEVEL_COLORS[level]}${ts} ${LEVEL}${RESET}${tail}` — the real shape
    // when stdout is a TTY, which is the case that matters on a dev machine.
    const colored = `\u001B[33m2026-07-30T02:41:53.123Z WARN\u001B[0m [action-governance] undeclared handler`;
    expect(classifyBootLogLine(colored)).toBe('warn');
    expect(stripAnsi(colored)).toBe(
      '2026-07-30T02:41:53.123Z WARN [action-governance] undeclared handler',
    );
  });

  it('does not mistake startup chatter for a logger record', () => {
    // Everything the quiet window exists to hide must stay hidden, or the fix
    // trades a silent boot for an unreadable banner.
    for (const noise of [
      '',
      '   ',
      '  Loading objectstack.config.ts...',
      '⠋ building',
      'ObjectStack v17.0.0',
      '{ not json',
      '{"msg":"no level or time"}',
      '2026-07-30 02:41:53 WARN not-an-iso-timestamp',
      'WARN: leading level, no timestamp',
    ]) {
      expect(classifyBootLogLine(noise), noise).toBeNull();
    }
  });
});

describe('isBootDiagnostic', () => {
  it('keeps warn and above, drops the info/debug chatter', () => {
    expect(isBootDiagnostic(pretty('WARN', 'x'))).toBe(true);
    expect(isBootDiagnostic(pretty('ERROR', 'x'))).toBe(true);
    expect(isBootDiagnostic(pretty('FATAL', 'x'))).toBe(true);
    expect(isBootDiagnostic(pretty('INFO', 'x'))).toBe(false);
    expect(isBootDiagnostic(pretty('DEBUG', 'x'))).toBe(false);
    expect(isBootDiagnostic('  Loading config...')).toBe(false);
  });
});

describe('isVerboseBootLevel', () => {
  it('is the levels that ask to watch the boot happen', () => {
    // At these the window never opens at all — buffering a stream the operator
    // explicitly asked for would be the flag defeating itself.
    expect(isVerboseBootLevel('debug')).toBe(true);
    expect(isVerboseBootLevel('info')).toBe(true);
    expect(isVerboseBootLevel('warn')).toBe(false);
    expect(isVerboseBootLevel('error')).toBe(false);
    expect(isVerboseBootLevel('fatal')).toBe(false);
    expect(isVerboseBootLevel('silent')).toBe(false);
  });
});

describe('BootLogCapture', () => {
  it('survives a record split across write chunks', () => {
    // pino-pretty and ObjectLogger both write whole lines, but stdout chunking
    // is not a guarantee — a fragment classified on its own is unparseable and
    // would be dropped as noise.
    const capture = new BootLogCapture();
    capture.write('2026-07-30T02:41:53.123Z WA');
    capture.write('RN [action-governance] undeclared handler\n');
    expect(capture.diagnostics()).toEqual([
      '2026-07-30T02:41:53.123Z WARN [action-governance] undeclared handler',
    ]);
  });

  it('flushes a trailing record that never got its newline', () => {
    // The last warning before a boot dies is exactly the one that arrives
    // unterminated.
    const capture = new BootLogCapture();
    capture.write(pretty('WARN', 'datasource unreachable — DEGRADED BOOT'));
    expect(capture.diagnostics()).toEqual([
      '2026-07-30T02:41:53.123Z WARN datasource unreachable — DEGRADED BOOT',
    ]);
  });

  it('keeps order, strips \\r, and drops the noise between records', () => {
    const capture = new BootLogCapture();
    capture.write(
      [
        '  Loading objectstack.config.ts...',
        pretty('INFO', 'Phase 1: Init plugins'),
        `${pretty('WARN', 'first')}\r`,
        'SchemaRegistry: 42 objects',
        pretty('WARN', 'second'),
        '',
      ].join('\n'),
    );
    expect(capture.diagnostics()).toEqual([
      '2026-07-30T02:41:53.123Z WARN first',
      '2026-07-30T02:41:53.123Z WARN second',
    ]);
  });

  it('is bounded — a boot that warns forever cannot grow the buffer forever', () => {
    const capture = new BootLogCapture(120);
    for (let i = 0; i < 50; i++) capture.write(`${pretty('WARN', `warning ${i}`)}\n`);
    const kept = capture.diagnostics();
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(50);
    expect(capture.droppedCount).toBe(50 - kept.length);
    // The ones it did keep are the earliest — a boot's first warning is
    // usually the cause and the rest the consequences.
    expect(kept[0]).toContain('warning 0');
  });

  it('holds nothing when a boot logged nothing', () => {
    const capture = new BootLogCapture();
    capture.write('  Loading objectstack.config.ts...\n');
    expect(capture.diagnostics()).toEqual([]);
    expect(capture.droppedCount).toBe(0);
  });
});

describe('the #4012 regression — a real ObjectLogger under the boot-quiet window', () => {
  it('retains a boot-phase logger.warn that the window used to swallow', () => {
    // The positive control from the issue: the ADR-0110 D5 inventory warns
    // through `logger.warn`, lands on stdout, and vanished. Drive the REAL
    // logger through the REAL interception and require it to come back out.
    const capture = new BootLogCapture();
    const logger = new ObjectLogger({ level: 'warn' });

    underBootQuietWindow(capture, () => {
      logger.warn(
        '[action-governance] registered handlers with NO declaration — these are REFUSED at dispatch',
        { count: 1, handlers: ['todo:archive'] },
      );
    });

    const diagnostics = capture.diagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('[action-governance]');
    expect(diagnostics[0]).toContain('todo:archive');
  });

  it('still keeps the banner clean when a host runs a chattier kernel level', () => {
    // The window's whole purpose. A host that configures `info` gets its
    // warnings replayed and its startup narration dropped.
    const capture = new BootLogCapture();
    const logger = new ObjectLogger({ level: 'info' });

    underBootQuietWindow(capture, () => {
      logger.info('Phase 1: Init plugins');
      logger.info('Plugin registered: com.objectstack.todo@1.0.0');
      logger.warn('Service not provided — using in-memory fallback', { service: 'queue' });
      logger.info('✅ Bootstrap complete');
    });

    const diagnostics = capture.diagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('using in-memory fallback');
    expect(diagnostics.join('\n')).not.toContain('Bootstrap complete');
  });

  it('captures error/fatal too, for the hosts that route them to stdout', () => {
    // ObjectLogger sends these to stderr, which the window never touched — but
    // the filter must not be the reason they would go missing if it did.
    const capture = new BootLogCapture();
    capture.write(`${pretty('ERROR', 'Plugin startup failed: com.objectstack.todo')}\n`);
    capture.write(`${pretty('FATAL', 'kernel unrecoverable')}\n`);
    expect(capture.diagnostics()).toHaveLength(2);
  });
});

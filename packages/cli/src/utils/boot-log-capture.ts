// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { CliLogLevel } from './log-level.js';

// ---------------------------------------------------------------------------
// Boot-phase log capture (#4012).
//
// `serve` blanks stdout while the kernel boots so the startup banner is not
// buried under startup chatter (pino-pretty, SchemaRegistry, plugin
// `console.log`). That window used to *discard* the bytes outright:
//
//     process.stdout.write = (chunk, ...rest) => {
//       if (bootQuiet) return true;  // swallow
//       ...
//     };
//
// `ObjectLogger` writes `debug`/`info`/`warn` to **stdout** and only
// `error`/`fatal` to stderr, so that one line swallowed every boot-phase
// `logger.warn` any plugin emits — the ADR-0110 D5 `[action-governance]`
// inventory, the automation engine's binding warnings, every degraded-boot
// notice — while data-phase logging (after the window closes) streamed fine.
// The CLI's `--log-level` help promises the opposite: it defaults to `warn`
// precisely "so flow/hook execution failures surface (ADR-0032)".
//
// The window itself is worth keeping, so the fix is to make it a *buffer*
// rather than a drain: retain the kernel-logger records that carry
// diagnostics and replay them once the banner has printed. Everything else in
// the window is the chatter the window exists to hide, and is still dropped.
//
// Capture is line-oriented and filters as it goes, so a long boot cannot grow
// the buffer past the diagnostics themselves.
// ---------------------------------------------------------------------------

/** Levels `ObjectLogger` stamps onto a record, in severity order. */
const LEVEL_ORDER = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
} as const;

export type BootLogLevel = keyof typeof LEVEL_ORDER;

/**
 * Severity at or above which a boot-phase record is a *diagnostic* — something
 * the operator needs to see even though the banner owns the screen.
 *
 * `warn` matches the CLI's own default kernel level: at that level the logger
 * only emits `warn` (stdout) and `error`/`fatal` (stderr), so in practice every
 * record that reaches this filter is already one an operator asked for. The
 * floor still earns its keep when a *host* configures a chattier kernel level
 * than the CLI flag — the banner stays clean instead of absorbing its info log.
 */
export const BOOT_DIAGNOSTIC_FLOOR: BootLogLevel = 'warn';

/** Default cap on retained diagnostics, in characters. */
export const BOOT_LOG_CAPTURE_LIMIT = 256 * 1024;

/** SGR color sequences — the head `ObjectLogger` wraps when stdout is a TTY. */
const ANSI_SGR = /\u001B\[[0-9;]*m/g;

/**
 * `ObjectLogger`'s three renderings of one record, as emitted by
 * `logger.write()`:
 *
 *   pretty  `2026-07-30T02:41:53.123Z WARN [name] message {"ctx":1}`
 *   text    `2026-07-30T02:41:53.123Z | WARN | message | {"ctx":1}`
 *   json    `{"time":"2026-07-30T02:41:53.123Z","level":"warn","msg":"…"}`
 *
 * `pretty` (the CLI's format — the kernel constructs the logger from a bare
 * `{ level }`, so `ObjectLogger`'s own `'pretty'` default applies) colors the
 * `<ts> <LEVEL>` head, hence the ANSI strip before matching.
 */
const PRETTY_OR_TEXT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?: \|)? (DEBUG|INFO|WARN|ERROR|FATAL)\b/;

/** Strip SGR color so a colored record classifies the same as a plain one. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR, '');
}

/**
 * Read the level off one raw stdout line, or `null` when the line is not a
 * kernel-logger record (spinner frames, third-party banners, bare
 * `console.log` — the noise the boot-quiet window exists to hide).
 */
export function classifyBootLogLine(raw: string): BootLogLevel | null {
  const line = stripAnsi(raw).trim();
  if (!line) return null;

  if (line.startsWith('{')) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return null;
    }
    const rec = record as { level?: unknown; time?: unknown } | null;
    if (!rec || typeof rec.time !== 'string' || typeof rec.level !== 'string') return null;
    const level = rec.level.toLowerCase();
    return level in LEVEL_ORDER ? (level as BootLogLevel) : null;
  }

  const match = PRETTY_OR_TEXT.exec(line);
  return match ? (match[1].toLowerCase() as BootLogLevel) : null;
}

/**
 * Whether a raw stdout line is a boot diagnostic worth replaying after the
 * banner — a kernel-logger record at or above {@link BOOT_DIAGNOSTIC_FLOOR}.
 */
export function isBootDiagnostic(raw: string, floor: BootLogLevel = BOOT_DIAGNOSTIC_FLOOR): boolean {
  const level = classifyBootLogLine(raw);
  return level !== null && LEVEL_ORDER[level] >= LEVEL_ORDER[floor];
}

/**
 * Whether the operator asked for a verbose kernel level.
 *
 * At `debug`/`info` the boot-quiet window is self-defeating: they opted into
 * the stream, so `serve` skips quieting entirely and boot output goes live
 * rather than being buffered and replayed. A clean banner is not worth a
 * silent boot when the whole point of the flag is to watch one.
 */
export function isVerboseBootLevel(level: CliLogLevel): boolean {
  return level === 'debug' || level === 'info';
}

/**
 * Line-oriented, bounded sink for the bytes `serve`'s boot-quiet window would
 * otherwise discard. Retains only diagnostics, so buffer size tracks the
 * warnings a boot emits and not how chatty the boot was.
 */
export class BootLogCapture {
  private carry = '';
  private retained: string[] = [];
  private retainedChars = 0;
  private dropped = 0;

  constructor(
    private readonly limit: number = BOOT_LOG_CAPTURE_LIMIT,
    private readonly floor: BootLogLevel = BOOT_DIAGNOSTIC_FLOOR,
  ) {}

  /**
   * Feed one `process.stdout.write` chunk. Chunks split mid-line, so the
   * trailing fragment is carried into the next call rather than classified as
   * its own (unparseable, therefore dropped) line.
   */
  write(chunk: string | Uint8Array, encoding?: string): void {
    const text =
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk).toString(
            // `encoding` arrives off `process.stdout.write`'s untyped varargs,
            // so it is validated rather than trusted.
            encoding && Buffer.isEncoding(encoding) ? encoding : 'utf8',
          );

    this.carry += text;
    let newline = this.carry.indexOf('\n');
    while (newline !== -1) {
      this.offer(this.carry.slice(0, newline));
      this.carry = this.carry.slice(newline + 1);
      newline = this.carry.indexOf('\n');
    }
  }

  private offer(line: string): void {
    const trimmed = line.replace(/\r$/, '');
    if (!isBootDiagnostic(trimmed, this.floor)) return;
    if (this.retainedChars + trimmed.length > this.limit) {
      this.dropped += 1;
      return;
    }
    this.retained.push(trimmed);
    this.retainedChars += trimmed.length;
  }

  /**
   * The diagnostics to replay, in emission order. Flushes any trailing
   * fragment that never got its newline — the last warning before a boot
   * crash is exactly the one that tends to arrive unterminated.
   */
  diagnostics(): string[] {
    if (this.carry) {
      this.offer(this.carry);
      this.carry = '';
    }
    return this.retained;
  }

  /** Diagnostics discarded because the buffer was full. */
  get droppedCount(): number {
    return this.dropped;
  }
}

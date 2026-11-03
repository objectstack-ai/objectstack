// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The refusal a config load raises when a `define*` helper's `Schema.parse`
 * throws a raw `ZodError` while the config MODULE evaluates.
 *
 * ## The defect this closes
 *
 * `defineView`, `defineAction` and the other strict helpers call
 * `Schema.parse` and let the `ZodError` out as is. Nothing on the normal load
 * path wrapped it, and every command's catch-all printed `error.message` —
 * which for a `ZodError` is its issues as a JSON array. Measured on this tree
 * with a `defineView` mixing string and object `list.columns`: `os validate`,
 * `os build`, `os lint`, `os dev` and `os serve` all printed `✗ [` and 40-odd
 * lines of JSON, naming no file, no helper and no remedy.
 *
 * ## What it renders, and with what
 *
 * The issues go through the project's own `formatZodError` — the formatter the
 * `os migrate meta` shim's `__refusal` and the loader's own `defineStack
 * validation failed` block already use, union branch expansion included. There
 * is no second formatter here: this file only works out WHERE the refused call
 * is, and puts that in front of the block.
 *
 * ## How the location is read, and when it is not
 *
 * bundle-require evaluates one esbuild bundle of the config and every module
 * it imports (an `@objectstack/*` package or a `node_modules` dependency stays
 * external), with an inline source map. The innermost stack frame inside that
 * bundle is therefore the authored call that threw, and the map turns it back
 * into the authored file, line and column. The frame directly above it is the
 * function that call entered: the helper, named only when it is a `define*`
 * function whose name the authored line actually spells.
 *
 * ⛔ Never a guessed file. When the stack holds no frame in the bundle (a
 * truncated stack, an error rethrown from a promise), when the map has no
 * entry on that generated line, or when the mapped file is not on disk,
 * {@link locateConfigLoadZodError} answers `undefined` and the refusal names
 * the config entry it was loading, saying the module that threw is unknown.
 */

import fs from 'fs';
import path from 'path';
import { SourceMap } from 'node:module';
import { fileURLToPath } from 'node:url';
import { formatZodError } from '@objectstack/spec';

/** The bundle bundle-require evaluated: its path on disk and its text. */
export interface EvaluatedConfigBundle {
  readonly file: string;
  readonly text: string;
}

/** Where the refused call is in the authored source. */
export interface ConfigLoadZodLocation {
  /** Absolute path of the authored module that made the refused call. */
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
  /** The `define*` helper the call entered, when the stack and the line agree on it. */
  readonly helper?: string;
}

/** A `ZodError` as `Schema.parse` throws it: by shape, not `instanceof` (two zod copies can be live). */
export function isRawZodError(error: unknown): error is Error & { issues: unknown[] } {
  return (
    error instanceof Error
    && error.name === 'ZodError'
    && Array.isArray((error as { issues?: unknown }).issues)
  );
}

const DEFINE_HELPER_NAME_RE = /^define[A-Z][A-Za-z0-9]*$/;
const INLINE_SOURCE_MAP_RE = /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/;
const STACK_FRAME_RE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

interface StackFrame {
  readonly fn?: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

function stackFramesOf(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const match = STACK_FRAME_RE.exec(raw);
    if (!match) continue;
    const [, fn, location, line, column] = match;
    let file = location;
    if (file.startsWith('async ')) file = file.slice('async '.length);
    if (file.startsWith('file://')) {
      try {
        file = fileURLToPath(file);
      } catch {
        continue;
      }
    }
    frames.push({ fn: fn?.replace(/^async /, ''), file, line: Number(line), column: Number(column) });
  }
  return frames;
}

function sourceMapOf(bundle: EvaluatedConfigBundle): { map: SourceMap; sources: Set<string> } | undefined {
  const match = INLINE_SOURCE_MAP_RE.exec(bundle.text);
  if (!match) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    return {
      map: new SourceMap(payload),
      sources: new Set<string>(Array.isArray(payload.sources) ? payload.sources : []),
    };
  } catch {
    return undefined;
  }
}

/** A map `sources` entry as an absolute path: esbuild writes them relative to its working directory. */
function absoluteSource(source: string, cwd: string): string | undefined {
  if (source.startsWith('file://')) {
    try {
      return fileURLToPath(source);
    } catch {
      return undefined;
    }
  }
  return path.resolve(cwd, source);
}

/** The helper the frame names, when it is a `define*` function and the authored line spells that name. */
function helperOf(frame: StackFrame | undefined, file: string, line: number): string | undefined {
  const name = frame?.fn?.split('.').pop();
  if (!name || !DEFINE_HELPER_NAME_RE.test(name)) return undefined;
  let text: string | undefined;
  try {
    text = fs.readFileSync(file, 'utf8').split(/\r?\n/)[line - 1];
  } catch {
    return undefined;
  }
  return text !== undefined && new RegExp(`\\b${name}\\b`).test(text) ? name : undefined;
}

/**
 * The authored file, line, column and helper of the call that threw `stack`
 * while `bundle` evaluated, or `undefined` when the stack cannot tell.
 *
 * @param stack the thrown error's `stack`
 * @param bundle the bundle bundle-require evaluated, read before it was deleted
 * @param cwd the working directory esbuild resolved the map's `sources` against
 */
export function locateConfigLoadZodError(
  stack: string | undefined,
  bundle: EvaluatedConfigBundle | undefined,
  cwd: string,
): ConfigLoadZodLocation | undefined {
  if (!stack || !bundle) return undefined;
  const mapped = sourceMapOf(bundle);
  if (!mapped) return undefined;
  const authored = new Set<string>();
  for (const source of mapped.sources) {
    const absolute = absoluteSource(source, cwd);
    if (absolute) authored.add(absolute);
  }

  const frames = stackFramesOf(stack);
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    let located: { file: string; line: number; column: number } | undefined;
    if (frame.file === bundle.file) {
      // V8 frames are 1-based; the map is 0-based. The entry must sit on the
      // frame's own generated line — `findEntry` otherwise answers the nearest
      // earlier mapping, which can be another module's code.
      const entry = mapped.map.findEntry(frame.line - 1, frame.column - 1) as {
        generatedLine?: number;
        originalSource?: string;
        originalLine?: number;
        originalColumn?: number;
      };
      if (
        entry.generatedLine !== frame.line - 1
        || typeof entry.originalSource !== 'string'
        || typeof entry.originalLine !== 'number'
        || typeof entry.originalColumn !== 'number'
      ) {
        return undefined;
      }
      const file = absoluteSource(entry.originalSource, cwd);
      if (!file) return undefined;
      located = { file, line: entry.originalLine + 1, column: entry.originalColumn + 1 };
    } else if (authored.has(frame.file)) {
      // `--enable-source-maps`: V8 already mapped the frame to the authored file.
      located = { file: frame.file, line: frame.line, column: frame.column };
    }
    if (!located) continue;
    if (!fs.existsSync(located.file)) return undefined;
    const helper = helperOf(frames[i - 1], located.file, located.line);
    return helper ? { ...located, helper } : located;
  }
  return undefined;
}

/** A path as the author reads it: relative to the working directory when it is under it. */
function displayPath(file: string, cwd: string): string {
  const relative = path.relative(cwd, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

/**
 * The readable refusal for a raw `ZodError` a config load threw.
 *
 * A plain `Error`, so every command's catch-all prints it exactly where it
 * printed the JSON array before — `--json` copies `message` into its
 * envelope's `error` — and no catch-all changes. The `ZodError` rides as
 * `cause`.
 */
export class ConfigLoadRefusalError extends Error {
  constructor(message: string, cause: Error) {
    super(message, { cause });
    this.name = 'ConfigLoadRefusalError';
  }
}

/**
 * Turn a raw `ZodError` thrown while `configPath` loaded into
 * {@link ConfigLoadRefusalError}:
 *
 * ```text
 * src/views/ticket.view.ts:5:28 · defineView validation failed (1 issue):
 *
 *   ✗ list.columns: Invalid input
 *     ✗ list.columns.0: Invalid input: expected string, received object
 * ```
 */
export function configLoadRefusal(
  error: Error & { issues: unknown[] },
  configPath: string,
  bundle: EvaluatedConfigBundle | undefined,
  cwd: string,
): ConfigLoadRefusalError {
  const location = locateConfigLoadZodError(error.stack, bundle, cwd);
  const where = location
    ? `${displayPath(location.file, cwd)}:${location.line}:${location.column}`
    : `${displayPath(configPath, cwd)} (loading it threw; the stack does not say which module)`;
  const label = location?.helper ? `${location.helper} validation failed` : undefined;
  const block = formatZodError(error as unknown as Parameters<typeof formatZodError>[0], label);
  return new ConfigLoadRefusalError(`${where} · ${block}`, error);
}

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-closure-refusal — the Studio sentence for one publish refusal: a flow
 * that binds an object its package may not use (objectstack#30038, ruling A).
 *
 * Under a package closure the publish gate refuses a flow whose trigger object,
 * time-relative scan object or start-input object is outside that closure, and
 * the draft's `_diagnostics.errors[]` carry the refusal as the gate wrote it: an
 * English sentence in packaging terms, with the rule id as the entry's `code`
 * and the item-relative `path` of the offending key. The Problems panel used to
 * show that English text as sent, to a reader in any language.
 *
 * This module renders the sentence in the Console's language from what the
 * wire already carries, and nothing else: the entry's `code` (the rule id the
 * spec calls "the key a renderer groups or suppresses by") picks the copy, the
 * entry's `path` picks the position, and the object name is read from the flow
 * on screen at that path. The wire shape does not move.
 *
 * - Two rule ids at three positions, and only this refusal:
 *   `flow-trigger-unknown-object` at `nodes.N.config.objectName` (the start
 *   node's object) and at `nodes.N.config.timeRelative.object` (a time-relative
 *   scan's object); `flow-input-unknown-object` at `variables.N.objectName` (a
 *   start input's declaration). Both ids also raise a no-closure advisory with
 *   other words; that one is a warning and never reaches `errors[]`, so an
 *   error entry with one of these ids is this refusal.
 * - The sentence names the object and says "this package": the package is the
 *   one Studio is editing, which the page already shows. "Did you mean" is not
 *   recomputed here; the sentence points at the object list and at the
 *   dependency declaration instead.
 * - Anything else — another code, another position, a value no longer a name
 *   at that path — answers `undefined`, and the caller shows the server's own
 *   sentence as before.
 *
 * ⛔ No verdict is computed here: the refusal is the server's, and this only
 * words it.
 */

import { tFormat } from '../i18n.js';

/** The rule id of the trigger / time-relative scan refusal (`@objectstack/lint`). */
export const FLOW_TRIGGER_UNKNOWN_OBJECT = 'flow-trigger-unknown-object';
/** The rule id of the start-input declaration refusal (`@objectstack/lint`). */
export const FLOW_INPUT_UNKNOWN_OBJECT = 'flow-input-unknown-object';

/** The flow on screen, as far as this sentence reads it. */
export interface ClosureRefusalFlow {
  nodes?: readonly unknown[];
  variables?: readonly unknown[];
}

/** The served entry, as far as this sentence reads it. */
export interface ClosureRefusalEntry {
  code?: string;
  path?: string | ReadonlyArray<string | number>;
}

const TRIGGER_OBJECT = /^nodes\.(\d+)\.config\.objectName$/;
const SCAN_OBJECT = /^nodes\.(\d+)\.config\.timeRelative\.object$/;
const INPUT_OBJECT = /^variables\.(\d+)\.objectName$/;

function dottedPath(path: ClosureRefusalEntry['path']): string {
  if (Array.isArray(path)) return path.join('.');
  return typeof path === 'string' ? path : '';
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function name(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * The localized sentence for a served closure refusal, or `undefined` when the
 * entry is not one of the three positions this module words (the caller then
 * shows the server's message unchanged).
 */
export function closureRefusalMessage(
  entry: ClosureRefusalEntry,
  flow: ClosureRefusalFlow,
  locale?: string,
): string | undefined {
  const path = dottedPath(entry.path);
  if (entry.code === FLOW_TRIGGER_UNKNOWN_OBJECT) {
    const trigger = TRIGGER_OBJECT.exec(path);
    if (trigger) {
      const object = name(record(record(flow.nodes?.[Number(trigger[1])])?.config)?.objectName);
      return object ? tFormat('engine.flowProblems.closureRefusal.triggerObject', locale, { object }) : undefined;
    }
    const scan = SCAN_OBJECT.exec(path);
    if (scan) {
      const config = record(record(flow.nodes?.[Number(scan[1])])?.config);
      const object = name(record(config?.timeRelative)?.object);
      return object ? tFormat('engine.flowProblems.closureRefusal.scanObject', locale, { object }) : undefined;
    }
    return undefined;
  }
  if (entry.code === FLOW_INPUT_UNKNOWN_OBJECT) {
    const input = INPUT_OBJECT.exec(path);
    if (!input) return undefined;
    const variable = record(flow.variables?.[Number(input[1])]);
    const object = name(variable?.objectName);
    if (!object) return undefined;
    return tFormat('engine.flowProblems.closureRefusal.inputObject', locale, {
      object,
      input: name(variable?.name) ?? `#${input[1]}`,
    });
  }
  return undefined;
}

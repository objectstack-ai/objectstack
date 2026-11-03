// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # `Intl.DateTimeFormat` inside the body sandbox (#28898)
 *
 * The QuickJS build the runner ships has no `Intl` (no ICU in the WASM, and
 * `quickjs-emscripten` publishes no variant with one). A body therefore could
 * not do time-zone date maths — "which calendar day is this instant in
 * `America/New_York`?" — and a job whose work needs it (duly#147: each duty's
 * period in the duty's own IANA zone) could not leave the deprecated `handler`.
 *
 * This installs `globalThis.Intl` with ONE member, `DateTimeFormat`, whose
 * every answer is the HOST's: the VM-side constructor holds only a snapshot of
 * its `locales` / `options` as plain values, and each call asks the host to
 * format with a host `Intl.DateTimeFormat` built from that snapshot. So output
 * is byte-for-byte the host's for the same input, IANA zones and DST included.
 *
 * ## The whole of `DateTimeFormat`, and nothing else of `Intl`
 *
 * The constructor (with or without `new`), `supportedLocalesOf`, and the full
 * prototype — `format` (a bound getter), `formatToParts`, `formatRange`,
 * `formatRangeToParts`, `resolvedOptions`. A member missing from a constructor
 * an author can feature-test as `typeof Intl.DateTimeFormat === 'function'`
 * would be half-working: it passes the test and throws on use. Every other
 * `Intl` member (`NumberFormat`, `Collator`, …) is ABSENT, so its own
 * `typeof` answers `'undefined'` — the CLI's lowering reads that measurement
 * (`detect-free-identifiers.ts`, `sandbox-globals-probe.test.ts`) and keeps a
 * handler using one bundled.
 *
 * ## What crosses the boundary — plain values only
 *
 * - **In:** an op name, ONE JSON string (`{ l, o }`: the locales and options
 *   snapshot), and at most two numbers (the epoch-ms instants). The host
 *   re-reads the JSON into a fresh object, keeping only the option keys
 *   `DateTimeFormat` reads with primitive values, so nothing a body builds is
 *   ever handed to the host `Intl` as is.
 * - **Out:** one JSON string — `{ ok: true, value }` or `{ ok: false, name,
 *   message }` — parsed INSIDE the VM, so every object a body receives
 *   (`resolvedOptions()`, the parts arrays) is made by the VM's own `Object` /
 *   `Array`. A host error becomes a VM `RangeError` / `TypeError` with the
 *   host's message: a body's own throw, not a host refusal relayed.
 * - **The bridge** is a closure argument of the installed shim, never a global,
 *   and the shim captures the builtins it uses at install time, so a body that
 *   replaces `JSON.stringify` or `Date.now` cannot steer what the host is asked.
 *
 * ## No new clock, no new I/O
 *
 * `format()` with no argument means "now"; the VM's own `Date.now()` supplies
 * that instant, so the host clock is never read on a body's behalf. Formatting
 * performs no I/O. The host formatters are cached per invocation (a bounded
 * map dropped with the VM), so a job formatting many instants in a few zones
 * does not rebuild one per call.
 */

import type { QuickJSContext } from 'quickjs-emscripten';

/**
 * The option keys `Intl.DateTimeFormat` reads (ECMA-402 `CreateDateTimeFormat`).
 * The host keeps only these from a body's snapshot; the shim copies only these.
 */
const DATE_TIME_FORMAT_OPTION_KEYS = [
  'localeMatcher', 'calendar', 'numberingSystem', 'hour12', 'hourCycle', 'timeZone',
  'weekday', 'era', 'year', 'month', 'day', 'dayPeriod', 'hour', 'minute', 'second',
  'fractionalSecondDigits', 'timeZoneName', 'formatMatcher', 'dateStyle', 'timeStyle',
] as const;

/** Error names relayed into the VM as their own constructor; anything else is a plain `Error`. */
const RELAYED_ERROR_NAMES = new Set(['RangeError', 'TypeError']);

/** How many distinct (locales, options) host formatters one invocation keeps. */
const FORMATTER_CACHE_LIMIT = 64;

type Primitive = string | number | boolean | null;
type Answer = { ok: true; value: unknown } | { ok: false; name: string; message: string };

const isPrimitive = (v: unknown): v is Primitive =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/**
 * The VM-side shim: an expression evaluating to `function (host)`. It
 * interpolates only the constant option-key list above — a body's data only
 * ever crosses as call arguments.
 */
const SHIM = `(function (host) {
  'use strict';
  var stringify = JSON.stringify, parse = JSON.parse, now = Date.now;
  var toNumber = Number, toStr = String, toBool = Boolean;
  var defineProperty = Object.defineProperty, create = Object.create;
  var WM = WeakMap, wmGet = WeakMap.prototype.get, wmSet = WeakMap.prototype.set;
  var RangeErr = RangeError, TypeErr = TypeError, Err = Error;
  var KEYS = ${JSON.stringify(DATE_TIME_FORMAT_OPTION_KEYS)};
  var state = new WM();

  function call(op, l, o, a, b) {
    var r = parse(host(op, stringify({ l: l, o: o }), a, b));
    if (r.ok) return r.value;
    var C = r.name === 'RangeError' ? RangeErr : r.name === 'TypeError' ? TypeErr : Err;
    throw new C(r.message);
  }
  function isObj(v) { return (typeof v === 'object' && v !== null) || typeof v === 'function'; }
  function snapLocales(l) {
    if (typeof l === 'bigint' || typeof l === 'symbol') return undefined;
    if (!isObj(l)) return l;
    var out = [], len = toNumber(l.length) >>> 0;
    for (var i = 0; i < len; i++) {
      if (i in l) { var v = l[i]; out.push(isObj(v) ? toStr(v) : v); }
    }
    return out;
  }
  function snapOptions(o) {
    if (o === undefined || o === null) return o;
    if (!isObj(o)) return {};
    var out = {};
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], v = o[k];
      if (v === undefined) continue;
      if (typeof v === 'symbol') throw new TypeErr('Cannot convert a Symbol value to a string');
      if (isObj(v) || typeof v === 'bigint') {
        v = k === 'hour12' ? toBool(v) : k === 'fractionalSecondDigits' ? toNumber(v) : toStr(v);
      }
      out[k] = v;
    }
    return out;
  }
  function slot(self, name) {
    var s = isObj(self) ? wmGet.call(state, self) : undefined;
    if (!s) throw new TypeErr('Method Intl.DateTimeFormat.prototype.' + name + ' called on incompatible receiver');
    return s;
  }
  function instant(d) { return d === undefined ? now() : toNumber(d); }
  function rangeEnd(d) { return d === undefined ? undefined : toNumber(d); }
  function method(target, name, fn) {
    defineProperty(target, name, { value: fn, writable: true, enumerable: false, configurable: true });
  }

  function DateTimeFormat(locales, options) {
    var l = snapLocales(locales), o = snapOptions(options);
    call('resolvedOptions', l, o);
    var self = new.target ? this : create(DateTimeFormat.prototype);
    wmSet.call(state, self, { l: l, o: o, format: undefined });
    return self;
  }
  defineProperty(DateTimeFormat, 'length', { value: 0, configurable: true });
  method(DateTimeFormat, 'supportedLocalesOf', function supportedLocalesOf(locales, options) {
    return call('supportedLocalesOf', snapLocales(locales), snapOptions(options));
  });
  var proto = DateTimeFormat.prototype;
  defineProperty(proto, 'format', {
    enumerable: false, configurable: true,
    get: function () {
      var s = slot(this, 'format');
      if (!s.format) s.format = function (date) { return call('format', s.l, s.o, instant(date)); };
      return s.format;
    },
  });
  method(proto, 'formatToParts', function formatToParts(date) {
    var s = slot(this, 'formatToParts');
    return call('formatToParts', s.l, s.o, instant(date));
  });
  method(proto, 'formatRange', function formatRange(startDate, endDate) {
    var s = slot(this, 'formatRange');
    return call('formatRange', s.l, s.o, rangeEnd(startDate), rangeEnd(endDate));
  });
  method(proto, 'formatRangeToParts', function formatRangeToParts(startDate, endDate) {
    var s = slot(this, 'formatRangeToParts');
    return call('formatRangeToParts', s.l, s.o, rangeEnd(startDate), rangeEnd(endDate));
  });
  method(proto, 'resolvedOptions', function resolvedOptions() {
    var s = slot(this, 'resolvedOptions');
    return call('resolvedOptions', s.l, s.o);
  });
  defineProperty(proto, Symbol.toStringTag, { value: 'Intl.DateTimeFormat', configurable: true });

  var Intl = {};
  method(Intl, 'DateTimeFormat', DateTimeFormat);
  defineProperty(Intl, Symbol.toStringTag, { value: 'Intl', configurable: true });
  method(globalThis, 'Intl', Intl);
})`;

/** Re-read the body's snapshot as plain host values, keeping only what `DateTimeFormat` reads. */
function readSnapshot(json: string): { locales: unknown; options: unknown } {
  const raw = JSON.parse(json) as { l?: unknown; o?: unknown } | null;
  const l = raw?.l;
  const o = raw?.o;
  let locales: unknown;
  if (l === undefined || isPrimitive(l)) locales = l;
  else if (Array.isArray(l) && l.every(isPrimitive)) locales = [...l];
  else throw new TypeError('Intl.DateTimeFormat: locales must be a string or a list of strings');
  let options: unknown;
  if (o === undefined || o === null) options = o;
  else if (typeof o === 'object' && !Array.isArray(o)) {
    const clean: Record<string, Primitive> = {};
    for (const k of DATE_TIME_FORMAT_OPTION_KEYS) {
      const v = (o as Record<string, unknown>)[k];
      if (isPrimitive(v)) clean[k] = v;
    }
    options = clean;
  } else options = {};
  return { locales, options };
}

/**
 * Install `globalThis.Intl` (with `DateTimeFormat` only) into a fresh sandbox
 * context. Called once per invocation, for every body kind: hooks, actions and
 * jobs share the runner, so they share this one global set.
 */
export function installSandboxIntl(vm: QuickJSContext): void {
  const formatters = new Map<string, Intl.DateTimeFormat>();
  const formatterFor = (key: string, locales: unknown, options: unknown): Intl.DateTimeFormat => {
    const hit = formatters.get(key);
    if (hit) return hit;
    const f = new Intl.DateTimeFormat(locales as string | string[] | undefined, options as Intl.DateTimeFormatOptions);
    if (formatters.size >= FORMATTER_CACHE_LIMIT) formatters.clear();
    formatters.set(key, f);
    return f;
  };

  const host = vm.newFunction('intl', (opH, snapH, aH, bH) => {
    let answer: Answer;
    try {
      const op = opH === undefined ? '' : vm.getString(opH);
      const snap = snapH === undefined ? '{}' : vm.getString(snapH);
      // `vm.dump` keeps a number handle a number (NaN included) and `undefined`
      // undefined, which is what the host's own argument checks must see.
      const a = aH === undefined ? undefined : (vm.dump(aH) as number | undefined);
      const b = bH === undefined ? undefined : (vm.dump(bH) as number | undefined);
      const { locales, options } = readSnapshot(snap);
      let value: unknown;
      if (op === 'supportedLocalesOf') {
        value = Intl.DateTimeFormat.supportedLocalesOf(
          locales as string | string[] | undefined,
          options as Intl.DateTimeFormatOptions,
        );
      } else {
        const f = formatterFor(snap, locales, options);
        const range = f as Intl.DateTimeFormat & {
          formatRange(x: unknown, y: unknown): string;
          formatRangeToParts(x: unknown, y: unknown): unknown;
        };
        switch (op) {
          case 'resolvedOptions': value = f.resolvedOptions(); break;
          case 'format': value = f.format(a); break;
          case 'formatToParts': value = f.formatToParts(a); break;
          case 'formatRange': value = range.formatRange(a, b); break;
          case 'formatRangeToParts': value = range.formatRangeToParts(a, b); break;
          default: throw new TypeError(`Intl.DateTimeFormat: unknown operation '${op}'`);
        }
      }
      answer = { ok: true, value };
    } catch (err) {
      const e = err as { name?: unknown; message?: unknown };
      const name = typeof e?.name === 'string' && RELAYED_ERROR_NAMES.has(e.name) ? e.name : 'Error';
      answer = { ok: false, name, message: typeof e?.message === 'string' ? e.message : String(err) };
    }
    return vm.newString(JSON.stringify(answer));
  });

  try {
    const factory = vm.evalCode(SHIM);
    if (factory.error) {
      const detail = vm.dump(factory.error);
      factory.error.dispose();
      throw new Error(`sandbox Intl shim did not compile: ${JSON.stringify(detail)}`);
    }
    const installed = vm.callFunction(factory.value, vm.undefined, host);
    factory.value.dispose();
    if (installed.error) {
      const detail = vm.dump(installed.error);
      installed.error.dispose();
      throw new Error(`sandbox Intl shim did not install: ${JSON.stringify(detail)}`);
    }
    installed.value.dispose();
  } finally {
    host.dispose();
  }
}

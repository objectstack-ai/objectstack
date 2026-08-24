// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Completeness guard (#2874 P2): the PUBLIC_AUTH_FEATURES registry
 * (`@objectstack/spec/kernel`) and the feature gates actually carried by the
 * platform objects must stay in lockstep, in BOTH directions:
 *
 * 1. Forward (registry → objects): every `gatedInputs` path must resolve to a
 *    real action/param whose lowered `visible` predicate carries the flag's
 *    gate. Removing a `requiresFeature` annotation (or the whole input)
 *    without updating the registry turns this red.
 * 2. Reverse (objects → registry): every `features.<name>` reference inside
 *    any action/param `visible` predicate must name a registry flag AND be
 *    booked in that flag's `gatedInputs`. Adding a gate without registry
 *    bookkeeping turns this red.
 *
 * Scope notes: objects that moved to capability plugins per ADR-0029 K2
 * (plugin-security / plugin-sharing / plugin-audit / service-realtime /
 * plugin-webhooks) are outside this package and this guard; none of them
 * reference `features.*` today. Object FIELDS (`visibleWhen`) carry no
 * feature gates today and are not walked. Per the issue's explicit non-goal,
 * this guard cannot catch a brand-new capability-dependent input that was
 * never annotated at all — that ground truth lives in plugin runtime
 * behavior.
 */

import { describe, expect, it } from 'vitest';
import {
  PUBLIC_AUTH_FEATURES,
  featureGatePredicate,
  type PublicAuthFeatureName,
} from '@objectstack/spec/kernel';
import * as identity from './identity/index.js';
import * as metadata from './metadata/index.js';
import * as system from './system/index.js';

type AnyParam = { name?: string; field?: string; visible?: { source?: string } };
type AnyAction = { name?: string; visible?: { source?: string }; params?: AnyParam[] };
type AnyObject = { name?: string; actions?: AnyAction[] };

// Every exported platform object, keyed by machine name (object.name).
const objectsByName = new Map<string, AnyObject>();
for (const mod of [identity, metadata, system]) {
  for (const value of Object.values(mod)) {
    const obj = value as AnyObject;
    if (obj && typeof obj === 'object' && typeof obj.name === 'string' && obj.name.startsWith('sys_')) {
      objectsByName.set(obj.name, obj);
    }
  }
}

const flagEntries = Object.entries(PUBLIC_AUTH_FEATURES) as Array<
  [PublicAuthFeatureName, (typeof PUBLIC_AUTH_FEATURES)[PublicAuthFeatureName]]
>;

/** Resolve `<object>.actions.<action>[.params.<name|field>]` to its `visible`. */
function resolveGatedInput(path: string): { visibleSource: string | undefined } {
  const match = /^([a-z0-9_]+)\.actions\.([a-z0-9_]+)(?:\.params\.([A-Za-z0-9_]+))?$/.exec(path);
  expect(match, `path grammar: ${path}`).not.toBeNull();
  const [, objectName, actionName, paramName] = match!;
  const object = objectsByName.get(objectName);
  expect(object, `object exists: ${path}`).toBeDefined();
  const action = (object!.actions ?? []).find((a) => a.name === actionName);
  expect(action, `action exists: ${path}`).toBeDefined();
  if (!paramName) return { visibleSource: action!.visible?.source };
  const param = (action!.params ?? []).find((p) => (p.name ?? p.field) === paramName);
  expect(param, `param exists: ${path}`).toBeDefined();
  return { visibleSource: param!.visible?.source };
}

describe('feature-gate completeness guard (#2874)', () => {
  it('sanity: the walker actually sees the platform objects', () => {
    for (const name of ['sys_user', 'sys_organization', 'sys_oauth_application', 'sys_two_factor']) {
      expect(objectsByName.has(name), name).toBe(true);
    }
  });

  describe('forward: every registered gated input carries the matching predicate', () => {
    const rows = flagEntries.flatMap(([flag, entry]) =>
      (entry.gatedInputs ?? []).map((path): [string, PublicAuthFeatureName] => [path, flag]),
    );

    it.each(rows)('%s is gated on %s', (path, flag) => {
      const gate = featureGatePredicate(flag);
      const { visibleSource } = resolveGatedInput(path);
      expect(visibleSource, `${path} has a visible predicate`).toBeDefined();
      const matches = visibleSource === gate || visibleSource!.endsWith(`&& ${gate}`);
      expect(matches, `${path}: "${visibleSource}" must equal or end with "&& ${gate}"`).toBe(true);
    });
  });

  describe('reverse: every features.* gate in the objects is booked in the registry', () => {
    const inputsByFlag = new Map<string, Set<string>>(
      flagEntries.map(([flag, entry]) => [flag as string, new Set(entry.gatedInputs ?? [])]),
    );

    const referencedInputs: Array<[string, string]> = [];
    for (const [objectName, object] of objectsByName) {
      for (const action of object.actions ?? []) {
        const sites: Array<[string, string | undefined]> = [
          [`${objectName}.actions.${action.name}`, action.visible?.source],
          ...(action.params ?? []).map((p): [string, string | undefined] => [
            `${objectName}.actions.${action.name}.params.${p.name ?? p.field}`,
            p.visible?.source,
          ]),
        ];
        for (const [path, source] of sites) {
          for (const m of (source ?? '').matchAll(/features\.([A-Za-z0-9_]+)/g)) {
            referencedInputs.push([path, m[1]]);
          }
        }
      }
    }

    it('finds the gated surface (guards the walker itself)', () => {
      // 37 booked inputs exist today (38 before #9968 retired
      // sys_user.actions.set_user_role); if the walker ever goes blind and
      // finds none, the it.each below would vacuously pass — pin a floor
      // instead.
      expect(referencedInputs.length).toBeGreaterThanOrEqual(37);
    });

    it.each(referencedInputs)('%s references registered flag %s and is booked', (path, flag) => {
      const booked = inputsByFlag.get(flag);
      expect(booked, `features.${flag} is a registry flag`).toBeDefined();
      expect(booked!.has(path), `${path} is booked in ${flag}.gatedInputs`).toBe(true);
    });
  });
});

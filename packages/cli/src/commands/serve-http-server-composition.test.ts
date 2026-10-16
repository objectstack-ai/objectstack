// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { readComposedHttpServer, resolveBoundPort, resolveHttpServerComposition } from './serve.js';

/**
 * #23623 — whether a boot serves HTTP is read off the booted kernel, never off
 * the `--server` flag.
 *
 * The flag says whether SERVE composes its own `HonoServerPlugin`. A config
 * can mount one itself under `--no-server`, and then an `http.server` service
 * is registered and the banner's addresses must still print. The flag only
 * says WHY there is none, so the banner names `--no-server` when that is the
 * cause and not otherwise.
 */

/** A kernel whose `getService` behaves like `ObjectKernel`'s: it THROWS for an unregistered name. */
function kernelWith(services: Record<string, unknown>) {
  const asked: string[] = [];
  return {
    asked,
    kernel: {
      getService(name: string): unknown {
        asked.push(name);
        if (!(name in services)) throw new Error(`Service '${name}' not found`);
        return services[name];
      },
    },
  };
}

const TRANSPORT = { getPort: () => 41234 };

describe('#23623 resolveHttpServerComposition', () => {
  it('a registered http.server is composed, whatever the flag says', () => {
    // `--no-server` with a config-mounted transport: the address is real.
    expect(resolveHttpServerComposition(kernelWith({ 'http.server': TRANSPORT }).kernel, false)).toBe('composed');
    expect(resolveHttpServerComposition(kernelWith({ 'http.server': TRANSPORT }).kernel, true)).toBe('composed');
  });

  it('none registered under --no-server is the flag\'s doing', () => {
    expect(resolveHttpServerComposition(kernelWith({}).kernel, false)).toBe('skipped-by-no-server');
  });

  it('none registered with the flag on is NOT blamed on the flag', () => {
    expect(resolveHttpServerComposition(kernelWith({}).kernel, true)).toBe('not-composed');
  });

  it('a kernel that answers undefined, or has no getService, composes nothing', () => {
    expect(resolveHttpServerComposition({ getService: () => undefined }, true)).toBe('not-composed');
    expect(resolveHttpServerComposition(undefined, false)).toBe('skipped-by-no-server');
    expect(resolveHttpServerComposition({}, true)).toBe('not-composed');
  });

  it('asks for the canonical service name only, as resolveBoundPort does', () => {
    const a = kernelWith({ 'http.server': TRANSPORT });
    resolveHttpServerComposition(a.kernel, false);
    const b = kernelWith({ 'http.server': TRANSPORT });
    resolveBoundPort(b.kernel, 0);
    expect(a.asked).toEqual(['http.server']);
    expect(b.asked).toEqual(a.asked);
    // Registered only under the deprecated alias (#4251) is not composed.
    expect(resolveHttpServerComposition(kernelWith({ 'http-server': TRANSPORT }).kernel, true)).toBe('not-composed');
  });

  it('the one read hands back the registered instance, so the port and the decision share it', () => {
    expect(readComposedHttpServer(kernelWith({ 'http.server': TRANSPORT }).kernel)).toBe(TRANSPORT);
    expect(readComposedHttpServer(kernelWith({}).kernel)).toBeUndefined();
    expect(resolveBoundPort(kernelWith({ 'http.server': TRANSPORT }).kernel, 0)).toBe(41234);
  });
});

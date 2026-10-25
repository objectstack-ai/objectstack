import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Each case loads a fresh copy of the module: the overrides and the one-time
 * read of the page globals are module state, and the default is only
 * observable before anything has overridden it.
 */
async function load() {
  vi.resetModules();
  return import('../capabilities.js');
}

type CapabilityGlobals = {
  __OBJECTUI_CAPABILITIES__?: unknown;
  __OBJECTUI_CAPABILITIES_DISABLED__?: unknown;
};
const g = globalThis as unknown as CapabilityGlobals;

describe('runtime capabilities', () => {
  beforeEach(() => {
    delete g.__OBJECTUI_CAPABILITIES__;
    delete g.__OBJECTUI_CAPABILITIES_DISABLED__;
  });
  afterEach(() => {
    delete g.__OBJECTUI_CAPABILITIES__;
    delete g.__OBJECTUI_CAPABILITIES_DISABLED__;
  });

  it('react-pages defaults OFF when no host turns it on', async () => {
    const { isCapabilityEnabled, CAP_REACT_PAGES } = await load();
    expect(isCapabilityEnabled(CAP_REACT_PAGES)).toBe(false);
  });

  it('the enable global a server writes turns react-pages on', async () => {
    g.__OBJECTUI_CAPABILITIES__ = ['react-pages'];
    const { isCapabilityEnabled, CAP_REACT_PAGES } = await load();
    expect(isCapabilityEnabled(CAP_REACT_PAGES)).toBe(true);
  });

  it('the disable global wins over a stale enable list in the same page', async () => {
    g.__OBJECTUI_CAPABILITIES__ = ['react-pages'];
    g.__OBJECTUI_CAPABILITIES_DISABLED__ = ['react-pages'];
    const { isCapabilityEnabled, CAP_REACT_PAGES } = await load();
    expect(isCapabilityEnabled(CAP_REACT_PAGES)).toBe(false);
  });

  it('a host can enable and disable react-pages', async () => {
    const { enableCapability, disableCapability, isCapabilityEnabled, CAP_REACT_PAGES } = await load();
    enableCapability(CAP_REACT_PAGES);
    expect(isCapabilityEnabled(CAP_REACT_PAGES)).toBe(true);
    disableCapability(CAP_REACT_PAGES);
    expect(isCapabilityEnabled(CAP_REACT_PAGES)).toBe(false);
  });

  it('unknown capabilities default OFF', async () => {
    const { isCapabilityEnabled } = await load();
    expect(isCapabilityEnabled('something-unknown')).toBe(false);
  });

  it('exposes the react-pages capability constant', async () => {
    const { CAP_REACT_PAGES } = await load();
    expect(CAP_REACT_PAGES).toBe('react-pages');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  enableCapability,
  disableCapability,
  isCapabilityEnabled,
  CAP_REACT_PAGES,
} from '../capabilities.js';

describe('runtime capabilities', () => {
  beforeEach(() => {
    // reset react-pages to its default by clearing the explicit override
    enableCapability(CAP_REACT_PAGES);
  });

  it('react-pages defaults ON', () => {
    // default state (no host override) is enabled
    expect(isCapabilityEnabled(CAP_REACT_PAGES)).toBe(true);
  });

  it('unknown capabilities default OFF', () => {
    expect(isCapabilityEnabled('something-unknown')).toBe(false);
  });

  it('a host can disable react-pages (server opt-out)', () => {
    disableCapability(CAP_REACT_PAGES);
    expect(isCapabilityEnabled(CAP_REACT_PAGES)).toBe(false);
    enableCapability(CAP_REACT_PAGES);
    expect(isCapabilityEnabled(CAP_REACT_PAGES)).toBe(true);
  });

  it('exposes the react-pages capability constant', () => {
    expect(CAP_REACT_PAGES).toBe('react-pages');
  });
});

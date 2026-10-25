/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  BREAKPOINTS,
  BREAKPOINT_ORDER,
  resolveResponsiveValue,
  getCurrentBreakpoint,
} from '../breakpoints';

describe('breakpoints', () => {
  describe('BREAKPOINTS', () => {
    it('should define Tailwind-compatible breakpoint values', () => {
      expect(BREAKPOINTS.xs).toBe(0);
      expect(BREAKPOINTS.sm).toBe(640);
      expect(BREAKPOINTS.md).toBe(768);
      expect(BREAKPOINTS.lg).toBe(1024);
      expect(BREAKPOINTS.xl).toBe(1280);
      expect(BREAKPOINTS['2xl']).toBe(1536);
    });
  });

  describe('BREAKPOINT_ORDER', () => {
    it('should be ordered from smallest to largest', () => {
      expect(BREAKPOINT_ORDER).toEqual(['xs', 'sm', 'md', 'lg', 'xl', '2xl']);
    });
  });

  describe('resolveResponsiveValue', () => {
    it('should return direct value for non-object values', () => {
      expect(resolveResponsiveValue(42, 'md')).toBe(42);
      expect(resolveResponsiveValue('hello', 'lg')).toBe('hello');
    });

    it('should return value for exact breakpoint', () => {
      expect(resolveResponsiveValue({ xs: 1, md: 2, lg: 3 }, 'md')).toBe(2);
    });

    it('should fall back to smaller breakpoint', () => {
      expect(resolveResponsiveValue({ xs: 1, lg: 3 }, 'md')).toBe(1);
    });

    it('should return undefined when no breakpoint matches', () => {
      expect(resolveResponsiveValue({ lg: 3 }, 'sm')).toBeUndefined();
    });

    it('should handle null values', () => {
      expect(resolveResponsiveValue(null as any, 'md')).toBeNull();
    });
  });

  describe('getCurrentBreakpoint', () => {
    it('should return xs for small widths', () => {
      expect(getCurrentBreakpoint(320)).toBe('xs');
    });

    it('should return sm for 640px', () => {
      expect(getCurrentBreakpoint(640)).toBe('sm');
    });

    it('should return md for 768px', () => {
      expect(getCurrentBreakpoint(768)).toBe('md');
    });

    it('should return lg for 1024px', () => {
      expect(getCurrentBreakpoint(1024)).toBe('lg');
    });

    it('should return xl for 1280px', () => {
      expect(getCurrentBreakpoint(1280)).toBe('xl');
    });

    it('should return 2xl for 1536px+', () => {
      expect(getCurrentBreakpoint(1536)).toBe('2xl');
      expect(getCurrentBreakpoint(2000)).toBe('2xl');
    });
  });
});

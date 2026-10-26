// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PreviewBadge — the top-bar platform-stage chip.
 *
 * Shows "Preview"/"Beta" while the platform is pre-GA and disappears at GA.
 * The stage comes from runtime-config, mocked here so each case is deterministic
 * without a server round-trip. Text is matched case-insensitively so the
 * assertions hold whether i18n resolves the key or falls back to its
 * defaultValue.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../runtime-config', () => ({
  getPlatformStage: vi.fn(() => 'preview'),
}));

import { PreviewBadge } from './PreviewBadge';
import { getPlatformStage } from '../runtime-config';

const stageMock = vi.mocked(getPlatformStage);

describe('PreviewBadge', () => {
  beforeEach(() => {
    stageMock.mockReset();
  });

  it('renders a Preview chip while the platform is in preview', () => {
    stageMock.mockReturnValue('preview');
    render(<PreviewBadge />);
    const badge = screen.getByTestId('platform-preview-badge');
    expect(badge.textContent ?? '').toMatch(/preview/i);
    expect(badge.textContent ?? '').not.toMatch(/beta/i);
  });

  it('renders a Beta chip while the platform is in beta', () => {
    stageMock.mockReturnValue('beta');
    render(<PreviewBadge />);
    expect(screen.getByTestId('platform-preview-badge').textContent ?? '').toMatch(/beta/i);
  });

  it('renders nothing once the platform reaches GA', () => {
    stageMock.mockReturnValue('ga');
    const { container } = render(<PreviewBadge />);
    expect(screen.queryByTestId('platform-preview-badge')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('passes caller classes through (responsive visibility / spacing)', () => {
    stageMock.mockReturnValue('preview');
    render(<PreviewBadge className="ml-2 hidden sm:inline-flex" />);
    const badge = screen.getByTestId('platform-preview-badge');
    expect(badge.className).toContain('sm:inline-flex');
    expect(badge.className).toContain('ml-2');
  });
});

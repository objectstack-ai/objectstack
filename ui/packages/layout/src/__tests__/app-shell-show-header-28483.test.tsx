/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28483 — `AppShell`'s `showHeader`. `false` draws no `<header>`
 * element at all (the console's record page on a phone draws its own top bar),
 * and the `navbar` passed with it is not mounted. The prop is additive: left
 * out, the shell draws its bar exactly as before, and a shell with no `navbar`
 * still draws its (empty) bar, which an external host may rely on.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import { AppShell } from '../index';

const navbar = <span data-testid="navbar-content">Search</span>;
const headers = (c: HTMLElement) => c.querySelectorAll('header');

afterEach(() => cleanup());

describe('AppShell showHeader (objectstack#28483)', () => {
  it('showHeader={false}: no header element, and the navbar is not mounted', () => {
    const { container } = render(
      <AppShell navbar={navbar} showHeader={false}>
        <p data-testid="page">page</p>
      </AppShell>,
    );
    expect(headers(container)).toHaveLength(0);
    expect(screen.queryByTestId('navbar-content')).toBeNull();
    // The page still renders, inside the shell's one main landmark.
    expect(container.querySelector('main')).toContainElement(screen.getByTestId('page'));
  });

  it('control: showHeader left out draws the bar around the navbar, as before', () => {
    const { container } = render(
      <AppShell navbar={navbar}>
        <p>page</p>
      </AppShell>,
    );
    expect(headers(container)).toHaveLength(1);
    expect(headers(container)[0]).toContainElement(screen.getByTestId('navbar-content'));
  });

  it('control: showHeader={true} is the same as leaving it out', () => {
    const { container } = render(
      <AppShell navbar={navbar} showHeader>
        <p>page</p>
      </AppShell>,
    );
    expect(headers(container)).toHaveLength(1);
  });

  it('control: no navbar and no showHeader still draws the empty bar (published behaviour)', () => {
    const { container } = render(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );
    expect(headers(container)).toHaveLength(1);
    expect(headers(container)[0]).toBeEmptyDOMElement();
  });
});

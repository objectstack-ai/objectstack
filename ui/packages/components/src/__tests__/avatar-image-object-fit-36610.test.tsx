/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The shared `AvatarImage` draws its picture with `object-cover` (#36610).
 * Without an `object-fit` the browser default `fill` scales each axis on its
 * own, so a non-square photo or logo is squashed into the round avatar. A
 * caller that passes `object-contain` (the record-header logo does) wins.
 *
 * Radix's `AvatarImage` draws its `img` only once the image has loaded, and
 * happy-dom never loads one, so `LoadedImage` stands in for `window.Image`
 * (the stand-in `page-header-record-picture-11383` uses).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Avatar, AvatarImage } from '../ui/avatar';

class LoadedImage {
  complete = true;
  naturalWidth = 1;
  src = '';
  crossOrigin: string | null = null;
  referrerPolicy = '';
  addEventListener(): void {}
  removeEventListener(): void {}
}

let realImage: typeof window.Image;

beforeEach(() => {
  realImage = window.Image;
  window.Image = LoadedImage as unknown as typeof window.Image;
});

afterEach(() => {
  cleanup();
  window.Image = realImage;
});

function drawnImage(container: HTMLElement): HTMLImageElement {
  const img = container.querySelector('img');
  expect(img).not.toBeNull();
  return img as HTMLImageElement;
}

describe('AvatarImage object-fit (#36610)', () => {
  it('crops to the circle with object-cover when the caller passes no class', () => {
    const { container } = render(
      <Avatar>
        <AvatarImage src="https://example.com/wide.png" alt="" />
      </Avatar>,
    );
    const classes = drawnImage(container).classList;
    expect(classes.contains('object-cover')).toBe(true);
    expect(classes.contains('object-contain')).toBe(false);
  });

  it('lets a passed object-contain win over the default', () => {
    const { container } = render(
      <Avatar>
        <AvatarImage src="https://example.com/logo.png" alt="" className="object-contain" />
      </Avatar>,
    );
    const classes = drawnImage(container).classList;
    expect(classes.contains('object-contain')).toBe(true);
    expect(classes.contains('object-cover')).toBe(false);
  });

  it('keeps the default when the caller passes an unrelated class', () => {
    const { container } = render(
      <Avatar>
        <AvatarImage src="https://example.com/wide.png" alt="" className="opacity-80" />
      </Avatar>,
    );
    const classes = drawnImage(container).classList;
    expect(classes.contains('object-cover')).toBe(true);
    expect(classes.contains('opacity-80')).toBe(true);
  });
});

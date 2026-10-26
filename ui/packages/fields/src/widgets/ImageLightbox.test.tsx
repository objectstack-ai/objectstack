import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import { I18nProvider } from '@object-ui/i18n';
import { ImageLightbox, type ImageLightboxProps } from './ImageLightbox';

const imgs = [
  { url: '/api/v1/storage/files/a', name: 'a.png' },
  { url: '/api/v1/storage/files/b', name: 'b.png' },
  { url: '/api/v1/storage/files/c', name: 'c.png' },
];

const renderLightbox = (props: ImageLightboxProps) =>
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ImageLightbox {...props} />
    </I18nProvider>,
  );

describe('ImageLightbox', () => {
  it('renders the image at the requested index', () => {
    renderLightbox({ images: imgs, index: 1, open: true, onOpenChange: () => {} });
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toContain('/api/v1/storage/files/b');
  });

  it('shows navigation and a position counter for multiple images', () => {
    renderLightbox({ images: imgs, index: 0, open: true, onOpenChange: () => {} });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Next image')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous image')).toBeInTheDocument();
  });

  it('omits navigation for a single image', () => {
    renderLightbox({ images: [imgs[0]], index: 0, open: true, onOpenChange: () => {} });
    expect(screen.queryByLabelText('Next image')).not.toBeInTheDocument();
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
  });

  it('advances to the next image and wraps around', () => {
    const seen: number[] = [];
    renderLightbox({ images: imgs, index: 2, open: true, onOpenChange: () => {}, onIndexChange: (i) => seen.push(i) });
    fireEvent.click(screen.getByLabelText('Next image'));
    expect(seen).toEqual([0]); // wrapped 2 -> 0
  });

  it('steps to the previous image and wraps around', () => {
    const seen: number[] = [];
    renderLightbox({ images: imgs, index: 0, open: true, onOpenChange: () => {}, onIndexChange: (i) => seen.push(i) });
    fireEvent.click(screen.getByLabelText('Previous image'));
    expect(seen).toEqual([2]); // wrapped 0 -> 2
  });
});

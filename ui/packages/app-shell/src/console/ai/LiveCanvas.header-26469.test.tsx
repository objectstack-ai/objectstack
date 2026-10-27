/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#26469 — the Live Canvas header names the app by the label the
 * chat's build card uses and says what the card says about publishing: a
 * build the card calls live carries no 「未发布 · 仅自己可见」, a materialized
 * build the card does not call live keeps it. Rendered through the shipped zh
 * pack, since the wording is the point.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { LiveCanvas, type LiveCanvasProps } from './LiveCanvas';

function renderZh(props: Partial<LiveCanvasProps>) {
  render(
    <MemoryRouter>
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <LiveCanvas
          appName="home_renovation_management"
          appSegment="app.u9ba"
          refreshKey={0}
          onClose={() => {}}
          {...props}
        />
      </I18nProvider>
    </MemoryRouter>,
  );
  return screen.getByTestId('live-canvas').firstElementChild as HTMLElement;
}

describe('LiveCanvas header — the build card is the source (objectstack#26469)', () => {
  it('a published build: the label, and no 未发布 badge', () => {
    const header = renderZh({ appLabel: '家装项目管理', materialized: true, live: true });
    expect(header).toHaveTextContent('运行预览 · 家装项目管理');
    expect(header).not.toHaveTextContent('未发布');
    expect(header).not.toHaveTextContent('home_renovation_management');
  });

  it('a materialized build the card does not call live keeps the 未发布 badge', () => {
    const header = renderZh({ appLabel: '家装项目管理', materialized: true });
    expect(header).toHaveTextContent('运行预览 · 家装项目管理(未发布 · 仅自己可见)');
  });

  it('without a label the header falls back to the machine name', () => {
    const header = renderZh({ materialized: true, live: true });
    expect(header).toHaveTextContent('运行预览 · home_renovation_management');
  });

  it('a draft preview stays a draft preview, by label', () => {
    const header = renderZh({ appLabel: '家装项目管理' });
    expect(header).toHaveTextContent('草稿预览 · 家装项目管理');
  });
});

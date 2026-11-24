/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#35928 — a flow the stage confirm names is named by its label in
 * the reader's language: the app's `flows` translation, read through
 * `activeFlowsBundle` and the spec's `translateFlow` (the flow runner's
 * reading), and the authored label where the app translates none.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// The active language's resource tree, as the provider loads an app's
// translations into i18next (the `flows` group under the app namespace).
const tree = {
  app: { flows: { project_closure: { label: '项目结项' } } },
};

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/i18n')>();
  return {
    ...actual,
    useObjectTranslation: () => ({
      ...actual.useObjectTranslation(),
      language: 'zh-Hans',
      i18n: { getResourceBundle: (lng: string) => (lng === 'zh-Hans' ? tree : undefined) },
    }),
  };
});

import { StageChangeStarts } from '../stageChangeStarts';

afterEach(() => cleanup());

describe('#35928 StageChangeStarts names a flow in the reader\'s language', () => {
  it('a translated flow reads its translation; an untranslated one its authored label', () => {
    const { container } = render(
      <StageChangeStarts
        flows={[
          { name: 'project_closure', label: 'Project Closure', startsApproval: true },
          { name: 'notify_owner', label: 'Notify Owner', startsApproval: false },
        ]}
      />,
    );
    expect(container.querySelector('[data-stage-change-start="project_closure"]')).toHaveTextContent('项目结项');
    expect(container.querySelector('[data-stage-change-start="project_closure"]')).not.toHaveTextContent('Project Closure');
    expect(container.querySelector('[data-stage-change-start="notify_owner"]')).toHaveTextContent('Notify Owner');
  });

  it('draws nothing for no flows', () => {
    const { container } = render(<StageChangeStarts flows={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

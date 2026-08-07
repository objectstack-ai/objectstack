// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// FROZEN bare-literal fixture (see log-call.action.ts). Pages were one of the
// 16 domains with no factory before #2035, so real third parties authored them
// exactly like this.
import type { Page } from '@objectstack/spec/ui';

export const WelcomePage: Page = {
  name: 'dc_welcome',
  label: 'Welcome',
  type: 'home',
  kind: 'full',
  template: 'default',
  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        {
          type: 'page:header',
          properties: { title: 'Welcome', subtitle: 'Downstream contract page.' },
        },
      ],
    },
  ],
};

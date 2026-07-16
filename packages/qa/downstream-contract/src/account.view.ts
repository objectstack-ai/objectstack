// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Existing-factory authoring path.
import { defineView } from '@objectstack/spec/ui';

const data = { provider: 'object' as const, object: 'dc_account' };

export const AccountViews = defineView({
  list: {
    label: 'All Accounts',
    type: 'grid',
    data,
    columns: [{ field: 'name' }, { field: 'stage' }],
  },
});

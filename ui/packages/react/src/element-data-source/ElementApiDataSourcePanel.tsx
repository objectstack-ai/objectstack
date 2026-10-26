/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The error panel of a page element's API binding (objectui#12197), titled in
 * the page's language.
 *
 * `SchemaRenderer` draws it in place of a node whose binding the spec refused
 * or whose read failed. The translation hook lives HERE, not in
 * `SchemaRenderer`'s body: that body runs for every node on every page, and a
 * language subscription there would re-render the whole tree on a language
 * change. This component mounts only on the error path, so only it subscribes.
 * The panel itself is {@link ElementDataSourceErrorPanel}; the inline
 * `defaultValue`s are the `en` pack's values (`pnpm check:i18n-keys`).
 */

import * as React from 'react';
import { useObjectTranslation } from '@object-ui/i18n';
import { ElementDataSourceErrorPanel } from './ElementDataSourceGate.js';

export interface ElementApiDataSourcePanelProps {
  /** `data-testid` stem — the node's registry key. */
  testId: string;
  /** `refused`: the spec's schema refused the binding. `error`: the read failed. */
  state: 'refused' | 'error';
  /** Why — the spec's refusal, or the failed read's sentence. */
  message?: string;
}

export function ElementApiDataSourcePanel({
  testId,
  state,
  message,
}: ElementApiDataSourcePanelProps): React.ReactElement {
  const { t } = useObjectTranslation();
  const title = state === 'refused'
    ? t('element.component.apiRefused', { defaultValue: 'This component’s API data source is refused' })
    : t('element.component.apiUnreadable', { defaultValue: 'This component’s API data source could not be read' });
  return <ElementDataSourceErrorPanel testId={testId} title={title} message={message} />;
}

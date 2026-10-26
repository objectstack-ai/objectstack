/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useRef, useState } from 'react';
import { useObjectTranslation } from '@object-ui/i18n';

/** What `ActionRunner.setTranslator` takes. */
type ActionRunnerTranslate = (key: string, options: { defaultValue: string }) => string;

/**
 * The translator both React owners of an `ActionRunner` — `<ActionProvider>`
 * and `useActionRunner` — install on the runner they build, so the text the
 * runner writes itself (the generic success toast an action with no
 * `successMessage` ends in) renders in the session's language instead of
 * English. Internal to this package; not re-exported from its entry.
 *
 * The function is created once per mount and reads the latest `t` when it is
 * CALLED, so a language switch reaches a runner that was built before it. Both
 * owners rebuild their runner only when their `context` changes, and a
 * translator captured at build time would keep answering in the language that
 * was active then. The identity comes from `useState`'s initializer, not from a
 * memo, so nothing depends on a `useMemo` result staying put (AGENTS.md #10).
 */
export function useActionRunnerTranslator(): ActionRunnerTranslate {
  const { t } = useObjectTranslation();
  const latest = useRef(t);
  // No dependency list: after every render, the ref holds that render's `t`.
  // Actions run from user events, which arrive after the commit.
  useEffect(() => {
    latest.current = t;
  });
  const [translate] = useState<ActionRunnerTranslate>(() => {
    const read: ActionRunnerTranslate = (key, options) => String(latest.current(key, options));
    return read;
  });
  return translate;
}

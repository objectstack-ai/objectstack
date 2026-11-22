/**
 * LastAppProvider
 *
 * The app this person last had open (objectstack#35881): where a phone lands
 * after sign-in. On a phone it comes first, ahead of the app the product
 * declares as default, which applies only when there is no record yet (ruling
 * 7045309332, 「上次用的优先」). Stored per person, so it follows them to
 * another device: one `sys_user_preference` row, `ui.app.last`, holding the
 * app's `name`, through the same adapter channel and the same one shared read
 * the favorites and the recent items use (objectui#12187). The browser keeps a
 * copy, scoped to the user, for the first frame and for a session with no
 * adapter.
 *
 * Written whenever an app is open, at any width: it is the person's last app,
 * not their last phone app. Read only by the phone's landing:
 * `RootLandingRedirect` in the console app, through `resolvePhoneLandingPath`.
 *
 * @module
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@object-ui/auth';
import {
  createDebouncedFlush,
  readScopedCopy,
  scopedKey,
  useOrganizationScope,
  useStorageSync,
  useUserStateAdapter,
} from './UserStateAdapters.js';

/** The preference row's key, and the browser copy's base key. */
export const LAST_APP_PREFERENCE_KEY = 'ui.app.last';

interface LastAppValue {
  /** The last app's `name`, or `null` when none is known. */
  lastApp: string | null;
  /**
   * Whether `lastApp` is an answer: the person's row has been read, or the
   * browser already held a copy. Before that, a landing waits rather than
   * showing the app list to someone who has a last app on the server.
   */
  settled: boolean;
  /** Record `name` as the app now open. */
  rememberApp: (name: string) => void;
}

function sanitize(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first ? first : null;
}

function loadLocal(userId: string | null, orgId: string | null): string | null {
  try {
    const raw = readScopedCopy(LAST_APP_PREFERENCE_KEY, userId, orgId);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveLocal(name: string, userId: string | null, orgId: string | null) {
  try {
    localStorage.setItem(scopedKey(LAST_APP_PREFERENCE_KEY, userId, orgId), JSON.stringify([name]));
  } catch {
    // storage full / privacy mode: the server row still carries it
  }
}

const LastAppContext = createContext<LastAppValue | null>(null);

export function LastAppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // The browser copy is kept per organization, like the server row it mirrors
  // (objectstack#36244): an app of one organization is no landing in another.
  const orgId = useOrganizationScope();
  // A list-shaped adapter, like every slot: the list holds the one name.
  const adapter = useUserStateAdapter<string>('lastApp');

  const [local, setLocal] = useState<{ userId: string | null; orgId: string | null; name: string | null }>(() => ({
    userId,
    orgId,
    name: loadLocal(userId, orgId),
  }));
  const [remote, setRemote] = useState<{ adapter: unknown; name: string | null } | null>(null);
  // A pick made in this session beats any read that lands after it.
  const picked = useRef<string | null>(null);

  if (local.userId !== userId || local.orgId !== orgId) {
    // Adjusted while rendering, on the signed-in user or organization changing.
    setLocal({ userId, orgId, name: loadLocal(userId, orgId) });
    picked.current = null;
  }

  useStorageSync<string[]>(scopedKey(LAST_APP_PREFERENCE_KEY, userId, orgId), (value) => {
    setLocal({ userId, orgId, name: sanitize(value) });
  });

  const flusher = useMemo(
    () =>
      createDebouncedFlush<string[]>(async (items) => {
        if (adapter) await adapter.save(items);
      }, 500),
    [adapter],
  );
  useEffect(() => () => void flusher.flush(), [flusher]);

  useEffect(() => {
    if (!adapter) return;
    let cancelled = false;
    void adapter
      .load()
      .catch(() => [])
      .then((items) => {
        if (cancelled) return;
        const name = sanitize(items);
        setRemote({ adapter, name });
        if (name && !picked.current) saveLocal(name, userId, orgId);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, userId, orgId]);

  const rememberApp = useCallback(
    (name: string) => {
      if (!name) return;
      picked.current = name;
      setLocal((prev) =>
        prev.name === name && prev.userId === userId && prev.orgId === orgId ? prev : { userId, orgId, name },
      );
      if (loadLocal(userId, orgId) === name && remote?.name === name) return;
      saveLocal(name, userId, orgId);
      if (adapter) flusher.schedule([name]);
    },
    [userId, orgId, adapter, flusher, remote?.name],
  );

  const remoteName = remote && remote.adapter === adapter ? remote.name : null;
  const remoteRead = !!remote && remote.adapter === adapter;
  const lastApp = picked.current ?? remoteName ?? local.name;
  const settled = remoteRead || local.name !== null || picked.current !== null;

  const value = useMemo<LastAppValue>(
    () => ({ lastApp, settled, rememberApp }),
    [lastApp, settled, rememberApp],
  );
  return <LastAppContext.Provider value={value}>{children}</LastAppContext.Provider>;
}

/** Outside a provider (unit tests, previews): nothing known, nothing kept. */
const NO_LAST_APP: LastAppValue = { lastApp: null, settled: true, rememberApp: () => {} };

/** The person's last app, and the write that records the app now open. */
export function useLastApp(): LastAppValue {
  return useContext(LastAppContext) ?? NO_LAST_APP;
}

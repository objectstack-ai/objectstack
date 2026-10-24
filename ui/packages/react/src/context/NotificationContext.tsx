/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/react - Notification Context
 *
 * Provides a spec-driven notification system to the component tree.
 * Implements NotificationSchema, NotificationConfigSchema, and
 * NotificationActionSchema from @objectstack/spec v2.0.7.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** Notification severity levels aligned with NotificationSeveritySchema */
export type NotificationSeverityLevel = 'info' | 'success' | 'warning' | 'error';

/**
 * Notification presentation — the spec `NotificationTypeSchema`
 * (`ui/notification.zod.ts`: toast / snackbar / banner / alert / inline).
 * Every member has a DISTINCT presentation; see {@link NOTIFICATION_PRESENTATIONS}.
 */
export type NotificationPresentation =
  | 'toast'
  | 'snackbar'
  | 'banner'
  | 'alert'
  | 'inline';

/**
 * Notification display type as AUTHORED. Identical to
 * {@link NotificationPresentation} plus the deprecated renderer-local `modal`
 * spelling, which stored items may still carry (#2942) and which resolves to
 * `alert`. Use {@link resolveNotificationPresentation} to get the presentation.
 */
export type NotificationDisplayType =
  | NotificationPresentation
  /** @deprecated renderer dialect — never in the spec; presented as `alert` */
  | 'modal';

/**
 * Where a presentation is rendered.
 *
 * - `delegate` — handed to the provider's `onToast` callback; the host owns the
 *   overlay (sonner in the console). Historically EVERY type took this path,
 *   which is why a `banner` surfaced as a toast (#3014).
 * - everything else names a surface component that subscribes to the context
 *   and renders the items in place. `@object-ui/components` ships one per
 *   surface (`NotificationSnackbar` / `NotificationBanners` /
 *   `NotificationAlerts` / `NotificationInline`).
 */
export type NotificationSurface = 'delegate' | 'snackbar' | 'banner' | 'alert' | 'inline';

export interface NotificationPresentationBehavior {
  /** The surface responsible for rendering this presentation. */
  surface: NotificationSurface;
  /**
   * Whether the presentation auto-dismisses when the raiser declares no
   * `duration`. A toast/snackbar is transient by definition; a banner is a
   * persistent strip and an alert is a blocking acknowledgement, so neither may
   * evaporate on the shared 5s timer. An explicit `duration` always wins.
   */
  transient: boolean;
}

/**
 * The presentation table — one entry per spec `NotificationTypeSchema` member.
 *
 * Typed as `Record<NotificationPresentation, …>`, so adding a member to the
 * spec enum fails type-check here until its presentation is decided, rather
 * than silently falling back to a toast.
 */
export const NOTIFICATION_PRESENTATIONS: Record<
  NotificationPresentation,
  NotificationPresentationBehavior
> = {
  toast: { surface: 'delegate', transient: true },
  snackbar: { surface: 'snackbar', transient: true },
  banner: { surface: 'banner', transient: false },
  alert: { surface: 'alert', transient: false },
  inline: { surface: 'inline', transient: false },
};

/**
 * Resolve an authored `displayType` to the presentation that renders it:
 * the spec default (`toast`) when absent, and `alert` for the deprecated
 * `modal` dialect.
 */
export function resolveNotificationPresentation(
  displayType?: NotificationDisplayType,
): NotificationPresentation {
  if (displayType === 'modal') return 'alert';
  if (displayType && displayType in NOTIFICATION_PRESENTATIONS) return displayType;
  return 'toast';
}

/**
 * Notification position — the spec `NotificationPositionSchema`
 * (underscore spellings). The hyphen forms are this context's historical
 * dialect, kept accepted for stored items.
 */
export type NotificationPositionValue =
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right'
  /** @deprecated legacy spelling — use `top_left` */
  | 'top-left'
  /** @deprecated legacy spelling — use `top_center` */
  | 'top-center'
  /** @deprecated legacy spelling — use `top_right` */
  | 'top-right'
  /** @deprecated legacy spelling — use `bottom_left` */
  | 'bottom-left'
  /** @deprecated legacy spelling — use `bottom_center` */
  | 'bottom-center'
  /** @deprecated legacy spelling — use `bottom_right` */
  | 'bottom-right';

/**
 * The spec vocabularies this context implements — exported for the parity
 * tests (#2942), which fail the moment `NotificationTypeSchema` /
 * `NotificationPositionSchema` and these sets drift in either direction.
 */
export const SUPPORTED_NOTIFICATION_DISPLAY_TYPES: ReadonlySet<string> = new Set(
  Object.keys(NOTIFICATION_PRESENTATIONS),
);
export const SUPPORTED_NOTIFICATION_POSITIONS: ReadonlySet<string> = new Set([
  'top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right',
]);

/**
 * Action button variant — the spec `NotificationActionSchema.variant`
 * (`primary | secondary | link`, default `primary`).
 *
 * This used to be the shadcn Button vocabulary (`default | destructive |
 * outline`) — a renderer-local fork of a spec enum, i.e. a second de-facto
 * contract. Surfaces map these three onto their own button styling instead.
 */
export type NotificationActionVariant = 'primary' | 'secondary' | 'link';

/** The spec vocabulary this context implements — exported for the parity test. */
export const SUPPORTED_NOTIFICATION_ACTION_VARIANTS: ReadonlySet<string> = new Set([
  'primary', 'secondary', 'link',
]);

/** Action button on a notification */
export interface NotificationActionButton {
  label: string;
  onClick: () => void;
  /** Spec `NotificationActionSchema.variant`. Default: `primary`. */
  variant?: NotificationActionVariant;
}

/** A single notification item */
export interface NotificationItem {
  id: string;
  title: string;
  message?: string;
  severity: NotificationSeverityLevel;
  /**
   * The presentation the raiser asked for. Materialized by `notify()` — stored
   * items always carry a resolved {@link NotificationPresentation}, never
   * `modal` and never `undefined`.
   */
  displayType?: NotificationDisplayType;
  actions?: NotificationActionButton[];
  /**
   * Duration in ms (0 = persistent). Defaults to the configured duration for
   * TRANSIENT presentations (toast / snackbar) and to persistent for the rest —
   * a banner that evaporates after 5s is not a banner.
   */
  duration?: number;
  /**
   * Whether the surface offers a dismiss control (spec `dismissible`, default
   * `true`). Only meaningful for the persistent presentations — a transient
   * one dismisses itself.
   */
  dismissible?: boolean;
  /**
   * `inline` only — names the surface that raised it, so the matching
   * `<NotificationInline scope="…" />` renders it in place instead of every
   * inline outlet on the page showing every inline notification. Renderer-local
   * routing metadata, not a spec field: the spec describes what a notification
   * IS, not which React subtree hosts it.
   */
  scope?: string;
  /**
   * Spec `NotificationSchema.position` — "Override default position", falling
   * back to `config.defaultPosition`. Honored by the FLOATING presentations
   * (toast, snackbar); `banner` / `inline` / `alert` are anchored by what they
   * are (content top / in place / centered modal) and ignore it.
   */
  position?: NotificationPositionValue;
  /** Whether the notification has been read */
  read?: boolean;
  /** Timestamp */
  createdAt: Date;
  /** Optional icon name (lucide icon) */
  icon?: string;
}

/**
 * Configuration for the notification system — the spec
 * `NotificationConfigSchema` (`defaultPosition` / `defaultDuration` /
 * `maxVisible` / `stackDirection` / `pauseOnHover`).
 *
 * The field names used to fork from it (`position`, and a renderer-local
 * `stacking` boolean with no spec counterpart), and only `defaultDuration` was
 * ever read — the other three were stored and ignored. The legacy names are
 * still accepted; see {@link resolveNotificationConfig}.
 */
export interface NotificationSystemConfig {
  /**
   * Default screen position for the FLOATING presentations (toast, snackbar).
   * A notification's own `position` overrides it.
   *
   * Deliberately undefined by default: "the host didn't say" has to be
   * representable, otherwise a fabricated default silently competes with the
   * host's own toast chrome (which also serves non-notification `toast.*`
   * calls). Declared wins; undeclared defers to the surface's own anchor.
   */
  defaultPosition?: NotificationPositionValue;
  /** Default duration in ms for the transient presentations. */
  defaultDuration?: number;
  /** Maximum number of notifications a stacking surface renders at once. */
  maxVisible?: number;
  /** Which way a stack grows: `down` puts the newest below (spec default). */
  stackDirection?: 'up' | 'down';
  /** Pause a transient notification's auto-dismiss timer while hovered. */
  pauseOnHover?: boolean;
  /** @deprecated renderer dialect — use `defaultPosition` */
  position?: NotificationPositionValue;
  /**
   * @deprecated renderer dialect with no spec counterpart. Read as "show only
   * the newest" (`maxVisible: 1`) when false, so it is honored rather than
   * fossilized; declare `maxVisible` instead.
   */
  stacking?: boolean;
}

/** Config with the legacy spellings folded in and the spec defaults applied. */
export interface ResolvedNotificationConfig {
  defaultPosition?: NotificationPositionValue;
  defaultDuration: number;
  maxVisible: number;
  stackDirection: 'up' | 'down';
  pauseOnHover: boolean;
}

/**
 * Fold the deprecated spellings into the spec ones and apply the spec defaults
 * (`NotificationConfigSchema`: 5000ms / 5 visible / stack down / pause on
 * hover). `defaultPosition` gets no fabricated default — see the field docs.
 */
export function resolveNotificationConfig(
  config: NotificationSystemConfig = {},
): ResolvedNotificationConfig {
  return {
    defaultPosition: config.defaultPosition ?? config.position,
    defaultDuration: config.defaultDuration ?? 5000,
    // `stacking: false` means "don't stack" — one visible item.
    maxVisible: config.stacking === false ? 1 : config.maxVisible ?? 5,
    stackDirection: config.stackDirection ?? 'down',
    pauseOnHover: config.pauseOnHover ?? true,
  };
}

export interface NotificationProviderProps {
  children: React.ReactNode;
  /** System configuration */
  config?: NotificationSystemConfig;
  /**
   * External toast handler (e.g. Sonner) — the `toast` presentation's surface.
   *
   * Called ONLY for `displayType: 'toast'`. It used to receive every
   * notification, which is why the other four spec types all surfaced as
   * toasts (#3014); they now render through their own surface components,
   * which subscribe via {@link useNotificationsByPresentation}.
   *
   * The resolved config comes with it so the delegate can honor the parts of
   * the contract only it can apply — `defaultPosition` above all, since the
   * toast overlay is the host's.
   */
  onToast?: (notification: NotificationItem, config: ResolvedNotificationConfig) => void;
}

interface NotificationContextValue {
  /** All notifications (including history) */
  notifications: NotificationItem[];
  /** Unread notification count */
  unreadCount: number;
  /** Add a notification */
  notify: (notification: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => string;
  /** Convenience: show info notification */
  info: (title: string, message?: string) => string;
  /** Convenience: show success notification */
  success: (title: string, message?: string) => string;
  /** Convenience: show warning notification */
  warning: (title: string, message?: string) => string;
  /** Convenience: show error notification */
  error: (title: string, message?: string) => string;
  /** Mark a notification as read */
  markAsRead: (id: string) => void;
  /** Mark all notifications as read */
  markAllAsRead: () => void;
  /** Dismiss a notification */
  dismiss: (id: string) => void;
  /** Clear all notifications */
  clearAll: () => void;
  /** System configuration, spec-normalized (see {@link resolveNotificationConfig}). */
  config: ResolvedNotificationConfig;
  /**
   * Hold a transient notification's auto-dismiss timer (spec `pauseOnHover`).
   * A surface calls this on pointer-enter; no-op when the notification is
   * persistent or the config opted out.
   */
  pauseAutoDismiss: (id: string) => void;
  /** Resume a held timer with the time it had left. */
  resumeAutoDismiss: (id: string) => void;
  /**
   * Announce that a surface is mounted and will render `surface` items.
   * Returns the unregister callback. Surfaces call this from an effect; the
   * provider uses it only to warn (dev builds) when a notification is raised
   * with nothing on screen able to present it.
   */
  registerSurface: (surface: NotificationSurface) => () => void;
}

let notificationCounter = 0;

/** Dev-build check — same idiom as `SchemaRenderer`'s `__DEV__`. */
const __DEV__ = (() => {
  try {
    return (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV
      !== 'production';
  } catch {
    return true;
  }
})();

/** Dev-only guidance for a presentation raised with no surface mounted. */
const SURFACE_HINTS: Record<NotificationSurface, string> = {
  delegate: 'pass `onToast` to <NotificationProvider>',
  snackbar: 'mount <NotificationSnackbar /> from @object-ui/components',
  banner: 'mount <NotificationBanners /> from @object-ui/components',
  alert: 'mount <NotificationAlerts /> from @object-ui/components',
  inline: 'mount <NotificationInline /> from @object-ui/components at the raising surface',
};

const NotificationCtx = createContext<NotificationContextValue | null>(null);

/**
 * NotificationProvider — Provides a spec-driven notification system.
 *
 * Each spec display type is presented by its own surface. `toast` is delegated
 * to the host (`onToast`); the other four are rendered by surface components
 * that subscribe to this context — mount them where they belong:
 * `NotificationSnackbar` / `NotificationAlerts` anywhere inside the provider,
 * `NotificationBanners` at the top of the content area, and
 * `NotificationInline` in the surface that raises the notification.
 *
 * @example
 * ```tsx
 * <NotificationProvider
 *   config={{ position: 'top_right', defaultDuration: 5000, maxVisible: 5 }}
 *   onToast={(n) => toast[n.severity](n.title, { description: n.message })}
 * >
 *   <NotificationBanners />
 *   <App />
 *   <NotificationSnackbar />
 *   <NotificationAlerts />
 * </NotificationProvider>
 * ```
 */
export const NotificationProvider: React.FC<NotificationProviderProps> = ({
  children,
  config: userConfig = {},
  onToast,
}) => {
  const config = useMemo<ResolvedNotificationConfig>(
    () => resolveNotificationConfig(userConfig),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(userConfig)],
  );

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Surfaces currently mounted, by presentation surface. A ref (not state) so
  // `notify` can read the live set without re-creating itself on every mount.
  const mountedSurfaces = useRef<Map<NotificationSurface, number>>(new Map());

  // Live auto-dismiss timers, so `pauseOnHover` can hold one and resume it with
  // the time it had left. A plain `setTimeout` could only ever be cancelled,
  // which is why the spec's `pauseOnHover` had nothing to attach to.
  const timers = useRef<Map<string, { handle: ReturnType<typeof setTimeout>; endsAt: number; left: number }>>(new Map());

  const scheduleAutoDismiss = useCallback((id: string, ms: number) => {
    const handle = setTimeout(() => {
      timers.current.delete(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, ms);
    timers.current.set(id, { handle, endsAt: Date.now() + ms, left: ms });
  }, []);

  const pauseAutoDismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    timers.current.set(id, { ...timer, left: Math.max(0, timer.endsAt - Date.now()) });
  }, []);

  const resumeAutoDismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    scheduleAutoDismiss(id, timer.left);
  }, [scheduleAutoDismiss]);

  // Never leave a timer running past unmount.
  useEffect(() => () => {
    for (const { handle } of timers.current.values()) clearTimeout(handle);
    timers.current.clear();
  }, []);

  const registerSurface = useCallback((surface: NotificationSurface) => {
    const counts = mountedSurfaces.current;
    counts.set(surface, (counts.get(surface) ?? 0) + 1);
    return () => {
      const next = (counts.get(surface) ?? 1) - 1;
      if (next > 0) counts.set(surface, next);
      else counts.delete(surface);
    };
  }, []);

  const notify = useCallback(
    (input: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>): string => {
      const id = `notification-${++notificationCounter}`;
      // Materialize the declared presentation (spec default: toast; the legacy
      // `modal` dialect presents as its nearest spec family, alert) so every
      // stored item carries the presentation that will render it (#2942).
      const presentation = resolveNotificationPresentation(input.displayType);
      const { surface, transient } = NOTIFICATION_PRESENTATIONS[presentation];
      const notification: NotificationItem = {
        ...input,
        displayType: presentation,
        id,
        createdAt: new Date(),
        read: false,
      };

      setNotifications((prev) => [notification, ...prev]);

      // Route to the presentation's surface. `onToast` is the `toast` surface —
      // it used to receive EVERY type, so a banner/alert/inline notification
      // presented as a toast (#3014). The other four are rendered by the
      // surface components subscribing through the context below.
      if (surface === 'delegate') onToast?.(notification, config);

      // A surface-rendered presentation with no surface mounted is invisible —
      // the "silently absent" shape this whole issue is about. Say so loudly in
      // dev. `toast` is exempt: a provider with no `onToast` is the supported
      // store-only mode (a notification centre with no overlay).
      if (__DEV__ && surface !== 'delegate' && (mountedSurfaces.current.get(surface) ?? 0) === 0) {
        console.warn(
          `[NotificationProvider] "${notification.title}" declares displayType ` +
            `'${presentation}' but no ${presentation} surface is mounted, so it will ` +
            `not be shown. To present it, ${SURFACE_HINTS[surface]}.`,
        );
      }

      // Auto-dismiss transient presentations. A banner/alert/inline stays until
      // it is dismissed unless the raiser asked for a duration explicitly —
      // sharing the toast timer made "persistent" presentations evaporate.
      const duration = input.duration ?? (transient ? config.defaultDuration : 0);
      if (duration > 0) scheduleAutoDismiss(id, duration);

      return id;
    },
    [config, onToast, scheduleAutoDismiss],
  );

  const info = useCallback(
    (title: string, message?: string) =>
      notify({ title, message, severity: 'info' }),
    [notify],
  );

  const success = useCallback(
    (title: string, message?: string) =>
      notify({ title, message, severity: 'success' }),
    [notify],
  );

  const warning = useCallback(
    (title: string, message?: string) =>
      notify({ title, message, severity: 'warning' }),
    [notify],
  );

  const error = useCallback(
    (title: string, message?: string) =>
      notify({ title, message, severity: 'error' }),
    [notify],
  );

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: string) => {
    // Drop any pending auto-dismiss with it — a held (hovered) timer would
    // otherwise sit in the map until unmount.
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer.handle); timers.current.delete(id); }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications,
      unreadCount,
      notify,
      info,
      success,
      warning,
      error,
      markAsRead,
      markAllAsRead,
      dismiss,
      clearAll,
      config,
      pauseAutoDismiss,
      resumeAutoDismiss,
      registerSurface,
    }),
    [
      notifications,
      unreadCount,
      notify,
      info,
      success,
      warning,
      error,
      markAsRead,
      markAllAsRead,
      dismiss,
      clearAll,
      config,
      pauseAutoDismiss,
      resumeAutoDismiss,
      registerSurface,
    ],
  );

  return (
    <NotificationCtx.Provider value={value}>
      {children}
    </NotificationCtx.Provider>
  );
};

NotificationProvider.displayName = 'NotificationProvider';

/**
 * Hook to consume the NotificationProvider context.
 *
 * @throws Error if used outside a NotificationProvider
 */
export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationCtx);
  if (!ctx) {
    throw new Error(
      'useNotifications must be used within a <NotificationProvider>. ' +
        'Wrap your app with <NotificationProvider> to use the notification system.',
    );
  }
  return ctx;
}

/**
 * Hook to check if a NotificationProvider is available.
 */
export function useHasNotificationProvider(): boolean {
  return useContext(NotificationCtx) !== null;
}

/**
 * Apply the config's stack rules to a surface's items: keep the newest
 * `maxVisible`, then order them so the stack GROWS in `stackDirection`
 * (`down`, the spec default, puts the newest below the older ones).
 *
 * Shared by the stacking surfaces (banner, inline) so `maxVisible` means one
 * thing. It used to mean nothing at all — the config carried it and no surface
 * read it, while `NotificationBanners` capped at a hard-coded 3 of its own.
 *
 * @param items the surface's notifications, newest-first
 */
export function visibleNotificationStack(
  items: NotificationItem[],
  config: Pick<ResolvedNotificationConfig, 'maxVisible' | 'stackDirection'>,
): NotificationItem[] {
  // Cap BEFORE ordering — an over-long stack drops its oldest, never its newest.
  const capped = config.maxVisible > 0 ? items.slice(0, config.maxVisible) : items;
  return config.stackDirection === 'up' ? capped : [...capped].reverse();
}

/**
 * The screen position a FLOATING notification (toast, snackbar) should take:
 * its own `position`, else the configured `defaultPosition`, else `undefined`.
 *
 * `undefined` is a meaningful answer, not a missing one — it means "nothing was
 * declared", and the surface should keep its own anchor (a snackbar's bottom
 * edge) or defer to the host's toast chrome, rather than being moved by a
 * default nobody asked for. Always returns the spec (underscore) spelling.
 */
export function resolveNotificationPosition(
  notification: Pick<NotificationItem, 'position'>,
  config?: Pick<ResolvedNotificationConfig, 'defaultPosition'>,
): NotificationPositionValue | undefined {
  const declared = notification.position ?? config?.defaultPosition;
  if (!declared) return undefined;
  const underscored = declared.replace(/-/g, '_') as NotificationPositionValue;
  return SUPPORTED_NOTIFICATION_POSITIONS.has(underscored) ? underscored : undefined;
}

/**
 * Subscribe to the live notifications for ONE presentation — the contract a
 * surface component implements (`@object-ui/components` ships one per spec
 * type). Registering also tells the provider the surface exists, so raising a
 * `banner` with no banner surface mounted warns in dev instead of vanishing.
 *
 * Items come back newest-first, matching `notifications`. A surface that wants
 * FIFO order (an `alert` queue) reverses them itself.
 *
 * @param presentation the spec display type this surface renders
 * @param scope optional `inline` routing key — when set, only items raised with
 *   the same `scope` are returned; when omitted, only unscoped items are.
 */
export function useNotificationsByPresentation(
  presentation: NotificationPresentation,
  scope?: string,
): NotificationItem[] {
  const { notifications, registerSurface } = useNotifications();
  const { surface } = NOTIFICATION_PRESENTATIONS[presentation];

  useEffect(() => registerSurface(surface), [registerSurface, surface]);

  return useMemo(
    () =>
      notifications.filter(
        (n) =>
          resolveNotificationPresentation(n.displayType) === presentation &&
          (presentation !== 'inline' || (n.scope ?? undefined) === scope),
      ),
    [notifications, presentation, scope],
  );
}

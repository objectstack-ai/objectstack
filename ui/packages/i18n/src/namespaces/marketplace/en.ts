/**
 * English (en) — the lazy `marketplace` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/en.ts`, holding only
 * the `marketplace` group, which `./index.ts` deep-merges into an i18next
 * instance when a marketplace page mounts. `./index.ts` says what the
 * namespace is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const en = { … }` and `export default en`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const en = {
  marketplace: {
    title: 'App Marketplace',
      subtitle: 'Browse approved apps published to the ObjectStack catalog. Click an app to view details and install it into one of your environments.',
      searchPlaceholder: 'Search apps by name or app ID…',
      searchAria: 'Search marketplace apps',
      installed: 'Installed',
      installedCount: 'Installed ({{count}})',
      refresh: 'Refresh',
      all: 'All',
      noApprovedYet: 'No apps have been approved for the marketplace yet.',
      noMatchFilters: 'No apps match your filters.',
      noDescription: 'No description provided.',
      back: 'Back to marketplace',
      browseLink: 'Browse the marketplace →',
      installedAdditiveNote: 'Uninstall removes the app from the running kernel at once, together with its permission sets and their grants, and deletes the cached manifest so the package does not load at the next start. Records stored in its objects stay in the database.',
      versionBadge: 'v{{version}}',
      installedBadge: 'Installed v{{version}}',
      // objectui#11645 — an install-local entry this runtime refused to load at
      // startup (the listing's `notLoaded` marker), read on Installed Apps.
      notLoaded: {
        badge: 'Not loaded',
        protocolIncompatible: 'This runtime did not load this package: it targets protocol {{requiredRange}}, which this runtime does not support.',
        otherReason: 'This runtime did not load this package ({{code}}).',
      },
      load: {
        failed: 'Failed to load marketplace',
        failedHintConfigured: 'This runtime reaches the marketplace through the control plane at {{url}}. Check that it is online and reachable from here.',
        failedHintSameOrigin: 'The marketplace catalog is reached through this runtime. Check that the runtime is online and can reach the catalog.',
        loading: 'Loading the marketplace catalog…',
        slow: 'Still loading — the marketplace catalog is slow to answer.',
        retry: 'Retry',
        unreachable: 'The marketplace catalog could not be reached.',
        answeredError: 'The marketplace catalog answered with an error (HTTP {{status}}).',
        packageFailed: 'Failed to load package',
        notFound: 'Not found.',
      },
      disabled: {
        title: 'App Marketplace is turned off',
        description: 'This runtime has no marketplace configured, so there is nothing to browse or install from here.',
        hint: 'That is the expected state when the runtime is started with <code>OS_CLOUD_URL=off</code> (or <code>none</code>, <code>local</code>, <code>disabled</code>). To turn the marketplace on, point <code>OS_CLOUD_URL</code> at a control plane and restart the runtime.',
      },
      detail: {
        homepage: 'Homepage',
        installedV: 'Installed · v{{version}}',
        about: 'About',
        noReadme: 'No readme provided.',
        versions: 'Versions',
        noApprovedVersions: 'No approved versions.',
        prerelease: 'pre',
        moreOptions: 'More install options',
        uninstallFromRuntime: 'Uninstall from this runtime',
        addSampleData: 'Add sample data',
        reseedAgain: 'Re-seed sample data',
        purgeSampleData: 'Purge sample data',
        purgeConfirm: 'Delete all sample records seeded by this package? User-added records will NOT be touched.',
        purgeSuccess: 'Removed {{count}} sample record(s).',
        purgeSuccess_one: 'Removed {{count}} sample record.',
        purgeSuccess_other: 'Removed {{count}} sample records.',
        purgeNoData: 'No sample records found to purge.',
        // objectstack#30323 — the install note's sample-data count, its clear and the app banner.
        sampleDataLoaded: 'This install loaded {{count}} sample record(s) so you can see the app working. Clear them when you start using it for real.',
        sampleDataLoaded_one: 'This install loaded {{count}} sample record so you can see the app working. Clear it when you start using the app for real.',
        sampleDataLoaded_other: 'This install loaded {{count}} sample records so you can see the app working. Clear them when you start using it for real.',
        sampleDataReloaded: 'Installing again loads the sample data again, including any you had cleared.',
        purgeConfirmAtMost: 'At most {{count}} sample record(s) will be deleted: the number this install loaded.',
        purgeConfirmAtMost_one: 'At most {{count}} sample record will be deleted: the number this install loaded.',
        purgeConfirmAtMost_other: 'At most {{count}} sample records will be deleted: the number this install loaded.',
        sampleDataBannerTitle: '"{{name}}" has sample data.',
        sampleDataBannerMessage: 'It is there so you can see the app working. Clear it when you start using the app for real.',
        reseedQueued: 'Sample data will be re-seeded on next environment access.',
        reseedLocalSuccess: 'Re-seeded sample data: {{inserted}} inserted, {{updated}} updated.',
        reseedPartialErrors: '({{count}} record(s) failed to write)',
        reseedPartialErrors_one: '({{count}} record failed to write)',
        reseedPartialErrors_other: '({{count}} records failed to write)',
        sampleDataKernelUnavailable: 'This control plane has no environment kernel, so sample data cannot be re-seeded or purged from here. Do it from the environment\'s own runtime.',
        updateAvailable: 'Update available',
      },
      action: {
        install: 'Install',
        reinstall: 'Reinstall',
        working: 'Working…',
        installToCloud: 'Install to cloud…',
        installed: 'Installed',
        installing: 'Installing…',
        updating: 'Updating…',
        uninstall: 'Uninstall',
        uninstalling: 'Uninstalling…',
        details: 'Details',
        close: 'Close',
        dismiss: 'Dismiss',
        openOnCloud: 'Open on cloud',
        backHome: 'Back to home',
        updateTo: 'Update',
      },
      install: {
        dialogTitle: 'Install {{name}}',
        dialogDescCurrent: 'Install into this environment ({{host}}).',
        dialogDescPicker: 'Choose an environment to install this app into. You need to be signed into ObjectOS Cloud.',
        environment: 'Environment',
        environmentPlaceholder: 'Pick an environment',
        includeSampleData: 'Include sample data',
        noEnvs: 'No environments found in your active organization.',
        noPermission: 'You do not have permission to install apps in any environment. Only organization owners and admins can install — ask your organization admin.',
        signInFirst: 'You need to sign into ObjectOS Cloud first. Click "Open on cloud" below.',
        success: 'Installed successfully. Open the environment to see the new app.',
        localSuccess: 'Installed v{{version}} to this runtime. "{{name}}" is now in the app switcher.',
        // objectui#12098 — the install answered `hotLoaded: false`: installed, and
        // the running kernel did not register it (objectstack#22695), so nothing
        // of it is served before the next restart.
        localLoadsAtRestart: 'Installed v{{version}} to this runtime. "{{name}}" loads when the runtime next restarts; it does not appear in the app switcher until then.',
        localManifestConflict: '{{message}}\nTip: a local app already owns this manifest_id. Remove it from objectstack.config.ts first.',
        localUnauthorized: 'Sign in to this runtime first, then try again.',
        localMarketplaceUnavailable: 'This runtime has no OS_CLOUD_URL configured, so the marketplace catalog is unreachable.',
        updateTo: 'Update → v{{version}}',
        installedVersion: 'Installed v{{version}}',
        // objectui#12087 — an install into THIS environment, from its answer
        // until the runtime serves the package's app (MarketplacePackagePage).
        deploying: 'Deploying the app…',
        deployed: 'The app is deployed and ready.',
        openApp: 'Open {{name}}',
        deployTimeout: 'The install was recorded, but this environment is not serving the app yet. It may still be deploying — check again shortly. If it never appears, the package may not have loaded, may include no app, or its app may need a permission you do not hold.',
        checkAgain: 'Check again',
        // ADR-0131 D6 — the install modes a package's manifest permits, and
        // what an unmanaged install answers (MarketplacePackagePage).
        mode: {
          label: 'Install mode',
          managed: 'Managed',
          managedHint: 'The package stays the authority: it is registered as code, receives its upgrades, and its items are not edited here.',
          unmanaged: 'Unmanaged copy',
          unmanagedHint: 'Copied once into this runtime as its own metadata: every item is editable here, and the copy receives no upgrade.',
          required: 'Choose an install mode to install this package.',
        },
        unmanagedSuccess: 'Copied v{{version}} of "{{name}}" into this runtime as its own metadata, in the base {{base}}. The copy is editable and receives no upgrade.',
        unmanagedStrippedLocks: 'The package locked these items. The copy is editable, so their locks were not copied:',
        unmanagedIgnored: 'This runtime does not support unmanaged installs, so "{{name}}" was installed managed (registered as code) instead of copied. Upgrade the runtime, then uninstall the package and install it again as an unmanaged copy.',
      },
      // objectui#12146 — the install dialog opened as an UPDATE of the copy
      // this environment holds (MarketplacePackagePage).
      update: {
        dialogTitle: 'Update {{name}}',
        dialogDescCurrent: 'Update the copy installed in this environment ({{host}}).',
        dialogDescPicker: 'Choose the environment whose installed copy to update. You need to be signed into ObjectOS Cloud.',
        majorNotice: 'This is a major version update (v{{fromMajor}} → v{{toMajor}}), which may include breaking changes.',
        releaseNotes: 'Read the v{{version}} release notes',
        success: 'Updated to v{{version}}.',
        deployTimeout: 'The update was recorded, but this environment is not serving v{{version}} yet. It may still be deploying — check again shortly.',
      },
      // objectui#3546 — the MarketplacePage "Your organization" strip.
      org: {
        heading: 'Your organization',
        install: 'Install',
        installed: 'Installed {{name}}',
        installedBadge: 'Installed',
        installing: 'Installing…',
      },
      // ADR-0025 PD4 §3.5/§3.11 — the pre-install consent panel
      // (PluginDisclosure.tsx). `runtime` is a CLOSED enum: spec
      // PluginRuntimeSchema = z.enum(['node', 'sandbox', 'worker']).
      disclosure: {
        containsCode: 'This package contains code',
        reviewed: 'Reviewed & approved',
        unreviewed: 'Not yet reviewed',
        signed: 'Signed',
        grantsIntro: 'This package requests:',
        notEnforced: 'Recorded at install, and re-confirmed if a later version asks for more — but the runtime does not yet restrict the package to this list.',
        services: 'Platform services',
        hooks: 'Lifecycle hooks',
        network: 'Network access',
        fs: 'Filesystem access',
        noPermissions: 'Requests no special permissions.',
        acknowledge: 'I understand this package runs code and grants the permissions above.',
        runtime: {
          node: 'In-process · full trust',
          sandbox: 'Sandboxed',
          worker: 'Out-of-process',
        },
      },
      // ADR-0090 D5/D9 — a package's isDefault permission set is an
      // install-time suggestion to bind it to the everyone/guest position;
      // the admin confirms here, the server never auto-binds.
      suggestedBindings: {
        promptEveryone: 'This app suggests granting "{{set}}" to all signed-in users (the Everyone position).',
        promptGuest: 'This app suggests granting "{{set}}" to unauthenticated visitors (the Guest position).',
        confirm: 'Grant',
        confirming: 'Granting…',
        dismiss: 'Dismiss',
        confirmedToast: '"{{set}}" is now granted to {{anchor}}.',
        dismissedToast: 'Suggestion for "{{set}}" dismissed.',
        guestUnsupported: 'Cannot be granted here: the Guest position takes no sets from accepted suggestions.',
        acceptedState: '"{{set}}" was accepted for all signed-in users (the Everyone position).',
        notInForceState: '"{{set}}" was accepted but is not in force yet: the Everyone position did not change on this request. The server log says why.',
        dismissedState: '"{{set}}" is not granted: the suggestion was dismissed or revoked.',
        revoke: 'Revoke',
        revoking: 'Revoking…',
        revokedToast: 'Acceptance of "{{set}}" revoked.',
        reopen: 'Reconsider',
        reopening: 'Reopening…',
        reopenedToast: 'Suggestion for "{{set}}" reopened: nothing is granted until it is accepted.',
      },
      uninstall: {
        confirm: 'Uninstall {{manifestId}} v{{version}} from this runtime?\n\nThe app will leave the running kernel at once, together with its permission sets and their grants, and its cached manifest will be removed. Records stored in its objects stay in the database.',
        successInList: 'Removed {{manifestId}}: the app has left the running kernel, with its permission sets and their grants. Records stored in its objects stay in the database.',
        successInDetail: 'Removed {{manifestId}} and its cached manifest: the app has left the running kernel, with its permission sets and their grants. Records stored in its objects stay in the database.',
        confirmNotLoaded: 'Uninstall {{manifestId}} v{{version}} from this runtime?\n\nThe cached manifest will be removed. This runtime did not load the package, so none of it is running.',
        successNotLoaded: 'Removed {{manifestId}}. It was not loaded, so no restart is needed.',
      },
      accessDenied: {
        title: 'App Marketplace is admin-only',
        description: 'You don\'t have permission to install apps in this environment. Ask an owner or admin of this organization for access.',
      },
      category: {
        crm: 'CRM',
        erp: 'ERP',
        hr: 'Human Resources',
        finance: 'Finance',
        project: 'Project Management',
        collaboration: 'Collaboration',
        analytics: 'Analytics',
        integration: 'Integration',
        automation: 'Automation',
        ai: 'AI',
        security: 'Security',
        'developer-tools': 'Developer Tools',
        'ui-theme': 'UI Theme',
        storage: 'Storage',
        other: 'Other',
      },
      relativeTime: {
        today: 'today',
        daysAgo: '{{count}}d ago',
        monthsAgo: '{{count}}mo ago',
        monthsAgo_one: '{{count}}mo ago',
        monthsAgo_other: '{{count}}mo ago',
        yearsAgo: '{{count}}y ago',
        yearsAgo_one: '{{count}}y ago',
        yearsAgo_other: '{{count}}y ago',
      },
    },
} as const;

export default en;

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Package conventions and directory structure constants.
 * These define the "Law of Location" - where things must be in ObjectStack packages.
 * 
 * These paths are the source of truth used by:
 * - the ObjectStack runtime (to locate package components)
 * - ObjectStack CLI (to scaffold and validate packages)
 * - ObjectStudio IDE (to provide intelligent navigation and validation)
 */
export const PKG_CONVENTIONS = {
  /**
   * Standard directories within ObjectStack packages.
   * All packages MUST follow these conventions for the runtime to locate resources.
   */
  DIRS: {
    /** 
     * Location for schema definitions (Zod schemas, JSON schemas).
     * Path: src/schemas
     */
    SCHEMA: 'src/schemas',
    
    /** 
     * Location for server-side code and triggers.
     * Path: src/server
     */
    SERVER: 'src/server',
    
    /** 
     * Location for server-side trigger functions.
     * Path: src/triggers
     */
    TRIGGERS: 'src/triggers',
    
    /** 
     * Location for client-side code.
     * Path: src/client
     */
    CLIENT: 'src/client',
    
    /** 
     * Location for client-side page components.
     * Path: src/client/pages
     */
    PAGES: 'src/client/pages',
    
    /** 
     * Location for static assets (images, fonts, etc.).
     * Path: assets
     */
    ASSETS: 'assets',
  },
  
  /**
   * Standard file names within ObjectStack packages.
   */
  FILES: {
    /** 
     * Package manifest configuration file.
     * File: objectstack.config.ts
     */
    MANIFEST: 'objectstack.config.ts',
    
    /** 
     * Main entry point for the package.
     * File: src/index.ts
     */
    ENTRY: 'src/index.ts',
  },
} as const;

/**
 * Type helper to extract directory path values.
 */
export type PackageDirectory = typeof PKG_CONVENTIONS.DIRS[keyof typeof PKG_CONVENTIONS.DIRS];

/**
 * Type helper to extract file path values.
 */
export type PackageFile = typeof PKG_CONVENTIONS.FILES[keyof typeof PKG_CONVENTIONS.FILES];

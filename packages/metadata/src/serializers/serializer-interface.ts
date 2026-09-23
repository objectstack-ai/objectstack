// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata Serializer Interface
 * 
 * Defines the contract for serializing/deserializing metadata
 */

import type { z } from 'zod';
import type { MetadataFormat } from '@objectstack/spec/system';

/**
 * Serialization options
 */
export interface SerializeOptions {
  /** Prettify output (formatted with indentation) */
  prettify?: boolean;
  /** Indentation size (spaces) */
  indent?: number;
  /** Sort object keys alphabetically */
  sortKeys?: boolean;
  /** Include default values in output */
  includeDefaults?: boolean;
  /**
   * The metadata type of the item being serialized (`'object'`, `'view'`,
   * `'flow'`, …). Only the `typescript` format reads it: it picks the spec
   * authoring type the emitted constant is annotated with, and an item with no
   * type, or with a type that has no such spec type, is written with no
   * annotation. `FilesystemLoader.save()` passes the type it was given.
   */
  metadataType?: string;
}

/**
 * Abstract interface for metadata serializers
 * Implementations handle different formats (JSON, YAML, TypeScript, etc.)
 */
export interface MetadataSerializer {
  /**
   * Serialize object to string
   * @param item The item to serialize
   * @param options Serialization options
   * @returns Serialized string
   */
  serialize<T>(item: T, options?: SerializeOptions): string;

  /**
   * Deserialize string to object
   * @param content The content to deserialize
   * @param schema Optional Zod schema for validation
   * @returns Deserialized object
   */
  deserialize<T>(content: string, schema?: z.ZodSchema): T;

  /**
   * Get file extension for this format
   * @returns File extension (e.g., '.json', '.yaml')
   */
  getExtension(): string;

  /**
   * Check if this serializer can handle the format
   * @param format The format to check
   * @returns True if can handle
   */
  canHandle(format: MetadataFormat): boolean;

  /**
   * Get the format this serializer handles
   * @returns The metadata format
   */
  getFormat(): MetadataFormat;
}

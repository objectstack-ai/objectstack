/**
 * Metadata describing an example. Kept separate from the schema JSON so the
 * raw schemas remain copy-pasteable into user projects.
 */
export interface ExampleMeta {
  /** Short human title, e.g. "Simple Login Form" */
  title: string;
  /** One-line description shown above the preview */
  description: string;
  /** Coarse category, e.g. "auth", "dashboard" */
  category: string;
  /** Optional free-form tags used by docs filters / AI retrieval */
  tags?: string[];
}

/**
 * One registry entry: the immutable id, the metadata, and the JSON schema.
 */
export interface Example<TSchema = unknown> {
  /** Stable identifier, e.g. "auth/login-simple". Used as the MDX `id` prop. */
  id: string;
  meta: ExampleMeta;
  schema: TSchema;
}

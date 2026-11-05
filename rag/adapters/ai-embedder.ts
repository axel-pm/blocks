// OPTIONAL adapter. Wrap an AI SDK embedding model as the core's `Embedder`. This is the only file
// that imports `ai`; the core stays provider-free.
//
// `model` is whatever AI SDK's embedMany accepts — a Gateway string like
// "openai/text-embedding-3-small", or a provider EmbeddingModel instance. `providerOptions` is
// passed straight through, so you can carry the same gateway residency / zero-retention options you
// use elsewhere (compose this with the inference block's gatewayOptions for an EU-pinned embedder).

import { embedMany, type EmbeddingModel } from 'ai';
import type { Embedder } from '../src/types';

/** The providerOptions shape embedMany accepts, borrowed from the SDK so we don't redeclare it. */
type EmbedProviderOptions = NonNullable<Parameters<typeof embedMany>[0]['providerOptions']>;

export type AiEmbedderConfig = {
  /** A Gateway model string ("openai/text-embedding-3-small") or an AI SDK EmbeddingModel instance. */
  model: EmbeddingModel;
  /** The id recorded in the index for the mismatch guard. Defaults to the model string when `model` is a string. */
  id?: string;
  /** Passed to embedMany as providerOptions (e.g. gateway zero-retention / region). */
  providerOptions?: EmbedProviderOptions;
  /** Passed to embedMany as maxRetries. */
  maxRetries?: number;
};

export function aiEmbedder(config: AiEmbedderConfig): Embedder {
  // The id is stored in the index and is the ONLY thing the retriever checks for a match. So the id
  // must capture anything that changes the vector space: the model, and any providerOptions (e.g. a
  // task/input type). Refuse to default the id from the model string when providerOptions are set —
  // otherwise two different embedding configs could share an id and silently return wrong results.
  const id =
    config.id ?? (typeof config.model === 'string' && !config.providerOptions ? config.model : undefined);
  if (!id) {
    throw new Error(
      'aiEmbedder: pass an explicit `id` when `model` is not a plain string, or when `providerOptions` are set ' +
        '(the id is stored in the index and must uniquely identify the embedding configuration)',
    );
  }

  return {
    id,
    embed: async (texts: string[]) => {
      if (texts.length === 0) return [];
      const { embeddings } = await embedMany({
        model: config.model,
        values: texts,
        ...(config.providerOptions ? { providerOptions: config.providerOptions } : {}),
        ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
      });
      return embeddings;
    },
  };
}

// Shared test fixtures: a tiny three-role app with a gateway default and one off-gateway target.
// Imported by both the core tests and the adapter tests so they agree on one registry.

import { defineRegistry } from '../src/registry';
import type { Target } from '../src/types';

export type Role = 'router' | 'answer' | 'verify';

export const gatewayOptions = {
  gateway: { tags: ['app'], inferenceRegion: { scope: 'zone', geoRegion: 'eu' }, zeroDataRetention: true, models: [] as string[] },
};

export const GATEWAY: Target<Role> = {
  id: 'gateway-eu',
  label: 'Gateway (EU)',
  residency: 'EU-pinned gateway',
  apiKeyEnv: '',
  mode: 'gateway',
  enabled: true,
  models: {
    router: { model: 'anthropic/claude-haiku-5.5' },
    answer: { model: 'anthropic/claude-sonnet-5.5', effort: 'medium' },
    verify: { model: 'anthropic/claude-haiku-5.5' },
  },
};

export const SCALEWAY: Target<Role> = {
  id: 'scaleway',
  label: 'Scaleway',
  residency: 'EU open weights',
  apiKeyEnv: 'SCW_SECRET_KEY',
  baseURL: 'https://api.scaleway.ai/v1',
  mode: 'openai-compatible',
  enabled: false,
  models: {
    router: { model: 'mistral-small' },
    answer: { model: 'gpt-oss-120b' },
    verify: { model: 'mistral-small' },
  },
};

export const registry = defineRegistry<Role>([GATEWAY, SCALEWAY], 'gateway-eu');

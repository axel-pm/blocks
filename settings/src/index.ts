// Public surface of the settings block's pure core. Copy `src/` in, import from here.
export type { Codec, EnvReader, Setting, SettingsConfig, SettingsStore } from './types';
export { enumCodec, jsonCodec, stringCodec } from './codec';
export { createSettings, defineSetting } from './settings';
export type { Settings } from './settings';

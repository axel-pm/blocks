import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestDir } from '../adapters/fs-ingest';

// This file is copied in only with `--adapter fs-ingest` (or the cli adapter), alongside the
// adapter it exercises.

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rag-ingest-'));
  writeFileSync(join(root, 'readme.md'), '# Readme\n\nHello world.');
  writeFileSync(join(root, 'notes.txt'), 'plain notes');
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n\nStep one.');
  // Things that MUST be skipped:
  writeFileSync(join(root, '.env'), 'SECRET_KEY=supersecret'); // secret
  writeFileSync(join(root, 'server.pem'), '-----BEGIN KEY-----'); // secret by extension
  writeFileSync(join(root, 'photo.png'), 'PNGDATA'); // wrong extension
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'dep.md'), '# Dep\n\nnoise'); // noise dir
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('ingestDir', () => {
  it('ingests text docs with forward-slash relative ids and a title', () => {
    const docs = ingestDir(root);
    const ids = docs.map((d) => d.id);
    expect(ids).toEqual(['docs/guide.md', 'notes.txt', 'readme.md']); // sorted, forward slashes
    expect(docs.find((d) => d.id === 'readme.md')!.title).toBe('Readme'); // from the H1
    expect(docs.find((d) => d.id === 'notes.txt')!.title).toBe('notes.txt'); // falls back to name
  });

  it('skips secrets, wrong extensions, and noise directories by default', () => {
    const ids = ingestDir(root).map((d) => d.id);
    expect(ids).not.toContain('.env');
    expect(ids).not.toContain('server.pem');
    expect(ids).not.toContain('photo.png');
    expect(ids.some((id) => id.includes('node_modules'))).toBe(false);
  });

  it('honours a custom extension list', () => {
    const ids = ingestDir(root, { extensions: ['txt'] }).map((d) => d.id);
    expect(ids).toEqual(['notes.txt']);
  });
});

describe('ingestDir — secret gate (H3)', () => {
  let r: string;
  beforeAll(() => {
    r = mkdtempSync(join(tmpdir(), 'rag-sec-'));
    mkdirSync(join(r, '.aws'));
    writeFileSync(join(r, '.aws', 'config.txt'), 'region=eu-west-1'); // in a credential dir
    mkdirSync(join(r, 'secrets'));
    writeFileSync(join(r, 'secrets', 'db.md'), '# DB\n\nconnection notes'); // in a secrets dir
    writeFileSync(join(r, '.env.production'), 'TOKEN=abc'); // secret file shape
    writeFileSync(join(r, 'server.ppk'), 'PuTTY-User-Key'); // secret extension
    writeFileSync(join(r, 'apikey.txt'), 'here is the key AKIAIOSFODNN7EXAMPLE use it'); // secret CONTENT
    writeFileSync(join(r, 'leak.md'), '# Deploy\n\n-----BEGIN RSA PRIVATE KEY-----\nMII...'); // secret CONTENT
    // Docs that must NOT be wrongly skipped (precise name rules, not fuzzy words):
    writeFileSync(join(r, 'reset-password.md'), '# Reset your password\n\nClick the link.');
    writeFileSync(join(r, 'credentials-guide.md'), '# Credentials guide\n\nHow to request access.');
  });
  afterAll(() => rmSync(r, { recursive: true, force: true }));

  it('skips credential dirs, secret file shapes, and secret content', () => {
    const skipped: Record<string, string> = {};
    const ids = ingestDir(r, { onSkip: (p, reason) => { skipped[p] = reason; } }).map((d) => d.id);
    expect(ids).not.toContain('.aws/config.txt');
    expect(ids).not.toContain('secrets/db.md');
    expect(ids).not.toContain('.env.production');
    expect(ids).not.toContain('server.ppk');
    expect(ids).not.toContain('apikey.txt');
    expect(ids).not.toContain('leak.md');
    expect(skipped['.aws']).toBe('secret-dir');
    expect(skipped['apikey.txt']).toBe('secret-content');
    expect(skipped['leak.md']).toBe('secret-content');
    expect(skipped['server.ppk']).toBe('secret-name');
  });

  it('does NOT wrongly skip legitimate docs that merely mention password/credentials', () => {
    const ids = ingestDir(r).map((d) => d.id);
    expect(ids).toContain('reset-password.md');
    expect(ids).toContain('credentials-guide.md');
  });

  it('enforces the maxFiles cap', () => {
    expect(() => ingestDir(r, { maxFiles: 0 })).toThrow(/maxFiles/);
  });
});

describe('ingestDir — secret gate hardening (confirm-pass fixes)', () => {
  let r: string;
  beforeAll(() => {
    r = mkdtempSync(join(tmpdir(), 'rag-sec2-'));
    // Hyphenated modern keys that the old \bsk-[A-Za-z0-9]{20,}\b missed:
    writeFileSync(join(r, 'anthropic.md'), '# key\n\nsk-ant-api03-' + 'a'.repeat(40));
    writeFileSync(join(r, 'openai-proj.md'), 'sk-proj-' + 'b'.repeat(40));
    writeFileSync(join(r, 'stripe.md'), 'sk_live_' + 'c'.repeat(30));
    writeFileSync(join(r, 'ghpat.md'), 'github_pat_' + 'd'.repeat(40));
    // A secret past the old 512K scan window:
    writeFileSync(join(r, 'big.md'), 'filler\n\n'.repeat(80000) + '\n\nAKIAIOSFODNN7EXAMPLE');
    // Config-shaped secret files (reachable when --ext is widened):
    writeFileSync(join(r, 'serviceAccountKey.json'), '{"type":"service_account"}');
    writeFileSync(join(r, 'prod.env'), 'TOKEN=x');
    writeFileSync(join(r, 'clean.md'), '# Clean\n\nNothing secret here.');
  });
  afterAll(() => rmSync(r, { recursive: true, force: true }));

  it('catches hyphenated sk-ant/sk-proj, stripe, and github_pat keys in docs', () => {
    const ids = ingestDir(r).map((d) => d.id);
    for (const f of ['anthropic.md', 'openai-proj.md', 'stripe.md', 'ghpat.md']) expect(ids).not.toContain(f);
  });

  it('scans the whole file, not just the first 512K', () => {
    expect(ingestDir(r).map((d) => d.id)).not.toContain('big.md');
  });

  it('skips config-shaped secret files when those extensions are ingested', () => {
    const ids = ingestDir(r, { extensions: ['md', 'json', 'env'] }).map((d) => d.id);
    expect(ids).not.toContain('serviceAccountKey.json');
    expect(ids).not.toContain('prod.env');
    expect(ids).toContain('clean.md'); // and a clean doc still gets in
  });
});

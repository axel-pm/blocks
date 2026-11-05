// OPTIONAL adapter. Walk a directory (a repo, a docs folder, a knowledge base) and turn its text
// files into Documents for the core to index. This is where filesystem access lives — the core
// never reads a file.
//
// Security is the whole point of this step: it decides what enters your index, and anything indexed
// becomes retrievable (and gets sent to your embedding provider). It is deny-by-default on three
// axes:
//   1. Directory names (anywhere in the tree): node_modules/.git/build output AND credential dirs
//      (.aws, .ssh, .gnupg, .gcloud, .kube, .terraform, secrets).
//   2. File shapes that are almost always secrets: .env*, *.pem/key/pfx/p12/ppk, id_rsa, kubeconfig,
//      *.tfstate/tfvars, service-account/credentials *.json|*.yaml, .npmrc/.netrc/.git-credentials, …
//   3. File CONTENT: a scan for secret signatures (private-key blocks, AWS AKIA…, OpenAI sk-…,
//      GitHub ghp_…, Slack xox…, Google AIza…). This catches a key pasted into an ordinary .md/.txt
//      that no name rule would flag — the backstop that makes widening --ext safe.
//
// Precise name rules (not fuzzy word matching) are deliberate: matching "secret"/"password" anywhere
// in a name wrongly skips legitimate docs like reset-password.md or credentials-guide.md. Those are
// indexed; a real secret inside them is caught by the content scan instead.
//
// NOTE: .gitignore is NOT consulted. If a private directory is gitignored but not in the skip list,
// add it via `skipDirs`. Review a corpus built from a tree you didn't audit.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Document } from '../src/types';

export type SkipReason = 'ext' | 'secret-name' | 'secret-dir' | 'secret-content' | 'binary' | 'size' | 'empty' | 'custom';

export type IngestOptions = {
  /** File extensions to include (lower-case, no dot). Default: common doc/text formats. */
  extensions?: string[];
  /** Directory names to skip anywhere in the tree. Merged with sensible defaults; matched case-insensitively. */
  skipDirs?: string[];
  /** Extra filename patterns to skip, beyond the secret defaults (matched on the base name). */
  skipFiles?: RegExp[];
  /** Skip a file larger than this many bytes. Default 1 MiB. */
  maxBytes?: number;
  /** Refuse to ingest more than this many files (cost/safety cap). Default 5000. */
  maxFiles?: number;
  /** Refuse to ingest more than this many total bytes (cost/safety cap). Default 50 MiB. */
  maxTotalBytes?: number;
  /** Turn off the content scan for secret signatures. Default false (scan on). */
  disableSecretScan?: boolean;
  /** Called for each skipped file, with the reason. Lets a caller log what didn't enter the index. */
  onSkip?: (path: string, reason: SkipReason) => void;
};

const DEFAULT_EXT = ['md', 'mdx', 'markdown', 'mdown', 'txt', 'rst', 'adoc'];
const DEFAULT_SKIP_DIRS = [
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage',
  '.vercel', '.cache', 'vendor', '.venv', '__pycache__',
  // credential / key directories — deny by default
  '.aws', '.ssh', '.gnupg', '.gcloud', 'gcloud', '.kube', '.terraform', '.docker', 'secrets',
];
// High-precision secret FILE shapes (tested on the basename). Not fuzzy word matching — see header.
const SECRET_NAME_PATTERNS: RegExp[] = [
  /(^|\.)env(\.[^/]*)?$/i, // .env, .env.production, prod.env, foo.env
  /^\.(npmrc|netrc|pgpass|pypirc|dockercfg|git-credentials|htpasswd|envrc)(\.[^/]*)?$/i,
  /\.(pem|key|pfx|p12|crt|cer|der|keystore|jks|ppk|tfstate|tfvars)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^kubeconfig$/i,
  // credential/secret/token/service-account/auth config files (any case, camelCase included):
  // e.g. serviceAccountKey.json, service-account.yaml, application_default_credentials.json,
  // token.json, auth.json, firebase-adminsdk-*.json, client_secret_*.json.
  /(service[_-]?account|credential|secret|token|auth|firebase[_-]?adminsdk)[^/]*\.(json|ya?ml|yml)$/i,
];
// Secret CONTENT signatures (scanned over the whole file text).
const SECRET_CONTENT_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key id
  /\bsk-[A-Za-z0-9]{20,}\b/, // OpenAI classic
  /\bsk-(?:ant|proj)-[A-Za-z0-9_-]{16,}/, // Anthropic / OpenAI project keys (hyphenated)
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/, // Stripe secret keys
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, // GitHub tokens (classic)
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, // GitHub fine-grained PAT
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack
  /\bAIza[0-9A-Za-z_\-]{35}\b/, // Google API key
];

/** Read a directory tree into Documents. `root` is the base; each Document id is the path relative to it. */
export function ingestDir(root: string, opts: IngestOptions = {}): Document[] {
  const extensions = new Set((opts.extensions ?? DEFAULT_EXT).map((e) => e.toLowerCase()));
  const skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...(opts.skipDirs ?? [])].map((d) => d.toLowerCase()));
  const userSkip = stripStatefulFlags(opts.skipFiles ?? []);
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const maxFiles = opts.maxFiles ?? 5000;
  const maxTotalBytes = opts.maxTotalBytes ?? 50 * 1024 * 1024;
  const scan = !opts.disableSecretScan;
  const onSkip = opts.onSkip ?? (() => {});

  const docs: Document[] = [];
  let totalBytes = 0;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const id = relative(root, full).split(sep).join('/');
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name.toLowerCase())) onSkip(id, 'secret-dir');
        else walk(full);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks/sockets: Dirent does not follow, so no cycles

      if (SECRET_NAME_PATTERNS.some((re) => re.test(entry.name)) || userSkip.some((re) => re.test(entry.name))) {
        onSkip(id, 'secret-name');
        continue;
      }
      const ext = entry.name.includes('.') ? entry.name.split('.').pop()!.toLowerCase() : '';
      if (!extensions.has(ext)) {
        onSkip(id, 'ext');
        continue;
      }

      const info = statSync(full);
      if (info.size === 0) { onSkip(id, 'empty'); continue; }
      if (info.size > maxBytes) { onSkip(id, 'size'); continue; }

      const text = readFileSync(full, 'utf8');
      if (!text.trim()) { onSkip(id, 'empty'); continue; }
      if (looksBinary(text)) { onSkip(id, 'binary'); continue; }
      if (scan && SECRET_CONTENT_PATTERNS.some((re) => re.test(text))) {
        onSkip(id, 'secret-content');
        continue;
      }

      docs.push({ id, title: firstHeadingOrName(text, entry.name), text, meta: { path: id } });
      totalBytes += info.size;
      if (docs.length > maxFiles) throw new Error(`rag: ingest exceeded maxFiles (${maxFiles}); narrow the directory or raise the cap`);
      if (totalBytes > maxTotalBytes) throw new Error(`rag: ingest exceeded maxTotalBytes (${maxTotalBytes}); narrow the directory or raise the cap`);
    }
  };

  walk(root);
  docs.sort((a, b) => a.id.localeCompare(b.id)); // deterministic order → reproducible index
  return docs;
}

/** Clone any user RegExp carrying `g` or `y`, since `.test()` on a global/sticky regex is stateful. */
function stripStatefulFlags(patterns: RegExp[]): RegExp[] {
  return patterns.map((re) => (re.global || re.sticky ? new RegExp(re.source, re.flags.replace(/[gy]/g, '')) : re));
}

/** A markdown H1/H2 if the file opens with one, else the file name. */
function firstHeadingOrName(text: string, name: string): string {
  const m = text.match(/^\s{0,3}#{1,2}\s+(.+?)\s*$/m);
  return m ? m[1]!.trim() : name;
}

/** Cheap binary sniff: a NUL byte in the first 1k almost never appears in real text. */
function looksBinary(text: string): boolean {
  return text.slice(0, 1024).includes('\u0000');
}

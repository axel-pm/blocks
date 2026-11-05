#!/usr/bin/env node
// blocks — a zero-dependency copy-in CLI for this source registry.
//
//   blocks list                              list available blocks
//   blocks info  <block>                     show a block's files, peerDeps, env, adapters
//   blocks add   <block> <dest> [--adapter <name>] [--force] [--dry-run]
//                                            copy a block's source into <dest>
//   blocks diff  <block> <dest> [--adapter <name>]
//                                            show which copied files have drifted from the registry
//
// It has NO dependencies of its own (Node built-ins only), on purpose: the tool that guards your
// supply chain must not widen it. It never runs anything in your project — it only copies files
// and prints what you then install and wire yourself.

import { readFileSync, existsSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadRegistry() {
  return JSON.parse(readFileSync(join(ROOT, 'registry.json'), 'utf8'));
}
function loadBlock(name) {
  const entry = loadRegistry().blocks.find((b) => b.name === name);
  if (!entry) die(`unknown block: ${name}\nrun "blocks list" to see what's available`);
  const manifest = JSON.parse(readFileSync(join(ROOT, entry.path, 'block.json'), 'utf8'));
  return { entry, manifest, dir: join(ROOT, entry.path) };
}
function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
function parseFlags(args) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--adapter') {
      const v = args[++i];
      if (!v || v.startsWith('--')) die('--adapter needs a value, e.g. --adapter next-postgres');
      flags.adapter = v;
    } else if (a === '--force') flags.force = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a.startsWith('--')) die(`unknown flag: ${a}`);
    else flags._.push(a);
  }
  return flags;
}

/** The files a block contributes: always its core `files`, plus one adapter's files if named. */
function filesFor(manifest, adapterName) {
  const files = [...manifest.files];
  if (adapterName) {
    const adapter = (manifest.adapters ?? []).find((a) => a.name === adapterName);
    if (!adapter) die(`block ${manifest.name} has no adapter "${adapterName}"`);
    files.push(...adapter.files);
  }
  // Guard against a manifest escaping its destination via `..` (defence in depth; registry is local).
  for (const f of files) {
    if (f.to.split('/').includes('..') || f.from.split('/').includes('..')) {
      die(`refusing path with ".." in manifest: ${f.from} → ${f.to}`);
    }
  }
  return files;
}

function cmdList() {
  for (const b of loadRegistry().blocks) console.log(`${b.name.padEnd(14)} ${b.description}`);
}

function cmdInfo(name) {
  const { manifest } = loadBlock(name);
  console.log(`${manifest.name} v${manifest.version}\n${manifest.description}\n`);
  console.log('peerDependencies:');
  for (const [k, v] of Object.entries(manifest.peerDependencies ?? {})) console.log(`  ${k}@${v}`);
  console.log('\nfiles (core):');
  for (const f of manifest.files) console.log(`  ${f.from}  →  <dest>/${f.to}`);
  if (manifest.adapters?.length) {
    console.log('\nadapters (opt in with --adapter <name>):');
    for (const a of manifest.adapters) {
      console.log(`  ${a.name} — ${a.desc}`);
      for (const f of a.files) console.log(`    ${f.from}  →  <dest>/${f.to}`);
    }
  }
  if (manifest.env?.length) {
    console.log('\nenvironment:');
    for (const e of manifest.env) console.log(`  ${e.name}${e.required ? ' (required)' : ''} — ${e.desc}`);
  }
}

function cmdAdd(name, dest, flags) {
  if (!dest) die('usage: blocks add <block> <dest> [--adapter <name>]');
  const { manifest, dir } = loadBlock(name);
  const files = filesFor(manifest, flags.adapter);

  // Refuse to clobber unless --force, so a copy-in never silently overwrites local edits.
  // In --dry-run we only preview (marking clashes), never abort — that's what preview is for.
  const clashes = new Set(files.map((f) => join(resolve(dest), f.to)).filter((p) => existsSync(p)));
  if (clashes.size && !flags.force && !flags.dryRun) {
    die(`these files already exist (use --force to overwrite, or --dry-run to preview):\n` +
      [...clashes].map((p) => `  ${relative(process.cwd(), p)}`).join('\n'));
  }

  for (const f of files) {
    const to = join(resolve(dest), f.to);
    const mark = flags.dryRun ? (clashes.has(to) ? '[dry-run, OVERWRITES] ' : '[dry-run] ') : '';
    console.log(`${mark}${f.from} → ${relative(process.cwd(), to)}`);
    if (flags.dryRun) continue;
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(dir, f.from), to);
  }
  if (flags.dryRun) return;

  console.log(`\n✓ copied ${name}${flags.adapter ? ` (+${flags.adapter})` : ''} into ${dest}`);
  console.log('\nnext:');
  const peers = Object.entries(manifest.peerDependencies ?? {}).map(([k, v]) => `${k}@${v}`);
  if (peers.length) console.log(`  npm i ${peers.join(' ')}`);
  if (manifest.env?.length) {
    console.log('  set the env vars this block reads:');
    for (const e of manifest.env) console.log(`    ${e.name}${e.required ? ' (required)' : ''} — ${e.desc}`);
  }
  console.log('  then wire it in — see the block README.');
}

function cmdDiff(name, dest, flags) {
  if (!dest) die('usage: blocks diff <block> <dest> [--adapter <name>]');
  const { manifest, dir } = loadBlock(name);
  let drift = 0;
  for (const f of filesFor(manifest, flags.adapter)) {
    const copied = join(resolve(dest), f.to);
    const label = relative(process.cwd(), copied);
    if (!existsSync(copied)) { console.log(`  missing   ${label}`); drift++; continue; }
    const a = readFileSync(join(dir, f.from), 'utf8');
    const b = readFileSync(copied, 'utf8');
    if (a !== b) { console.log(`  drifted   ${label}`); drift++; }
    else console.log(`  ok        ${label}`);
  }
  if (drift) { console.log(`\n${drift} file(s) differ from the registry.`); process.exit(2); }
  console.log('\n✓ in sync with the registry.');
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
switch (cmd) {
  case 'list': cmdList(); break;
  case 'info': cmdInfo(flags._[0] ?? die('usage: blocks info <block>')); break;
  case 'add': cmdAdd(flags._[0], flags._[1], flags); break;
  case 'diff': cmdDiff(flags._[0], flags._[1], flags); break;
  default:
    console.log('blocks — copy-in source registry\n');
    console.log('  blocks list');
    console.log('  blocks info <block>');
    console.log('  blocks add  <block> <dest> [--adapter <name>] [--force] [--dry-run]');
    console.log('  blocks diff <block> <dest> [--adapter <name>]');
    if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(1);
}

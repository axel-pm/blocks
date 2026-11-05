import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Enforces the block's core rule via a real TypeScript AST walk over ALL of src/ (recursively): the
// core reads no environment, uses no runtime globals or dynamic code loading, and imports only
// sibling files or its declared AI SDK peer deps. Catches process / process[...] / {env}=process,
// globalThis/global/window/self/Deno/Bun/eval/Reflect, require()/import()/Function()/new Function,
// `import x = require()`, and any non-relative or block-escaping import.

const SRC = join(__dirname, '..', 'src');

/** The inference core may import siblings (not escaping the block) or its AI SDK peer deps. */
const allowedImport = (spec: string) =>
  (spec.startsWith('./') && !spec.split('/').includes('..')) || /^(ai|@ai-sdk\/[\w-]+)$/.test(spec);
const FORBIDDEN_GLOBALS = new Set(['process', 'globalThis', 'global', 'window', 'self', 'Deno', 'Bun', 'eval', 'Reflect', 'require', 'fetch', 'XMLHttpRequest', 'WebSocket']);

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? tsFiles(p) : e.name.endsWith('.ts') ? [p] : [];
  });
}

function violations(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const walk = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!allowedImport(node.moduleSpecifier.text)) found.push(`import "${node.moduleSpecifier.text}"`);
    }
    if (ts.isImportEqualsDeclaration(node)) found.push('import = require(...)');
    if (ts.isMetaProperty(node)) found.push('import.meta'); // import.meta.env etc. is an env read
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push('dynamic import()');
      if (ts.isIdentifier(node.expression) && (node.expression.text === 'require' || node.expression.text === 'Function' || node.expression.text === 'eval')) {
        found.push(`${node.expression.text}()`);
      }
    }
    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) {
      const p = node.parent;
      const isPropertyName = ts.isPropertyAccessExpression(p) && p.name === node;
      if (!isPropertyName) found.push(`global "${node.text}"`);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return found;
}

const files = tsFiles(SRC);

describe('core portability contract (src/)', () => {
  it('has core files to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    it(`${file.slice(SRC.length + 1)} has no env, globals, dynamic loads, or escaping imports`, () => {
      const v = violations(file, readFileSync(file, 'utf8'));
      expect(v, `${file}: ${v.join(', ')}`).toEqual([]);
    });
  }
});

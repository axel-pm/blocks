import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Enforces the block's core rule: src/ is framework-free, reads no environment, and imports nothing
// outside the block. The rag core also pulls in no provider (the embedder is injected), so it must
// import only sibling files — no peer deps at all.

const SRC = join(__dirname, '..', 'src');
const coreFiles = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('core portability contract (src/)', () => {
  it('has core files to check', () => {
    expect(coreFiles.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of coreFiles) {
    const text = stripComments(readFileSync(join(SRC, file), 'utf8'));

    it(`${file} reads no environment or global state`, () => {
      expect(text, `${file} must not read process.*`).not.toMatch(/\bprocess\.\w/);
      expect(text, `${file} must not read import.meta.env`).not.toMatch(/import\.meta\.env/);
      expect(text, `${file} must not use globalThis`).not.toMatch(/\bglobalThis\b/);
    });

    it(`${file} imports only sibling files (the core pulls in no provider)`, () => {
      for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        expect(spec.startsWith('./'), `${file} imports "${spec}" — the rag core may import only ./siblings`).toBe(true);
      }
    });
  }
});

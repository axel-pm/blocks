import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Enforces the block's core rule as a test (not just a comment): src/ is framework-free, reads no
// environment, and imports nothing outside the block. If someone adds `process.env` or a project
// import to a core file, this fails — the portability contract regresses loudly, not silently.

const SRC = join(__dirname, '..', 'src');
const coreFiles = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

/** Strip block and line comments so the scan checks CODE, not prose that mentions process.env. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('core portability contract (src/)', () => {
  it('has core files to check', () => {
    expect(coreFiles.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of coreFiles) {
    const text = stripComments(readFileSync(join(SRC, file), 'utf8'));

    it(`${file} reads no environment or global state`, () => {
      expect(text, `${file} must not read process.*`).not.toMatch(/\bprocess\.\w/);
      expect(text, `${file} must not read import.meta.env`).not.toMatch(/import\.meta\.env/);
      expect(text, `${file} must not use globalThis`).not.toMatch(/\bglobalThis\b/);
    });

    it(`${file} imports only sibling files and declared peer deps`, () => {
      for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        const relativeWithinBlock = spec.startsWith('./'); // sibling in src/
        const peerDep = /^(ai|@ai-sdk\/[\w-]+)$/.test(spec); // declared peer dependencies only
        expect(
          relativeWithinBlock || peerDep,
          `${file} imports "${spec}" — core may import only ./siblings and peer deps (ai, @ai-sdk/*), never ../ or a project module`,
        ).toBe(true);
      }
    });
  }
});

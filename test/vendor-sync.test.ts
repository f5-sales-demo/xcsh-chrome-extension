/**
 * Drift guard for the vendored `@f5-sales-demo/xcsh-chat-ui` copy under
 * `src/vendor/chat-ui`. This is the consumer-side `verifySelf` check: it needs
 * NO access to the xcsh source (or any cross-repo credential) — it re-hashes the
 * committed files against the `VENDOR-MANIFEST.json` the vendor step wrote, so a
 * hand-edit, a partial copy, or a stray file fails CI. Upstream drift (the shared
 * source advancing past this copy) is caught separately by `sync-vendor.ts
 * --verify-sync` on the workstation / in xcsh CI, where the source exists.
 */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const VENDOR_DIR = join(import.meta.dir, '..', 'src', 'vendor', 'chat-ui');
const MANIFEST_NAME = 'VENDOR-MANIFEST.json';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function listVendoredSource(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(full);
    }
  };
  walk(dir);
  return out.map((f) => relative(dir, f).split(sep).join('/')).sort();
}

const manifest = JSON.parse(readFileSync(join(VENDOR_DIR, MANIFEST_NAME), 'utf8')) as {
  generatedFrom: string;
  files: Record<string, string>;
};

describe('vendored chat-ui drift guard (verifySelf)', () => {
  it('is generated from the shared package', () => {
    expect(manifest.generatedFrom).toBe('@f5-sales-demo/xcsh-chat-ui');
  });

  it('every vendored file matches its recorded sha256 (no hand-edits / partial copy)', () => {
    const problems = Object.entries(manifest.files).filter(([rel, expected]) => {
      return sha256(readFileSync(join(VENDOR_DIR, rel))) !== expected;
    });
    expect(problems.map(([rel]) => rel)).toEqual([]);
  });

  it('has no stray vendored source file the manifest does not cover', () => {
    const stray = listVendoredSource(VENDOR_DIR).filter((rel) => !(rel in manifest.files));
    expect(stray).toEqual([]);
  });
});

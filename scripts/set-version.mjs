#!/usr/bin/env node
/**
 * Set the extension version in manifest.json + package.json.
 * Called by semantic-release's prepare step with the next version.
 *
 * Usage: node scripts/set-version.mjs 1.2.3
 */
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`set-version: invalid version "${version}" (expected x.y.z)`);
  process.exit(1);
}

for (const file of ['manifest.json', 'package.json']) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = version;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`set-version: ${file} → ${version}`);
}

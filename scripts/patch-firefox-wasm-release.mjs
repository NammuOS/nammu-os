import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const bundleUrl = new URL('../public/firefox-wasm/assets/index-D39giZCc.js', import.meta.url);
const upstreamDiscovery = 'https://sensible-ship-8305.puter.work/';
const localDiscovery = '/api/firefox/wisp-endpoint';
const source = await readFile(bundleUrl, 'utf8');

if (source.includes(localDiscovery) && !source.includes(upstreamDiscovery)) {
  console.info('Firefox-WASM release bundle is already patched.');
  process.exit(0);
}

const occurrences = source.split(upstreamDiscovery).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected one NammuOS Wisp discovery URL, found ${occurrences}.`);
}

await writeFile(bundleUrl, source.replace(upstreamDiscovery, localDiscovery), 'utf8');
console.info(`Patched ${fileURLToPath(bundleUrl)} to use NammuOS Wisp discovery.`);

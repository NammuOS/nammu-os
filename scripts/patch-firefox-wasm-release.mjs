import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const bundleUrl = new URL('../public/firefox-wasm/assets/index-D39giZCc.js', import.meta.url);
const upstreamDiscovery = 'https://sensible-ship-8305.puter.work/';
const localDiscovery = '/api/firefox/wisp-endpoint';
const initialTabNeedle = 'const n=[{title:"Nammu",url:"https://google.com/"';
const initialTabReplacement =
  'const n=[{title:"Nammu",url:new URLSearchParams(location.search).get("url")||"https://google.com/"';
const readyNeedle =
  'ue.then(()=>{console.log("[chrome-demo] chrome assets ready"),R("ready"),h.disabled=!he}).catch(pe);';
const readyReplacement =
  'ue.then(()=>{console.log("[chrome-demo] chrome assets ready"),R("ready"),h.disabled=!he,new URLSearchParams(location.search).get("autostart")==="1"&&he&&FA()}).catch(pe);';

let source = await readFile(bundleUrl, 'utf8');
let changed = false;

if (source.includes(upstreamDiscovery)) {
  const occurrences = source.split(upstreamDiscovery).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected one NammuOS Wisp discovery URL, found ${occurrences}.`);
  }
  source = source.replace(upstreamDiscovery, localDiscovery);
  changed = true;
} else if (!source.includes(localDiscovery)) {
  throw new Error('Firefox-WASM bundle does not contain a recognized Wisp discovery URL.');
}

if (source.includes(initialTabNeedle)) {
  source = source.replace(initialTabNeedle, initialTabReplacement);
  changed = true;
} else if (!source.includes(initialTabReplacement)) {
  throw new Error('Firefox-WASM bundle does not contain the expected initial-tab definition.');
}

if (source.includes(readyNeedle)) {
  source = source.replace(readyNeedle, readyReplacement);
  changed = true;
} else if (!source.includes(readyReplacement)) {
  throw new Error('Firefox-WASM bundle does not contain the expected ready handler.');
}

if (!changed) {
  console.info('Firefox-WASM release bundle is already patched.');
  process.exit(0);
}

await writeFile(bundleUrl, source, 'utf8');
console.info(
  `Patched ${fileURLToPath(bundleUrl)} for NammuOS Wisp discovery and embedded-app startup.`,
);

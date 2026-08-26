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
const initialNavigationNeedle =
  "A.evalChrome(\"openTrustedLinkIn('https://google.com/', 'current'); 'ok'\")";
const initialNavigationReplacement =
  'A.evalChrome(`openTrustedLinkIn(${JSON.stringify(new URLSearchParams(location.search).get("url")||"https://google.com/")}, "current"); "ok"`)';
const runtimeReadyNeedle =
  'window.geckoEvalChrome=i=>A.evalChrome(i),window.parent!==window&&window.parent.postMessage({type:"NAMMU_GECKO_READY"},"*"),await A.resize';
const runtimeReadyReplacement =
  'window.geckoEvalChrome=i=>A.evalChrome(i),new URLSearchParams(location.search).get("app")==="1"&&await A.evalChrome(`(()=>{document.documentElement.setAttribute("chromehidden","menubar toolbar location directories status extrachrome");let e=document.getElementById("nammu-app-mode");e||((e=document.createElement("style")).id="nammu-app-mode",e.textContent="#titlebar,#navigator-toolbox,#TabsToolbar,#nav-bar,#PersonalToolbar,#toolbar-menubar,#sidebar-main,#sidebar-box,#sidebar-splitter,#statuspanel{display:none!important}#browser,#appcontent,#tabbrowser-tabbox,#tabbrowser-tabpanels{margin:0!important;padding:0!important;border:0!important}",document.documentElement.appendChild(e));return "app-mode"})()`),window.parent!==window&&window.parent.postMessage({type:"NAMMU_GECKO_READY"},"*"),await A.resize';

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

if (source.includes(initialNavigationNeedle)) {
  source = source.replace(initialNavigationNeedle, initialNavigationReplacement);
  changed = true;
} else if (!source.includes(initialNavigationReplacement)) {
  throw new Error('Firefox-WASM bundle does not contain the expected initial navigation.');
}

if (source.includes(runtimeReadyNeedle)) {
  source = source.replace(runtimeReadyNeedle, runtimeReadyReplacement);
  changed = true;
} else if (!source.includes(runtimeReadyReplacement)) {
  throw new Error('Firefox-WASM bundle does not contain the expected runtime-ready hook.');
}

if (!changed) {
  console.info('Firefox-WASM release bundle is already patched.');
  process.exit(0);
}

await writeFile(bundleUrl, source, 'utf8');
console.info(
  `Patched ${fileURLToPath(bundleUrl)} for NammuOS Wisp discovery and embedded-app startup.`,
);

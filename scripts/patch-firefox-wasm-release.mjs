import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const bundleUrl = new URL('../public/firefox-wasm/assets/index-D39giZCc.js', import.meta.url);
const upstreamDiscovery = 'https://sensible-ship-8305.puter.work/';
const legacyLocalDiscovery = '/api/firefox/wisp-endpoint';
const localDiscovery = '/api/browser/wisp-endpoint';
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
const legacyRuntimeReadyNeedle =
  'window.geckoEvalChrome=i=>A.evalChrome(i),window.parent!==window&&window.parent.postMessage({type:"NAMMU_GECKO_READY"},"*"),await A.resize';
const runtimeReadyNeedle =
  'window.geckoEvalChrome=i=>A.evalChrome(i),new URLSearchParams(location.search).get("app")==="1"&&await A.evalChrome(`(()=>{document.documentElement.setAttribute("chromehidden","menubar toolbar location directories status extrachrome");let e=document.getElementById("nammu-app-mode");e||((e=document.createElement("style")).id="nammu-app-mode",e.textContent="#titlebar,#navigator-toolbox,#TabsToolbar,#nav-bar,#PersonalToolbar,#toolbar-menubar,#sidebar-main,#sidebar-box,#sidebar-splitter,#statuspanel{display:none!important}#browser,#appcontent,#tabbrowser-tabbox,#tabbrowser-tabpanels{margin:0!important;padding:0!important;border:0!important}",document.documentElement.appendChild(e));return "app-mode"})()`),window.parent!==window&&window.parent.postMessage({type:"NAMMU_GECKO_READY"},"*"),await A.resize';
const runtimeReadyReplacement =
  'window.geckoEvalChrome=i=>A.evalChrome(i),new URLSearchParams(location.search).get("app")==="1"&&await A.evalChrome(`(()=>{document.documentElement.setAttribute("chromehidden","menubar toolbar location directories status extrachrome");Services.prefs.setIntPref("browser.link.open_newwindow",1);Services.prefs.setIntPref("browser.link.open_newwindow.restriction",0);let e=document.getElementById("nammu-app-mode");e||((e=document.createElement("style")).id="nammu-app-mode",e.textContent="#titlebar,#navigator-toolbox,#TabsToolbar,#nav-bar,#PersonalToolbar,#toolbar-menubar,#sidebar-main,#sidebar-box,#sidebar-splitter,#statuspanel{display:none!important}#browser,#appcontent,#tabbrowser-tabbox,#tabbrowser-tabpanels{margin:0!important;padding:0!important;border:0!important}",document.documentElement.appendChild(e));return "app-mode"})()`),window.parent!==window&&window.parent.postMessage({type:"NAMMU_GECKO_READY"},"*"),await A.resize';
const persistedWispNeedle =
  'function yA(){const r={gpu:z.checked,jit:X.checked,wisp:F?y:M.value.trim()};return localStorage.setItem(Qe,JSON.stringify(r)),r}';
const persistedWispReplacement =
  'function yA(){const r={gpu:z.checked,jit:X.checked,wisp:F?y:M.value.trim()};return localStorage.setItem(Qe,JSON.stringify(F?{gpu:r.gpu,jit:r.jit}:r)),r}';
const runtimeDisposalNeedle =
  'window.geckoLoad=i=>A.load(i),window.geckoEvalChrome=i=>A.evalChrome(i),new URLSearchParams';
const runtimeDisposalReplacement =
  'window.geckoLoad=i=>A.load(i),window.geckoEvalChrome=i=>A.evalChrome(i),window.geckoDispose=()=>{try{PThread.terminateRuntime()}catch{}},new URLSearchParams';
const runtimeEvaluationDisposalNeedle =
  'window.geckoEvalChrome=i=>A.evalChrome(i),new URLSearchParams';
const runtimeEvaluationDisposalReplacement =
  'window.geckoEvalChrome=i=>A.evalChrome(i),window.geckoDispose=()=>{try{PThread.terminateRuntime()}catch{}},new URLSearchParams';
const runtimeReadyReplacementWithDisposal = runtimeReadyReplacement.replace(
  runtimeEvaluationDisposalNeedle,
  runtimeEvaluationDisposalReplacement,
);

let source = await readFile(bundleUrl, 'utf8');
let changed = false;

if (source.includes(upstreamDiscovery)) {
  const occurrences = source.split(upstreamDiscovery).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected one NammuOS Wisp discovery URL, found ${occurrences}.`);
  }
  source = source.replace(upstreamDiscovery, localDiscovery);
  changed = true;
} else if (source.includes(legacyLocalDiscovery)) {
  source = source.replace(legacyLocalDiscovery, localDiscovery);
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
} else if (source.includes(legacyRuntimeReadyNeedle)) {
  source = source.replace(legacyRuntimeReadyNeedle, runtimeReadyReplacement);
  changed = true;
} else if (
  !source.includes(runtimeReadyReplacement) &&
  !source.includes(runtimeReadyReplacementWithDisposal)
) {
  throw new Error('Firefox-WASM bundle does not contain the expected runtime-ready hook.');
}

if (source.includes(persistedWispNeedle)) {
  source = source.replace(persistedWispNeedle, persistedWispReplacement);
  changed = true;
} else if (!source.includes(persistedWispReplacement)) {
  throw new Error('Firefox-WASM bundle does not contain the expected preference persistence hook.');
}

if (source.includes(runtimeDisposalNeedle)) {
  source = source.replace(runtimeDisposalNeedle, runtimeDisposalReplacement);
  changed = true;
} else if (!source.includes(runtimeDisposalReplacement)) {
  throw new Error('Firefox-WASM bundle does not contain the expected runtime disposal hook.');
}

if (!changed) {
  console.info('Firefox-WASM release bundle is already patched.');
  process.exit(0);
}

await writeFile(bundleUrl, source, 'utf8');
console.info(
  `Patched ${fileURLToPath(bundleUrl)} for NammuOS Wisp discovery, lifecycle, and embedded-app startup.`,
);

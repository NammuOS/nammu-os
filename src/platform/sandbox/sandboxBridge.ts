const escapeInlineScript = (source: string) => source.replaceAll('</script', '<\\/script');

export function createSandboxBridgeScript(
  appId: string,
  instanceId: string,
  nonce: string,
): string {
  return `<script>
  (function() {
    window.__NAMMU_APP_ID__ = ${JSON.stringify(appId)};
    window.__NAMMU_INSTANCE_ID__ = ${JSON.stringify(instanceId)};
    window.__NAMMU_INSTANCE_NONCE__ = ${JSON.stringify(nonce)};
    var boundPort = null;
    var bootstrapBound = false;
    var queuedSends = [];
    var messageListener = null;
    window.addEventListener('message', function(event) {
      if (event.source === window.parent && !bootstrapBound && event.data && event.data.type === 'nammu:bootstrap' && event.data.instanceId === ${JSON.stringify(instanceId)} && event.data.instanceNonce === ${JSON.stringify(nonce)} && event.ports && event.ports[0]) {
        bootstrapBound = true;
        boundPort = event.ports[0];
        boundPort.onmessage = function(portEvent) {
          if (messageListener && portEvent.data) messageListener(portEvent.data);
        };
        for (var i = 0; i < queuedSends.length; i++) boundPort.postMessage(queuedSends[i]);
        queuedSends = [];
      }
    });
    window.__NAMMU_IPC_TRANSPORT__ = {
      send: function(request) {
        if (boundPort) boundPort.postMessage(request);
        else queuedSends.push(request);
      },
      onMessage: function(callback) {
        messageListener = callback;
        return function() {
          messageListener = null;
        };
      }
    };
  })();
</script>`;
}

export async function materializeSandboxDocument(
  html: string,
  entryPath: string,
  readPackageText: (path: string) => Promise<string>,
): Promise<string> {
  const slash = entryPath.lastIndexOf('/');
  const entryDirectory = slash >= 0 ? entryPath.slice(0, slash + 1) : '';
  const scriptPattern = /<script\b([^>]*?)\bsrc=(['"])([^'"]+)\2([^>]*)><\/script>/gi;
  let output = '';
  let cursor = 0;
  for (const match of html.matchAll(scriptPattern)) {
    const index = match.index ?? 0;
    output += html.slice(cursor, index);
    const source = match[3];
    if (/^(?:https?:|data:|blob:|\/\/|\/)/i.test(source)) {
      throw new Error(`External or absolute sandbox script source is not allowed: ${source}`);
    }
    const normalized = `${entryDirectory}${source}`.replace(/^\.\//, '');
    if (normalized.split('/').includes('..'))
      throw new Error(`Sandbox script traversal is not allowed: ${source}`);
    const script = await readPackageText(normalized);
    const attributes = `${match[1]} ${match[4]}`.replace(/\s+src=(['"])[^'"]+\1/i, '').trim();
    output += `<script${attributes ? ` ${attributes}` : ''}>${escapeInlineScript(script)}</script>`;
    cursor = index + match[0].length;
  }
  output += html.slice(cursor);

  const stylePattern = /<link\b([^>]*)>/gi;
  cursor = 0;
  let styledOutput = '';
  for (const match of output.matchAll(stylePattern)) {
    const index = match.index ?? 0;
    const attributes = match[1];
    const rel = attributes.match(/\brel\s*=\s*(['"])([^'"]+)\1/i)?.[2] ?? '';
    if (!rel.toLowerCase().split(/\s+/).includes('stylesheet')) continue;
    styledOutput += output.slice(cursor, index);
    const source = attributes.match(/\bhref\s*=\s*(['"])([^'"]+)\1/i)?.[2];
    if (!source) throw new Error('Packaged sandbox stylesheet is missing a valid href.');
    if (/^(?:https?:|data:|blob:|\/\/|\/)/i.test(source)) {
      throw new Error(`External or absolute sandbox stylesheet source is not allowed: ${source}`);
    }
    const normalized = `${entryDirectory}${source}`.replace(/^\.\//, '');
    if (normalized.split('/').includes('..')) {
      throw new Error(`Sandbox stylesheet traversal is not allowed: ${source}`);
    }
    const stylesheet = await readPackageText(normalized);
    styledOutput += `<style>${stylesheet.replaceAll('</style', '<\\/style')}</style>`;
    cursor = index + match[0].length;
  }
  return styledOutput + output.slice(cursor);
}

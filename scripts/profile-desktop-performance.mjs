import WebSocket from 'ws';

const debugPort = Number.parseInt(process.env.NAMMU_PROFILE_DEBUG_PORT || '9333', 10);
const command = process.argv[2] || 'inspect';
const argument = process.argv[3] || '';
const secondArgument = process.argv[4] || '';

async function findPageTarget() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) throw new Error(`DevTools target lookup failed with HTTP ${response.status}`);
  const targets = await response.json();
  const target = targets.find((candidate) => candidate.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('No WebView2 page target is available.');
  return target;
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  let nextId = 0;
  const pending = new Map();
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (!message.id) return;
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });

  return {
    close: () => socket.close(),
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

function readValue(result) {
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Runtime evaluation failed.');
  }
  return result.result.value;
}

async function main() {
  const target = await findPageTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send('Runtime.enable');
    await cdp.send('Performance.enable');

    if (command === 'measure-drag' || command === 'measure-resize') {
      const elementSelector =
        command === 'measure-drag' ? '.window-titlebar' : '[aria-label="Resize window"]';
      const boundsResult = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const expectedTitle = ${JSON.stringify(argument)};
          const target = [...document.querySelectorAll('.os-window-chrome')]
            .find((element) => element.querySelector('.window-title')?.textContent?.trim() === expectedTitle);
          const element = target?.querySelector(${JSON.stringify(elementSelector)});
          if (!element) return null;
          const bounds = element.getBoundingClientRect();
          return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
        })()`,
      });
      const start = readValue(boundsResult);
      if (!start) throw new Error(`Could not locate ${command} target for ${argument}.`);

      const before = await cdp.send('Performance.getMetrics');
      const beforeMetrics = Object.fromEntries(
        before.metrics.map(({ name, value }) => [name, value]),
      );
      const startedAt = performance.now();
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: start.x,
        y: start.y,
        button: 'left',
        clickCount: 1,
      });
      for (let index = 1; index <= 120; index += 1) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: start.x + (index * 180) / 120,
          y: start.y + (index * 90) / 120,
          button: 'left',
        });
      }
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: start.x + 180,
        y: start.y + 90,
        button: 'left',
        clickCount: 1,
      });
      const after = await cdp.send('Performance.getMetrics');
      const afterMetrics = Object.fromEntries(
        after.metrics.map(({ name, value }) => [name, value]),
      );
      process.stdout.write(
        `${JSON.stringify({
          command,
          window: argument,
          pointerEvents: 122,
          elapsedMs: Math.round(performance.now() - startedAt),
          layoutCount: afterMetrics.LayoutCount - beforeMetrics.LayoutCount,
          recalcStyleCount: afterMetrics.RecalcStyleCount - beforeMetrics.RecalcStyleCount,
          taskDurationMs: Math.round(
            (afterMetrics.TaskDuration - beforeMetrics.TaskDuration) * 1_000,
          ),
        })}\n`,
      );
      return;
    }

    if (command === 'cpu-profile') {
      const durationMs = Math.max(1_000, Number.parseInt(argument || '5000', 10));
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      const { profile } = await cdp.send('Profiler.stop');
      const sampleCounts = new Map();
      for (const nodeId of profile.samples || []) {
        sampleCounts.set(nodeId, (sampleCounts.get(nodeId) || 0) + 1);
      }
      const hottest = profile.nodes
        .map((node) => ({
          functionName: node.callFrame.functionName || '(anonymous)',
          url: node.callFrame.url,
          line: node.callFrame.lineNumber + 1,
          samples: sampleCounts.get(node.id) || 0,
        }))
        .filter(({ samples }) => samples > 0)
        .sort((left, right) => right.samples - left.samples)
        .slice(0, 20);
      process.stdout.write(`${JSON.stringify({ durationMs, hottest }, null, 2)}\n`);
      return;
    }

    if (command === 'collect') {
      await cdp.send('HeapProfiler.collectGarbage');
      process.stdout.write('{"collected":true}\n');
      return;
    }

    if (command === 'close-window' || command === 'minimize-window') {
      const controlClass =
        command === 'close-window' ? 'window-close-control' : 'window-minimize-control';
      const result = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const expectedTitle = ${JSON.stringify(argument)};
          const target = [...document.querySelectorAll('.os-window-chrome')]
            .find((element) => element.querySelector('.window-title')?.textContent?.trim() === expectedTitle);
          const control = target?.querySelector('.${controlClass}');
          if (!control) return false;
          control.click();
          return true;
        })()`,
      });
      process.stdout.write(`${JSON.stringify({ performed: Boolean(readValue(result)) })}\n`);
      return;
    }

    if (command === 'measure-open') {
      const startedAt = performance.now();
      const clickResult = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const needle = ${JSON.stringify(argument)}.toLowerCase();
          const elements = [...document.querySelectorAll('button,[role="button"],a')];
          const element = elements.find((candidate) => {
            const label = [candidate.getAttribute('title'), candidate.getAttribute('aria-label'), candidate.textContent]
              .filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim().toLowerCase();
            return label === needle;
          });
          if (!element) return false;
          element.click();
          return true;
        })()`,
      });
      if (!readValue(clickResult))
        throw new Error(`Could not find exact launch control: ${argument}`);

      const timeoutMs = Number.parseInt(process.env.NAMMU_PROFILE_TIMEOUT_MS || '150000', 10);
      let ready = false;
      while (!ready && performance.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const readyResult = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => {
            const expected = ${JSON.stringify(secondArgument)};
            return [...document.querySelectorAll('button')].some((button) =>
              button.getAttribute('title') === expected && !button.disabled
            );
          })()`,
        });
        ready = Boolean(readValue(readyResult));
      }
      process.stdout.write(
        `${JSON.stringify({
          app: argument,
          readyControl: secondArgument,
          ready,
          elapsedMs: Math.round(performance.now() - startedAt),
        })}\n`,
      );
      if (!ready) process.exitCode = 1;
      return;
    }

    if (command === 'click') {
      const result = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const needle = ${JSON.stringify(argument)}.toLowerCase();
          const elements = [...document.querySelectorAll('button,[role="button"],a')];
          const labelled = elements.map((candidate) => ({
            candidate,
            label: [candidate.getAttribute('title'), candidate.getAttribute('aria-label'), candidate.textContent]
              .filter(Boolean).join(' ').trim().toLowerCase(),
          }));
          const match = labelled.find(({ label }) => label === needle)
            || labelled.find(({ label }) => label.includes(needle));
          const element = match?.candidate;
          if (!element) return { clicked: false };
          element.click();
          return {
            clicked: true,
            label: [element.getAttribute('title'), element.getAttribute('aria-label'), element.textContent]
              .filter(Boolean).join(' ').trim(),
          };
        })()`,
      });
      process.stdout.write(`${JSON.stringify(readValue(result), null, 2)}\n`);
      return;
    }

    if (command === 'browser-navigate') {
      const result = await cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async () => {
          const browser = [...document.querySelectorAll('.os-window-chrome')]
            .find((element) => element.querySelector('.window-title')?.textContent?.trim() === 'Browser');
          const input = browser?.querySelector('input[title="Address and search bar"]')
            || browser?.querySelector('input');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, ${JSON.stringify(argument)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 0));
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', bubbles: true, cancelable: true
          }));
          return true;
        })()`,
      });
      process.stdout.write(`${JSON.stringify({ navigated: Boolean(readValue(result)), url: argument })}\n`);
      return;
    }

    if (command === 'evaluate') {
      const result = await cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: argument,
      });
      process.stdout.write(`${JSON.stringify(readValue(result), null, 2)}\n`);
      return;
    }

    const [snapshotResult, metricsResult] = await Promise.all([
      cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const labels = [...document.querySelectorAll('button,[role="button"],a')]
            .map((element) => [element.getAttribute('title'), element.getAttribute('aria-label'), element.textContent]
              .filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim())
            .filter(Boolean);
          const navigation = performance.getEntriesByType('navigation')[0];
          return {
            title: document.title,
            url: location.href,
            readyState: document.readyState,
            bodyText: document.body?.innerText.slice(0, 1200) || '',
            interactiveMs: navigation ? Math.round(navigation.domInteractive) : null,
            loadMs: navigation ? Math.round(navigation.loadEventEnd) : null,
            resourceCount: performance.getEntriesByType('resource').length,
            iframeCount: document.querySelectorAll('iframe').length,
            geckoIframeCount: [...document.querySelectorAll('iframe')]
              .filter((frame) => frame.src.includes('/firefox-wasm/')).length,
            labels: labels.slice(0, 160),
          };
        })()`,
      }),
      cdp.send('Performance.getMetrics'),
    ]);

    const metrics = Object.fromEntries(
      metricsResult.metrics.map(({ name, value }) => [name, value]),
    );
    const selectedMetrics = Object.fromEntries(
      [
        'Timestamp',
        'Documents',
        'Frames',
        'JSEventListeners',
        'Nodes',
        'LayoutCount',
        'RecalcStyleCount',
        'ScriptDuration',
        'TaskDuration',
        'JSHeapUsedSize',
        'JSHeapTotalSize',
      ]
        .map((name) => [name, metrics[name]])
        .filter(([, value]) => value !== undefined),
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          target: { title: target.title, url: target.url },
          page: readValue(snapshotResult),
          metrics: selectedMetrics,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

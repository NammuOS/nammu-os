import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { SystemAppId } from './systemAppRegistry';
import { AppSandboxHost } from './sandbox/AppSandboxHost';

const AIApp = lazy(() => import('./RailApps').then((module) => ({ default: module.AIApp })));
const AppStoreApp = lazy(() => import('../app-store/AppStoreApp'));
const BrowserApp = lazy(() => import('../browser/BrowserApp'));
const CalculatorTool = lazy(() =>
  import('../../tools/CalculatorSuite').then((module) => ({ default: module.CalculatorTool })),
);
const CalendarApp = lazy(() =>
  import('./CalendarApp').then((module) => ({ default: module.CalendarApp })),
);
const CloudApp = lazy(() => import('../cloud/CloudApp'));
const FilesApp = lazy(() => import('../files/FilesApp'));
const MapApp = lazy(() => import('../maps/MapApp'));
const PdfApp = lazy(() => import('../pdf/PdfApp'));
const ProjectsApp = lazy(() =>
  import('./ProjectsApp').then((module) => ({ default: module.ProjectsApp })),
);
const QrGen = lazy(() =>
  import('../../tools/Utilities').then((module) => ({ default: module.QrGen })),
);
const SettingsApp = lazy(() =>
  import('./SettingsApp').then((module) => ({ default: module.SettingsApp })),
);
const TelegramApp = lazy(() => import('../telegram/TelegramApp'));
const WhatsAppApp = lazy(() => import('../whatsapp/WhatsAppApp'));
const YouTubeMusicApp = lazy(() => import('../youtube-music/YouTubeMusicApp'));

const EDITOR_FILES: Record<string, string> = {
  'runtime.ts':
    'const core = await nammu.restore({\n  session: 7,\n  strict: true,\n});\n\ncore.bind("signal");\ncore.listen();',
  'field-notes.md':
    '# Field notes\n\n- residual drift below 0.3°\n- preserve the quiet channel\n- review core runtime',
  'signal.json': '{\n  "channel": "private",\n  "quality": "lossless",\n  "status": "online"\n}',
};

const MAIL = [
  {
    id: 1,
    from: 'Mira Kade',
    subject: 'Night horizon transfer',
    body: 'The carrier is stable. I left the final render in the private channel.',
  },
  {
    id: 2,
    from: 'Atelier North',
    subject: 'Descent notes',
    body: 'Geometry survived the fog pass. Review the attached coordinates when ready.',
  },
  {
    id: 3,
    from: 'Signal Desk',
    subject: 'Polar window',
    body: 'A short visibility window opens at 04:12 local. Residual remains below tolerance.',
  },
];

function TerminalApp() {
  const [lines, setLines] = useState([
    'nammu core 4.1.0 · private shell',
    'type help for bound verbs',
    '',
  ]);
  const [value, setValue] = useState('');
  const run = () => {
    const command = value.trim().toLowerCase();
    if (command === 'clear') setLines([]);
    else {
      const output =
        command === 'help'
          ? 'whoami  date  ls  status  clear'
          : command === 'whoami'
            ? 'operator · nammu · local'
            : command === 'date'
              ? new Date().toISOString()
              : command === 'ls'
                ? 'core  tidal  signal  notes  listen'
                : command === 'status'
                  ? 'cpu 18%  mem 41%  net 2.1  core ok'
                  : command
                    ? `nammu: ${command}: not a bound verb`
                    : '';
      setLines((current) => [...current, `λ ${value}`, output]);
    }
    setValue('');
  };
  return (
    <div className="flex h-full flex-col bg-[#05080d] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#9ec3b0]">
      <div className="min-h-0 flex-1 overflow-auto">
        {lines.map((line, index) => (
          <div key={index} className={line.startsWith('λ') ? 'text-[#6ec8d4]' : ''}>
            {line || '\u00a0'}
          </div>
        ))}
      </div>
      <form
        className="flex items-center gap-2 border-t border-white/[0.04] pt-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <span className="text-[#4aa3ff]">λ</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="flex-1 bg-transparent text-[#d5e0ea] outline-none"
          autoFocus
        />
      </form>
    </div>
  );
}

function EditorApp() {
  const [file, setFile] = useState('runtime.ts');
  const [contents, setContents] = useState(EDITOR_FILES);
  return (
    <div className="flex h-full">
      <div className="w-32 shrink-0 border-r border-white/[0.05] py-2 font-mono text-[9px] text-[#6d8294]">
        {Object.keys(contents).map((name) => (
          <button
            key={name}
            onClick={() => setFile(name)}
            className={`block w-full px-2 py-1 text-left ${name === file ? 'bg-white/[0.04] text-[#d5e4f0]' : ''}`}
          >
            {name}
          </button>
        ))}
      </div>
      <textarea
        value={contents[file]}
        onChange={(event) => setContents((current) => ({ ...current, [file]: event.target.value }))}
        spellCheck={false}
        className="h-full w-full resize-none bg-transparent px-3 py-2 font-mono text-[11px] leading-relaxed text-[#c5d4e0] outline-none"
      />
    </div>
  );
}

function MailApp() {
  const [selected, setSelected] = useState(1);
  const message = MAIL.find((item) => item.id === selected) ?? MAIL[0];
  return (
    <div className="flex h-full">
      <div className="w-52 shrink-0 overflow-auto border-r border-white/[0.05]">
        {MAIL.map((item) => (
          <button
            key={item.id}
            onClick={() => setSelected(item.id)}
            className={`block w-full px-2.5 py-2 text-left ${selected === item.id ? 'bg-white/[0.05]' : 'row-hover'}`}
          >
            <div className="text-[11px] text-[#d5e0ea]">{item.from}</div>
            <div className="truncate text-[10px] text-[#8aa0b2]">{item.subject}</div>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto px-4 py-3">
        <div className="text-[13px] text-[#e8eef4]">{message.subject}</div>
        <div className="mt-1 font-mono text-[9px] text-[#6d8294]">
          {message.from} · private relay
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-[#b7c8d6]">{message.body}</p>
      </div>
    </div>
  );
}

export function SystemAppContent({
  appId,
  initialData,
}: {
  appId: SystemAppId;
  initialData?: unknown;
}) {
  let content: ReactNode = null;
  switch (appId) {
    case 'calculator':
      content = <CalculatorTool />;
      break;
    case 'qr-gen':
      content = <QrGen />;
      break;
    case 'whatsapp':
      content = <WhatsAppApp />;
      break;
    case 'telegram':
      content = <TelegramApp />;
      break;
    case 'browser':
      content = <BrowserApp />;
      break;
    case 'youtube-music':
      content = <YouTubeMusicApp />;
      break;
    case 'files':
      content = <FilesApp />;
      break;
    case 'pdf':
      content = <PdfApp initialData={initialData as import('../pdf/model').PdfAppInitialData} />;
      break;
    case 'cloud':
      content = <CloudApp />;
      break;
    case 'terminal':
      content = <TerminalApp />;
      break;
    case 'editor':
      content = <EditorApp />;
      break;
    case 'notes':
      content = <AppSandboxHost appId="os.nammu.notes" windowId="system:notes" title="Notes" />;
      break;
    case 'mail':
      content = <MailApp />;
      break;
    case 'maps':
      content = <MapApp />;
      break;
    case 'calendar':
      content = <CalendarApp />;
      break;
    case 'settings':
      content = <SettingsApp />;
      break;
    case 'projects':
      content = <ProjectsApp />;
      break;
    case 'ai':
      content = <AIApp />;
      break;
    case 'app-store':
      content = <AppStoreApp />;
      break;
  }

  return (
    <Suspense
      fallback={
        <div className="horizon-app-loading h-full min-h-0" aria-label="Opening application" />
      }
    >
      <div
        className="nammu-app-surface h-full min-h-0 w-full overflow-hidden"
        data-nammu-app={appId}
      >
        {content}
      </div>
    </Suspense>
  );
}

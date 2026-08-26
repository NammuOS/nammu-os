import { useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Copy,
  File,
  Folder,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Info,
  List,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import type { SystemAppId } from './systemAppRegistry';
import { AIApp } from './RailApps';
import { ProjectsApp } from './ProjectsApp';
import { NotesApp } from './NotesApp';
import { CalendarApp } from './CalendarApp';
import { SettingsApp } from './SettingsApp';
import { CalculatorTool } from '../../tools/CalculatorSuite';
import { QrGen } from '../../tools/Utilities';
import CloudApp from '../cloud/CloudApp';
import BrowserApp from '../browser/BrowserApp';
import WhatsAppApp from '../whatsapp/WhatsAppApp';
import MapApp from '../maps/MapApp';
import { useContextMenu } from '../context-menu/useContextMenu';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';

const FILES = [
  ['dir', 'core', '—', '12:41'],
  ['dir', 'tidal', '—', '11:08'],
  ['dir', 'signal', '—', '09:32'],
  ['file', 'runtime.ts', '4.8 KB', '12:38'],
  ['file', 'field-notes.md', '2.1 KB', '10:16'],
  ['file', 'signal.json', '918 B', '08:47'],
];

void FILES;
type ExplorerItem = {
  id: number;
  kind: 'folder' | 'file';
  name: string;
  size: string;
  modified: string;
  location: string;
  type: string;
};

const INITIAL_FILES: ExplorerItem[] = [
  {
    id: 1,
    kind: 'folder',
    name: 'core',
    size: '—',
    modified: '12:41',
    location: 'Home',
    type: 'Environment',
  },
  {
    id: 2,
    kind: 'folder',
    name: 'tidal',
    size: '—',
    modified: '11:08',
    location: 'Home',
    type: 'Environment',
  },
  {
    id: 3,
    kind: 'folder',
    name: 'signal',
    size: '—',
    modified: '09:32',
    location: 'Home',
    type: 'Environment',
  },
  {
    id: 4,
    kind: 'file',
    name: 'runtime.ts',
    size: '4.8 KB',
    modified: '12:38',
    location: 'Home',
    type: 'TypeScript',
  },
  {
    id: 5,
    kind: 'file',
    name: 'field-notes.md',
    size: '2.1 KB',
    modified: '10:16',
    location: 'Home',
    type: 'Markdown',
  },
  {
    id: 6,
    kind: 'file',
    name: 'signal.json',
    size: '918 B',
    modified: '08:47',
    location: 'Home',
    type: 'JSON',
  },
  {
    id: 7,
    kind: 'file',
    name: 'horizon.png',
    size: '2.8 MB',
    modified: 'Yesterday',
    location: 'Images',
    type: 'PNG image',
  },
  {
    id: 8,
    kind: 'file',
    name: 'field-recording.wav',
    size: '18 MB',
    modified: 'Friday',
    location: 'Audio',
    type: 'Wave audio',
  },
];

const EDITOR_FILES: Record<string, string> = {
  'runtime.ts':
    'const core = await nammu.restore({\n  session: 7,\n  strict: true,\n});\n\ncore.bind("signal");\ncore.listen();',
  'field-notes.md':
    '# Field notes\n\n- residual drift below 0.3°\n- preserve the quiet channel\n- review core runtime',
  'signal.json': '{\n  "channel": "private",\n  "quality": "lossless",\n  "status": "online"\n}',
};

const NOTES = [
  {
    id: 1,
    title: 'Runtime handoff',
    body: 'Resume runtime.ts from session 7. Keep strict mode enabled and verify the residual types.',
  },
  {
    id: 2,
    title: 'Polar pass',
    body: 'Polar pass at 04:12. Confirm KEP-12 and SENT-3B visibility before the window closes.',
  },
  {
    id: 3,
    title: 'Listening room',
    body: 'Private collection restored. Check levels after the next build completes.',
  },
];

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

function FilesApp() {
  const [items, setItems] = useState(INITIAL_FILES);
  const [location, setLocation] = useState('Home');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [selected, setSelected] = useState<number | null>(4);
  const contextMenu = useContextMenu();
  const locations = ['Home', 'Recent', 'Starred', 'Images', 'Audio'];
  const visible = useMemo(
    () =>
      items.filter((item) => {
        const inLocation =
          location === 'Recent' || location === 'Starred' || item.location === location;
        return inLocation && item.name.toLowerCase().includes(query.trim().toLowerCase());
      }),
    [items, location, query],
  );
  const active = items.find((item) => item.id === selected);
  const createFolder = () => {
    const id = Date.now();
    const target = location === 'Recent' || location === 'Starred' ? 'Home' : location;
    setItems((current) => [
      {
        id,
        kind: 'folder',
        name: `untitled-${current.filter((item) => item.kind === 'folder').length + 1}`,
        size: '—',
        modified: 'Now',
        location: target,
        type: 'Folder',
      },
      ...current,
    ]);
    setSelected(id);
  };
  const duplicateItem = (item: ExplorerItem) => {
    const dot = item.name.lastIndexOf('.');
    const name =
      dot > 0 ? `${item.name.slice(0, dot)} copy${item.name.slice(dot)}` : `${item.name} copy`;
    const copy = {
      ...item,
      id: Math.max(0, ...items.map((entry) => entry.id)) + 1,
      name,
      modified: 'Now',
    };
    setItems((current) => [copy, ...current]);
    setSelected(copy.id);
  };
  const fileMenu = (item: ExplorerItem): ContextMenuEntry[] => [
    { id: `file-${item.id}-header`, type: 'header', label: item.name },
    {
      id: `file-${item.id}-open`,
      label: item.kind === 'folder' ? 'Open folder' : 'Open',
      icon: FolderOpen,
      action: () => setSelected(item.id),
    },
    {
      id: `file-${item.id}-duplicate`,
      label: 'Duplicate',
      icon: Copy,
      shortcut: 'CTRL D',
      action: () => duplicateItem(item),
    },
    {
      id: `file-${item.id}-info`,
      label: 'Properties',
      icon: Info,
      action: () => setSelected(item.id),
    },
    { id: `file-${item.id}-sep`, type: 'separator' },
    {
      id: `file-${item.id}-delete`,
      label: 'Delete',
      icon: Trash2,
      danger: true,
      action: () => {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
        setSelected((current) => (current === item.id ? null : current));
      },
    },
  ];
  const explorerMenu: ContextMenuEntry[] = [
    { id: 'explorer-header', type: 'header', label: `${location} · Explorer` },
    {
      id: 'explorer-new-folder',
      label: 'New folder',
      icon: Plus,
      shortcut: 'CTRL SHIFT N',
      action: createFolder,
    },
    { id: 'explorer-refresh', label: 'Refresh', icon: RefreshCw, action: () => setQuery('') },
    {
      id: 'explorer-view',
      label: 'View',
      icon: Grid2X2,
      items: [
        {
          id: 'explorer-view-list',
          label: 'List',
          icon: List,
          checked: view === 'list',
          action: () => setView('list'),
        },
        {
          id: 'explorer-view-grid',
          label: 'Grid',
          icon: Grid2X2,
          checked: view === 'grid',
          action: () => setView('grid'),
        },
      ],
    },
  ];

  return (
    <div
      className="flex h-full min-h-0 bg-[#05080d] text-[11px]"
      onContextMenu={(event) =>
        contextMenu.openAtEvent(event, explorerMenu, { ariaLabel: 'Explorer menu' })
      }
    >
      <aside className="w-36 shrink-0 border-r border-white/[0.06] bg-white/[0.012] p-2">
        <div className="mb-2 px-2 font-mono text-[8px] uppercase tracking-[0.22em] text-[#476077]">
          Explorer
        </div>
        {locations.map((name) => (
          <button
            key={name}
            onClick={() => {
              setLocation(name);
              setSelected(null);
            }}
            className={`mb-0.5 flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left transition-colors ${location === name ? 'bg-[#4aa3ff]/10 text-[#cfe6ff]' : 'text-[#71889d] hover:bg-white/[0.035] hover:text-[#bcd0df]'}`}
          >
            {name === 'Home' ? (
              <HardDrive size={12} />
            ) : name === 'Starred' ? (
              <Star size={12} />
            ) : (
              <Folder size={12} />
            )}
            <span>{name}</span>
          </button>
        ))}
        <div className="mt-4 border-t border-white/[0.05] pt-3">
          <div className="mb-1 flex justify-between px-2 font-mono text-[8px] text-[#476077]">
            <span>LOCAL</span>
            <span>62%</span>
          </div>
          <div className="mx-2 h-px bg-white/[0.06]">
            <span className="block h-full w-[62%] bg-[#4aa3ff] shadow-[0_0_6px_rgba(74,163,255,.5)]" />
          </div>
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-white/[0.06] px-2">
          <button
            onClick={createFolder}
            className="flex items-center gap-1 border border-white/[0.06] px-2 py-1 text-[9px] text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0]"
          >
            <Plus size={10} /> New
          </button>
          <label className="flex cursor-pointer items-center gap-1 border border-white/[0.06] px-2 py-1 text-[9px] text-[#8fa5b8] hover:bg-white/[0.04] hover:text-[#d6e5f0]">
            <Upload size={10} /> Import
            <input
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const target = location === 'Recent' || location === 'Starred' ? 'Home' : location;
                const imported = Array.from(event.target.files ?? []).map(
                  (file, index): ExplorerItem => ({
                    id: Date.now() + index,
                    kind: 'file',
                    name: file.name,
                    size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
                    modified: 'Now',
                    location: target,
                    type: file.type || 'File',
                  }),
                );
                if (imported.length) setItems((current) => [...imported, ...current]);
              }}
            />
          </label>
          <div className="ml-1 flex min-w-0 items-center font-mono text-[9px] text-[#557087]">
            <span>Nammu</span>
            <ChevronRight size={10} />
            <span className="text-[#9ab3c7]">{location}</span>
          </div>
          <div className="ml-auto flex w-40 items-center gap-1.5 border border-white/[0.06] bg-black/20 px-2 py-1">
            <Search size={10} className="text-[#4aa3ff]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter resources"
              className="min-w-0 flex-1 bg-transparent text-[9px] text-[#c9d8e4] outline-none"
            />
          </div>
          <button
            onClick={() => setView('list')}
            className={`p-1 ${view === 'list' ? 'text-[#4aa3ff]' : 'text-[#52697c]'}`}
            title="List view"
          >
            <List size={12} />
          </button>
          <button
            onClick={() => setView('grid')}
            className={`p-1 ${view === 'grid' ? 'text-[#4aa3ff]' : 'text-[#52697c]'}`}
            title="Grid view"
          >
            <Grid2X2 size={12} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto os-scrollbar p-1.5">
            {view === 'list' && (
              <div className="grid grid-cols-[22px_1fr_90px_68px] border-b border-white/[0.05] px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#43586b]">
                <span />
                <span>Name</span>
                <span>Type</span>
                <span className="text-right">Modified</span>
              </div>
            )}
            <div
              className={
                view === 'grid'
                  ? 'grid grid-cols-[repeat(auto-fill,minmax(94px,1fr))] gap-1.5 p-1'
                  : ''
              }
            >
              {visible.map((item) => {
                const Icon = item.kind === 'folder' ? Folder : File;
                if (view === 'grid')
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelected(item.id)}
                      onContextMenu={(event) =>
                        contextMenu.openAtEvent(event, fileMenu(item), {
                          ariaLabel: `${item.name} menu`,
                        })
                      }
                      className={`flex min-h-24 flex-col items-center justify-center gap-2 border p-2 ${selected === item.id ? 'border-[#4aa3ff]/35 bg-[#4aa3ff]/8' : 'border-white/[0.04] hover:bg-white/[0.025]'}`}
                    >
                      <Icon
                        size={24}
                        strokeWidth={1.1}
                        className={item.kind === 'folder' ? 'text-[#4aa3ff]' : 'text-[#7f95a8]'}
                      />
                      <span className="max-w-full truncate text-[10px] text-[#c6d4df]">
                        {item.name}
                      </span>
                    </button>
                  );
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelected(item.id)}
                    onContextMenu={(event) =>
                      contextMenu.openAtEvent(event, fileMenu(item), {
                        ariaLabel: `${item.name} menu`,
                      })
                    }
                    className={`grid w-full grid-cols-[22px_1fr_90px_68px] items-center px-2 py-1.5 text-left ${selected === item.id ? 'bg-[#4aa3ff]/8' : 'hover:bg-white/[0.025]'}`}
                  >
                    <Icon
                      size={12}
                      className={item.kind === 'folder' ? 'text-[#4aa3ff]' : 'text-[#6f8598]'}
                    />
                    <span className="truncate text-[#c9d7e2]">{item.name}</span>
                    <span className="truncate font-mono text-[8px] text-[#536a7d]">
                      {item.type}
                    </span>
                    <span className="text-right font-mono text-[8px] text-[#465c6f]">
                      {item.modified}
                    </span>
                  </button>
                );
              })}
            </div>
            {!visible.length && (
              <div className="grid h-40 place-items-center font-mono text-[9px] text-[#43586b]">
                No resources found
              </div>
            )}
          </div>
          <aside className="hidden w-40 shrink-0 border-l border-white/[0.06] p-3 md:block">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#43586b]">
              Inspector
            </div>
            {active ? (
              <div className="mt-5">
                <div className="grid h-16 place-items-center border border-white/[0.05] bg-white/[0.015]">
                  <File size={22} strokeWidth={1} className="text-[#4aa3ff]" />
                </div>
                <div className="mt-3 break-all text-[#d1deea]">{active.name}</div>
                <div className="mt-1 font-mono text-[8px] leading-5 text-[#536a7d]">
                  {active.type}
                  <br />
                  {active.size}
                  <br />
                  Modified {active.modified}
                </div>
              </div>
            ) : (
              <div className="mt-5 font-mono text-[8px] text-[#43586b]">Select a resource</div>
            )}
          </aside>
        </div>
        <div className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.05] px-2 font-mono text-[8px] text-[#465c6f]">
          <span>{visible.length} resources</span>
          <span>{location} · local</span>
        </div>
      </section>
    </div>
  );
}

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

export function SystemAppContent({ appId }: { appId: SystemAppId }) {
  switch (appId) {
    case 'calculator':
      return <CalculatorTool />;
    case 'qr-gen':
      return <QrGen />;
    case 'whatsapp':
      return <WhatsAppApp />;
    case 'browser':
      return <BrowserApp />;
    case 'files':
      return <FilesApp />;
    case 'cloud':
      return <CloudApp />;
    case 'terminal':
      return <TerminalApp />;
    case 'editor':
      return <EditorApp />;
    case 'notes':
      return <NotesApp />;
    case 'mail':
      return <MailApp />;
    case 'maps':
      return <MapApp />;
    case 'calendar':
      return <CalendarApp />;
    case 'settings':
      return <SettingsApp />;
    case 'projects':
      return <ProjectsApp />;
    case 'ai':
      return <AIApp />;
  }
}

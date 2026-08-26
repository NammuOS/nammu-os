import { useMemo, useState } from 'react';
import { Archive, MessageSquare, Play, Plus, Send, Sparkles, Trash2 } from 'lucide-react';

type Project = {
  id: number;
  name: string;
  space: string;
  description: string;
  status: 'active' | 'archived';
  color: string;
};
const INITIAL_PROJECTS: Project[] = [
  {
    id: 1,
    name: 'Core runtime',
    space: 'Deep Work',
    description: 'Strict-mode runtime and residual checks',
    status: 'active',
    color: '#4aa3ff',
  },
  {
    id: 2,
    name: 'Night horizon',
    space: 'Studio',
    description: 'Visual study and final render handoff',
    status: 'active',
    color: '#6ec8d4',
  },
  {
    id: 3,
    name: 'Polar window',
    space: 'Field',
    description: 'Satellite visibility and carrier telemetry',
    status: 'archived',
    color: '#2ee6a6',
  },
];

export function ProjectsApp() {
  const [projects, setProjects] = useState(INITIAL_PROJECTS);
  const [name, setName] = useState('');
  const [space, setSpace] = useState('Deep Work');
  const [description, setDescription] = useState('');
  const create = () => {
    if (!name.trim()) return;
    setProjects((current) => [
      {
        id: Date.now(),
        name: name.trim(),
        space,
        description: description.trim() || 'New working environment',
        status: 'active',
        color: '#4aa3ff',
      },
      ...current,
    ]);
    setName('');
    setDescription('');
  };
  return (
    <div className="grid h-full min-h-0 grid-cols-[190px_1fr] bg-[#05080d] text-[11px]">
      <aside className="border-r border-white/6 p-3 ">
        <div className="mb-3 font-mono text-[8px] uppercase tracking-[0.22em] text-[#4c6478]">
          New environment
        </div>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Project name"
          className="w-full border border-white/[0.07] bg-black/20 px-2 py-1.5 text-[#d2deea] outline-none focus:border-[#4aa3ff]/40"
        />
        <select
          value={space}
          onChange={(event) => setSpace(event.target.value)}
          className="mt-1.5 w-full border border-white/[0.07] bg-[#090d14] px-2 py-1.5 text-[#92a7b9] outline-none"
        >
          {['Deep Work', 'Studio', 'Field'].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Intent"
          className="mt-1.5 h-20 w-full resize-none border border-white/[0.07] bg-black/20 px-2 py-1.5 text-[#d2deea] outline-none focus:border-[#4aa3ff]/40"
        />
        <button
          onClick={create}
          className="mt-2 flex w-full items-center justify-center gap-1 bg-[#4aa3ff]/12 py-1.5 text-[#92c8ff] hover:bg-[#4aa3ff]/18"
        >
          <Plus size={11} /> Create
        </button>
      </aside>
      <div className="min-w-0 overflow-auto os-scrollbar p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#4c6478]">
            Persistent environments
          </span>
          <span className="font-mono text-[8px] text-[#4c6478]">
            {projects.filter((item) => item.status === 'active').length} active
          </span>
        </div>
        {projects.map((project) => (
          <div
            key={project.id}
            className="group mb-1 flex items-center gap-3 border border-white/[0.045] px-3 py-2 hover:bg-white/[0.02]"
          >
            <span
              className="h-7 w-0.5"
              style={{ background: project.color, boxShadow: `0 0 7px ${project.color}` }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[#d1deea]">
                {project.name}{' '}
                <span className="ml-1 font-mono text-[7px] uppercase text-[#547086]">
                  {project.status}
                </span>
              </div>
              <div className="truncate font-mono text-[8px] text-[#52697c]">
                {project.space} · {project.description}
              </div>
            </div>
            <button
              onClick={() =>
                setProjects((current) =>
                  current.map((item) =>
                    item.id === project.id
                      ? { ...item, status: item.status === 'active' ? 'archived' : 'active' }
                      : item,
                  ),
                )
              }
              className="p-1 text-[#60778a] hover:text-[#4aa3ff]"
              title={project.status === 'active' ? 'Archive' : 'Activate'}
            >
              {project.status === 'active' ? <Archive size={12} /> : <Play size={12} />}
            </button>
            <button
              onClick={() =>
                setProjects((current) => current.filter((item) => item.id !== project.id))
              }
              className="p-1 text-[#60778a] hover:text-[#e96f6f]"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

type ChatMessage = { id: number; role: 'you' | 'nammu'; body: string };
export function AIApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: 'nammu',
      body: 'I am grounded in the windows, projects, and files in this local workspace.',
    },
  ]);
  const [query, setQuery] = useState('');
  const send = () => {
    if (!query.trim()) return;
    const question = query.trim();
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: 'you', body: question },
      {
        id: Date.now() + 1,
        role: 'nammu',
        body: `I can help organize “${question}”. This local demo keeps actions visible and under your control.`,
      },
    ]);
    setQuery('');
  };
  const context = useMemo(
    () => `${messages.filter((message) => message.role === 'you').length} prompts · local context`,
    [messages],
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#05080d]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3">
        <Sparkles size={12} className="text-[#4aa3ff]" />
        <span className="text-[10px] text-[#9eb2c4]">Nammu context</span>
        <span className="ml-auto font-mono text-[8px] text-[#4d6579]">{context}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto os-scrollbar p-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`mb-3 max-w-[84%] border-l px-3 py-1.5 text-[11px] leading-relaxed ${message.role === 'you' ? 'ml-auto border-[#6ec8d4]/40 bg-[#6ec8d4]/5 text-[#bfd6df]' : 'border-[#4aa3ff]/45 bg-[#4aa3ff]/5 text-[#cbd9e6]'}`}
          >
            <div className="mb-1 flex items-center gap-1 font-mono text-[7px] uppercase tracking-[0.16em] text-[#547086]">
              {message.role === 'you' ? <MessageSquare size={8} /> : <Sparkles size={8} />}
              {message.role}
            </div>
            {message.body}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 gap-1.5 border-t border-white/[0.06] p-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && send()}
          placeholder="Continue your work…"
          className="min-w-0 flex-1 bg-transparent px-2 text-[11px] text-[#d1deea] outline-none"
        />
        <button
          onClick={send}
          className="grid h-7 w-8 place-items-center bg-[#4aa3ff]/10 text-[#4aa3ff] hover:bg-[#4aa3ff]/18"
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}

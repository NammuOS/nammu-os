import { useMemo, useState } from 'react';
import { MessageSquare, Send, Sparkles } from 'lucide-react';

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

import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Tag,
  Trash2,
  CheckCircle2,
  Circle,
  Search,
  CalendarDays,
  X,
  Check,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  category: 'work' | 'personal' | 'meeting' | 'deadline' | 'milestone';
  description?: string;
  completed?: boolean;
}

const CATEGORY_COLORS: Record<
  CalendarEvent['category'],
  { bg: string; text: string; border: string }
> = {
  work: { bg: 'bg-[#4aa3ff]/15', text: 'text-[#8ec4ff]', border: 'border-[#4aa3ff]/40' },
  personal: { bg: 'bg-[#2ee6a6]/15', text: 'text-[#6ee7b7]', border: 'border-[#2ee6a6]/40' },
  meeting: { bg: 'bg-[#a855f7]/15', text: 'text-[#d8b4fe]', border: 'border-[#a855f7]/40' },
  deadline: { bg: 'bg-[#f43f5e]/15', text: 'text-[#fda4af]', border: 'border-[#f43f5e]/40' },
  milestone: { bg: 'bg-[#f59e0b]/15', text: 'text-[#fcd34d]', border: 'border-[#f59e0b]/40' },
};

const INITIAL_EVENTS: CalendarEvent[] = [
  {
    id: 'evt-1',
    title: 'Aether Runtime Review',
    date: new Date().toISOString().split('T')[0],
    startTime: '10:00',
    endTime: '11:30',
    category: 'work',
    description: 'Evaluate JIT compiler telemetry and pipeline latency.',
    completed: false,
  },
  {
    id: 'evt-2',
    title: 'Core Architecture Sync',
    date: new Date().toISOString().split('T')[0],
    startTime: '14:00',
    endTime: '15:00',
    category: 'meeting',
    description: 'Nammu OS kernel stability review.',
    completed: true,
  },
  {
    id: 'evt-3',
    title: 'Orbit Stream Milestone',
    date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '10:00',
    category: 'milestone',
    description: 'Deploy satellite downlink telemetry listener.',
    completed: false,
  },
];

export function CalendarApp() {
  const [events, setEvents] = useState<CalendarEvent[]>(() => {
    try {
      const saved = localStorage.getItem('nammu-calendar-events');
      return saved ? JSON.parse(saved) : INITIAL_EVENTS;
    } catch {
      return INITIAL_EVENTS;
    }
  });

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Form state
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDate, setNewEventDate] = useState(selectedDate);
  const [newEventStartTime, setNewEventStartTime] = useState('09:00');
  const [newEventEndTime, setNewEventEndTime] = useState('10:00');
  const [newEventCategory, setNewEventCategory] = useState<CalendarEvent['category']>('work');
  const [newEventDesc, setNewEventDesc] = useState('');

  // Persist events
  useEffect(() => {
    try {
      localStorage.setItem('nammu-calendar-events', JSON.stringify(events));
    } catch {}
  }, [events]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7; // Monday start

  const prevMonthDays = new Date(year, month, 0).getDate();

  const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const handleToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today.toISOString().split('T')[0]);
  };

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventTitle.trim()) return;

    const newEvt: CalendarEvent = {
      id: `evt-${Date.now()}`,
      title: newEventTitle.trim(),
      date: newEventDate || selectedDate,
      startTime: newEventStartTime,
      endTime: newEventEndTime,
      category: newEventCategory,
      description: newEventDesc.trim(),
      completed: false,
    };

    setEvents((prev) => [newEvt, ...prev]);
    setNewEventTitle('');
    setNewEventDesc('');
    setShowAddModal(false);
  };

  const toggleEventComplete = (id: string) => {
    setEvents((prev) =>
      prev.map((ev) => (ev.id === id ? { ...ev, completed: !ev.completed } : ev)),
    );
  };

  const deleteEvent = (id: string) => {
    setEvents((prev) => prev.filter((ev) => ev.id !== id));
  };

  // Filtered list for selected date
  const dateEvents = useMemo(() => {
    return events.filter((ev) => {
      const matchDate = ev.date === selectedDate;
      const matchCat = categoryFilter === 'all' || ev.category === categoryFilter;
      const matchQuery =
        !searchQuery.trim() ||
        ev.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ev.description && ev.description.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchDate && matchCat && matchQuery;
    });
  }, [events, selectedDate, categoryFilter, searchQuery]);

  // All upcoming events
  const upcomingEvents = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return events
      .filter((ev) => ev.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  }, [events]);

  return (
    <div className="flex h-full min-h-0 bg-[#05080d] text-[11px] select-none">
      {/* Main Calendar View */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-white/[0.06] p-3">
        {/* Month Header Navigation */}
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/[0.05]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold tracking-wider text-[#d5e0ea]">
              {monthNames[month].toUpperCase()} {year}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-white/[0.03] text-[9px] font-mono text-[#5d7488]">
              {
                events.filter((e) =>
                  e.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`),
                ).length
              }{' '}
              events
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleToday}
              className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-[#9eb2c4] font-medium transition-colors"
            >
              Today
            </button>
            <button
              onClick={handlePrevMonth}
              className="p-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[#8aa0b2] transition-colors"
              title="Previous month"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              onClick={handleNextMonth}
              className="p-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[#8aa0b2] transition-colors"
              title="Next month"
            >
              <ChevronRight size={13} />
            </button>
            <button
              onClick={() => {
                setNewEventDate(selectedDate);
                setShowAddModal(true);
              }}
              className="ml-2 flex items-center gap-1 px-2.5 py-1 rounded bg-os-accent/20 border border-os-accent/40 text-os-accent hover:bg-os-accent/30 text-[10.5px] font-medium transition-colors"
            >
              <Plus size={12} /> New Event
            </button>
          </div>
        </div>

        {/* Days of Week Header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((day, idx) => (
            <div
              key={idx}
              className="text-center font-mono text-[8.5px] font-semibold text-[#476077] py-1"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1 flex-1 min-h-0">
          {/* Previous month leading days */}
          {Array.from({ length: firstDayIndex }).map((_, idx) => {
            const dayNum = prevMonthDays - firstDayIndex + idx + 1;
            return (
              <div
                key={`prev-${idx}`}
                className="p-1 rounded border border-white/[0.02] bg-black/10 opacity-30 text-[#476077] text-[10px] font-mono flex flex-col justify-between"
              >
                <span>{dayNum}</span>
              </div>
            );
          })}

          {/* Current month days */}
          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const dayNum = idx + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const isToday = dateStr === new Date().toISOString().split('T')[0];
            const isSelected = dateStr === selectedDate;
            const dayEvents = events.filter((e) => e.date === dateStr);

            return (
              <div
                key={dayNum}
                onClick={() => setSelectedDate(dateStr)}
                className={`p-1.5 rounded border transition-all cursor-pointer flex flex-col justify-between group ${
                  isSelected
                    ? 'border-[#4aa3ff] bg-[#4aa3ff]/10 shadow-[0_0_10px_rgba(74,163,255,0.15)]'
                    : isToday
                      ? 'border-[#2ee6a6]/50 bg-[#2ee6a6]/5 hover:bg-white/[0.04]'
                      : 'border-white/[0.04] bg-white/[0.015] hover:border-white/[0.1] hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span
                    className={`${isSelected ? 'text-[#8ec4ff] font-bold' : isToday ? 'text-[#2ee6a6] font-semibold' : 'text-[#8aa0b2]'}`}
                  >
                    {dayNum}
                  </span>
                  {dayEvents.length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4aa3ff] shadow-[0_0_6px_#4aa3ff]" />
                  )}
                </div>

                {/* Day events pills (up to 2 preview) */}
                <div className="space-y-0.5 mt-1 overflow-hidden">
                  {dayEvents.slice(0, 2).map((ev) => {
                    const style = CATEGORY_COLORS[ev.category];
                    return (
                      <div
                        key={ev.id}
                        className={`truncate px-1 py-0.2 rounded text-[7.5px] font-mono border ${style.bg} ${style.text} ${style.border}`}
                      >
                        {ev.title}
                      </div>
                    );
                  })}
                  {dayEvents.length > 2 && (
                    <div className="text-[7px] font-mono text-[#547086] text-right">
                      +{dayEvents.length - 2} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Drawer: Selected Date Schedule & Management */}
      <aside className="w-72 shrink-0 flex flex-col justify-between p-3 bg-[#060a12]/95">
        <div className="flex-1 overflow-y-auto os-scrollbar">
          {/* Selected Date Header */}
          <div className="pb-2.5 border-b border-white/[0.06]">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#476077]">
              Agenda
            </div>
            <div className="text-xs font-semibold text-[#d5e0ea] mt-0.5">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </div>
          </div>

          {/* Quick Category Filter */}
          <div className="flex gap-1 py-2 overflow-x-auto os-scrollbar">
            {['all', 'work', 'meeting', 'deadline', 'personal', 'milestone'].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-1.5 py-0.5 rounded text-[8.5px] font-mono capitalize transition-colors ${
                  categoryFilter === cat
                    ? 'bg-[#4aa3ff]/20 border border-[#4aa3ff]/40 text-[#8ec4ff]'
                    : 'text-[#61788c] hover:text-[#9eb2c4]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Events for selected date */}
          <div className="mt-1 space-y-1.5">
            {dateEvents.length === 0 ? (
              <div className="py-8 text-center text-[10.5px] text-[#476077]">
                No events scheduled for this day.
                <br />
                <button
                  onClick={() => {
                    setNewEventDate(selectedDate);
                    setShowAddModal(true);
                  }}
                  className="mt-2 text-[9px] text-[#4aa3ff] hover:underline"
                >
                  + Add an event
                </button>
              </div>
            ) : (
              dateEvents.map((ev) => {
                const style = CATEGORY_COLORS[ev.category];
                return (
                  <div
                    key={ev.id}
                    className={`p-2 rounded border bg-white/[0.02] transition-all group ${
                      ev.completed ? 'opacity-50 border-white/[0.03]' : style.border
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <button
                        onClick={() => toggleEventComplete(ev.id)}
                        className="mt-0.5 text-os-text-muted hover:text-os-accent transition-colors shrink-0"
                      >
                        {ev.completed ? (
                          <CheckCircle2 size={13} className="text-[#2ee6a6]" />
                        ) : (
                          <Circle size={13} />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-[11px] font-medium leading-tight ${ev.completed ? 'line-through text-[#61788c]' : 'text-[#d5e0ea]'}`}
                        >
                          {ev.title}
                        </div>
                        {(ev.startTime || ev.endTime) && (
                          <div className="flex items-center gap-1 font-mono text-[8px] text-[#547086] mt-0.5">
                            <Clock size={9} /> {ev.startTime} - {ev.endTime}
                          </div>
                        )}
                        {ev.description && (
                          <div className="text-[9.5px] text-[#8aa0b2] mt-1 leading-normal">
                            {ev.description}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => deleteEvent(ev.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-[#547086] hover:text-[#f43f5e] transition-opacity"
                        title="Delete event"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Upcoming Section */}
          <div className="mt-4 pt-3 border-t border-white/[0.05]">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#476077] mb-1.5">
              Upcoming Horizon
            </div>
            <div className="space-y-1">
              {upcomingEvents.map((ev) => (
                <div
                  key={ev.id}
                  onClick={() => setSelectedDate(ev.date)}
                  className="flex items-center justify-between p-1.5 rounded bg-white/[0.015] hover:bg-white/[0.03] cursor-pointer border border-white/[0.03]"
                >
                  <div className="truncate text-[10px] text-[#9eb2c4]">{ev.title}</div>
                  <span className="font-mono text-[8px] text-[#547086] shrink-0 ml-2">
                    {ev.date}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Add Event Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#090e18] border border-os-border/50 rounded-md p-4 w-full max-w-sm shadow-2xl animate-fade-in space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
              <span className="text-xs font-semibold text-[#d5e0ea] flex items-center gap-1.5">
                <CalendarIcon size={12} className="text-os-accent" /> Schedule New Event
              </span>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-os-text-muted hover:text-os-text"
              >
                <X size={13} />
              </button>
            </div>

            <form onSubmit={handleAddEvent} className="space-y-2.5">
              <div>
                <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">Event Title</label>
                <input
                  type="text"
                  required
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  placeholder="e.g. Production Deployment Sync"
                  className="os-input w-full text-xs"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">Date</label>
                  <input
                    type="date"
                    required
                    value={newEventDate}
                    onChange={(e) => setNewEventDate(e.target.value)}
                    className="os-input w-full font-mono text-[10px]"
                  />
                </div>
                <div>
                  <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">Start Time</label>
                  <input
                    type="time"
                    value={newEventStartTime}
                    onChange={(e) => setNewEventStartTime(e.target.value)}
                    className="os-input w-full font-mono text-[10px]"
                  />
                </div>
                <div>
                  <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">End Time</label>
                  <input
                    type="time"
                    value={newEventEndTime}
                    onChange={(e) => setNewEventEndTime(e.target.value)}
                    className="os-input w-full font-mono text-[10px]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">Category</label>
                <select
                  value={newEventCategory}
                  onChange={(e) => setNewEventCategory(e.target.value as any)}
                  className="os-input w-full text-xs bg-[#05080d]"
                >
                  <option value="work">Work (Blue)</option>
                  <option value="meeting">Meeting (Purple)</option>
                  <option value="deadline">Deadline (Red)</option>
                  <option value="personal">Personal (Green)</option>
                  <option value="milestone">Milestone (Amber)</option>
                </select>
              </div>

              <div>
                <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">
                  Description (Optional)
                </label>
                <textarea
                  value={newEventDesc}
                  onChange={(e) => setNewEventDesc(e.target.value)}
                  placeholder="Notes, links, or agenda..."
                  className="os-input w-full text-xs h-16 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.05]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1 text-[11px] rounded bg-white/[0.04] text-[#8aa0b2] hover:bg-white/[0.08]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 text-[11px] rounded bg-os-accent text-black font-semibold hover:bg-os-accent/90"
                >
                  Save Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

import { Folder, Users, Clock, Star, Trash2, LayoutDashboard, type LucideIcon } from 'lucide-react';
import type { CloudNavSection, StorageStats } from './types/cloudTypes';

interface SidebarProps {
  currentSection: CloudNavSection;
  onSelectSection: (section: CloudNavSection) => void;
  stats: StorageStats;
}

interface NavItem {
  id: CloudNavSection;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'my-drive', label: 'My Drive', icon: Folder },
  { id: 'shared-with-me', label: 'Shared', icon: Users },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

export default function CloudSidebar({ currentSection, onSelectSection, stats }: SidebarProps) {
  return (
    <aside className="w-36 shrink-0 border-r border-white/[0.06] bg-white/[0.012] p-2 flex flex-col justify-between select-none">
      <div>
        <nav className="space-y-0.5" aria-label="Cloud Sections">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = currentSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectSection(item.id)}
                className={`flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-[11px] transition-colors ${
                  isActive
                    ? 'bg-[#4aa3ff]/10 text-[#cfe6ff] font-medium'
                    : 'text-[#71889d] hover:bg-white/[0.035] hover:text-[#bcd0df]'
                }`}
              >
                <Icon size={12} className={isActive ? 'text-[#4aa3ff]' : 'text-[#61788c]'} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Cloud Storage Gauge widget matching Nammu OS Files App sidebar */}
      <div className="mt-4 border-t border-white/[0.05] pt-3">
        <div className="mb-1 flex justify-between px-2 font-mono text-[8px] text-[#476077]">
          <span>CLOUD</span>
          <span className="text-[#89a6be]">{stats.percentRounded}%</span>
        </div>
        <div className="mx-2 h-px bg-white/[0.06]">
          <span
            className="block h-full bg-[#4aa3ff] shadow-[0_0_6px_rgba(74,163,255,.6)] transition-all duration-500"
            style={{ width: `${stats.percentRounded}%` }}
          />
        </div>
        <div className="mt-1 px-2 font-mono text-[7.5px] text-[#455c6e]">
          {stats.usedFormatted} of {stats.totalFormatted}
        </div>
      </div>
    </aside>
  );
}

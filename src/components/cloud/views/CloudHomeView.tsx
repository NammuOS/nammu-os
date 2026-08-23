import { useState } from 'react';
import {
  Folder,
  HardDrive,
  Plus,
  RefreshCw,
  Sparkles,
  Cloud,
  ChevronDown,
  Trash2,
  Check,
  Zap,
  Loader2,
  ArrowUp,
  ArrowDown,
  Sliders,
} from 'lucide-react';
import type {
  AllocationConfig,
  AllocationStrategy,
  CloudAccount,
  CloudFile,
  CloudNavSection,
  CloudProvider,
  StorageStats,
} from '../types/cloudTypes';
import { formatBytes, getProviderColor, getProviderName } from '../services/cloudClient';

interface HomeViewProps {
  stats: StorageStats;
  accounts: CloudAccount[];
  allocation: AllocationConfig;
  onNavigate: (section: CloudNavSection) => void;
  onOpenFile: (file: CloudFile) => void;
  onOpenConnect: (provider?: CloudProvider) => void;
  onDisconnectAccount: (accountId: string) => Promise<void>;
  onUpdateAllocation: (config: AllocationConfig) => Promise<void>;
  onSync: () => void;
  isSyncing: boolean;
}

const ALL_PROVIDERS: { id: CloudProvider; name: string }[] = [
  { id: 'google_drive', name: 'Google Drive' },
  { id: 'onedrive', name: 'OneDrive' },
  { id: 'dropbox', name: 'Dropbox' },
  { id: 'mega', name: 'MEGA' },
  { id: 'pcloud', name: 'pCloud' },
  { id: 'yandex', name: 'Yandex Disk' },
  { id: 's3', name: 'S3-Compatible Storage' },
];

const STRATEGIES: { id: AllocationStrategy; label: string; desc: string }[] = [
  {
    id: 'round_robin',
    label: 'Round Robin',
    desc: 'Rotate upload allocations sequentially across active connected accounts.',
  },
  {
    id: 'weighted_round_robin',
    label: 'Weighted Proportional',
    desc: 'Distribute uploads weighted proportionally to each account’s total quota capacity.',
  },
  {
    id: 'least_used',
    label: 'Least Utilized Space',
    desc: 'Always route new uploads to the account with the lowest used storage footprint.',
  },
  {
    id: 'most_free',
    label: 'Highest Free Capacity',
    desc: 'Target the account possessing the greatest available free space.',
  },
  {
    id: 'manual',
    label: 'Custom Priority Hierarchy',
    desc: 'Enforce an explicit manual account fallback queue for all incoming streams.',
  },
];

export default function CloudHomeView({
  stats,
  accounts,
  allocation,
  onNavigate,
  onOpenConnect,
  onDisconnectAccount,
  onUpdateAllocation,
  onSync,
  isSyncing,
}: HomeViewProps) {
  const [activeTab, setActiveTab] = useState<'matrix' | 'policy'>('matrix');
  const [isConnectDropdownOpen, setIsConnectDropdownOpen] = useState(false);

  // Allocation policy state
  const [selectedStrategy, setSelectedStrategy] = useState<AllocationStrategy>(
    allocation.strategy || 'round_robin',
  );
  const [accountOrder, setAccountOrder] = useState<string[]>(() => {
    const existingIds = accounts.map((a) => a.id);
    const savedOrder = (allocation.manual_order || []).filter((id) => existingIds.includes(id));
    const unlisted = existingIds.filter((id) => !savedOrder.includes(id));
    return [...savedOrder, ...unlisted];
  });

  const [savingAllocation, setSavingAllocation] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const moveAccount = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= accountOrder.length) return;
    const next = [...accountOrder];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setAccountOrder(next);
  };

  const handleSaveAllocation = async () => {
    setSavingAllocation(true);
    try {
      await onUpdateAllocation({
        strategy: selectedStrategy,
        manual_order: accountOrder,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setSavingAllocation(false);
    }
  };

  // Group accounts by provider
  const accountsByProvider = ALL_PROVIDERS.map((prov) => {
    const provAccounts = accounts.filter((a) => a.provider === prov.id);
    const totalSpace = provAccounts.reduce((sum, a) => sum + (Number(a.total_space) || 0), 0);
    const usedSpace = provAccounts.reduce((sum, a) => sum + (Number(a.used_space) || 0), 0);
    return {
      provider: prov.id,
      name: prov.name,
      accounts: provAccounts,
      totalSpace,
      usedSpace,
      count: provAccounts.length,
    };
  });

  const connectedProviderGroups = accountsByProvider.filter((g) => g.count > 0);
  const unlinkedProviders = accountsByProvider.filter((g) => g.count === 0);

  const orderedAccounts = accountOrder
    .map((id) => accounts.find((a) => a.id === id))
    .filter(Boolean) as CloudAccount[];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 os-scrollbar text-[11px]">
      {/* Top Hero Banner */}
      <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(10,18,30,0.85)_0%,rgba(6,10,18,0.95)_100%)] p-5 backdrop-blur-xl shadow-xl">
        <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-[#4aa3ff]/5 blur-3xl pointer-events-none" />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_260px] items-center">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 rounded border border-[#4aa3ff]/25 bg-[#4aa3ff]/10 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#76bbf8]">
              <Sparkles size={10} /> Unified Cloud Matrix
            </div>
            <div>
              <h2 className="text-lg font-medium text-[#eef6ff]">
                Aggregated Multi-Provider Storage & Policy
              </h2>
              <p className="mt-1 text-[11px] text-[#7891a6] max-w-xl leading-relaxed">
                Seamlessly control Google Drive, MEGA, OneDrive, Dropbox, pCloud, Yandex, and S3
                with active multi-cloud streaming, provider management, and automatic upload
                allocation.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={() => onNavigate('my-drive')}
                className="flex items-center gap-1.5 rounded border border-[#4aa3ff]/40 bg-[#4aa3ff]/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[#b8dcff] hover:bg-[#4aa3ff]/25 hover:border-[#4aa3ff]/70 transition-all"
              >
                <Folder size={12} />
                <span>Open My Drive</span>
              </button>

              <button
                onClick={onSync}
                disabled={isSyncing}
                className="flex items-center gap-1.5 rounded border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[#8da6bc] hover:bg-white/[0.06] hover:text-[#dbe7f2] transition-colors"
                title="Run Cloud Sync"
              >
                <RefreshCw size={11} className={isSyncing ? 'animate-spin text-[#4aa3ff]' : ''} />
                <span>{isSyncing ? 'Syncing...' : 'Sync Cloud'}</span>
              </button>
            </div>
          </div>

          {/* Gauge Widget */}
          <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-black/40 p-4 text-center">
            <div className="relative grid h-24 w-24 place-items-center">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-white/[0.06]"
                  strokeWidth="3.2"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-[#4aa3ff] transition-all duration-700"
                  strokeDasharray={`${stats.percentRounded}, 100`}
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="font-mono text-base font-semibold text-[#e1efff]">
                  {stats.percentRounded}%
                </span>
                <span className="font-mono text-[7px] uppercase tracking-widest text-[#567288]">
                  UTILIZED
                </span>
              </div>
            </div>
            <div className="mt-2 font-mono text-[10px] text-[#cfe0ee]">
              {stats.usedFormatted} <span className="text-[#557187]">/ {stats.totalFormatted}</span>
            </div>
            <div className="mt-0.5 font-mono text-[8px] text-[#2ee6a6]">
              {stats.freeFormatted} available
            </div>
          </div>
        </div>
      </div>

      {/* Main Home Sections Navigation */}
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-white/[0.06] bg-black/40 p-0.5 font-mono text-[9px]">
            <button
              onClick={() => setActiveTab('matrix')}
              className={`flex items-center gap-1.5 rounded px-3 py-1 uppercase tracking-wider transition-colors ${
                activeTab === 'matrix'
                  ? 'bg-[#4aa3ff]/15 text-[#9ecaff] font-medium'
                  : 'text-[#647c90] hover:text-[#bcd2e4]'
              }`}
            >
              <HardDrive size={11} />
              <span>Provider Storage Matrix ({accounts.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('policy')}
              className={`flex items-center gap-1.5 rounded px-3 py-1 uppercase tracking-wider transition-colors ${
                activeTab === 'policy'
                  ? 'bg-[#4aa3ff]/15 text-[#9ecaff] font-medium'
                  : 'text-[#647c90] hover:text-[#bcd2e4]'
              }`}
            >
              <Sliders size={11} />
              <span>Allocation Policy & Rules</span>
            </button>
          </div>
        </div>

        {/* Add Provider Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsConnectDropdownOpen(!isConnectDropdownOpen)}
            className="flex items-center gap-1.5 rounded border border-[#4aa3ff]/30 bg-[#4aa3ff]/15 px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-[#a5d2ff] hover:bg-[#4aa3ff]/25 transition-all"
          >
            <Plus size={11} />
            <span>Add Provider</span>
            <ChevronDown size={10} className="opacity-70" />
          </button>

          {isConnectDropdownOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-white/[0.08] bg-[#080d15] p-1 shadow-2xl backdrop-blur-xl">
              <div className="px-2.5 py-1 font-mono text-[8px] uppercase tracking-wider text-[#556f84] border-b border-white/[0.04]">
                Select Cloud Provider
              </div>
              {ALL_PROVIDERS.map((prov) => (
                <button
                  key={prov.id}
                  onClick={() => {
                    setIsConnectDropdownOpen(false);
                    onOpenConnect(prov.id);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[10px] text-[#c9d8e5] hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: getProviderColor(prov.id) }}
                  />
                  <span>{prov.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeTab === 'matrix' ? (
        /* Provider-Wise Structured Accounts Section */
        <div className="space-y-4">
          {connectedProviderGroups.map((group) => {
            const providerColor = getProviderColor(group.provider);
            return (
              <div
                key={group.provider}
                className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-3.5 space-y-3"
              >
                {/* Provider Header Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.04] pb-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="grid h-6 w-6 place-items-center rounded-md border border-white/10"
                      style={{ backgroundColor: `${providerColor}15`, color: providerColor }}
                    >
                      <Cloud size={13} />
                    </div>
                    <div>
                      <span className="font-medium text-[12px] text-[#e0ebf5]">{group.name}</span>
                      <span className="ml-2 font-mono text-[8px] text-[#5e778c]">
                        ({group.count} account{group.count > 1 ? 's' : ''})
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="font-mono text-[9px] text-[#6d859a]">
                      <span>{formatBytes(group.usedSpace)}</span>
                      <span className="text-[#415566]"> / </span>
                      <span className="text-[#a1b7cb]">{formatBytes(group.totalSpace)}</span>
                    </div>

                    <button
                      onClick={() => onOpenConnect(group.provider)}
                      className="flex items-center gap-1 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider text-[#8da6bc] hover:bg-white/[0.05] hover:text-white"
                    >
                      <Plus size={9} /> Link Account
                    </button>
                  </div>
                </div>

                {/* Account Cards Grid */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.accounts.map((acc) => {
                    const usedPct =
                      acc.total_space > 0
                        ? Math.round((acc.used_space / acc.total_space) * 100)
                        : 0;
                    return (
                      <div
                        key={acc.id}
                        className="rounded-lg border border-white/[0.05] bg-black/30 p-2.5 transition-colors hover:border-white/[0.1] hover:bg-black/50"
                      >
                        <div className="flex items-center justify-between">
                          <div className="truncate font-mono text-[9.5px] text-[#d0e0ee]">
                            {acc.label || acc.email}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {acc.status === 'invalid_token' ? (
                              <button
                                onClick={() => onOpenConnect(acc.provider)}
                                className="shrink-0 rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 font-mono text-[7.5px] text-amber-300 hover:bg-amber-500/25"
                              >
                                RECONNECT
                              </button>
                            ) : (
                              <span className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.2 font-mono text-[7.5px] text-[#2ee6a6]">
                                ACTIVE
                              </span>
                            )}
                            <button
                              onClick={() => onDisconnectAccount(acc.id)}
                              className="grid h-4 w-4 place-items-center rounded text-[#586e80] hover:text-red-400 transition-colors"
                              title="Disconnect account"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 space-y-1">
                          <div className="flex justify-between font-mono text-[7.5px] text-[#4d667a]">
                            <span>{formatBytes(acc.used_space)}</span>
                            <span>{formatBytes(acc.total_space)}</span>
                          </div>
                          <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.05]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, usedPct)}%`,
                                backgroundColor: providerColor,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Unlinked Providers Quick Connect Row */}
          {unlinkedProviders.length > 0 && (
            <div className="rounded-xl border border-dashed border-white/[0.06] bg-white/[0.005] p-3">
              <div className="mb-2 font-mono text-[8px] uppercase tracking-[0.15em] text-[#4a6173]">
                Available Cloud Providers to Connect
              </div>
              <div className="flex flex-wrap gap-2">
                {unlinkedProviders.map((prov) => {
                  const color = getProviderColor(prov.provider);
                  return (
                    <button
                      key={prov.provider}
                      onClick={() => onOpenConnect(prov.provider)}
                      className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-1.5 text-[10px] text-[#8fa5b8] hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-white transition-all"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      <span>+ Connect {prov.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Allocation Policy & Rules Section */
        <div className="space-y-4">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] p-4">
            <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#556f84]">
              Automatic Distribution Rules
            </div>
            <p className="mt-1 text-[11px] text-[#7a93a8] leading-relaxed">
              When uploads enter the Cloud, the allocation engine dynamically routes streams to
              target accounts according to your active strategy policy.
            </p>

            {/* Strategy Options */}
            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {STRATEGIES.map((strat) => {
                const isSelected = selectedStrategy === strat.id;
                return (
                  <button
                    key={strat.id}
                    onClick={() => setSelectedStrategy(strat.id)}
                    className={`flex flex-col rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? 'border-[#4aa3ff]/50 bg-[#4aa3ff]/10 text-white'
                        : 'border-white/[0.06] bg-white/[0.01] hover:bg-white/[0.03] text-[#a1b8cc]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[11px]">{strat.label}</span>
                      {isSelected && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#4aa3ff] shadow-[0_0_6px_#4aa3ff]" />
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[8.5px] leading-relaxed text-[#5e778c]">
                      {strat.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Manual Priority Ordering Matrix */}
          {selectedStrategy === 'manual' && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] p-4">
              <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#556f84]">
                Manual Allocation Priority Stack
              </div>
              <p className="mt-0.5 text-[10px] text-[#6d869c]">
                Order accounts top-to-bottom. Uploads will fill accounts in exact succession.
              </p>

              <div className="mt-3 space-y-1.5">
                {orderedAccounts.map((acc, index) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between rounded border border-white/[0.06] bg-black/30 px-3 py-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-[9px] text-[#4aa3ff] font-semibold">
                        #{index + 1}
                      </span>
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: getProviderColor(acc.provider) }}
                      />
                      <span className="text-[11px] text-[#dce7f2]">
                        {getProviderName(acc.provider)}
                      </span>
                      <span className="font-mono text-[9px] text-[#556f84]">
                        ({acc.label || acc.email})
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        disabled={index === 0}
                        onClick={() => moveAccount(index, 'up')}
                        className="grid h-5 w-5 place-items-center rounded text-[#647c90] hover:text-white disabled:opacity-30"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        disabled={index === orderedAccounts.length - 1}
                        onClick={() => moveAccount(index, 'down')}
                        className="grid h-5 w-5 place-items-center rounded text-[#647c90] hover:text-white disabled:opacity-30"
                      >
                        <ArrowDown size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="flex items-center justify-end gap-3 pt-2">
            {savedSuccess && (
              <div className="flex items-center gap-1 font-mono text-[9px] text-[#2ee6a6]">
                <Check size={12} /> Policy Updated
              </div>
            )}
            <button
              onClick={handleSaveAllocation}
              disabled={savingAllocation}
              className="flex items-center gap-1.5 rounded border border-[#4aa3ff]/40 bg-[#4aa3ff]/15 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[#b5dcff] hover:bg-[#4aa3ff]/25 transition-all"
            >
              {savingAllocation ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Zap size={12} />
              )}
              <span>Save Allocation Policy</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

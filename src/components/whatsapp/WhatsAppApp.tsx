import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  X,
  Settings,
  Palette,
  Send,
  Volume2,
  VolumeX,
  QrCode,
  Edit2,
  RotateCw,
  Flame,
} from 'lucide-react';
import {
  WhatsAppAccountTab,
  WhatsAppTheme,
  getStoredWhatsAppTabs,
  saveStoredWhatsAppTabs,
  getStoredWhatsAppThemes,
  saveStoredWhatsAppThemes,
} from './services/whatsappStore';

const WHATSAPP_WEB_URL = 'https://web.whatsapp.com/';
const FIREFOX_RUNTIME_URL = '/firefox-wasm/index.html';

type GeckoRuntimeWindow = Window & {
  geckoEvalChrome?: (script: string) => Promise<unknown>;
};

function getSafeWhatsAppUrl(candidate?: string) {
  try {
    const url = new URL(candidate || WHATSAPP_WEB_URL);
    if (
      url.protocol === 'https:' &&
      (url.hostname === 'web.whatsapp.com' || url.hostname === 'wa.me')
    ) {
      return url.toString();
    }
  } catch {
    // Invalid stored links fall back to the official WhatsApp Web URL.
  }

  return WHATSAPP_WEB_URL;
}

function getWhatsAppRuntimeUrl(candidate?: string) {
  const params = new URLSearchParams({
    app: '1',
    autostart: '1',
    url: getSafeWhatsAppUrl(candidate),
  });
  return `${FIREFOX_RUNTIME_URL}?${params.toString()}`;
}

export default function WhatsAppApp() {
  const [tabs, setTabs] = useState<WhatsAppAccountTab[]>(getStoredWhatsAppTabs);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0]?.id || 'wa-account-1');
  const [themes] = useState<WhatsAppTheme[]>(getStoredWhatsAppThemes);
  const [activeThemeId, setActiveThemeId] = useState<string>('default-dark');

  // Modals
  const [isDirectChatOpen, setIsDirectChatOpen] = useState(false);
  const [directPhone, setDirectPhone] = useState('');
  const [directMessage, setDirectMessage] = useState('');
  const [isThemeManagerOpen, setIsThemeManagerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingTab, setEditingTab] = useState<WhatsAppAccountTab | null>(null);
  const [mountedTabIds, setMountedTabIds] = useState<string[]>([activeTabId]);
  const [readyTabIds, setReadyTabIds] = useState<string[]>([]);
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const activeTheme = themes.find((t) => t.id === activeThemeId) || themes[0];

  // Save changes
  useEffect(() => {
    saveStoredWhatsAppTabs(tabs);
  }, [tabs]);

  useEffect(() => {
    saveStoredWhatsAppThemes(themes);
  }, [themes]);

  useEffect(() => {
    const handleRuntimeReady = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'NAMMU_GECKO_READY') {
        return;
      }

      const readyTab = tabs.find(
        (tab) => iframeRefs.current[tab.id]?.contentWindow === event.source,
      );
      if (readyTab) {
        setReadyTabIds((current) =>
          current.includes(readyTab.id) ? current : [...current, readyTab.id],
        );
      }
    };

    window.addEventListener('message', handleRuntimeReady);
    return () => window.removeEventListener('message', handleRuntimeReady);
  }, [tabs]);

  // Tab management
  const handleAddAccount = () => {
    const newId = `wa-account-${Date.now()}`;
    const newTab: WhatsAppAccountTab = {
      id: newId,
      name: `Account ${tabs.length + 1}`,
      color: ['#00a884', '#25d366', '#34b7f1', '#a855f7', '#f59e0b'][tabs.length % 5],
      unreadCount: 0,
      isMuted: false,
      themeId: 'default-dark',
      url: 'https://web.whatsapp.com/',
    };
    const updated = [...tabs, newTab];
    setTabs(updated);
    setActiveTabId(newId);
    setMountedTabIds((current) => [...current, newId]);
  };

  const handleCloseTab = (tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (tabs.length === 1) return;
    const updated = tabs.filter((t) => t.id !== tabId);
    setTabs(updated);
    setMountedTabIds((current) => current.filter((id) => id !== tabId));
    setReadyTabIds((current) => current.filter((id) => id !== tabId));
    delete iframeRefs.current[tabId];
    if (activeTabId === tabId) {
      setActiveTabId(updated[0].id);
    }
  };

  const handleToggleMute = (tabId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isMuted: !t.isMuted } : t)));
  };

  const handleActivateTab = (tabId: string) => {
    setMountedTabIds((current) => (current.includes(tabId) ? current : [...current, tabId]));
    setActiveTabId(tabId);
  };

  const evaluateInActiveRuntime = async (script: string) => {
    const runtimeWindow = iframeRefs.current[activeTabId]
      ?.contentWindow as GeckoRuntimeWindow | null;
    if (!runtimeWindow?.geckoEvalChrome) return false;

    await runtimeWindow.geckoEvalChrome(script);
    return true;
  };

  const handleReload = () => {
    void evaluateInActiveRuntime("gBrowser.selectedBrowser.reload(); 'ok'");
  };

  // Direct Click-to-Chat handler (wa.me)
  const handleLaunchDirectChat = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = directPhone.replace(/[^0-9]/g, '');
    if (!cleanPhone) return;

    let waUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
    if (directMessage.trim()) {
      waUrl += `&text=${encodeURIComponent(directMessage.trim())}`;
    }

    void evaluateInActiveRuntime(
      `openTrustedLinkIn(${JSON.stringify(getSafeWhatsAppUrl(waUrl))}, 'current'); 'ok'`,
    );
    setIsDirectChatOpen(false);
    setDirectPhone('');
    setDirectMessage('');
  };

  return (
    <div
      className="flex h-full w-full min-h-0 flex-col bg-[#111b21] text-[#e9edef] select-none font-sans overflow-hidden"
      style={{ backgroundColor: activeTheme?.backgroundColor || '#111b21' }}
    >
      {/* 1. WhatsApp account shortcut bar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#0c1317] px-2 gap-1.5 overflow-x-auto os-scrollbar">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => handleActivateTab(tab.id)}
                className={`group flex h-7 items-center gap-2 rounded px-2.5 text-[11px] cursor-pointer transition-all ${
                  isActive
                    ? 'bg-[#202c33] text-white shadow-sm font-medium border border-white/[0.1]'
                    : 'bg-white/[0.03] text-[#8696a0] hover:bg-white/[0.06] hover:text-[#d1d7db]'
                }`}
              >
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: tab.color }}
                />
                <span className="truncate max-w-[120px]">{tab.name}</span>

                {tab.unreadCount > 0 && (
                  <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-[#00a884] px-1 text-[9px] font-bold text-[#111b21]">
                    {tab.unreadCount}
                  </span>
                )}

                {tab.isMuted && <VolumeX size={10} className="text-[#f15c6d] shrink-0" />}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingTab(tab);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-white transition-opacity"
                  title="Edit Account Name"
                >
                  <Edit2 size={10} />
                </button>

                {tabs.length > 1 && (
                  <button
                    onClick={(e) => handleCloseTab(tab.id, e)}
                    className="opacity-0 group-hover:opacity-100 hover:text-[#f15c6d] transition-opacity"
                    title="Close Account Tab"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}

          <button
            onClick={handleAddAccount}
            className="grid h-6 w-6 shrink-0 place-items-center rounded bg-white/[0.04] text-[#8696a0] hover:bg-white/[0.08] hover:text-white transition-colors"
            title="Add another WhatsApp shortcut"
          >
            <Plus size={12} />
          </button>
        </div>

        {/* Companion actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setIsDirectChatOpen(true)}
            className="flex items-center gap-1 rounded bg-[#00a884]/20 border border-[#00a884]/40 px-2 py-0.5 text-[10px] text-[#25d366] hover:bg-[#00a884]/30 transition-colors"
            title="Start Direct Chat without adding contact"
          >
            <Send size={10} />
            <span>Direct Message</span>
          </button>

          <button
            onClick={() => setIsThemeManagerOpen(true)}
            className="grid h-6 w-6 place-items-center rounded text-[#8696a0] hover:bg-white/[0.08] hover:text-white transition-colors"
            title="Companion shell theme"
          >
            <Palette size={12} />
          </button>

          <button
            onClick={handleReload}
            className="grid h-6 w-6 place-items-center rounded text-[#8696a0] hover:bg-white/[0.08] hover:text-white transition-colors"
            title="Reload WhatsApp"
          >
            <RotateCw size={12} />
          </button>

          <button
            onClick={() => handleToggleMute(activeTabId)}
            className="grid h-6 w-6 place-items-center rounded text-[#8696a0] hover:bg-white/[0.08] hover:text-white transition-colors"
            title={activeTab?.isMuted ? 'Unmute Notifications' : 'Mute Notifications'}
          >
            {activeTab?.isMuted ? (
              <VolumeX size={12} className="text-[#f15c6d]" />
            ) : (
              <Volume2 size={12} />
            )}
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="grid h-6 w-6 place-items-center rounded text-[#8696a0] hover:bg-white/[0.08] hover:text-white transition-colors"
            title="WhatsApp Settings"
          >
            <Settings size={12} />
          </button>
        </div>
      </div>

      {/* 2. WhatsApp in-app runtime */}
      <div className="flex min-h-0 flex-1 overflow-hidden relative">
        {tabs
          .filter((tab) => mountedTabIds.includes(tab.id))
          .map((tab) => {
            const isActive = tab.id === activeTabId;
            const isReady = readyTabIds.includes(tab.id);
            return (
              <div
                key={tab.id}
                className={`${isActive ? 'flex' : 'hidden'} absolute inset-0 bg-[#111b21]`}
              >
                {!isReady && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#111b21] text-center">
                    <div className="relative grid h-16 w-16 place-items-center rounded-2xl border border-[#25d366]/30 bg-[#00a884]/15 text-[#25d366]">
                      <QrCode size={28} strokeWidth={1.6} />
                      <Flame
                        size={15}
                        className="absolute -bottom-1 -right-1 animate-pulse rounded-full bg-[#202c33] p-0.5 text-[#ff7139]"
                      />
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-white">
                        Starting WhatsApp inside Nammu OS
                      </div>
                      <div className="mt-1 max-w-sm text-[10.5px] leading-relaxed text-[#8696a0]">
                        Preparing your in-app session. WhatsApp's QR code will appear here.
                      </div>
                    </div>
                    <div className="h-1 w-48 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full w-1/2 animate-pulse rounded-full bg-[#00a884]" />
                    </div>
                  </div>
                )}
                <iframe
                  ref={(element) => {
                    iframeRefs.current[tab.id] = element;
                  }}
                  src={getWhatsAppRuntimeUrl(WHATSAPP_WEB_URL)}
                  className="h-full w-full border-0 bg-[#111b21]"
                  title={`WhatsApp — ${tab.name}`}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-orientation-lock"
                  allow="cross-origin-isolated; camera; microphone; clipboard-read; clipboard-write; autoplay; display-capture; fullscreen"
                />
              </div>
            );
          })}
      </div>

      {/* MODAL 1: Direct Message / Click-to-Chat Dialog */}
      {isDirectChatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg border border-white/[0.12] bg-[#202c33] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2 text-[#25d366]">
                <Send size={16} />
                <h3 className="font-semibold text-[13px] text-white">Direct WhatsApp Message</h3>
              </div>
              <button
                onClick={() => setIsDirectChatOpen(false)}
                className="text-[#8696a0] hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-[11px] text-[#aebac1] leading-relaxed">
              Message any phone number directly on WhatsApp without having to save them in your
              contacts list first.
            </p>

            <form onSubmit={handleLaunchDirectChat} className="space-y-3">
              <div className="space-y-1">
                <label className="block text-[10px] uppercase font-mono text-[#8696a0]">
                  Phone Number (with Country Code)
                </label>
                <input
                  type="text"
                  placeholder="e.g. +14155552671 or 919876543210"
                  value={directPhone}
                  onChange={(e) => setDirectPhone(e.target.value)}
                  className="w-full rounded bg-[#111b21] border border-white/[0.1] px-3 py-2 text-[12px] text-white outline-none focus:border-[#00a884]"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] uppercase font-mono text-[#8696a0]">
                  Pre-filled Message (Optional)
                </label>
                <textarea
                  placeholder="Type an optional opening message..."
                  value={directMessage}
                  onChange={(e) => setDirectMessage(e.target.value)}
                  rows={3}
                  className="w-full rounded bg-[#111b21] border border-white/[0.1] px-3 py-2 text-[12px] text-white outline-none focus:border-[#00a884] resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDirectChatOpen(false)}
                  className="px-3 py-1.5 rounded text-[11px] text-[#8696a0] hover:bg-white/[0.05]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#00a884] text-[11px] font-medium text-[#111b21] hover:bg-[#06cf9c] transition-colors"
                >
                  <Send size={12} />
                  <span>Start Chat</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Companion shell theme */}
      {isThemeManagerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-lg border border-white/[0.12] bg-[#202c33] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2 text-[#00a884]">
                <Palette size={16} />
                <h3 className="font-semibold text-[13px] text-white">WhatsApp Companion Theme</h3>
              </div>
              <button
                onClick={() => setIsThemeManagerOpen(false)}
                className="text-[#8696a0] hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] uppercase font-mono text-[#8696a0]">
                Choose Shell Palette
              </label>
              <div className="grid grid-cols-2 gap-2">
                {themes.map((th) => (
                  <button
                    key={th.id}
                    onClick={() => setActiveThemeId(th.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded border text-left transition-all ${
                      activeThemeId === th.id
                        ? 'border-[#00a884] bg-[#00a884]/15'
                        : 'border-white/[0.08] bg-[#111b21] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div
                      className="h-4 w-4 rounded-full border border-white/20 shrink-0"
                      style={{ backgroundColor: th.primaryColor }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[11px] text-white truncate">{th.name}</div>
                      <div className="font-mono text-[8.5px] text-[#8696a0]">{th.primaryColor}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-white/[0.08]">
              <button
                onClick={() => setIsThemeManagerOpen(false)}
                className="px-4 py-1.5 rounded bg-[#00a884] text-[11px] font-medium text-[#111b21] hover:bg-[#06cf9c]"
              >
                Apply Theme
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Edit Account Name Modal */}
      {editingTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-lg border border-white/[0.12] bg-[#202c33] p-4 shadow-2xl space-y-3">
            <h3 className="font-semibold text-[12px] text-white">Edit Account Name</h3>
            <input
              type="text"
              value={editingTab.name}
              onChange={(e) => setEditingTab({ ...editingTab, name: e.target.value })}
              className="w-full rounded bg-[#111b21] border border-white/[0.1] px-3 py-1.5 text-[11.5px] text-white outline-none focus:border-[#00a884]"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditingTab(null)}
                className="px-3 py-1 text-[11px] text-[#8696a0]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setTabs((prev) =>
                    prev.map((t) => (t.id === editingTab.id ? { ...t, name: editingTab.name } : t)),
                  );
                  setEditingTab(null);
                }}
                className="px-3 py-1 rounded bg-[#00a884] text-[11px] font-medium text-[#111b21]"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Settings Dialog */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg border border-white/[0.12] bg-[#202c33] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2 text-white">
                <Settings size={16} />
                <h3 className="font-semibold text-[13px]">WhatsApp Companion Settings</h3>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-[#8696a0] hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3 text-[11.5px]">
              <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
                <div>
                  <div className="text-white font-medium">In-App Session</div>
                  <div className="text-[9.5px] text-[#8696a0]">
                    WhatsApp stays inside its Nammu OS window
                  </div>
                </div>
                <span className="text-[#25d366] font-mono text-[10px]">IN APP</span>
              </div>

              <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
                <div>
                  <div className="text-white font-medium">Account Switching</div>
                  <div className="text-[9.5px] text-[#8696a0]">
                    Each open shortcut keeps its own active runtime
                  </div>
                </div>
                <span className="text-[#53bdeb] font-mono text-[10px]">RUNTIME</span>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-medium">Device Permissions</div>
                  <div className="text-[9.5px] text-[#8696a0]">
                    Camera and microphone stay in the Nammu window
                  </div>
                </div>
                <span className="text-[#8696a0] font-mono text-[10px]">NAMMU</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-1.5 rounded bg-[#00a884] text-[11px] font-medium text-[#111b21]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { X, Cloud, Loader2, AlertCircle } from 'lucide-react';
import type { CloudProvider } from '../types/cloudTypes';
import { getProviderName, getProviderColor } from '../services/cloudClient';

interface ConnectModalProps {
  provider: CloudProvider | null;
  isOpen: boolean;
  onClose: () => void;
  onConnect: (provider: CloudProvider, data: any) => Promise<void>;
}

export default function CloudConnectModal({
  provider,
  isOpen,
  onClose,
  onConnect,
}: ConnectModalProps) {
  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [location, setLocation] = useState<'us' | 'eu'>('us');

  // S3 form
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [totalSpaceGB, setTotalSpaceGB] = useState('50');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen || !provider) return null;

  const isOAuth = ['google_drive', 'onedrive', 'dropbox', 'yandex'].includes(provider);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (provider === 's3') {
        const gb = Number(totalSpaceGB) || 50;
        await onConnect('s3', {
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
          bucket: bucket.trim(),
          region: region.trim() || undefined,
          endpoint: endpoint.trim(),
          label: label.trim() || undefined,
          totalSpace: gb * 1024 * 1024 * 1024,
        });
      } else if (provider === 'mega') {
        await onConnect('mega', {
          email: email.trim(),
          password,
          label: label.trim() || undefined,
        });
      } else if (provider === 'pcloud') {
        await onConnect('pcloud', {
          email: email.trim(),
          password,
          location,
          label: label.trim() || undefined,
        });
      } else {
        // OAuth initiate
        await onConnect(provider, {
          email: email.trim() || undefined,
          label: label.trim() || undefined,
        });
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to connect provider');
    } finally {
      setLoading(false);
    }
  };

  const providerName = getProviderName(provider);
  const providerColor = getProviderColor(provider);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-white/[0.08] bg-[#070b12] text-[#d5e0ea] shadow-[0_24px_70px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.015] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div
              className="grid h-7 w-7 place-items-center rounded-md border border-white/10"
              style={{ backgroundColor: `${providerColor}15`, color: providerColor }}
            >
              <Cloud size={16} />
            </div>
            <div>
              <div className="font-medium text-[13px] text-[#e8eef4]">Connect {providerName}</div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-[#556e82]">
                Storage Provider Adapter
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-[#6a8094] hover:bg-white/[0.05] hover:text-[#d5e4f0]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} className="space-y-4 p-5 text-[11px]">
          {error && (
            <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 p-2.5 text-red-300">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isOAuth ? (
            <div className="space-y-3.5 py-2">
              <p className="text-[#8ba2b5] leading-relaxed">
                Connect your <strong className="text-white">{providerName}</strong> account via
                OAuth 2.0. A popup will open to authenticate and authorize Nammu OS with read/write
                access.
              </p>
              {['onedrive', 'dropbox', 'yandex'].includes(provider) && (
                <div className="rounded border border-amber-500/20 bg-amber-500/10 p-2.5 font-mono text-[9px] text-amber-300/90 leading-relaxed">
                  Tip: Make sure{' '}
                  <strong className="text-amber-200">{provider.toUpperCase()}_CLIENT_ID</strong> and{' '}
                  <strong className="text-amber-200">{provider.toUpperCase()}_CLIENT_SECRET</strong>{' '}
                  are configured in your{' '}
                  <code className="bg-black/30 px-1 rounded text-white">.env</code> file.
                </div>
              )}
              <div className="space-y-1.5">
                <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                  Account Label (Optional)
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Primary Drive"
                  className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-2 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                />
              </div>
            </div>
          ) : provider === 's3' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                    Access Key ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    placeholder="AKIA..."
                    className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 font-mono text-[10px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                    Secret Access Key *
                  </label>
                  <input
                    type="password"
                    required
                    value={secretAccessKey}
                    onChange={(e) => setSecretAccessKey(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 font-mono text-[10px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                    Bucket Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                    placeholder="nammu-cloud-data"
                    className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 font-mono text-[10px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                    Region
                  </label>
                  <input
                    type="text"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="us-east-1"
                    className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 font-mono text-[10px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                  Endpoint URL *
                </label>
                <input
                  type="text"
                  required
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://s3.amazonaws.com or https://minio.local"
                  className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 font-mono text-[10px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                    Custom Label
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="MinIO Cluster"
                    className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                    Storage Capacity (GB)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={totalSpaceGB}
                    onChange={(e) => setTotalSpaceGB(e.target.value)}
                    className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 font-mono text-[10px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                  Account Email / Username *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={`user@${provider === 'mega' ? 'mega.nz' : 'pcloud.com'}`}
                  className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                  Password *
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••••••"
                  className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 font-mono text-[10px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                />
              </div>

              {provider === 'pcloud' && (
                <div className="space-y-1">
                  <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                    Data Center Region
                  </label>
                  <div className="flex gap-4 pt-1">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name="pcloud-region"
                        checked={location === 'us'}
                        onChange={() => setLocation('us')}
                        className="text-[#4aa3ff]"
                      />
                      <span>United States (US)</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name="pcloud-region"
                        checked={location === 'eu'}
                        onChange={() => setLocation('eu')}
                        className="text-[#4aa3ff]"
                      />
                      <span>European Union (EU)</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-mono text-[9px] uppercase tracking-wider text-[#637d92]">
                  Account Label (Optional)
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={`My ${providerName}`}
                  className="w-full rounded border border-white/[0.08] bg-black/40 px-3 py-1.5 text-[11px] text-[#e0ecf7] outline-none focus:border-[#4aa3ff]/50"
                />
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded border border-white/[0.08] px-3.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#7990a4] transition-colors hover:bg-white/[0.04] hover:text-[#d5e0ea]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 rounded border border-[#4aa3ff]/30 bg-[#4aa3ff]/15 px-4 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#a5d2ff] transition-all hover:bg-[#4aa3ff]/25 hover:border-[#4aa3ff]/60"
            >
              {loading ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Cloud size={12} />
                  {isOAuth ? 'Authorize & Link' : 'Connect Account'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

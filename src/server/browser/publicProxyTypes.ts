export type PublicProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5';
export type PublicProxyAnonymity = 'elite' | 'anonymous' | 'transparent' | 'unknown';

export interface PublicProxyEndpoint {
  id: string;
  host: string;
  port: number;
  protocol: PublicProxyProtocol;
  country: string;
  countryCode: string;
  city: string;
  anonymity: PublicProxyAnonymity;
  source: 'ProxyScrape' | 'Proxifly';
  sourceLatencyMs: number | null;
  uptimePercent: number | null;
  lastCheckedAt: string | null;
}

export interface PublicProxyHealth extends PublicProxyEndpoint {
  alive: boolean;
  latencyMs: number | null;
  checkedAt: string;
  error?: string;
}

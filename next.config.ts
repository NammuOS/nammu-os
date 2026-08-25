import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    'better-sqlite3',
    'pdf-lib',
    'megajs',
    'busboy',
    'googleapis',
    'dropbox',
    '@aws-sdk/client-s3',
    '@aws-sdk/lib-storage',
  ],
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
          // Gecko's Emscripten pthread pool uses SharedArrayBuffer. Isolation must
          // start at the top-level Nammu document; the framed demo cannot add it.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // Keep third-party images and media usable while enabling shared memory.
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(self), cross-origin-isolated=(self "https://google.com")',
          },
        ],
      },
      {
        source: '/assets/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;

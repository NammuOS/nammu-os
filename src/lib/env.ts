import { z } from 'zod';

const envSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('3000'),
  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database (Drizzle ORM / Supabase / PostgreSQL)
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/nammu_os'),
  DIRECT_DATABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Caching (Redis / Upstash)
  REDIS_URL: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  CACHE_DEFAULT_TTL_SECONDS: z.coerce.number().default(300),

  // Authentication & Security
  AUTH_SECRET: z.string().default('nammu-os-local-auth-secret-change-in-prod'),
  AUTH_COOKIE_NAME: z.string().default('nammu_os_session'),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().default(336),
  CORS_ORIGIN: z.string().default('*'),

  // Multi-Cloud OAuth Providers
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  ONEDRIVE_CLIENT_ID: z.string().optional(),
  ONEDRIVE_CLIENT_SECRET: z.string().optional(),
  ONEDRIVE_TENANT_ID: z.string().default('common'),
  ONEDRIVE_REDIRECT_URI: z.string().optional(),

  DROPBOX_CLIENT_ID: z.string().optional(),
  DROPBOX_CLIENT_SECRET: z.string().optional(),
  DROPBOX_REDIRECT_URI: z.string().optional(),

  YANDEX_CLIENT_ID: z.string().optional(),
  YANDEX_CLIENT_SECRET: z.string().optional(),
  YANDEX_REDIRECT_URI: z.string().optional(),

  // S3 Storage
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_S3_ENDPOINT: z.string().optional(),

  // pCloud
  PCLOUD_CLIENT_ID: z.string().optional(),
  PCLOUD_CLIENT_SECRET: z.string().optional(),
  PCLOUD_API_HOSTNAME: z.string().default('api.pcloud.com'),

  // Cloudflare
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_KV_NAMESPACE_ID: z.string().optional(),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.warn('⚠️ Environment variable warning:', result.error.format());
    return envSchema.parse({
      ...process.env,
      AUTH_SECRET: process.env.AUTH_SECRET || 'nammu-os-local-auth-secret-change-in-prod',
    });
  }
  return result.data;
}

export const env = parseEnv();
export type Environment = z.infer<typeof envSchema>;

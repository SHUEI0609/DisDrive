import { z } from "zod";

const envSchema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: z.string().optional(),
  UPLOAD_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(2147483648),

  DISCORD_APPLICATION_ID: z.string().optional(),
  DISCORD_PUBLIC_KEY: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),

  AUTH_SECRET: z.string().optional(),
  AUTH_URL: z.string().url().optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_LINK_EMBEDS: z.coerce.boolean().default(false),
  YOUTUBE_UPLOAD_VIDEOS: z.coerce.boolean().default(false),
  NEXT_PUBLIC_YOUTUBE_UPLOAD_VIDEOS: z.coerce.boolean().default(false),
});

export const env = envSchema.parse(process.env);

export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value as NonNullable<(typeof env)[K]>;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue?: string): string | undefined {
  return process.env[name] ?? defaultValue;
}

export const env = {
  DATABASE_URL: () => required("DATABASE_URL"),
  NEXTAUTH_URL: () => required("NEXTAUTH_URL"),
  NEXTAUTH_SECRET: () => required("NEXTAUTH_SECRET"),

  REDIS_HOST: () => optional("REDIS_HOST", "localhost"),
  REDIS_PORT: () => optional("REDIS_PORT", "6379"),

  API_ENCRYPTION_KEY: () => required("API_ENCRYPTION_KEY"),

  STORAGE_TYPE: () => optional("STORAGE_TYPE", "local"),
  LOCAL_STORAGE_PATH: () => optional("LOCAL_STORAGE_PATH", "./data"),

  NODE_ENV: () => optional("NODE_ENV", "development"),
} as const;

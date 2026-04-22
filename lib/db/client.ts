import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Db = NeonHttpDatabase<typeof schema>;

let cached: Db | null = null;

function getDb(): Db {
  if (cached) return cached;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Complete ticket 001 (Neon provisioning) and populate .env.local.",
    );
  }
  cached = drizzle({ client: neon(connectionString), schema });
  return cached;
}

// Lazy proxy: module import never touches env. First DB op triggers connection.
// Lets `pnpm dev` / static builds work before Neon is provisioned (ticket 001).
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const target = getDb() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export { schema };

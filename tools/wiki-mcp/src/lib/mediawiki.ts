const BASE_URL = "https://lordofthemysteries.fandom.com/api.php";
const DEFAULT_UA = "Arrodes-WikiMCP/0.1 (brasen@rundoo.ai)";

export type MediaWikiParams = Record<string, string | number | undefined>;

export interface MediaWikiClientOptions {
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
  rateLimit?: { capacity: number; refillPerSecond: number };
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(private capacity: number, private refillPerSecond: number) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  async take(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const msPerToken = 1000 / this.refillPerSecond;
      await new Promise((r) => setTimeout(r, msPerToken));
    }
  }
  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefill = now;
  }
}

export class MediaWikiClient {
  private fetchImpl: typeof globalThis.fetch;
  private userAgent: string;
  private bucket: TokenBucket;

  constructor(opts: MediaWikiClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.userAgent = opts.userAgent ?? DEFAULT_UA;
    const rl = opts.rateLimit ?? { capacity: 10, refillPerSecond: 10 };
    this.bucket = new TokenBucket(rl.capacity, rl.refillPerSecond);
  }

  async get<T = unknown>(params: MediaWikiParams): Promise<T> {
    await this.bucket.take();
    const url = new URL(BASE_URL);
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: { "User-Agent": this.userAgent, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`MediaWiki HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { error?: { code: string; info: string } } & T;
    if (json.error) throw new Error(`MediaWiki ${json.error.code}: ${json.error.info}`);
    return json;
  }
}

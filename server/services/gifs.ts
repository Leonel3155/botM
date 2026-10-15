// GIFs para las interacciones (/abrazar, /besar…). Sin claves: primero nekos.best y, si falla,
// waifu.pics. Las dos solo dan GIFs aptos para todo público en estas categorías. Si ninguna responde,
// la interacción sale igual, solo sin GIF.
import { safeFetchText } from './safeFetch';

const TIMEOUT_MS = 4_000;
const ALLOWED_GIF_HOSTS = /(^|\.)(nekos\.best|waifu\.pics)$/i;

export interface GifSourceOptions {
  /** Solo para pruebas: otra dirección para cada fuente. */
  nekosBaseUrl?: string;
  waifuBaseUrl?: string;
  allowPrivateHosts?: boolean;
}

function cleanGifUrl(raw: unknown, allowAnyHost: boolean): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !allowAnyHost) return null;
    if (!allowAnyHost && !ALLOWED_GIF_HOSTS.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export class GifSource {
  private readonly nekosBaseUrl: string;
  private readonly waifuBaseUrl: string;
  private readonly allowPrivateHosts: boolean;

  constructor(options: GifSourceOptions = {}) {
    this.nekosBaseUrl = (options.nekosBaseUrl ?? 'https://nekos.best/api/v2').replace(/\/+$/, '');
    this.waifuBaseUrl = (options.waifuBaseUrl ?? 'https://api.waifu.pics/sfw').replace(/\/+$/, '');
    this.allowPrivateHosts = options.allowPrivateHosts ?? false;
  }

  /** Un GIF al azar de la categoría (nombres de nekos.best y de waifu.pics), o null si no hay. */
  async random(nekosCategory: string | null, waifuCategory: string | null): Promise<string | null> {
    if (nekosCategory) {
      const gif = await this.fromNekos(nekosCategory).catch(() => null);
      if (gif) return gif;
    }
    if (waifuCategory) {
      const gif = await this.fromWaifu(waifuCategory).catch(() => null);
      if (gif) return gif;
    }
    return null;
  }

  private async getJson(url: string): Promise<unknown> {
    const page = await safeFetchText(url, { accept: 'application/json', timeoutMs: TIMEOUT_MS, maxBytes: 200_000, allowPrivateHosts: this.allowPrivateHosts });
    return JSON.parse(page.text);
  }

  private async fromNekos(category: string): Promise<string | null> {
    const body = await this.getJson(`${this.nekosBaseUrl}/${encodeURIComponent(category)}`) as { results?: Array<{ url?: unknown }> };
    return cleanGifUrl(body?.results?.[0]?.url, this.allowPrivateHosts);
  }

  private async fromWaifu(category: string): Promise<string | null> {
    const body = await this.getJson(`${this.waifuBaseUrl}/${encodeURIComponent(category)}`) as { url?: unknown };
    return cleanGifUrl(body?.url, this.allowPrivateHosts);
  }
}

export const gifSource = new GifSource();

import { lookup as dnsLookup, type LookupAddress } from 'dns';
import http, { type IncomingHttpHeaders } from 'http';
import https from 'https';
import { BlockList, isIP, type LookupFunction } from 'net';
import { pipeline, type Readable } from 'stream';
import zlib from 'zlib';

// Descargas de direcciones que escribe alguien en el panel (feeds RSS).
// Solo sitios públicos: nunca la red local, el propio PC ni el router, aunque el enlace
// redirija ahí o el nombre resuelva a una IP privada. Con tope de tamaño y de tiempo.

export class SafeFetchError extends Error {
  /** Código HTTP cuando el sitio respondió con error. */
  readonly status: number | null;
  /** Cuánto pidió esperar el sitio (cabecera Retry-After), si lo dijo. */
  readonly retryAfterMs: number | null;
  /** Cabeceras de esa respuesta de error. */
  readonly headers: IncomingHttpHeaders;

  constructor(
    message: string,
    details: { status?: number; retryAfterMs?: number | null; headers?: IncomingHttpHeaders } = {},
  ) {
    super(message);
    this.name = 'SafeFetchError';
    this.status = details.status ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.headers = details.headers ?? {};
  }
}

export interface SafeFetchOptions {
  /** Bytes máximos ya descomprimidos. */
  maxBytes?: number;
  /** Tiempo máximo para todo (redirecciones incluidas). */
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  /** Solo para pruebas locales: deja pasar direcciones privadas. */
  allowPrivateHosts?: boolean;
}

export interface SafeFetchResult {
  /** Dirección final, después de las redirecciones. */
  url: string;
  status: number;
  contentType: string;
  headers: IncomingHttpHeaders;
  text: string;
}

const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const USER_AGENT = 'BotM/1.0 (bot de Discord; lector de RSS)';

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

/** ¿Es una IP de internet (no local, privada ni reservada)? */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, 'ipv4');
  if (family !== 6) return false;
  // ::ffff:10.0.0.1 y parecidos: se revisa la IPv4 de dentro
  const mapped = address.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicAddress(mapped[1]);
  if (/^::ffff:/i.test(address)) return false;
  return !blockedAddresses.check(address, 'ipv6');
}

// Resuelve el nombre y rechaza la conexión si alguna IP no es pública.
// Va dentro de la conexión misma, así un DNS que cambia entre la revisión y la descarga no sirve de truco.
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 0);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0) {
      return callback(new SafeFetchError(`No se encontró el sitio ${hostname}.`), '', 0);
    }
    const blocked = list.find((entry) => !isPublicAddress(entry.address));
    if (blocked) {
      return callback(new SafeFetchError(`${hostname} apunta a una dirección privada o local; por seguridad no la abro.`), '', 0);
    }
    if (options.all) {
      (callback as unknown as (err: null, addresses: LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

/** Revisa que la dirección se pueda abrir (http/https, puerto normal, sin usuario ni IP privada). */
export function checkFetchableUrl(raw: string, allowPrivateHosts = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('Esa dirección no es un enlace válido.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('El enlace tiene que empezar con http:// o https://.');
  }
  if (url.username || url.password) {
    throw new SafeFetchError('El enlace no puede llevar usuario ni contraseña.');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new SafeFetchError('El enlace usa un puerto raro; solo se aceptan sitios web normales.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivateHosts) {
    if (isIP(host) && !isPublicAddress(host)) {
      throw new SafeFetchError('Ese enlace apunta a una dirección privada o local; por seguridad no la abro.');
    }
    if (/^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home\.arpa$/i.test(host) || !host.includes('.')) {
      throw new SafeFetchError('Ese enlace apunta a un equipo de la red local; por seguridad no lo abro.');
    }
  }
  return url;
}

function charsetOf(contentType: string, head: Buffer): string {
  const fromHeader = contentType.match(/charset\s*=\s*"?([\w.:-]+)/i)?.[1];
  if (fromHeader) return fromHeader;
  const prolog = head.subarray(0, 200).toString('latin1');
  const fromXml = prolog.match(/<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i)?.[1];
  if (fromXml) return fromXml;
  const fromMeta = head.subarray(0, 2048).toString('latin1').match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i)?.[1];
  return fromMeta ?? 'utf-8';
}

function decodeBody(body: Buffer, contentType: string): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetOf(contentType, body));
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(body);
}

interface RawResponse {
  status: number;
  location: string | null;
  contentType: string;
  body: Buffer | null;
  headers: IncomingHttpHeaders;
}

/** Retry-After en segundos o como fecha → milisegundos (null si no viene o no se entiende). */
function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function requestOnce(
  url: URL,
  options: Required<Omit<SafeFetchOptions, 'allowPrivateHosts'>> & { allowPrivateHosts: boolean },
  signal: AbortSignal,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, {
      method: 'GET',
      signal,
      agent: false,
      lookup: options.allowPrivateHosts ? undefined : publicOnlyLookup,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: options.accept,
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });

    request.on('error', (error) => reject(error));
    request.on('response', (response) => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers['content-type'] ?? '');
      if (status >= 300 && status < 400) {
        response.resume();
        resolve({ status, location: response.headers.location ?? null, contentType, body: null, headers: response.headers });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        resolve({ status, location: null, contentType, body: null, headers: response.headers });
        return;
      }

      const declared = Number(response.headers['content-length']);
      const encoding = String(response.headers['content-encoding'] ?? '').trim().toLowerCase();
      if (!encoding && Number.isFinite(declared) && declared > options.maxBytes) {
        response.destroy();
        reject(new SafeFetchError('La página es demasiado grande para leerla.'));
        return;
      }

      let decoder: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null = null;
      if (encoding === 'gzip' || encoding === 'x-gzip') decoder = zlib.createGunzip();
      else if (encoding === 'deflate') decoder = zlib.createInflate();
      else if (encoding === 'br') decoder = zlib.createBrotliDecompress();
      else if (encoding && encoding !== 'identity') {
        response.destroy();
        reject(new SafeFetchError(`El sitio respondió en un formato que no entiendo (${encoding}).`));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let finished = false;
      // Si el sitio corta, tarda de más o manda de más, se suelta todo (también el descompresor,
      // que si no seguiría inflando en segundo plano lo que ya recibió)
      const onAbort = () => fail(new SafeFetchError(`${url.hostname} tardó demasiado en responder.`));
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        response.destroy();
        decoder?.destroy();
        reject(error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      response.on('error', (error) => fail(error));

      // pipeline (no pipe): si la respuesta se corta a medias, el descompresor también se entera
      const stream: Readable = decoder
        ? pipeline(response, decoder, (error) => {
            if (error) fail(error);
          })
        : response;
      stream.on('data', (chunk: Buffer) => {
        if (finished) return;
        size += chunk.length;
        if (size > options.maxBytes) {
          fail(new SafeFetchError('La página es demasiado grande para leerla.'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))));
      stream.on('end', () => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        resolve({ status, location: null, contentType, body: Buffer.concat(chunks), headers: response.headers });
      });
    });
    request.end();
  });
}

/** Descarga una página pública como texto, siguiendo redirecciones con las mismas reglas. */
export async function safeFetchText(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const settings = {
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    accept: options.accept ?? '*/*',
    allowPrivateHosts: options.allowPrivateHosts ?? false,
  };
  const signal = AbortSignal.timeout(settings.timeoutMs);
  let url = checkFetchableUrl(rawUrl, settings.allowPrivateHosts);

  for (let redirects = 0; ; redirects++) {
    let result: RawResponse;
    try {
      result = await requestOnce(url, settings, signal);
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      if (signal.aborted) throw new SafeFetchError(`${url.hostname} tardó demasiado en responder.`);
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new SafeFetchError(`No se encontró el sitio ${url.hostname}.`);
      if (code === 'ECONNREFUSED') throw new SafeFetchError(`${url.hostname} no aceptó la conexión.`);
      if (code === 'ETIMEDOUT') throw new SafeFetchError(`${url.hostname} tardó demasiado en responder.`);
      if (code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE' || (typeof code === 'string' && code.startsWith('Z_'))) {
        throw new SafeFetchError(`${url.hostname} cortó la respuesta a medias.`);
      }
      if (typeof code === 'string' && /CERT|SSL|TLS/i.test(code)) {
        throw new SafeFetchError(`${url.hostname} tiene un certificado de seguridad inválido.`);
      }
      throw new SafeFetchError(`No se pudo conectar con ${url.hostname}.`);
    }

    if (result.status >= 300 && result.status < 400) {
      if (!result.location) throw new SafeFetchError(`${url.hostname} redirigió a ninguna parte.`);
      if (redirects >= settings.maxRedirects) throw new SafeFetchError('El enlace redirige demasiadas veces.');
      let next: string;
      try {
        next = new URL(result.location, url).toString();
      } catch {
        throw new SafeFetchError(`${url.hostname} redirigió a un enlace inválido.`);
      }
      url = checkFetchableUrl(next, settings.allowPrivateHosts);
      continue;
    }
    const details = { status: result.status, retryAfterMs: parseRetryAfter(result.headers['retry-after'] ?? null), headers: result.headers };
    if (result.status === 404 || result.status === 410) throw new SafeFetchError(`Esa página no existe en ${url.hostname} (error ${result.status}).`, details);
    if (result.status === 401 || result.status === 403) throw new SafeFetchError(`${url.hostname} no deja leer esa página (error ${result.status}).`, details);
    if (result.status === 429) throw new SafeFetchError(`${url.hostname} pidió que esperemos un rato (demasiadas consultas).`, details);
    if (!result.body) throw new SafeFetchError(`${url.hostname} respondió con un error (${result.status}).`, details);

    return {
      url: url.toString(),
      status: result.status,
      contentType: result.contentType,
      headers: result.headers,
      text: decodeBody(result.body, result.contentType),
    };
  }
}

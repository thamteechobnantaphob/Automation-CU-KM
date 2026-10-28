import tls from 'tls';

/**
 * A minimal IMAP (TLS) reader for the e-mail cases of SRS Rev.1 (UC-CT-001 step 8, FR-CT-002): it logs in, reads
 * the messages of INBOX received since a date, decodes them (MIME multipart, base64 / quoted-printable, encoded-word
 * headers) and lets a case wait for the message that carries its stamp. No extra dependency; read-only (BODY.PEEK).
 *
 * Configured per mailbox in .env — `<PREFIX>_IMAP_HOST`, `<PREFIX>_IMAP_PORT` (993), `<PREFIX>_USER`, `<PREFIX>_PASS`,
 * `<PREFIX>_ADDRESS` (the address mail is sent to). Prefixes: MAILBOX (the person who asks, FR-CT-002) and
 * SYSTEM_MAILBOX (the system's own inbox, UC-CT-001 step 8).
 */

export interface MailboxConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  address: string;
}

export interface Mail {
  uid: number;
  subject: string;
  from: string;
  to: string;
  date: string;
  /** Every text part decoded (HTML reduced to text). */
  text: string;
}

/** The mailbox settings for `prefix`, or null when they are not all set. */
export function mailboxFromEnv(prefix: 'MAILBOX' | 'SYSTEM_MAILBOX'): MailboxConfig | null {
  const get = (name: string): string => process.env[`${prefix}_${name}`] ?? '';
  const config = { host: get('IMAP_HOST'), port: Number(get('IMAP_PORT') || 993), user: get('USER'), pass: get('PASS'), address: get('ADDRESS') };
  return config.host && config.user && config.pass && config.address ? config : null;
}

const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const imapDate = (d: Date): string => `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;

/** One IMAP session: send tagged commands, collect each answer as raw bytes. */
class ImapSession {
  private buffer = Buffer.alloc(0);
  private waiting: { tag: string; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null = null;
  private tagNo = 0;

  private constructor(private readonly socket: tls.TLSSocket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.check();
    });
    socket.on('error', (e) => this.waiting?.reject(e));
  }

  static open(config: MailboxConfig, timeoutMs = 30_000): Promise<ImapSession> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host: config.host, port: config.port, servername: config.host, timeout: timeoutMs }, () => undefined);
      const session = new ImapSession(socket);
      socket.once('timeout', () => reject(new Error(`IMAP ${config.host}:${config.port} timed out`)));
      socket.once('error', reject);
      // The greeting is untagged: wait for the first line.
      const onGreeting = (): void => {
        if (session.buffer.includes('\r\n')) {
          socket.off('data', onGreeting);
          session.buffer = Buffer.alloc(0);
          resolve(session);
        }
      };
      socket.on('data', onGreeting);
    });
  }

  private check(): void {
    if (!this.waiting) return;
    const marker = Buffer.from(`\r\n${this.waiting.tag} `);
    const start = this.buffer.indexOf(marker) >= 0 ? this.buffer.indexOf(marker) + 2 : this.buffer.indexOf(Buffer.from(`${this.waiting.tag} `)) === 0 ? 0 : -1;
    if (start < 0) return;
    const end = this.buffer.indexOf('\r\n', start);
    if (end < 0) return;
    const answer = this.buffer.subarray(0, end + 2);
    const status = answer.subarray(start).toString('utf8');
    this.buffer = this.buffer.subarray(end + 2);
    const { resolve, reject } = this.waiting;
    this.waiting = null;
    if (/^\S+ OK/.test(status)) resolve(answer);
    else reject(new Error(`IMAP: ${status.trim()}`));
  }

  command(text: string): Promise<Buffer> {
    const tag = `a${++this.tagNo}`;
    return new Promise((resolve, reject) => {
      this.waiting = { tag, resolve, reject };
      this.socket.write(`${tag} ${text}\r\n`);
      this.check();
    });
  }

  close(): void {
    this.socket.end();
  }
}

/** Raw messages (RFC 822 bytes) of INBOX received since `since`, newest last. */
async function fetchSince(config: MailboxConfig, since: Date): Promise<{ uid: number; raw: Buffer }[]> {
  const imap = await ImapSession.open(config);
  try {
    await imap.command(`LOGIN ${quote(config.user)} ${quote(config.pass)}`);
    await imap.command('SELECT INBOX');
    const search = (await imap.command(`UID SEARCH SINCE ${imapDate(since)}`)).toString('utf8');
    const uids = (/\* SEARCH([\d ]*)/.exec(search)?.[1] ?? '').trim().split(/\s+/).filter(Boolean).map(Number).slice(-30);
    if (!uids.length) return [];
    const answer = await imap.command(`UID FETCH ${uids.join(',')} (UID BODY.PEEK[])`);
    const messages: { uid: number; raw: Buffer }[] = [];
    let at = 0;
    for (;;) {
      const open = answer.indexOf('BODY[] {', at);
      if (open < 0) break;
      const close = answer.indexOf('}', open);
      const size = Number(answer.subarray(open + 8, close).toString());
      const head = answer.subarray(Math.max(0, answer.lastIndexOf('* ', open)), open).toString();
      const bodyStart = close + 3; // "}\r\n"
      messages.push({ uid: Number(/UID (\d+)/.exec(head)?.[1] ?? 0), raw: answer.subarray(bodyStart, bodyStart + size) });
      at = bodyStart + size;
    }
    await imap.command('LOGOUT').catch(() => undefined);
    return messages;
  } finally {
    imap.close();
  }
}

function decodeBytes(bytes: Buffer, charset = 'utf-8'): string {
  try {
    return new TextDecoder(charset.toLowerCase() === 'tis-620' ? 'windows-874' : charset).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

function decodeQuotedPrintable(text: string): Buffer {
  const clean = text.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '=' && /^[0-9A-F]{2}$/i.test(clean.slice(i + 1, i + 3))) {
      bytes.push(parseInt(clean.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...Buffer.from(clean[i], 'utf8'));
  }
  return Buffer.from(bytes);
}

/** "=?UTF-8?B?...?=" / "=?UTF-8?Q?...?=" header words. */
function decodeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=\s*/gi, (_m, charset: string, enc: string, data: string) =>
    decodeBytes(enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : decodeQuotedPrintable(data.replace(/_/g, ' ')), charset),
  );
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

/** The decoded text of a MIME entity (all text parts, HTML reduced to text). */
function entityText(raw: Buffer): string {
  const split = raw.indexOf('\r\n\r\n') >= 0 ? raw.indexOf('\r\n\r\n') : raw.indexOf('\n\n');
  const headers = parseHeaders(raw.subarray(0, Math.max(0, split)).toString('latin1'));
  const body = raw.subarray(split + (raw[split] === 13 ? 4 : 2));
  const type = headers['content-type'] ?? 'text/plain';
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (/^multipart\//i.test(type) && boundary) {
    return body
      .toString('latin1')
      .split(`--${boundary}`)
      .slice(1)
      .filter((part) => !part.startsWith('--'))
      .map((part) => entityText(Buffer.from(part.replace(/^\r?\n/, ''), 'latin1')))
      .join('\n');
  }
  if (!/^text\//i.test(type)) return '';
  const charset = /charset="?([^";]+)"?/i.exec(type)?.[1] ?? 'utf-8';
  const encoding = (headers['content-transfer-encoding'] ?? '').toLowerCase();
  const bytes = encoding === 'base64' ? Buffer.from(body.toString('latin1').replace(/\s+/g, ''), 'base64') : encoding === 'quoted-printable' ? decodeQuotedPrintable(body.toString('latin1')) : body;
  const text = decodeBytes(bytes, charset);
  return /html/i.test(type) ? text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ') : text;
}

export function decodeMail(uid: number, raw: Buffer): Mail {
  const split = raw.indexOf('\r\n\r\n') >= 0 ? raw.indexOf('\r\n\r\n') : raw.indexOf('\n\n');
  const headers = parseHeaders(raw.subarray(0, Math.max(0, split)).toString('latin1'));
  const header = (name: string): string => decodeWords(decodeBytes(Buffer.from(headers[name] ?? '', 'latin1')));
  return { uid, subject: header('subject'), from: header('from'), to: header('to'), date: header('date'), text: entityText(raw) };
}

/** Waits (polling every 15 s) for a message received since `since` that `match` accepts; null after `timeoutMs`. */
export async function waitForMail(config: MailboxConfig, since: Date, match: (mail: Mail) => boolean, timeoutMs = 5 * 60_000): Promise<Mail | null> {
  const deadline = Date.now() + timeoutMs;
  // The IMAP SINCE filter is by day: go one day back to be safe across midnight / time zones.
  const day = new Date(since.getTime() - 24 * 3600_000);
  for (;;) {
    const mails = (await fetchSince(config, day)).map((m) => decodeMail(m.uid, m.raw));
    const found = mails.reverse().find(match);
    if (found) return found;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

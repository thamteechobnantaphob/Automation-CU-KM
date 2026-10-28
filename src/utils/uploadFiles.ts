import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Page } from '@playwright/test';

/**
 * Files for the upload cases, as Playwright file payloads ({ name, mimeType, buffer }) so a case can give any file
 * name (Thai, path traversal, double extension) without touching the disk. Real office documents and the mp4/wmv
 * clips come from tests/fixtures/files (made once with Microsoft Office by scripts/make-office-fixtures.ps1); images
 * are drawn on a canvas in the browser; everything else (exe, fake extensions, empty / broken / padded files, other
 * video containers) is built here byte by byte.
 */
export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const FIXTURES = path.resolve(__dirname, '../../tests/fixtures');
const FILES = path.join(FIXTURES, 'files');

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  csv: 'text/csv',
  txt: 'text/plain',
  zip: 'application/zip',
  exe: 'application/x-msdownload',
  bat: 'application/x-bat',
  js: 'text/javascript',
  php: 'application/x-php',
  phtml: 'application/x-php',
  htaccess: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
};

/** The MIME type a browser would send for this file name (by its last extension). */
export function mimeOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

export function payload(name: string, buffer: Buffer, mimeType = mimeOf(name)): FilePayload {
  return { name, mimeType, buffer };
}

/** A file of tests/fixtures/files (or tests/fixtures), optionally under another name. */
export function fixtureFile(file: string, name = path.basename(file)): FilePayload {
  const full = fs.existsSync(path.join(FILES, file)) ? path.join(FILES, file) : path.join(FIXTURES, file);
  return payload(name, fs.readFileSync(full));
}

/** A Windows executable header ("MZ…") — the content of every "fake" file. */
export function exeBytes(): Buffer {
  return Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff]), Buffer.alloc(242, 0)]);
}

export const exeFile = (name = 'test.exe'): FilePayload => payload(name, exeBytes(), mimeOf(name));
export const emptyFile = (name: string): FilePayload => payload(name, Buffer.alloc(0));
export const textFile = (name: string, text: string): FilePayload => payload(name, Buffer.from(text, 'utf8'));

/** `base` padded with spaces (PDF) or zero bytes up to exactly `bytes` — its type is still recognised from the header. */
export function paddedFile(base: FilePayload, bytes: number, name = base.name): FilePayload {
  if (bytes < base.buffer.length) throw new Error(`${name}: ${bytes} bytes is smaller than the base file`);
  const fill = base.mimeType === 'application/pdf' ? 0x20 : 0x00;
  return payload(name, Buffer.concat([base.buffer, Buffer.alloc(bytes - base.buffer.length, fill)]), base.mimeType);
}

/** The first half of a file: a "broken" copy that still starts like the real thing. */
export function truncatedFile(base: FilePayload, name = `broken-${base.name}`): FilePayload {
  return payload(name, base.buffer.subarray(0, Math.max(16, Math.floor(base.buffer.length / 2))), base.mimeType);
}

export const MB = 1024 * 1024;

/** A one-entry ZIP archive (stored, no compression). */
export function zipFile(name = 'archive.zip', entry = 'readme.txt', text = '[Auto Test] zip'): FilePayload {
  const data = Buffer.from(text, 'utf8');
  const fileName = Buffer.from(entry, 'utf8');
  const crc = zlib.crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  const localPart = Buffer.concat([local, fileName, data]);
  const centralPart = Buffer.concat([central, fileName]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  return payload(name, Buffer.concat([localPart, centralPart, end]));
}

/** Minimal containers that file-type detection recognises by their header (not playable). */
export function videoStub(kind: 'mov' | 'avi' | 'mkv' | 'flv' | '3gp', name = `clip.${kind}`): FilePayload {
  const body = Buffer.alloc(2048, 0);
  let head: Buffer;
  switch (kind) {
    case 'mov':
      head = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.from([0, 0, 0, 0]), Buffer.from('qt  ')]);
      break;
    case '3gp':
      head = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftyp3gp4'), Buffer.from([0, 0, 0, 0]), Buffer.from('3gp4')]);
      break;
    case 'avi': {
      head = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI LIST')]);
      head.writeUInt32LE(body.length + 8, 4);
      break;
    }
    case 'mkv':
      // EBML header with DocType "matroska".
      head = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x88, ...Buffer.from('matroska'), 0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02]);
      break;
    case 'flv':
      head = Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x05, 0, 0, 0, 0x09, 0, 0, 0, 0]);
      break;
  }
  return payload(name, Buffer.concat([head, body]));
}

/** 1×1 GIF. */
export const gifFile = (name = 'anim.gif'): FilePayload => payload(name, Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));

/** An SVG with a <script>, under any name (e.g. "evil.png"). */
export const svgWithScript = (name = 'evil.svg'): FilePayload =>
  payload(name, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(document.domain)</script><rect width="10" height="10"/></svg>'), mimeOf(name));

/** A tiny BMP (2×2, 24-bit). */
export function bmpFile(name = 'image.bmp'): FilePayload {
  const pixels = Buffer.alloc(16, 0x80); // 2 rows × (2 px × 3 bytes + 2 padding)
  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(2, 18);
  header.writeInt32LE(2, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  return payload(name, Buffer.concat([header, pixels]));
}

export interface ImageSpec {
  width: number;
  height: number;
  type: 'image/png' | 'image/jpeg' | 'image/webp';
  /** PNG only: a transparent background with a coloured shape. */
  transparent?: boolean;
  quality?: number;
}

/** Draws an image on a canvas in a scratch page of `page`'s context (stripes + a label, so it is not blank). */
export async function drawImage(page: Page, name: string, spec: ImageSpec): Promise<FilePayload> {
  const scratch = await page.context().newPage();
  try {
    await scratch.setContent('<html><body></body></html>');
    const dataUrl = await scratch.evaluate(({ width, height, type, transparent, quality }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      if (!transparent) {
        for (let x = 0; x < width; x += 40) {
          ctx.fillStyle = (x / 40) % 2 ? '#2c7be5' : '#e3ebf6';
          ctx.fillRect(x, 0, 40, height);
        }
      }
      ctx.fillStyle = '#d6336c';
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, Math.min(width, height) / 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = `${Math.max(12, Math.floor(height / 12))}px sans-serif`;
      ctx.fillText(`[Auto Test] ${width}x${height}`, 10, Math.max(20, height / 8));
      return canvas.toDataURL(type, quality ?? 0.85);
    }, spec);
    return payload(name, Buffer.from(dataUrl.split(',')[1], 'base64'), spec.type);
  } finally {
    await scratch.close();
  }
}

/**
 * A JPEG with an EXIF Orientation tag (6 = rotate 90° clockwise): drawn landscape, so a viewer that honours EXIF shows
 * it portrait. The APP1 segment is inserted right after the SOI marker.
 */
export async function jpegWithOrientation(page: Page, name: string, width: number, height: number, orientation = 6): Promise<FilePayload> {
  const jpeg = await drawImage(page, name, { width, height, type: 'image/jpeg' });
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0);
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8); // one IFD entry
  tiff.writeUInt16BE(0x0112, 10); // Orientation
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22); // no next IFD
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  return payload(name, Buffer.concat([jpeg.buffer.subarray(0, 2), app1, exif, jpeg.buffer.subarray(2)]), 'image/jpeg');
}

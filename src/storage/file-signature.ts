/**
 * Content validation by magic bytes. This is NOT antivirus/malware scanning: it only checks that the bytes look
 * like the declared type. PDFs and Office files can still carry active content; no content scanning is implemented.
 */
export const ALLOWED_FILE_TYPES: Record<string, { ext: string }> = {
  'application/pdf': { ext: 'pdf' },
  'text/plain': { ext: 'txt' },
  'image/jpeg': { ext: 'jpg' },
  'image/png': { ext: 'png' },
  'image/webp': { ext: 'webp' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: 'pptx' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx' },
};

export function matchesFileSignature(body: Buffer, mime: string): boolean {
  const starts = (b: number[], at = 0) => body.length >= at + b.length && b.every((v, i) => body[at + i] === v);
  switch (mime) {
    case 'application/pdf': return starts([0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'image/png': return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg': return starts([0xff, 0xd8, 0xff]);
    case 'image/webp': return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
    case 'text/plain': {
      if (body.includes(0)) return false;
      try { new TextDecoder('utf-8', { fatal: true }).decode(body); return true; } catch { return false; }
    }
    default:
      if (mime.startsWith('application/vnd.openxmlformats-officedocument.')) return starts([0x50, 0x4b, 0x03, 0x04]);
      return false;
  }
}

export function sanitizeFilename(name: string | undefined, fallbackExt: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001F\u007F"<>:|?*\\]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120);
  return cleaned || `document.${fallbackExt}`;
}

const AUDIO: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: 'audio/webm', ext: 'webm', test: b => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'audio/ogg', ext: 'ogg', test: b => b.subarray(0, 4).toString('latin1') === 'OggS' },
  { mime: 'audio/wav', ext: 'wav', test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  { mime: 'audio/flac', ext: 'flac', test: b => b.subarray(0, 4).toString('latin1') === 'fLaC' },
  { mime: 'audio/mpeg', ext: 'mp3', test: b => b.subarray(0, 3).toString('latin1') === 'ID3' || (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) },
  { mime: 'audio/mp4', ext: 'm4a', test: b => b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' },
];

/** Identifies an audio container from its bytes; returns null when it is not a supported audio format. */
export function sniffAudio(body: Buffer): { mime: string; ext: string } | null {
  const hit = AUDIO.find(a => a.test(body));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

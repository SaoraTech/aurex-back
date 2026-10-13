import { matchesFileSignature, sanitizeFilename, sniffAudio } from './file-signature';
describe('file signatures', () => {
  it('accepts a PDF and rejects an HTML payload declared as PDF', () => {
    expect(matchesFileSignature(Buffer.from('%PDF-1.7 ...'), 'application/pdf')).toBe(true);
    expect(matchesFileSignature(Buffer.from('<script>alert(1)</script>'), 'application/pdf')).toBe(false);
  });
  it('validates png/jpeg/webp/ooxml headers', () => {
    expect(matchesFileSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png')).toBe(true);
    expect(matchesFileSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(true);
    expect(matchesFileSignature(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]), 'image/webp')).toBe(true);
    expect(matchesFileSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
  });
  it('rejects text with NUL bytes or invalid UTF-8; unknown types are rejected', () => {
    expect(matchesFileSignature(Buffer.from('bonjour é'), 'text/plain')).toBe(true);
    expect(matchesFileSignature(Buffer.from([0x61, 0x00, 0x62]), 'text/plain')).toBe(false);
    expect(matchesFileSignature(Buffer.from([0xff, 0xfe, 0xfd]), 'text/plain')).toBe(false);
    expect(matchesFileSignature(Buffer.from('MZ'), 'application/x-msdownload')).toBe(false);
  });
  it('sanitises file names (no paths, no control chars, no leading dots)', () => {
    expect(sanitizeFilename('../../etc/passwd', 'txt')).toBe('passwd');
    expect(sanitizeFilename('..hidden\u0000.pdf', 'pdf')).toBe('hidden.pdf');
    expect(sanitizeFilename(undefined, 'pdf')).toBe('document.pdf');
  });
  it('sniffs audio containers from bytes', () => {
    expect(sniffAudio(Buffer.from('OggS....'))?.mime).toBe('audio/ogg');
    expect(sniffAudio(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]))?.mime).toBe('audio/wav');
    expect(sniffAudio(Buffer.from('ID3\u0004...'))?.mime).toBe('audio/mpeg');
    expect(sniffAudio(Buffer.from('plain text here'))).toBeNull();
  });
});

import { describe, expect, test } from 'bun:test';
import { guessMimeType, resolveMimeType } from '../src/server/services/mimeUtils';

describe('MIME Type Resolution', () => {
  test('correctly guesses MIME for standard web formats', () => {
    expect(guessMimeType('photo.png')).toBe('image/png');
    expect(guessMimeType('song.mp3')).toBe('audio/mpeg');
    expect(guessMimeType('movie.mp4')).toBe('video/mp4');
    expect(guessMimeType('doc.pdf')).toBe('application/pdf');
    expect(guessMimeType('data.json')).toBe('application/json');
    expect(guessMimeType('notes.md')).toBe('text/markdown');
  });

  test('falls back to application/octet-stream for unknown files', () => {
    expect(guessMimeType('archive.unknownext123')).toBe('application/octet-stream');
    expect(guessMimeType('')).toBe('application/octet-stream');
  });

  test('resolveMimeType prioritizes provided valid MIME type', () => {
    expect(resolveMimeType({ mime_type: 'image/webp', file_name: 'test.bin' })).toBe('image/webp');
    expect(
      resolveMimeType({ mime_type: 'application/octet-stream', file_name: 'vector.svg' }),
    ).toBe('image/svg+xml');
  });
});

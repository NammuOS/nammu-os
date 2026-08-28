import { describe, expect, it } from 'bun:test';

import { createUploadTicket, readUploadTicket } from './uploadTicketService';

const ticketInput = {
  accountId: 'account-1',
  fileName: 'report.txt',
  mimeType: 'text/plain',
  size: 42,
  userId: 'local-default-user',
  virtualPath: '/Documents/',
};

describe('upload tickets', () => {
  it('round-trips the upload contract without exposing it in plaintext', () => {
    const token = createUploadTicket(ticketInput, 1_000);

    expect(token).not.toContain(ticketInput.fileName);
    expect(readUploadTicket(token, 2_000)).toEqual({
      ...ticketInput,
      expiresAt: 901_000,
    });
  });

  it('rejects tampering', () => {
    const token = createUploadTicket(ticketInput);
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    expect(() => readUploadTicket(tampered)).toThrow('invalid');
  });

  it('rejects expired sessions', () => {
    const token = createUploadTicket(ticketInput, 1_000);

    expect(() => readUploadTicket(token, 901_001)).toThrow('expired');
  });
});

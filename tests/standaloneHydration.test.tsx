import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import StandaloneWindowContent from '../src/components/desktop/StandaloneWindowContent';

describe('standalone app hydration boundary', () => {
  test.each([
    ['settings', 'Settings'],
    ['calendar', 'Calendar'],
    ['notes', 'Notes'],
    ['whatsapp', 'WhatsApp'],
    ['telegram', 'Telegram'],
    ['youtube-music', 'YouTube Music'],
    ['pdf', 'Nammu PDF'],
  ])('renders a deterministic shell for %s before browser state is available', (id, title) => {
    const markup = renderToString(<StandaloneWindowContent kind="app" id={id} />);
    expect(markup).toContain(`aria-label="Opening ${title}"`);
    expect(markup).toContain('horizon-app-loading');
    expect(markup).not.toContain('Loading local workspace state');
  });
});

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { installFakeCanvas } from './helpers/canvas';

/** Sharing a local ranking as an image: the panel, its formats and the ways out (share sheet, clipboard, download). */

const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const click = (sel: string) => {
  const el = $(sel);
  if (!el) throw new Error(`missing ${sel}`);
  el.click();
};
const flush = () => vi.advanceTimersByTimeAsync(0);

const share = vi.fn(async () => {});
const writeText = vi.fn(async () => {});
const write = vi.fn(async () => {});
const canvas = installFakeCanvas();

beforeAll(async () => {
  vi.useFakeTimers();
  window.scrollTo = () => {};
  localStorage.clear();
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText, write }, configurable: true });
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(readonly items: Record<string, Blob>) {}
    },
  );
  document.body.innerHTML = body;
  const { mount } = await import('../src/app/ui');
  // The share module loads once the page is idle (src/app/events.ts): loaded here, the first share opens at once.
  await (await import('../src/app/events')).loadSharing();
  mount(document);
});

describe('sharing a local ranking', () => {
  it('offers to share once there are duels, and opens the panel with a drawn preview', async () => {
    click('[data-action="new-rank"]');
    ($('#rank-title') as HTMLInputElement).value = 'Pâtisseries préférées';
    $('#rank-title')?.dispatchEvent(new Event('input', { bubbles: true }));
    const input = $('#add-input') as HTMLInputElement;
    for (const v of ['Croissant', 'Chocolatine', 'Kouign-amann']) {
      input.value = v;
      $('#add-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    click('.tab[data-tab="results"]');
    // No duel yet: nothing to share.
    expect($('[data-action="share-rank"]')).toBeNull();
    click('.tab[data-tab="duel"]');
    for (let i = 0; i < 3; i++) {
      click('[data-action="pick"][data-side="a"]');
      vi.advanceTimersByTime(600);
    }
    click('.tab[data-tab="results"]');
    click('[data-action="share-rank"]');
    expect($('#m-title')?.textContent).toBe('Share this ranking');
    expect($('#m-cancel')?.hidden).toBe(true);
    await flush();
    const drawn = $('#share-preview canvas') as HTMLCanvasElement;
    expect(drawn).not.toBeNull();
    expect([drawn.width, drawn.height]).toEqual([1080, 1350]);
    expect(canvas.calls).toContain('fillText');
    expect($('[data-action="share-fmt"][data-fmt="post"]')?.getAttribute('aria-pressed')).toBe('true');
    const msg = $('.share-msg')?.textContent ?? '';
    expect(msg).toContain('Pâtisseries préférées · 3 items · 3 duels · Balanced');
    expect(msg).toMatch(/1\. \w/);
    expect(msg).toContain('Made with Versus · http://localhost:3000/');
  });

  it('switches formats and redraws', async () => {
    click('[data-action="share-fmt"][data-fmt="story"]');
    await flush();
    const drawn = $('#share-preview canvas') as HTMLCanvasElement;
    expect([drawn.width, drawn.height]).toEqual([1080, 1920]);
    expect($('[data-action="share-fmt"][data-fmt="story"]')?.getAttribute('aria-pressed')).toBe('true');
    expect($('[data-action="share-fmt"][data-fmt="post"]')?.getAttribute('aria-pressed')).toBe('false');
    click('[data-action="share-fmt"][data-fmt="landscape"]');
    await flush();
    expect(($('#share-preview canvas') as HTMLCanvasElement).width).toBe(1200);
  });

  it('hands the image and the message to the system share sheet', async () => {
    click('[data-action="share-native"]');
    await flush();
    expect(share).toHaveBeenCalledOnce();
    const data = (share.mock.calls as unknown as [ShareData][])[0]?.[0] as ShareData;
    expect(data.text).toContain('Made with Versus');
    expect(data.files).toHaveLength(1);
    expect(data.files?.[0]?.name).toBe('versus-patisseries-preferees-landscape.png');
    expect(data.files?.[0]?.type).toBe('image/png');
  });

  it('copies the message, copies the image, downloads it', async () => {
    click('[data-action="share-copy-text"]');
    await flush();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('1. '));
    expect($('#toast')?.textContent).toBe('Message copied');
    click('[data-action="share-copy-image"]');
    await flush();
    expect(write).toHaveBeenCalledOnce();
    expect($('#toast')?.textContent).toBe('Image copied');
    const clicked: string[] = [];
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:card', revokeObjectURL: () => {} }));
    click('[data-action="share-download"]');
    await flush();
    expect(clicked).toEqual(['versus-patisseries-preferees-landscape.png']);
    anchorClick.mockRestore();
  });

  it('opens on the picture the Ranking tab shows, and switches to the other', async () => {
    const pressed = () => $('[data-action="share-view"][aria-pressed="true"]')?.dataset.view;
    // Opened from the podium: the podium, and the lines one click away.
    expect(pressed()).toBe('podium');
    expect([...document.querySelectorAll<HTMLElement>('[data-action="share-view"]')].map((b) => b.textContent)).toEqual(
      ['Podium', 'Compare two methods'],
    );
    click('[data-action="share-view"][data-view="lines"]');
    await flush();
    expect(pressed()).toBe('lines');
    // The format chosen stays.
    expect(($('#share-preview canvas') as HTMLCanvasElement).width).toBe(1200);
    const msg = $('.share-msg')?.textContent ?? '';
    expect(msg).toContain('Pâtisseries préférées · 3 items · 3 duels');
    expect(msg).toMatch(/\nBalanced: .+\nDynamic: .+/);
    click('#m-ok');
    // Opened from the lines, comparing with Simple: those lines.
    click('[data-action="rank-view"][data-view="lines"]');
    click('[data-action="set-compare"][data-m="win"]');
    click('[data-action="share-rank"]');
    await flush();
    expect(pressed()).toBe('lines');
    expect($('.share-msg')?.textContent).toMatch(/\nBalanced: .+\nSimple: .+/);
    click('[data-action="share-view"][data-view="podium"]');
    expect($('.share-msg')?.textContent).toContain('Pâtisseries préférées · 3 items · 3 duels · Balanced');
  });

  it('keeps quiet when the person closes the share sheet, and says so when sharing fails', async () => {
    share.mockRejectedValueOnce(new DOMException('closed', 'AbortError'));
    $('#toast')?.classList.remove('show');
    click('[data-action="share-native"]');
    await flush();
    expect($('#toast')?.classList.contains('show')).toBe(false);
    share.mockRejectedValueOnce(new Error('nope'));
    click('[data-action="share-native"]');
    await flush();
    expect($('#toast')?.textContent).toBe('Sharing didn’t work here. Copy or download the image instead.');
    click('#m-ok');
    expect($('#modal')?.hidden).toBe(true);
  });
});

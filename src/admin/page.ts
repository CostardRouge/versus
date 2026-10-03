import {
  ADMIN_FILTERS,
  type AdminBoardView,
  type AdminFilter,
  type AdminList,
  type AdminRow,
  type AdminTotals,
} from '../core/protocol';
import type { ErrorCode, ReportReason } from '../core/types';
import { esc } from '../core/util';
import { type AdminKey, type AdminLang, adminText } from '../i18n/admin';

/**
 * The publisher's moderation page (/admin/): the boards of the registry with their counts, flags and reports;
 * per board, the full view and the admin actions (close or reopen, feature, hide, remove an item, clear the
 * reports, delete its link previews, take down). Talks to /api/admin with the token typed on the page, kept in this tab only
 * (docs/published-boards.md#moderation). Rendered as HTML strings with delegated events, like the app.
 */

export interface AdminOpts {
  root: HTMLElement;
  /** The API's origin ('' for the page's own), or null in a build without a server. */
  api: string | null;
  lang: AdminLang;
  fetch: typeof fetch;
  /** Where the token lives between reloads of this tab; null when storage is unavailable. */
  storage: Storage | null;
  confirm: (message: string) => boolean;
  /** The app's address for a board. */
  boardURL: (alias: string) => string;
  locale: string;
}

const TOKEN_KEY = 'versus-admin';
const PAGE = 50;
/** How long a request may take before the page says the server didn't answer. */
const TIMEOUT_MS = 15_000;

const FILTER_KEYS: Record<AdminFilter, AdminKey> = {
  all: 'fAll',
  reported: 'fReported',
  pictures: 'fPictures',
  featured: 'fFeatured',
  hidden: 'fHidden',
  open: 'fOpen',
  closed: 'fClosed',
};
const REASON_KEYS: Record<ReportReason, AdminKey> = {
  spam: 'rSpam',
  offensive: 'rOffensive',
  personal: 'rPersonal',
  other: 'rOther',
};

class AdminError extends Error {
  constructor(readonly code: ErrorCode | 'network') {
    super(code);
  }
}

interface State {
  token: string;
  totals: AdminTotals | null;
  list: AdminList | null;
  filter: AdminFilter;
  q: string;
  offset: number;
  /** The board whose details are open, and those details. */
  open: string | null;
  detail: AdminBoardView | null;
  error: AdminKey | null;
  busy: boolean;
}

export function mountAdmin(opts: AdminOpts): void {
  const { root, lang } = opts;
  const tx = (key: AdminKey, vars: Record<string, string> = {}) => adminText(lang, key, vars);
  const dates = new Intl.DateTimeFormat(opts.locale, { dateStyle: 'medium', timeStyle: 'short' });
  const numbers = new Intl.NumberFormat(opts.locale);
  const n = (x: number) => numbers.format(x);
  const when = (ts: number) => dates.format(new Date(ts));
  const read = (): string => {
    try {
      return opts.storage?.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  };
  const write = (token: string): void => {
    try {
      if (token) opts.storage?.setItem(TOKEN_KEY, token);
      else opts.storage?.removeItem(TOKEN_KEY);
    } catch {
      /* the token lasts for this page only */
    }
  };

  const st: State = {
    token: read(),
    totals: null,
    list: null,
    filter: 'all',
    q: '',
    offset: 0,
    open: null,
    detail: null,
    error: null,
    busy: false,
  };

  // ─── API ──────────────────────────────────────────────────────────────────

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await opts.fetch(`${opts.api ?? ''}/api/admin${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new AdminError('network');
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: ErrorCode }) | null;
    if (!res.ok) throw new AdminError(data?.error ?? 'network');
    return data as T;
  }

  /** A refused token goes back to the form, forgotten; anything else keeps the page and says so. */
  const fail = (e: unknown): void => {
    const code = e instanceof AdminError ? e.code : 'network';
    const errors: Partial<Record<ErrorCode | 'network', AdminKey>> = {
      forbidden: 'wrongToken',
      network: 'offline',
      changed: 'picChanged',
    };
    st.error = errors[code] ?? 'failed';
    if (code === 'forbidden') {
      st.token = '';
      write('');
      st.totals = null;
      st.list = null;
      st.open = null;
      st.detail = null;
    }
  };

  async function load(): Promise<void> {
    if (!st.token) return;
    st.busy = true;
    st.error = null;
    render();
    try {
      const query = `?limit=${PAGE}&offset=${st.offset}&filter=${st.filter}&q=${encodeURIComponent(st.q)}`;
      const [totals, list] = await Promise.all([
        call<AdminTotals>('GET', '/stats'),
        call<AdminList>('GET', `/boards${query}`),
      ]);
      st.totals = totals;
      st.list = list;
      if (st.open && !list.boards.some((b) => b.alias === st.open)) {
        st.open = null;
        st.detail = null;
      }
    } catch (e) {
      fail(e);
    }
    st.busy = false;
    render();
  }

  async function inspect(alias: string): Promise<void> {
    st.open = alias;
    st.detail = null;
    render();
    try {
      st.detail = await call<AdminBoardView>('GET', `/boards/${alias}`);
    } catch (e) {
      fail(e);
    }
    render();
  }

  /**
   * An admin action on the open board, then its details and the list again (the row changed). What went wrong stays
   * on screen once the list is read again.
   */
  async function act(run: () => Promise<unknown>, then: 'detail' | 'list' = 'detail'): Promise<void> {
    const alias = st.open;
    st.busy = true;
    render();
    let failed: AdminKey | null = null;
    try {
      await run();
      if (then === 'list' || !alias) {
        st.open = null;
        st.detail = null;
      } else st.detail = await call<AdminBoardView>('GET', `/boards/${alias}`);
    } catch (e) {
      fail(e);
      failed = st.error;
    }
    st.busy = false;
    await load();
    if (failed && !st.error) {
      st.error = failed;
      render();
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  const button = (act: string, label: string, extra = '', cls = 'ad-btn') =>
    `<button class="${cls}" type="button" data-act="${act}" ${extra} ${st.busy ? 'disabled' : ''}>${esc(label)}</button>`;

  function statsHTML(): string {
    const s = st.totals;
    if (!s) return '';
    const cells: [number, AdminKey][] = [
      [s.boards, 'sBoards'],
      [s.open, 'sOpen'],
      [s.votes, 'sVotes'],
      [s.voters, 'sVoters'],
      [s.reported, 'sReported'],
      [s.pictures, 'sPictures'],
      [s.featured, 'sFeatured'],
      [s.hidden, 'sHidden'],
    ];
    return `<ul class="ad-stats">${cells
      .map(([v, k]) => `<li><b class="mono">${n(v)}</b> <span>${tx(k)}</span></li>`)
      .join('')}</ul>`;
  }

  function toolsHTML(): string {
    const filters = ADMIN_FILTERS.map(
      (f) =>
        `<button class="ad-filter" type="button" role="tab" aria-selected="${f === st.filter}" data-act="filter" data-filter="${f}">${tx(FILTER_KEYS[f])}</button>`,
    ).join('');
    return `<div class="ad-tools">
      <div class="ad-filters" role="tablist">${filters}</div>
      <form class="ad-search" data-form="search"><input type="search" name="q" value="${esc(st.q)}" placeholder="${esc(tx('search'))}" aria-label="${esc(tx('search'))}"><button class="ad-btn" type="submit">${tx('searchGo')}</button></form>
      ${button('refresh', tx('refresh'))}
    </div>`;
  }

  function rowHTML(b: AdminRow): string {
    const open = st.open === b.alias;
    const flags = [
      b.template ? tx('official') : '',
      b.featured ? tx('featured') : '',
      b.hidden ? tx('hidden') : '',
      b.pictures ? tx('picFlag', { n: n(b.pictures) }) : '',
    ].filter(Boolean);
    return `<tr class="${b.reports ? 'ad-reported' : ''} ${open ? 'ad-open' : ''}" data-alias="${esc(b.alias)}">
      <td class="ad-title"><a href="${esc(opts.boardURL(b.alias))}" target="_blank" rel="noopener">${esc(b.title)}</a>
        <small class="mono">${esc(b.alias)} · ${b.lang}</small>${flags.length ? `<span class="ad-flags">${flags.map((f) => `<span class="ad-flag">${f}</span>`).join('')}</span>` : ''}</td>
      <td>${tx(b.status)}</td>
      <td class="mono">${n(b.items)}</td>
      <td class="mono">${n(b.votes)}</td>
      <td class="mono">${n(b.voters)}</td>
      <td class="mono ${b.reports ? 'ad-count' : ''}">${n(b.reports)}</td>
      <td class="ad-date">${when(b.created)}</td>
      <td class="ad-date">${when(b.active)}</td>
      <td>${button(open ? 'less' : 'inspect', tx(open ? 'less' : 'details'), `data-alias="${esc(b.alias)}"`, 'ad-btn sm')}</td>
    </tr>${open ? `<tr class="ad-detail"><td colspan="9">${detailHTML()}</td></tr>` : ''}`;
  }

  function detailHTML(): string {
    const v = st.detail;
    if (!v) return `<p class="ad-muted">${tx('loading')}</p>`;
    const closed = v.status === 'closed';
    const actions = [
      button(closed ? 'reopen' : 'close', tx(closed ? 'reopenVote' : 'closeVote')),
      button('feature', tx(v.mod.featured ? 'unfeature' : 'feature'), `data-on="${!v.mod.featured}"`),
      button('hide', tx(v.mod.hidden ? 'unhideBoard' : 'hideBoard'), `data-on="${!v.mod.hidden}"`),
      v.reports.length ? button('clear-reports', tx('clearReports')) : '',
      button('delete-cards', tx('deleteCards')),
      button('delete', tx('takeDown'), '', 'ad-btn danger'),
    ].join('');
    const reports = v.reports.length
      ? `<ul class="ad-reports">${v.reports
          .map(
            (r) =>
              `<li><b>${tx(REASON_KEYS[r.reason])}</b> <span class="ad-muted">${when(r.t)}</span>${r.note ? `<p>${esc(r.note)}</p>` : ''}</li>`,
          )
          .join('')}</ul>`
      : `<p class="ad-muted">${tx('noReports')}</p>`;
    const canRemove = v.items.length > 2;
    const items = `<ul class="ad-items">${v.items
      .map(
        (it) =>
          `<li><span>${esc(it.label || (it.fill ? it.fill.colors.join(' → ') : ''))}</span>${canRemove ? button('remove-item', tx('remove'), `data-id="${esc(it.id)}" data-label="${esc(it.label)}"`, 'ad-btn sm') : ''}</li>`,
      )
      .join('')}</ul>`;
    const labels = new Map(v.items.map((it) => [it.id, it.label]));
    const ranking = v.ranking
      ? `<ol class="ad-ranking">${v.ranking.order
          .map(
            (id) =>
              `<li>${esc(labels.get(id) ?? id)} <span class="mono ad-muted">${n(Math.round(v.ranking?.stats[id]?.score ?? 0))}</span></li>`,
          )
          .join('')}</ol>`
      : '';
    // Pictures waiting for a decision: shown here (fetched with the token), approved or refused one by one.
    const pending = v.items.filter((it) => it.pic === 'pending');
    const pictures = pending.length
      ? `<section class="ad-pics-sec"><h3>${tx('picturesTitle')} <span class="mono">${n(pending.length)}</span></h3>
        <ul class="ad-pics">${pending
          .map(
            (it) =>
              `<li><img data-pic="${esc(it.id)}" alt="" width="160" height="160"><span class="ad-pic-label">${esc(it.label)}</span><span class="ad-pic-acts">${button('approve-pic', tx('approve'), `data-id="${esc(it.id)}"`, 'ad-btn sm primary')}${button('refuse-pic', tx('refuse'), `data-id="${esc(it.id)}"`, 'ad-btn sm danger')}</span></li>`,
          )
          .join('')}</ul></section>`
      : '';
    return `<div class="ad-panel">
      <div class="ad-actions">${actions}<a class="ad-btn" href="${esc(opts.boardURL(v.alias))}" target="_blank" rel="noopener">${tx('openBoard')} ↗</a></div>
      <p class="ad-muted ad-meta">${tx('language')}: ${v.lang} · ${tx('visibility')}: ${v.settings.visibility} · ${tx('method')}: ${v.settings.method} · ${tx('cCreated')}: ${when(v.created)}</p>
      ${pictures}
      <div class="ad-cols">
        <section><h3>${tx('reports')} <span class="mono">${n(v.reports.length)}</span></h3>${reports}</section>
        <section><h3>${tx('items')} <span class="mono">${n(v.items.length)}</span></h3>${items}</section>
        <section><h3>${tx('ranking')}</h3>${ranking}</section>
      </div>
    </div>`;
  }

  function tableHTML(): string {
    const list = st.list;
    if (!list) return st.busy ? `<p class="ad-muted">${tx('loading')}</p>` : '';
    const cols: AdminKey[] = ['cTitle', 'cStatus', 'cItems', 'cVotes', 'cVoters', 'cReports', 'cCreated', 'cActive'];
    const rows = list.boards.map(rowHTML).join('');
    const from = list.offset + 1;
    const to = list.offset + list.boards.length;
    const pager = `<nav class="ad-pager">
      ${button('prev', tx('prev'), list.offset === 0 ? 'disabled' : '')}
      <span class="mono ad-muted">${list.boards.length ? `${n(from)}–${n(to)}` : '0'}</span>
      ${button('next', tx('next'), list.boards.length < list.limit ? 'disabled' : '')}
    </nav>`;
    if (!list.boards.length) return `<p class="ad-muted ad-empty">${tx('empty')}</p>${list.offset ? pager : ''}`;
    return `<div class="ad-scroll"><table class="ad-table">
      <thead><tr>${cols.map((c) => `<th>${tx(c)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${pager}`;
  }

  function render(): void {
    const brand = `<a class="ad-brand" href="../"><span class="ad-mark" aria-hidden="true">vs</span> Versus</a><h1 class="ad-h">${tx('title')}</h1>`;
    if (opts.api === null) {
      root.innerHTML = `<header class="ad-top">${brand}</header><main class="ad-main"><p class="ad-notice">${tx('noApi')}</p></main>`;
      return;
    }
    const error = st.error ? `<p class="ad-error" role="alert">${tx(st.error)}</p>` : '';
    if (!st.token) {
      root.innerHTML = `<header class="ad-top">${brand}</header>
      <main class="ad-main">
        <form class="ad-login" data-form="token">
          <label for="ad-token">${tx('tokenLabel')}</label>
          <input id="ad-token" name="token" type="password" autocomplete="off" required>
          <button class="ad-btn primary" type="submit">${tx('enter')}</button>
          <p class="ad-muted">${tx('tokenHint')}</p>
        </form>${error}
      </main>`;
      return;
    }
    root.innerHTML = `<header class="ad-top">${brand}${button('logout', tx('logout'), '', 'ad-btn sm')}</header>
    <main class="ad-main" aria-busy="${st.busy}">${error}${statsHTML()}${toolsHTML()}${tableHTML()}</main>`;
    void loadPictures();
  }

  /**
   * The pictures to review are behind the token: fetched here and shown from object URLs (freed on the next render).
   * Each one's ETag goes back with an approval, so the server approves the picture shown here and no other.
   */
  const shown: string[] = [];
  const etags = new Map<string, string>();
  async function loadPictures(): Promise<void> {
    if (typeof URL.revokeObjectURL === 'function') for (const url of shown.splice(0)) URL.revokeObjectURL(url);
    etags.clear();
    const alias = st.open;
    if (!alias || typeof URL.createObjectURL !== 'function') return;
    for (const img of root.querySelectorAll<HTMLImageElement>('img[data-pic]')) {
      const id = img.dataset.pic ?? '';
      try {
        const res = await opts.fetch(
          `${opts.api ?? ''}/api/admin/boards/${alias}/items/${encodeURIComponent(id)}/image`,
          { headers: { Authorization: `Bearer ${st.token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
        );
        if (!res.ok || st.open !== alias) continue;
        const url = URL.createObjectURL(await res.blob());
        shown.push(url);
        img.src = url;
        etags.set(id, res.headers.get('ETag') ?? '');
      } catch {
        /* the picture stays blank; the label and the buttons are there */
      }
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  root.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === 'token') {
      st.token = String(data.get('token') ?? '').trim();
      write(st.token);
      void load();
    } else if (form.dataset.form === 'search') {
      st.q = String(data.get('q') ?? '').trim();
      st.offset = 0;
      void load();
    }
  });

  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const alias = st.open;
    const title = st.detail?.title ?? '';
    switch (el.dataset.act) {
      case 'logout':
        st.token = '';
        write('');
        st.totals = st.list = st.detail = null;
        st.open = null;
        st.error = null;
        render();
        break;
      case 'filter':
        st.filter = (el.dataset.filter as AdminFilter) ?? 'all';
        st.offset = 0;
        void load();
        break;
      case 'refresh':
        void load();
        break;
      case 'prev':
        st.offset = Math.max(0, st.offset - PAGE);
        void load();
        break;
      case 'next':
        st.offset += PAGE;
        void load();
        break;
      case 'inspect':
        if (el.dataset.alias) void inspect(el.dataset.alias);
        break;
      case 'less':
        st.open = null;
        st.detail = null;
        render();
        break;
      case 'close':
      case 'reopen':
        if (alias) void act(() => call('POST', `/boards/${alias}/${el.dataset.act}`));
        break;
      case 'feature':
        if (alias) void act(() => call('PATCH', `/boards/${alias}`, { featured: el.dataset.on === 'true' }));
        break;
      case 'hide':
        if (alias) void act(() => call('PATCH', `/boards/${alias}`, { hidden: el.dataset.on === 'true' }));
        break;
      case 'clear-reports':
        if (alias) void act(() => call('DELETE', `/boards/${alias}/reports`));
        break;
      case 'approve-pic':
      case 'refuse-pic': {
        const id = el.dataset.id;
        const decision = el.dataset.act === 'approve-pic' ? 'ok' : 'refused';
        if (alias && id) {
          const body = decision === 'ok' ? { decision, etag: etags.get(id) ?? '' } : { decision };
          void act(() => call('POST', `/boards/${alias}/items/${encodeURIComponent(id)}/picture`, body));
        }
        break;
      }
      case 'remove-item': {
        const id = el.dataset.id;
        if (alias && id && opts.confirm(tx('confirmRemove', { label: el.dataset.label ?? '', title }))) {
          void act(() => call('DELETE', `/boards/${alias}/items/${encodeURIComponent(id)}`));
        }
        break;
      }
      case 'delete-cards':
        if (alias && opts.confirm(tx('confirmDeleteCards', { title }))) {
          void act(() => call('DELETE', `/boards/${alias}/cards`));
        }
        break;
      case 'delete':
        if (alias && opts.confirm(tx('confirmTakeDown', { title }))) {
          void act(() => call('DELETE', `/boards/${alias}`), 'list');
        }
        break;
      default:
        break;
    }
  });

  render();
  void load();
}

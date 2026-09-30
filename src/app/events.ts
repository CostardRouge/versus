import { locale, plural, t } from '../i18n';
import {
  boardAddItem,
  boardAdminLink,
  boardChange,
  boardEditColor,
  boardKeydown,
  boardPick,
  boardRefresh,
  boardRemoveItem,
  boardReset,
  boardShare,
  boardSkip,
  boardStatus,
  boardUndo,
  boardUnlink,
  boardWithdraw,
  closeFinale,
  copyBoardLink,
  openFinale,
  setFinaleView,
  setFinaleWho,
} from './board';
import { closeColor, colorChange, colorInput, cp, cpAction, openColor, placeColor, setActiveStop } from './color';
import { $, closeModal, doc, narrow, toast } from './dom';
import { choose, duelKeydown, skip, undoLast } from './duel';
import { drawLines } from './finale';
import { changeTheme } from './header';
import { addColor, addFiles, addLabels, removeItem, renameItem } from './items';
import { publishRanking } from './publish';
import {
  changeLang,
  deleteRank,
  duplicateRank,
  goBack,
  newRank,
  open,
  openBoard,
  resetDemo,
  resetRank,
  routeFromHash,
  toggleDemos,
} from './rankings';
import { copyRanking } from './results';
import { cur, S, save } from './state';
import { setMethod, setTab, toggleMethodMenu } from './workspace';

/** Delegated listeners: interactive elements carry data-action (+ data-id, data-tab…). */

function onClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const mpop = $('#method-pop');
  if (mpop && !mpop.hidden && !target.closest('.method-wrap')) toggleMethodMenu(false);
  const cpop = $('#cpop');
  if (cpop && !cpop.hidden && !target.closest('#cpop') && !target.closest('.thumb-btn')) closeColor();
  const el = target.closest<HTMLElement>('[data-action]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const id = el.dataset.id;
  const action = el.dataset.action ?? '';
  if (action.startsWith('cp-')) {
    cpAction(action, el);
    return;
  }
  switch (action) {
    case 'new-rank':
      newRank();
      break;
    case 'open':
      open(id, el.dataset.tab);
      break;
    case 'back':
      goBack();
      break;
    case 'tab': {
      const tab = el.dataset.tab;
      setTab(tab === 'items' || tab === 'results' ? tab : 'duel');
      if (tab === 'items') setTimeout(() => $('#add-input')?.focus(), 30);
      break;
    }
    case 'lang':
      changeLang(el.dataset.l);
      break;
    case 'theme':
      changeTheme(el.dataset.t);
      break;
    case 'method-menu':
      toggleMethodMenu();
      break;
    case 'set-method':
      setMethod(el.dataset.m);
      break;
    case 'edit-color':
      if (id && cp.id === id && cpop && !cpop.hidden) closeColor();
      else if (id) openColor(id, el);
      break;
    case 'reset':
      void resetRank(id);
      break;
    case 'reset-demo':
      void resetDemo(id);
      break;
    case 'duplicate':
      duplicateRank(id);
      break;
    case 'toggle-demos':
      toggleDemos();
      break;
    case 'add-color':
      addColor();
      break;
    case 'delete':
      void deleteRank(id);
      break;
    case 'remove-item':
      removeItem(id);
      break;
    case 'pick':
      choose(el.dataset.side);
      break;
    case 'skip':
      skip();
      break;
    case 'undo':
      undoLast();
      break;
    case 'copy':
      copyRanking();
      break;
    case 'pick-files':
      $('#file-input')?.click();
      break;
    case 'publish':
      void publishRanking(cur());
      break;
    case 'open-board':
      openBoard(el.dataset.alias);
      break;
    case 'copy-link':
      void copyBoardLink(el.dataset.alias);
      break;
    case 'b-pick':
      boardPick(el.dataset.side);
      break;
    case 'b-skip':
      boardSkip();
      break;
    case 'b-undo':
      boardUndo();
      break;
    case 'b-reset':
      void boardReset();
      break;
    case 'b-refresh':
      boardRefresh();
      break;
    case 'b-share':
      void boardShare();
      break;
    case 'b-admin-link':
      void boardAdminLink();
      break;
    case 'b-close':
      void boardStatus('closed');
      break;
    case 'b-reopen':
      void boardStatus('open');
      break;
    case 'b-withdraw':
      void boardWithdraw();
      break;
    case 'b-unlink':
      boardUnlink();
      break;
    case 'b-remove-item':
      void boardRemoveItem(id);
      break;
    case 'b-edit-color':
      boardEditColor(id, el);
      break;
    case 'b-finale':
      openFinale();
      break;
    case 'b-finale-close':
      closeFinale();
      break;
    case 'b-finale-view':
      setFinaleView(el.dataset.view);
      break;
    case 'b-finale-who':
      setFinaleWho(el.dataset.who);
      break;
  }
}

function onInput(e: Event): void {
  const tg = e.target as HTMLInputElement;
  if (tg.id === 'rank-title') {
    const r = cur();
    if (r) {
      r.title = tg.value.trim() || t('untitled');
      r.updated = Date.now();
      save();
    }
    return;
  }
  colorInput(tg);
}

function onChange(e: Event): void {
  const tg = e.target as HTMLInputElement;
  // The color editor also serves published boards, where there is no local ranking.
  if (colorChange(tg) || (S.route.view === 'board' && boardChange(tg))) return;
  const r = cur();
  if (!r) return;
  if (tg.id === 'c-grad') {
    const c2 = $('#c2');
    if (c2) c2.hidden = !tg.checked;
    return;
  }
  if (tg.id === 'file-input') {
    if (tg.files) void addFiles(r, [...tg.files]);
    tg.value = '';
    return;
  }
  if (tg.classList.contains('row-label')) renameItem(r, tg);
}

function onKeydown(e: KeyboardEvent): void {
  const modal = $('#modal');
  if (modal && !modal.hidden) {
    if (e.key === 'Escape') closeModal(false);
    return;
  }
  const tg = e.target as HTMLElement;
  const cpop = $('#cpop');
  if (cpop && !cpop.hidden) {
    if (e.key === 'Enter' && tg.classList.contains('cp-hex')) {
      tg.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (e.key === 'Escape') {
      closeColor();
      return;
    }
    if (tg.closest('#cpop')) return;
  }
  const mpop = $('#method-pop');
  if (mpop && !mpop.hidden) {
    if (e.key === 'Escape') {
      toggleMethodMenu(false);
      $('#method-btn')?.focus();
    }
    return;
  }
  if (tg.id === 'rank-title' && e.key === 'Enter') {
    e.preventDefault();
    if (narrow.matches) setTab('items');
    $('#add-input')?.focus();
    return;
  }
  if (tg.classList.contains('row-label') && e.key === 'Enter') {
    tg.blur();
    return;
  }
  if (S.route.view === 'board') boardKeydown(e, tg);
  else duelKeydown(e, tg);
}

function onPaste(e: ClipboardEvent): void {
  const r = cur();
  const tg = e.target as HTMLElement;
  if (!r || !e.clipboardData || tg.closest?.('#cpop')) return;
  const files = [...(e.clipboardData.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    void addFiles(r, files);
    return;
  }
  if (tg.id === 'add-input') {
    const txt = e.clipboardData.getData('text/plain') || '';
    if (/\n/.test(txt.trim())) {
      e.preventDefault();
      const n = addLabels(r, txt.split(/\r?\n/));
      if (n) toast(t('itemsAdded', { items: plural(n, 'item'), n }));
    }
  }
}

const hasFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes('Files');

export function bindEvents(): void {
  doc.addEventListener('click', onClick);
  doc.addEventListener('input', onInput);
  doc.addEventListener('change', onChange);
  doc.addEventListener('keydown', onKeydown);
  doc.addEventListener('paste', onPaste);
  doc.addEventListener('submit', (e) => {
    if ((e.target as HTMLElement).id === 'b-add-form') {
      e.preventDefault();
      void boardAddItem();
      return;
    }
    if ((e.target as HTMLElement).id !== 'add-form') return;
    e.preventDefault();
    const r = cur();
    const input = $<HTMLInputElement>('#add-input');
    if (!r || !input) return;
    if (addLabels(r, [input.value])) input.value = '';
    input.focus();
  });
  doc.addEventListener('focusin', (e) => {
    const tg = e.target as HTMLElement;
    if (tg.matches?.('#cpop input[data-i]')) setActiveStop(Number(tg.dataset.i));
  });
  doc.addEventListener('focusout', (e) => {
    const tg = e.target as HTMLInputElement;
    if (tg.id === 'rank-title' && !tg.value.trim()) tg.value = t('untitled');
  });
  let dragDepth = 0;
  doc.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    doc.body.classList.add('dropping');
  });
  doc.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  doc.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) doc.body.classList.remove('dropping');
  });
  doc.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    doc.body.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files ?? [])];
    const date = new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
    const r = cur() ?? newRank(t('imagesRankTitle', { date }));
    void addFiles(r, files);
  });
  doc.addEventListener(
    'scroll',
    (e) => {
      if ((e.target as HTMLElement | null)?.id === 'item-list') placeColor();
    },
    true,
  );
  window.addEventListener('resize', () => {
    placeColor();
    drawLines();
  });
  window.addEventListener('hashchange', routeFromHash);
  narrow.addEventListener('change', () => {
    if (cur()) setTab(S.route.tab);
    placeColor();
  });
  $('#m-ok')?.addEventListener('click', () => closeModal(true));
  $('#m-cancel')?.addEventListener('click', () => closeModal(false));
  $('#modal')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal') closeModal(false);
  });
}

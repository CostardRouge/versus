import { parseList } from '../core/list';
import { locale, t } from '../i18n';
import {
  authorAdd,
  authorAddColor,
  authorAddFiles,
  authorEditColor,
  authorOnScreen,
  authorRemove,
  authorSettings,
} from './author';
import { exportAll, exportOne, importFile, isBackupFile, pickImport } from './backup';
import {
  boardAdd,
  boardAdminLink,
  boardChange,
  boardKeydown,
  boardMakeMine,
  boardPick,
  boardRefresh,
  boardReport,
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
import { $, closeModal, doc, narrow, toastAct } from './dom';
import { choose, duelKeydown, endContinue, endSee, endStay, skip, undoLast } from './duel';
import { changeTheme } from './header';
import { addColor, addFiles, addList, addTyped, removeItem, renameItem } from './items';
import { forgetJoined, keepJoinedCopy, makeMineFromCard } from './joined';
import { makeMineFromPopular } from './popular';
import { publishRanking } from './publish';
import { applyUpdate, dismissUpdate, install } from './pwa';
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
  routeFromURL,
  toggleDemos,
} from './rankings';
import { copyRanking, setCompare, setRankView } from './results';
import {
  shareBoard,
  shareCopyImage,
  shareCopyText,
  shareDownload,
  shareDuel,
  shareFinale,
  shareFormat,
  shareLocal,
  shareNative,
} from './share';
import { drawSlopes } from './slope';
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
  if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
  const id = el.dataset.id;
  const action = el.dataset.action ?? '';
  // A published board's settings close before one of their actions runs (it may open a dialog of its own).
  if (el.closest('#b-settings')) closeModal(true);
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
      if (S.route.view === 'board') authorEditColor(id, el);
      else if (id && cp.id === id && cpop && !cpop.hidden) closeColor();
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
    case 'add-color': {
      const r = cur();
      if (S.route.view === 'board') void authorAddColor();
      else if (r) addColor(r);
      break;
    }
    case 'delete':
      void deleteRank(id);
      break;
    case 'remove-item':
      if (S.route.view === 'board') void authorRemove(id);
      else removeItem(id);
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
    case 'share-rank':
      shareLocal(cur());
      break;
    case 'share-board':
      shareBoard();
      break;
    case 'share-duel':
      shareDuel();
      break;
    case 'share-finale':
      shareFinale();
      break;
    case 'share-fmt':
      shareFormat(el.dataset.fmt);
      break;
    case 'share-native':
      void shareNative();
      break;
    case 'share-copy-text':
      void shareCopyText();
      break;
    case 'share-copy-image':
      void shareCopyImage();
      break;
    case 'share-download':
      void shareDownload();
      break;
    case 'make-mine':
      makeMineFromCard(el.dataset.alias);
      break;
    case 'make-mine-popular':
      void makeMineFromPopular(el.dataset.alias);
      break;
    case 'b-make-mine':
      boardMakeMine();
      break;
    case 'b-report':
      void boardReport();
      break;
    case 'end-see':
      endSee();
      break;
    case 'end-stay':
      endStay();
      break;
    case 'end-continue':
      endContinue();
      break;
    case 'rank-view':
      setRankView(el.dataset.view);
      break;
    case 'set-compare':
      setCompare(el.dataset.m);
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
    case 'forget':
      forgetJoined(el.dataset.alias);
      break;
    case 'joined-copy':
      keepJoinedCopy(el.dataset.alias);
      break;
    case 'toast-act':
      toastAct();
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
    case 'b-settings':
      authorSettings();
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
    case 'install':
      void install();
      break;
    case 'update':
      applyUpdate();
      break;
    case 'update-later':
      dismissUpdate();
      break;
    case 'export-all':
      void exportAll();
      break;
    case 'export-one':
      void exportOne(id);
      break;
    case 'import':
      pickImport();
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
  if (tg.id === 'import-input') {
    const file = tg.files?.[0];
    tg.value = '';
    if (file) void importFile(file);
    return;
  }
  // The color editor and the items pane also serve published boards, where there is no local ranking.
  if (colorChange(tg)) return;
  if (tg.id === 'c-grad') {
    const c2 = $('#c2');
    if (c2) c2.hidden = !tg.checked;
    return;
  }
  if (S.route.view === 'board') {
    boardChange(tg);
    return;
  }
  const r = cur();
  if (!r) return;
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
    // Leaving the field commits a published board's title.
    tg.blur();
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
  if (!e.clipboardData || tg.closest?.('#cpop')) return;
  const files = [...(e.clipboardData.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (authorOnScreen()) {
    const text = e.clipboardData.getData('text/plain');
    if (files.length) void authorAddFiles(files);
    else if (tg.id === 'add-input' && parseList(text).length >= 2) void authorAdd(text);
    else return;
    e.preventDefault();
    return;
  }
  if (!r) return;
  if (files.length) {
    e.preventDefault();
    void addFiles(r, files);
    return;
  }
  // A list adds all its items at once; anything else goes into the field.
  if (tg.id === 'add-input' && addList(r, e.clipboardData.getData('text/plain'))) e.preventDefault();
}

/** A list dropped on the add field, or inserted by a phone keyboard's clipboard, comes without a paste event. */
function onBeforeInput(e: InputEvent): void {
  if (!e.cancelable || (e.target as HTMLElement).id !== 'add-input') return;
  const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
  const r = cur();
  if (authorOnScreen()) {
    if (parseList(text).length < 2) return;
    e.preventDefault();
    void authorAdd(text);
  } else if (r && addList(r, text)) e.preventDefault();
}

const hasFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes('Files');

export function bindEvents(): void {
  doc.addEventListener('click', onClick);
  doc.addEventListener('input', onInput);
  doc.addEventListener('change', onChange);
  doc.addEventListener('keydown', onKeydown);
  doc.addEventListener('paste', onPaste);
  doc.addEventListener('beforeinput', onBeforeInput);
  doc.addEventListener('submit', (e) => {
    if ((e.target as HTMLElement).id !== 'add-form') return;
    e.preventDefault();
    const input = $<HTMLInputElement>('#add-input');
    if (!input) return;
    // On a published board: the author's items, or a visitor's suggestion.
    if (S.route.view === 'board') {
      void boardAdd(input.value);
      return;
    }
    const r = cur();
    if (!r) return;
    if (addTyped(r, input.value)) input.value = '';
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
    // A Versus file dropped anywhere is imported.
    const [first] = files;
    if (files.length === 1 && first && isBackupFile(first)) {
      void importFile(first);
      return;
    }
    // Images go to the open ranking or the author's board (or a new ranking).
    if (authorOnScreen()) {
      void authorAddFiles(files);
      return;
    }
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
    drawSlopes();
  });
  window.addEventListener('popstate', routeFromURL);
  // A link written the old way (#/b/<alias>) pasted into an open app.
  window.addEventListener('hashchange', routeFromURL);
  narrow.addEventListener('change', () => {
    if (cur() || authorOnScreen()) setTab(S.route.tab);
    placeColor();
  });
  $('#m-ok')?.addEventListener('click', () => closeModal(true));
  $('#m-cancel')?.addEventListener('click', () => closeModal(false));
  $('#modal')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal') closeModal(false);
  });
}

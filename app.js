'use strict';

/* ============================================================
   随记 · 文本笔记
   本地优先（localStorage） + GitHub Gist 跨设备同步
   ============================================================ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowTs = () => Date.now();

const K = { data: 'suiji.data.v1', sync: 'suiji.sync.v1', ui: 'suiji.ui.v1' };
const GIST_FILE = 'suiji-notes.json';
const API = 'https://api.github.com';

/* ---------------- 存储 ---------------- */
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function write(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    return true;
  } catch (e) {
    toast('本地存储空间不足，保存失败');
    return false;
  }
}

/* ---------------- 状态 ---------------- */
const state = {
  data: read(K.data, null) || { notes: [], folders: [], deleted: {} },
  sync: Object.assign({ token: '', gistId: '', login: '', auto: true, lastAt: 0 }, read(K.sync, {})),
  ui: Object.assign(
    { theme: 'auto', view: { type: 'all', value: null }, sort: 'updated', q: '', activeId: null, mode: 'split' },
    read(K.ui, {})
  ),
};

if (!state.data.notes) state.data.notes = [];
if (!state.data.folders) state.data.folders = [];
if (!state.data.deleted) state.data.deleted = {};

const saveData = () => write(K.data, state.data);
const saveSync = () => write(K.sync, state.sync);
const saveUi = () => write(K.ui, state.ui);

const DEFAULT_FOLDER = 'f-default';
if (!state.data.folders.some((f) => f.id === DEFAULT_FOLDER)) {
  state.data.folders.unshift({ id: DEFAULT_FOLDER, name: '默认笔记本', createdAt: nowTs() });
}

/* ---------------- 小工具 ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return hm;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return '昨天 ' + hm;
  if (d.getFullYear() === now.getFullYear()) return d.getMonth() + 1 + '月' + d.getDate() + '日';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => (el.hidden = true), 220);
  }, 2200);
}

/* ============================================================
   Markdown 渲染（轻量，无依赖）
   ============================================================ */
function inlineMd(text) {
  const codes = [];
  let s = esc(text);
  s = s.replace(/`([^`\n]+)`/g, (m, c) => {
    codes.push(c);
    return '\u0001' + (codes.length - 1) + '\u0001';
  });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|[\s>])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, (m, p, u) => p + '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[\s(（【])(#[^\s#<，。；;、）)】]+)/g, (m, p, t) => p + '<span class="tag">' + t + '</span>');
  s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => '<code>' + codes[+i] + '</code>');
  return s;
}

function md(src) {
  if (!src || !src.trim()) return '';

  const blocks = [];
  let text = String(src).replace(/\r\n?/g, '\n');
  text = text.replace(/```([a-zA-Z0-9+#-]*)[ \t]*\n?([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
    return '\n\u0000B' + (blocks.length - 1) + '\u0000\n';
  });

  const lines = text.split('\n');
  const out = [];
  let list = null;
  let para = [];
  let i = 0;

  const flushPara = () => {
    if (para.length) {
      out.push('<p>' + inlineMd(para.join('\n')).replace(/\n/g, '<br>') + '</p>');
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push('</' + list + '>');
      list = null;
    }
  };
  const openList = (t) => {
    if (list !== t) {
      closeList();
      out.push('<' + t + '>');
      list = t;
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    if (!t) {
      flushPara();
      closeList();
      i++;
      continue;
    }

    const bm = t.match(/^\u0000B(\d+)\u0000$/);
    if (bm) {
      flushPara();
      closeList();
      out.push(blocks[+bm[1]]);
      i++;
      continue;
    }

    /* 表格 */
    if (t.includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1].trim()) && /-/.test(lines[i + 1])) {
      flushPara();
      closeList();
      const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(t);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(cells(lines[i]));
        i++;
      }
      out.push(
        '<table><thead><tr>' +
          head.map((c) => '<th>' + inlineMd(c) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>'
      );
      continue;
    }

    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const lv = Math.min(h[1].length, 4);
      out.push('<h' + lv + '>' + inlineMd(h[2]) + '</h' + lv + '>');
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flushPara();
      closeList();
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^>/.test(t)) {
      flushPara();
      closeList();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + md(buf.join('\n')) + '</blockquote>');
      continue;
    }

    const task = t.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      const done = task[1].toLowerCase() === 'x';
      openList('ul');
      out.push(
        '<li class="task' + (done ? ' done' : '') + '"><input type="checkbox" disabled' + (done ? ' checked' : '') + '><span>' + inlineMd(task[2]) + '</span></li>'
      );
      i++;
      continue;
    }

    const ul = t.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      openList('ul');
      out.push('<li>' + inlineMd(ul[1]) + '</li>');
      i++;
      continue;
    }

    const ol = t.match(/^(\d+)[.)]\s+(.*)$/);
    if (ol) {
      openList('ol');
      out.push('<li>' + inlineMd(ol[2]) + '</li>');
      i++;
      continue;
    }

    closeList();
    para.push(t);
    i++;
  }

  flushPara();
  closeList();
  return out.join('');
}

/* ============================================================
   数据查询
   ============================================================ */
function activeNotes() {
  return state.data.notes.filter((n) => !n.deletedAt);
}

function tagsOf(note) {
  const out = [];
  const re = /(^|[\s(（【])#([^\s#，。；;、）)】]+)/g;
  let m;
  const src = (note.title || '') + '\n' + (note.content || '');
  while ((m = re.exec(src))) {
    const t = m[2].replace(/[.,;:!?]+$/, '');
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function getNote(id) {
  return state.data.notes.find((n) => n.id === id) || null;
}

function currentNote() {
  return getNote(state.ui.activeId);
}

function sortedFiltered() {
  const v = state.ui.view;
  let arr = state.data.notes.slice();

  if (v.type === 'trash') {
    arr = arr.filter((n) => n.deletedAt).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  } else {
    arr = arr.filter((n) => !n.deletedAt);
    if (v.type === 'folder') arr = arr.filter((n) => (n.folderId || DEFAULT_FOLDER) === v.value);
    if (v.type === 'tag') arr = arr.filter((n) => tagsOf(n).includes(v.value));

    const sort = state.ui.sort;
    arr.sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      if (sort === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
      if (sort === 'title') return (a.title || '无标题笔记').localeCompare(b.title || '无标题笔记', 'zh');
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  const q = state.ui.q.trim().toLowerCase();
  if (q) {
    arr = arr.filter((n) => {
      const hay = ((n.title || '') + '\n' + (n.content || '') + '\n' + tagsOf(n).join(' ')).toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
  }
  return arr;
}

/* ============================================================
   渲染
   ============================================================ */
function renderRail() {
  const v = state.ui.view;
  const live = activeNotes();

  const rows = [];
  rows.push(
    `<li class="nav-item ${v.type === 'all' ? 'active' : ''}" data-nav="all">
       <svg class="ic"><use href="#i-note"/></svg>
       <span class="nav-name">全部笔记</span>
       <span class="nav-count">${live.length}</span>
     </li>`
  );

  state.data.folders.forEach((f) => {
    const count = live.filter((n) => (n.folderId || DEFAULT_FOLDER) === f.id).length;
    const active = v.type === 'folder' && v.value === f.id;
    rows.push(
      `<li class="nav-item ${active ? 'active' : ''}" data-nav="folder" data-id="${f.id}">
         <svg class="ic"><use href="#i-folder"/></svg>
         <span class="nav-name" data-rename="${f.id}" title="双击重命名">${esc(f.name)}</span>
         <span class="nav-count">${count}</span>
         ${f.id === DEFAULT_FOLDER ? '' : `<button class="nav-del" data-del-folder="${f.id}" title="删除笔记本"><svg class="ic" style="width:12px;height:12px"><use href="#i-x"/></svg></button>`}
       </li>`
    );
  });

  const trashCount = state.data.notes.filter((n) => n.deletedAt).length;
  rows.push(
    `<li class="nav-item ${v.type === 'trash' ? 'active' : ''}" data-nav="trash">
       <svg class="ic"><use href="#i-trash"/></svg>
       <span class="nav-name">回收站</span>
       <span class="nav-count">${trashCount}</span>
     </li>`
  );

  $('#navFolders').innerHTML = rows.join('');

  const counts = new Map();
  live.forEach((n) => tagsOf(n).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  const tags = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 24);

  $('#navTags').innerHTML = tags.length
    ? tags
        .map(
          ([t, c]) =>
            `<button class="tag-chip ${v.type === 'tag' && v.value === t ? 'active' : ''}" data-tag="${esc(t)}">#${esc(t)}<span style="opacity:.55;margin-left:4px">${c}</span></button>`
        )
        .join('')
    : '<div class="empty-tip">写 #标签 就会出现在这里</div>';
}

function excerptOf(note, n = 96) {
  const s = (note.content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function renderList() {
  const list = sortedFiltered();
  const box = $('#noteList');
  const v = state.ui.view;

  const titleMap = { all: '全部笔记', trash: '回收站' };
  let title = titleMap[v.type] || '';
  if (v.type === 'folder') {
    const f = state.data.folders.find((x) => x.id === v.value);
    title = f ? f.name : '笔记本';
  }
  if (v.type === 'tag') title = '#' + v.value;
  if (state.ui.q.trim()) title = '搜索：' + state.ui.q.trim();
  $('#listTitle').textContent = title;

  $('#sortLabel').textContent = state.ui.sort === 'created' ? '创建时间' : state.ui.sort === 'title' ? '标题' : '最近修改';

  if (!list.length) {
    const tips = {
      all: '还没有笔记。<br>按 Ctrl + N 开始记录第一篇。',
      trash: '回收站是空的。',
      tag: '这个标签下还没有笔记。',
      folder: '这个笔记本是空的。',
    };
    box.innerHTML = '<div class="blank">' + (state.ui.q.trim() ? '没有匹配的笔记。' : tips[v.type] || '暂无内容') + '</div>';
  } else {
    box.innerHTML = list
      .map((n) => {
        const tags = tagsOf(n).slice(0, 2);
        return `<article class="card ${n.id === state.ui.activeId ? 'active' : ''}" data-id="${n.id}">
          <div class="card-top">
            <h3>${esc(n.title || '无标题笔记')}</h3>
            ${n.pinned ? '<svg class="ic pin-ic"><use href="#i-pin"/></svg>' : ''}
          </div>
          <p class="card-ex">${esc(excerptOf(n)) || '<span style="color:var(--text-3)">空笔记</span>'}</p>
          <div class="card-foot">
            <span class="time">${v.type === 'trash' ? '删除于 ' + fmtTime(n.deletedAt) : fmtTime(n.updatedAt)}</span>
            ${tags.map((t) => `<span class="mini-tag">#${esc(t)}</span>`).join('')}
          </div>
          ${
            v.type === 'trash'
              ? `<div class="card-actions"><button data-restore="${n.id}">恢复</button><button class="danger" data-purge="${n.id}">彻底删除</button></div>`
              : ''
          }
        </article>`;
      })
      .join('');
  }

  const total = activeNotes().length;
  $('#listCount').textContent = state.ui.q.trim() ? `找到 ${list.length} 篇` : `共 ${total} 篇笔记`;
}

function renderFolderSelect() {
  const sel = $('#noteFolder');
  sel.innerHTML = state.data.folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
}

let previewTimer;
function renderPreview() {
  const note = currentNote();
  $('#preview').innerHTML = note ? md(note.content) : '';
}

function applyMode() {
  const mode = state.ui.mode;
  document.body.classList.toggle('split', mode === 'split');
  document.body.classList.toggle('preview-only', mode === 'read');
  const btn = $('#btnPreview');
  btn.title = mode === 'split' ? '预览：分栏（点击切换为纯预览）' : mode === 'read' ? '预览：只看渲染结果（点击切换为编辑）' : '预览：编辑（点击切换为分栏）';
  btn.classList.toggle('active', mode !== 'edit');
  if (mode !== 'edit') renderPreview();
}

function renderEditor() {
  const note = currentNote();
  const empty = $('#editorEmpty');
  const hasNote = !!note;

  empty.classList.toggle('show', !hasNote);
  $('#noteTitle').disabled = !hasNote;
  $('#noteContent').disabled = !hasNote;
  ['#btnPin', '#btnDel', '#noteFolder'].forEach((s) => ($(s).disabled = !hasNote));

  if (!hasNote) {
    $('#noteTitle').value = '';
    $('#noteContent').value = '';
    $('#preview').innerHTML = '';
    $('#metaWords').textContent = '0 字';
    $('#metaSaved').textContent = '';
    $('#btnRestore').classList.add('hidden');
    $('#btnPurge').classList.add('hidden');
    return;
  }

  $('#noteTitle').value = note.title || '';
  $('#noteContent').value = note.content || '';
  $('#noteFolder').value = note.folderId || DEFAULT_FOLDER;
  $('#btnPin').classList.toggle('active', !!note.pinned);
  $('#btnDel').classList.toggle('hidden', !!note.deletedAt);
  $('#btnRestore').classList.toggle('hidden', !note.deletedAt);
  $('#btnPurge').classList.toggle('hidden', !note.deletedAt);

  const readOnly = !!note.deletedAt;
  $('#noteTitle').readOnly = readOnly;
  $('#noteContent').readOnly = readOnly;

  updateMeta();
  if (state.ui.mode !== 'edit') renderPreview();
}

function updateMeta() {
  const note = currentNote();
  if (!note) return;
  const chars = (note.content || '').replace(/\s/g, '').length;
  $('#metaWords').textContent = chars + ' 字';
  $('#metaSaved').textContent = '已保存 · ' + fmtTime(note.updatedAt);
}

function renderAll() {
  renderRail();
  renderList();
  renderFolderSelect();
  renderEditor();
}

/* ============================================================
   笔记操作
   ============================================================ */
function newNote() {
  const v = state.ui.view;
  const note = {
    id: uid(),
    title: '',
    content: '',
    folderId: v.type === 'folder' ? v.value : DEFAULT_FOLDER,
    pinned: false,
    createdAt: nowTs(),
    updatedAt: nowTs(),
    deletedAt: null,
  };
  state.data.notes.push(note);
  state.ui.activeId = note.id;
  if (v.type === 'trash') state.ui.view = { type: 'all', value: null };
  saveData();
  saveUi();
  renderAll();
  $('#noteTitle').focus();
  document.body.classList.add('editing');
  scheduleSync();
}

function openNote(id, { focusTitle = false } = {}) {
  if (!getNote(id)) return;
  state.ui.activeId = id;
  saveUi();
  renderList();
  renderEditor();
  document.body.classList.add('editing');
  if (focusTitle) $('#noteTitle').focus();
}

function closeEditor() {
  document.body.classList.remove('editing');
}

function touchNote(note) {
  note.updatedAt = nowTs();
  saveData();
  scheduleSync();
}

function deleteNote(id) {
  const note = getNote(id);
  if (!note || note.deletedAt) return;
  note.deletedAt = nowTs();
  note.updatedAt = note.deletedAt;
  note.pinned = false;
  saveData();
  if (state.ui.activeId === id) {
    state.ui.activeId = null;
    if (window.innerWidth <= 820) closeEditor();
  }
  saveUi();
  renderAll();
  scheduleSync();
  toast('已移入回收站');
}

function restoreNote(id) {
  const note = getNote(id);
  if (!note) return;
  note.deletedAt = null;
  note.updatedAt = nowTs();
  saveData();
  renderAll();
  scheduleSync();
  toast('已恢复');
}

function purgeNote(id) {
  const note = getNote(id);
  if (!note) return;
  if (!confirm('彻底删除后无法恢复，确定吗？\n\n「' + (note.title || '无标题笔记') + '」')) return;
  state.data.deleted[id] = nowTs();
  state.data.notes = state.data.notes.filter((n) => n.id !== id);
  if (state.ui.activeId === id) state.ui.activeId = null;
  saveData();
  saveUi();
  renderAll();
  scheduleSync();
  toast('已彻底删除');
}

function togglePin() {
  const note = currentNote();
  if (!note) return;
  note.pinned = !note.pinned;
  touchNote(note);
  renderList();
  renderEditor();
}

/* ============================================================
   同步 · GitHub Gist
   ============================================================ */
let syncBusy = false;
let syncTimer;

function scheduleSync() {
  if (!state.sync.auto || !state.sync.token) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow({ silent: true }), 6000);
}

function setSyncDot(cls, label) {
  const dot = $('#syncDot');
  dot.className = 'sync-dot ' + (cls || '');
  if (label) $('#syncLabel').textContent = label;
}

function syncStatusIdle() {
  if (!state.sync.token) {
    $('#syncDot').className = 'sync-dot';
    $('#syncLabel').textContent = '未开启同步';
    return;
  }
  $('#syncDot').className = 'sync-dot on';
  $('#syncLabel').textContent = state.sync.lastAt ? '已同步 ' + fmtTime(state.sync.lastAt) : '已连接，待同步';
  $('#metaSync').textContent = state.sync.lastAt ? '☁ ' + fmtTime(state.sync.lastAt) : '';
}

async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: Object.assign(
      {
        Authorization: 'Bearer ' + state.sync.token,
        Accept: 'application/vnd.github+json',
      },
      opts.body ? { 'Content-Type': 'application/json' } : {},
      opts.headers || {}
    ),
  });
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try {
      const j = await res.json();
      if (j && j.message) msg = j.message;
    } catch (e) {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function friendlyError(e) {
  if (e.status === 401) return 'Token 无效或已过期，请重新生成';
  if (e.status === 403) return '权限不足或被限流，请检查 Token 的 gist 权限';
  if (e.status === 404) return '找不到该 Gist，请检查 Gist ID 或权限';
  if (e instanceof TypeError || /Failed to fetch|NetworkError/.test(e.message || '')) return '网络请求失败（检查网络或代理）';
  return e.message || String(e);
}

function payload() {
  return {
    app: 'suiji',
    version: 1,
    updatedAt: nowTs(),
    notes: state.data.notes,
    folders: state.data.folders,
    deleted: state.data.deleted,
  };
}

function mergeData(a, b) {
  a = a || {};
  b = b || {};
  const map = new Map();
  const put = (n) => {
    if (!n || !n.id) return;
    const cur = map.get(n.id);
    if (!cur || (n.updatedAt || 0) > (cur.updatedAt || 0)) map.set(n.id, n);
  };
  (a.notes || []).forEach(put);
  (b.notes || []).forEach(put);

  const deleted = {};
  [a.deleted || {}, b.deleted || {}].forEach((src) => {
    Object.keys(src).forEach((k) => {
      deleted[k] = Math.max(deleted[k] || 0, src[k] || 0);
    });
  });

  const notes = Array.from(map.values()).filter((n) => !(deleted[n.id] && deleted[n.id] >= (n.updatedAt || 0)));

  const folders = [];
  const seen = new Set();
  [...(a.folders || []), ...(b.folders || [])].forEach((f) => {
    if (!f || !f.id || seen.has(f.id)) return;
    seen.add(f.id);
    folders.push(f);
  });

  return { notes, folders, deleted };
}

async function pullRemote() {
  if (!state.sync.gistId) return null;
  const gist = await gh('/gists/' + state.sync.gistId);
  const file = (gist.files && (gist.files[GIST_FILE] || gist.files[Object.keys(gist.files)[0]])) || null;
  if (!file) return null;
  let content = file.content;
  if (file.truncated && file.raw_url) {
    const r = await fetch(file.raw_url, { headers: { Authorization: 'Bearer ' + state.sync.token } });
    content = await r.text();
  }
  try {
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

async function pushRemote() {
  const body = JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(payload(), null, 2) } } });
  if (state.sync.gistId) {
    await gh('/gists/' + state.sync.gistId, { method: 'PATCH', body });
  } else {
    const created = await gh('/gists', {
      method: 'POST',
      body: JSON.stringify({
        description: '随记 · 文本笔记同步数据（private）',
        public: false,
        files: { [GIST_FILE]: { content: JSON.stringify(payload(), null, 2) } },
      }),
    });
    state.sync.gistId = created.id;
    saveSync();
  }
}

async function syncNow({ silent = false, direction = 'both' } = {}) {
  if (!state.sync.token) {
    if (!silent) openSync();
    return;
  }
  if (syncBusy) return;
  syncBusy = true;
  setSyncDot('busy', '同步中…');
  const msg = $('#syncMsg');
  if (!silent && msg) msg.textContent = '正在同步…';

  try {
    if (direction === 'push') {
      await pushRemote();
    } else {
      const remote = await pullRemote();
      if (remote && (remote.notes || remote.folders)) {
        const merged = mergeData(state.data, remote);
        state.data.notes = merged.notes;
        state.data.folders = merged.folders;
        state.data.deleted = merged.deleted;
        saveData();
      }
      if (direction === 'both') await pushRemote();
    }

    state.sync.lastAt = nowTs();
    saveSync();
    syncBusy = false;
    syncStatusIdle();
    renderAll();
    if (state.ui.activeId) renderEditor();
    if (!silent && msg) {
      msg.className = 'sync-msg ok';
      msg.textContent = '✓ 同步完成 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }
    if (!silent) toast('同步完成');
  } catch (e) {
    syncBusy = false;
    console.warn(e);
    const m = friendlyError(e);
    setSyncDot('err', '同步失败');
    if (msg) {
      msg.className = 'sync-msg err';
      msg.textContent = '✗ ' + m;
    }
    if (!silent) toast('同步失败：' + m);
    setTimeout(() => {
      if (!syncBusy) syncStatusIdle();
    }, 4000);
  }
}

/* ============================================================
   主题
   ============================================================ */
const mqDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const t = state.ui.theme;
  const dark = t === 'dark' || (t === 'auto' && mqDark.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#14161a' : '#f1f0ec');
}
mqDark.addEventListener('change', () => {
  if (state.ui.theme === 'auto') applyTheme();
});

/* ============================================================
   导出 / 导入
   ============================================================ */
function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

function stamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

function exportJson() {
  download('suiji-backup-' + stamp() + '.json', JSON.stringify(payload(), null, 2), 'application/json');
  toast('已导出 JSON 备份');
}

function exportMarkdown() {
  const notes = activeNotes().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const mdText = notes
    .map((n) => {
      const folder = state.data.folders.find((f) => f.id === (n.folderId || DEFAULT_FOLDER));
      const tags = tagsOf(n);
      const meta = [folder ? folder.name : '', tags.map((t) => '#' + t).join(' ')].filter(Boolean).join(' · ');
      return (
        '# ' + (n.title || '无标题笔记') + '\n\n' +
        (meta ? '> ' + meta + '\n\n' : '') +
        (n.content || '') + '\n\n---\n'
      );
    })
    .join('\n');
  download('suiji-notes-' + stamp() + '.md', mdText || '# 空\n', 'text/markdown;charset=utf-8');
  toast('已导出 ' + notes.length + ' 篇 Markdown');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (!data || !Array.isArray(data.notes)) throw new Error('格式不正确');
      const merged = mergeData(state.data, data);
      state.data.notes = merged.notes;
      state.data.folders = merged.folders;
      state.data.deleted = merged.deleted;
      saveData();
      renderAll();
      scheduleSync();
      toast('已导入并合并 ' + data.notes.length + ' 篇笔记');
    } catch (e) {
      toast('导入失败：' + e.message);
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   弹窗
   ============================================================ */
function openModal(sel) {
  $(sel).hidden = false;
}
function closeModals() {
  $$('.modal').forEach((m) => (m.hidden = true));
}

function openSync() {
  $('#inToken').value = state.sync.token || '';
  $('#inGist').value = state.sync.gistId || '';
  $('#inAuto').checked = !!state.sync.auto;
  const msg = $('#syncMsg');
  msg.className = 'sync-msg';
  msg.textContent = state.sync.token
    ? state.sync.lastAt
      ? '上次同步：' + new Date(state.sync.lastAt).toLocaleString('zh-CN', { hour12: false })
      : '已填写 Token，点"立即同步"开始'
    : '';
  openModal('#modalSync');
}

/* ============================================================
   事件绑定
   ============================================================ */
function bind() {
  /* 侧栏 */
  $('#navFolders').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-folder]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.delFolder;
      const f = state.data.folders.find((x) => x.id === id);
      if (!f) return;
      if (!confirm('删除笔记本「' + f.name + '」？里面的笔记会移到默认笔记本。')) return;
      state.data.notes.forEach((n) => {
        if ((n.folderId || DEFAULT_FOLDER) === id) n.folderId = DEFAULT_FOLDER;
      });
      state.data.folders = state.data.folders.filter((x) => x.id !== id);
      if (state.ui.view.type === 'folder' && state.ui.view.value === id) state.ui.view = { type: 'all', value: null };
      saveData();
      saveUi();
      renderAll();
      scheduleSync();
      return;
    }

    const item = e.target.closest('[data-nav]');
    if (!item) return;
    const type = item.dataset.nav;
    state.ui.view = type === 'all' || type === 'trash' ? { type, value: null } : { type, value: item.dataset.id };
    saveUi();
    renderRail();
    renderList();
    document.body.classList.remove('nav-open');
    toggleScrim();
  });

  $('#navFolders').addEventListener('dblclick', (e) => {
    const span = e.target.closest('[data-rename]');
    if (!span) return;
    e.preventDefault();
    e.stopPropagation();
    startRename(span);
  });

  $('#navTags').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tag]');
    if (!btn) return;
    const tag = btn.dataset.tag;
    state.ui.view =
      state.ui.view.type === 'tag' && state.ui.view.value === tag ? { type: 'all', value: null } : { type: 'tag', value: tag };
    saveUi();
    renderRail();
    renderList();
  });

  $('#btnAddFolder').addEventListener('click', () => {
    const ul = $('#navFolders');
    if ($('#folderInput')) return;
    const li = document.createElement('li');
    li.className = 'nav-item';
    li.innerHTML = '<input class="folder-input" placeholder="笔记本名称，回车确认">';
    ul.insertBefore(li, ul.children[1] || null);
    const input = $('.folder-input', li);
    input.focus();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      li.remove();
      if (!name) return;
      const f = { id: uid(), name, createdAt: nowTs() };
      state.data.folders.push(f);
      state.ui.view = { type: 'folder', value: f.id };
      saveData();
      saveUi();
      renderAll();
      scheduleSync();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') commit();
      if (ev.key === 'Escape') {
        done = true;
        li.remove();
      }
    });
    input.addEventListener('blur', commit);
  });

  function startRename(span) {
    const id = span.dataset.rename;
    const f = state.data.folders.find((x) => x.id === id);
    if (!f) return;
    const input = document.createElement('input');
    input.className = 'folder-input';
    input.value = f.name;
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (name) f.name = name;
      saveData();
      renderAll();
      scheduleSync();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') commit();
      if (ev.key === 'Escape') {
        done = true;
        renderRail();
      }
    });
    input.addEventListener('blur', commit);
  }

  /* 列表 */
  $('#noteList').addEventListener('click', (e) => {
    const restore = e.target.closest('[data-restore]');
    if (restore) {
      e.stopPropagation();
      restoreNote(restore.dataset.restore);
      return;
    }
    const purge = e.target.closest('[data-purge]');
    if (purge) {
      e.stopPropagation();
      purgeNote(purge.dataset.purge);
      return;
    }
    const card = e.target.closest('.card');
    if (card) openNote(card.dataset.id);
  });

  $('#search').addEventListener('input', (e) => {
    state.ui.q = e.target.value;
    renderList();
  });

  $('#btnSort').addEventListener('click', () => {
    const order = ['updated', 'created', 'title'];
    state.ui.sort = order[(order.indexOf(state.ui.sort) + 1) % order.length];
    saveUi();
    renderList();
  });

  /* 工具栏 */
  $('#btnNew').addEventListener('click', newNote);
  $('#btnNewCenter').addEventListener('click', newNote);
  $('#btnMenu').addEventListener('click', () => {
    document.body.classList.add('nav-open');
    toggleScrim();
  });
  $('#btnRailClose').addEventListener('click', () => {
    document.body.classList.remove('nav-open');
    toggleScrim();
  });
  $('#btnBack').addEventListener('click', closeEditor);

  $('#btnTheme').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    state.ui.theme = order[(order.indexOf(state.ui.theme) + 1) % order.length];
    saveUi();
    applyTheme();
    toast(state.ui.theme === 'auto' ? '主题：跟随系统' : state.ui.theme === 'light' ? '主题：浅色' : '主题：深色');
  });

  /* 编辑器 */
  let typing;
  const onEdit = () => {
    const note = currentNote();
    if (!note || note.deletedAt) return;
    note.title = $('#noteTitle').value;
    note.content = $('#noteContent').value;
    note.updatedAt = nowTs();
    saveData();
    $('#metaSaved').textContent = '编辑中…';
    clearTimeout(typing);
    typing = setTimeout(() => {
      updateMeta();
      patchCard(note);
      renderRail();
      if (state.ui.mode !== 'edit') renderPreview();
    }, 350);
    scheduleSync();
  };

  $('#noteTitle').addEventListener('input', onEdit);
  $('#noteContent').addEventListener('input', onEdit);

  $('#noteContent').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target;
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 2;
      onEdit();
    }
  });

  $('#noteFolder').addEventListener('change', (e) => {
    const note = currentNote();
    if (!note) return;
    note.folderId = e.target.value;
    touchNote(note);
    renderRail();
    renderList();
  });

  $('#btnPin').addEventListener('click', togglePin);
  $('#btnDel').addEventListener('click', () => {
    const note = currentNote();
    if (note) deleteNote(note.id);
  });
  $('#btnRestore').addEventListener('click', () => {
    const note = currentNote();
    if (note) restoreNote(note.id);
  });
  $('#btnPurge').addEventListener('click', () => {
    const note = currentNote();
    if (note) purgeNote(note.id);
  });

  $('#btnPreview').addEventListener('click', () => {
    const order = ['split', 'read', 'edit'];
    state.ui.mode = order[(order.indexOf(state.ui.mode) + 1) % order.length];
    saveUi();
    applyMode();
  });

  /* 同步 */
  $('#btnSync').addEventListener('click', openSync);
  $('#btnDoSync').addEventListener('click', async () => {
    state.sync.token = $('#inToken').value.trim();
    state.sync.gistId = $('#inGist').value.trim();
    state.sync.auto = $('#inAuto').checked;
    saveSync();
    if (!state.sync.token) {
      const msg = $('#syncMsg');
      msg.className = 'sync-msg err';
      msg.textContent = '请先填写 Token';
      return;
    }
    await syncNow({ silent: false });
    $('#inGist').value = state.sync.gistId || '';
    syncStatusIdle();
  });
  $('#btnPull').addEventListener('click', async () => {
    state.sync.token = $('#inToken').value.trim();
    state.sync.gistId = $('#inGist').value.trim();
    state.sync.auto = $('#inAuto').checked;
    saveSync();
    await syncNow({ silent: false, direction: 'pull' });
    $('#inGist').value = state.sync.gistId || '';
  });
  $('#btnPush').addEventListener('click', async () => {
    state.sync.token = $('#inToken').value.trim();
    state.sync.gistId = $('#inGist').value.trim();
    state.sync.auto = $('#inAuto').checked;
    saveSync();
    await syncNow({ silent: false, direction: 'push' });
    $('#inGist').value = state.sync.gistId || '';
  });
  $('#inAuto').addEventListener('change', () => {
    state.sync.auto = $('#inAuto').checked;
    saveSync();
  });

  /* 导出 */
  $('#btnExport').addEventListener('click', () => openModal('#modalExport'));
  $$('[data-export]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const kind = btn.dataset.export;
      if (kind === 'json') exportJson();
      if (kind === 'md') exportMarkdown();
      if (kind === 'import') $('#fileImport').click();
      closeModals();
    })
  );
  $('#fileImport').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importJson(f);
    e.target.value = '';
  });

  /* 弹窗关闭 */
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
  $$('.modal').forEach((m) =>
    m.addEventListener('click', (e) => {
      if (e.target === m) closeModals();
    })
  );

  $('#scrim').addEventListener('click', () => {
    document.body.classList.remove('nav-open');
    closeEditor();
    toggleScrim();
  });

  /* 快捷键 */
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newNote();
    } else if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#search').focus();
      $('#search').select();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      const note = currentNote();
      if (note) touchNote(note);
      if (state.sync.token) syncNow({ silent: false });
      else toast('已保存到本地');
    } else if (e.key === 'Escape') {
      if ($$('.modal').some((m) => !m.hidden)) closeModals();
      else {
        document.body.classList.remove('nav-open');
        if (window.innerWidth <= 820) closeEditor();
        toggleScrim();
      }
    }
  });

  /* 窗口尺寸 / 首次打开同步 */
  window.addEventListener('resize', toggleScrim);
  window.addEventListener('focus', () => {
    if (state.sync.auto && state.sync.token && Date.now() - state.sync.lastAt > 60000) syncNow({ silent: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.sync.auto && state.sync.token && Date.now() - state.sync.lastAt > 60000) {
      syncNow({ silent: true });
    }
  });
}

function patchCard(note) {
  const el = $(`.card[data-id="${note.id}"]`);
  if (!el) return;
  const h = el.querySelector('h3');
  const ex = el.querySelector('.card-ex');
  const time = el.querySelector('.time');
  if (h) h.textContent = note.title || '无标题笔记';
  if (ex) ex.textContent = excerptOf(note) || '空笔记';
  if (time) time.textContent = fmtTime(note.updatedAt);
}

function toggleScrim() {
  const need = document.body.classList.contains('nav-open') || (window.innerWidth <= 820 && document.body.classList.contains('editing'));
  $('#scrim').hidden = !need;
}

/* ============================================================
   启动
   ============================================================ */
function seed() {
  if (read('suiji.seeded', false)) return;
  write('suiji.seeded', true);
  if (state.data.notes.length) return;

  const welcome = {
    id: uid(),
    title: '欢迎使用随记',
    folderId: DEFAULT_FOLDER,
    pinned: true,
    createdAt: nowTs(),
    updatedAt: nowTs(),
    deletedAt: null,
    content: `这是你的第一篇笔记，可以直接改写或删掉。

## 能做什么

- 左侧是**笔记本**，可以新建、双击名字重命名
- 正文支持 Markdown，右边会实时预览
- 用 \`#标签\` 给笔记打标签，标签会自动出现在侧栏
- 内容自动保存，换设备只要打开同一个网址就能接着写

## 常用写法

1. **粗体**、*斜体*、~~删除线~~、\`行内代码\`
2. 待办清单：

   - [x] 打开这个页面
   - [ ] 点左下角"未开启同步"，配置 GitHub Token
   - [ ] 在手机上打开同一个网址，验证数据同步

\`\`\`js
// 代码块也支持
const note = { title: '井位记录', depth: 3120 };
\`\`\`

> 引用：好的记录习惯，比好的工具更重要。

| 项目 | 说明 |
| --- | --- |
| 存储 | 本机浏览器 + 你的私密 Gist |
| 同步 | 编辑后 6 秒自动同步 |

---
快捷键：\`Ctrl+N\` 新建 · \`Ctrl+K\` 搜索 · \`Ctrl+S\` 保存并同步`,
  };

  state.data.notes.push(welcome);
  state.ui.activeId = welcome.id;
  saveData();
  saveUi();
}

function init() {
  applyTheme();
  if (window.innerWidth <= 820 && state.ui.mode === 'split') state.ui.mode = 'edit';
  seed();
  bind();
  renderAll();
  applyMode();
  syncStatusIdle();

  if (state.sync.auto && state.sync.token) {
    setTimeout(() => syncNow({ silent: true }), 800);
  }

  if (state.ui.activeId && getNote(state.ui.activeId) && window.innerWidth > 820) {
    document.body.classList.add('editing');
  }
  toggleScrim();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();


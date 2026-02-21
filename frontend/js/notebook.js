/* ══════════════════════════════════════════
   notebook.js  —  notebook editor logic
   ══════════════════════════════════════════ */

let notebooks   = [];
let activeNbId  = null;
let nbSaveTimer = null;

function genImgName(type) {
  const ext = (type || 'image/png').split('/')[1] || 'png';
  return 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5) + '.' + ext;
}

// ── List ──────────────────────────────────────────────────────────────────────
async function loadNotebooks() {
  try {
    notebooks = await apiGetNotebooks();
    renderNbList();
  } catch (e) { toast('Failed to load notebooks: ' + e.message); }
}

function renderNbList() {
  const list = document.getElementById('nb-tl');
  list.innerHTML = '';
  notebooks.forEach(nb => {
    const el = document.createElement('div');
    el.className = 'nb-tab' + (nb.id === activeNbId ? ' active' : '');
    el.innerHTML =
      `<span style="font-size:11px">&#x1F4D3;</span>` +
      `<span class="tn">${esc(nb.title)}</span>` +
      `<button class="td" onclick="delNb(event,'${nb.id}')">&#xD7;</button>`;
    el.addEventListener('click', () => selectNb(nb.id));
    list.appendChild(el);
  });
}

async function newNotebook() {
  const name = prompt('Notebook name:');
  if (!name || !name.trim()) return;
  try {
    const nb = await apiCreateNotebook(name.trim());
    notebooks.push(nb);
    renderNbList();
    await selectNb(nb.id);
  } catch (e) { toast('Error: ' + e.message); }
}

async function selectNb(id) {
  if (activeNbId && activeNbId !== id) await saveCurrentNb();
  activeNbId = id;
  const nb = notebooks.find(n => n.id === id);
  if (!nb) return;

  document.getElementById('nb-inner').style.display  = 'flex';
  document.getElementById('nb-empty').style.display  = 'none';
  document.getElementById('nb-title').value          = nb.title;
  renderNbList();

  try {
    const { html } = await apiGetContent(id);
    const editor = document.getElementById('nb-editor');
    editor.innerHTML = html || '';
    // Restore images: replace stored relative path with API URL + token
    editor.querySelectorAll('img[data-iname]').forEach(img => {
      img.src = apiImageUrl(id, img.dataset.iname);
      wrapImg(img);
    });
  } catch (e) { toast('Failed to load notebook: ' + e.message); }
}

async function saveCurrentNb() {
  if (!activeNbId) return;
  try {
    const editor = document.getElementById('nb-editor');
    const clone  = editor.cloneNode(true);
    // Strip live API URLs — store only the filename reference
    clone.querySelectorAll('img[data-iname]').forEach(img => {
      img.src = 'images/' + img.dataset.iname;
    });
    await apiSaveContent(activeNbId, clone.innerHTML);
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('ss').textContent = 'saved ' + t;
  } catch (e) { console.error('Save failed', e); }
}

function onTitleChange() {
  if (!activeNbId) return;
  const nb    = notebooks.find(n => n.id === activeNbId);
  const title = document.getElementById('nb-title').value || 'Untitled';
  if (nb) nb.title = title;
  renderNbList();
  clearTimeout(nbSaveTimer);
  nbSaveTimer = setTimeout(async () => {
    try { await apiUpdateNotebook(activeNbId, title); } catch {}
    await saveCurrentNb();
  }, 1200);
}

async function delNb(e, id) {
  e.stopPropagation();
  if (!confirm('Delete this notebook? This cannot be undone.')) return;
  try {
    await apiDeleteNotebook(id);
    notebooks = notebooks.filter(n => n.id !== id);
    if (activeNbId === id) {
      activeNbId = null;
      document.getElementById('nb-inner').style.display = 'none';
      document.getElementById('nb-empty').style.display = 'flex';
      document.getElementById('nb-editor').innerHTML    = '';
    }
    renderNbList();
  } catch (e) { toast('Error: ' + e.message); }
}

function ec(cmd, val) {
  document.getElementById('nb-editor').focus();
  document.execCommand(cmd, false, val || null);
  schedNbSave();
}

function schedNbSave() {
  clearTimeout(nbSaveTimer);
  nbSaveTimer = setTimeout(saveCurrentNb, 1500);
}

// ── Images ────────────────────────────────────────────────────────────────────
async function insertImageBlob(blob, type) {
  if (!activeNbId) { toast('Select a notebook first.'); return; }
  try {
    const name = genImgName(type);
    const b64  = await blobToBase64(blob);
    await apiUploadImage(activeNbId, name, b64.split(',')[1]);

    const img       = document.createElement('img');
    img.src         = apiImageUrl(activeNbId, name);
    img.dataset.iname = name;
    img.style.width = '300px';
    img.draggable   = false;

    const editor = document.getElementById('nb-editor');
    editor.focus();
    const wrap = wrapImg(img);
    const sel  = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        range.collapse(false); range.insertNode(wrap);
        range.setStartAfter(wrap); sel.removeAllRanges(); sel.addRange(range);
      } else { editor.appendChild(wrap); }
    } else { editor.appendChild(wrap); }
    schedNbSave();
  } catch (e) { toast('Image upload failed: ' + e.message); }
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error('Read failed'));
    r.readAsDataURL(blob);
  });
}

function onImgFileInput(e) {
  const f = e.target.files[0]; if (!f) return;
  insertImageBlob(f, f.type);
  e.target.value = '';
}

// ── Image Wrapper ─────────────────────────────────────────────────────────────
function wrapImg(img) {
  if (img.parentElement && img.parentElement.classList.contains('iw')) return img.parentElement;
  const wrap = document.createElement('span');
  wrap.className      = 'iw';
  wrap.contentEditable = 'false';

  const tb = document.createElement('span'); tb.className = 'itb';
  tb.innerHTML =
    `<button class="itb-b" data-a="dup">Dup</button>` +
    `<button class="itb-b" data-a="crop">Crop</button>` +
    `<button class="itb-b" data-a="del">Del</button>`;
  wrap.appendChild(tb);
  wrap.appendChild(img);

  ['nw','ne','sw','se'].forEach(p => {
    const h = document.createElement('span'); h.className = 'rh ' + p; wrap.appendChild(h);
    h.addEventListener('mousedown', e => startResize(e, wrap, img, p));
  });

  wrap.addEventListener('mousedown', e => {
    if (e.target.classList.contains('itb-b') || e.target.classList.contains('rh')) return;
    e.stopPropagation(); selImg(wrap);
  });
  tb.addEventListener('mousedown', e => e.stopPropagation());
  tb.addEventListener('click', e => {
    const btn = e.target.closest('[data-a]'); if (!btn) return;
    const a = btn.dataset.a;
    if (a === 'dup')  dupImg(img);
    if (a === 'crop') cropImg(wrap, img);
    if (a === 'del')  delImg(wrap, img);
  });

  setupDrag(wrap);
  return wrap;
}

let selWrap = null;
function selImg(w) {
  if (selWrap && selWrap !== w) selWrap.classList.remove('sel');
  selWrap = w; w.classList.add('sel');
}
document.addEventListener('mousedown', e => {
  if (selWrap && !selWrap.contains(e.target)) { selWrap.classList.remove('sel'); selWrap = null; }
});

function startResize(e, wrap, img, corner) {
  e.preventDefault(); e.stopPropagation(); selImg(wrap);
  const sx = e.clientX, sw = img.offsetWidth, sh = img.offsetHeight, asp = sw / sh;
  const onMove = ev => {
    const dx = ev.clientX - sx;
    const nw = Math.max(60, corner === 'se' || corner === 'ne' ? sw + dx : sw - dx);
    img.style.width = nw + 'px'; img.style.height = (nw / asp) + 'px';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    schedNbSave();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function setupDrag(wrap) {
  let drag = false, ox = 0, oy = 0, ghost = null;
  wrap.addEventListener('mousedown', e => {
    if (e.target.classList.contains('rh') || e.target.classList.contains('itb-b')) return;
    if (e.button !== 0 || !wrap.classList.contains('sel')) return;
    e.preventDefault(); drag = true;
    ox = e.clientX - wrap.getBoundingClientRect().left;
    oy = e.clientY - wrap.getBoundingClientRect().top;
    ghost = wrap.cloneNode(true);
    ghost.style.cssText = `position:fixed;opacity:.4;pointer-events:none;z-index:1000;width:${wrap.offsetWidth}px`;
    document.body.appendChild(ghost);
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    ghost.style.left = (e.clientX - ox) + 'px';
    ghost.style.top  = (e.clientY - oy) + 'px';
  });
  document.addEventListener('mouseup', e => {
    if (!drag) return; drag = false; ghost.remove(); ghost = null;
    const ed = document.getElementById('nb-editor');
    const r  = caretAt(e.clientX, e.clientY, ed);
    if (r) { wrap.remove(); r.insertNode(wrap); }
    schedNbSave();
  });
}

function caretAt(x, y, ed) {
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r && ed.contains(r.commonAncestorContainer)) return r;
  }
  return null;
}

async function dupImg(img) {
  if (!activeNbId) return;
  try {
    const res  = await fetch(apiImageUrl(activeNbId, img.dataset.iname));
    const blob = await res.blob();
    await insertImageBlob(blob, blob.type);
  } catch (e) { toast('Duplicate failed: ' + e.message); }
}

async function delImg(wrap, img) {
  if (img.dataset.iname && activeNbId) {
    try { await apiDeleteImage(activeNbId, img.dataset.iname); } catch {}
  }
  wrap.remove(); schedNbSave();
}

function cropImg(wrap, img) {
  wrap.classList.remove('sel');
  const W = img.offsetWidth, H = img.offsetHeight;
  const wr = wrap.getBoundingClientRect();
  const ov = document.createElement('div');
  ov.style.cssText =
    `position:fixed;left:${wr.left}px;top:${wr.top}px;width:${W}px;height:${H}px;` +
    `cursor:crosshair;z-index:999;background:rgba(0,0,0,.5)`;
  const sel = document.createElement('div');
  sel.style.cssText = `position:absolute;border:2px solid #fff;box-sizing:border-box;display:none`;
  ov.appendChild(sel); document.body.appendChild(ov);

  let sx = 0, sy = 0, ex = 0, ey = 0, drawing = false;
  ov.addEventListener('mousedown', e => {
    drawing = true; sx = e.clientX - wr.left; sy = e.clientY - wr.top;
    sel.style.display = 'block'; sel.style.left = sx + 'px'; sel.style.top = sy + 'px';
    sel.style.width = '0'; sel.style.height = '0';
  });
  ov.addEventListener('mousemove', e => {
    if (!drawing) return;
    ex = e.clientX - wr.left; ey = e.clientY - wr.top;
    const x = Math.min(sx,ex), y = Math.min(sy,ey), w = Math.abs(ex-sx), h = Math.abs(ey-sy);
    sel.style.left = x+'px'; sel.style.top = y+'px'; sel.style.width = w+'px'; sel.style.height = h+'px';
  });
  ov.addEventListener('mouseup', async () => {
    if (!drawing) return; drawing = false; ov.remove();
    const x = Math.min(sx,ex), y = Math.min(sy,ey), w = Math.abs(ex-sx), h = Math.abs(ey-sy);
    if (w < 5 || h < 5) return;
    const scX = img.naturalWidth / W, scY = img.naturalHeight / H;
    const cv  = document.createElement('canvas');
    cv.width  = Math.round(w * scX); cv.height = Math.round(h * scY);
    cv.getContext('2d').drawImage(img, x*scX, y*scY, w*scX, h*scY, 0, 0, cv.width, cv.height);
    cv.toBlob(async blob => {
      if (!blob || !activeNbId) return;
      try {
        if (img.dataset.iname) await apiDeleteImage(activeNbId, img.dataset.iname);
        const name = genImgName('image/png');
        const b64  = await blobToBase64(blob);
        await apiUploadImage(activeNbId, name, b64.split(',')[1]);
        img.src           = apiImageUrl(activeNbId, name);
        img.dataset.iname = name;
        img.style.width   = w + 'px'; img.style.height = '';
        schedNbSave();
      } catch (e) { toast('Crop save failed: ' + e.message); }
    }, 'image/png');
  });
  const onKey = e => {
    if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
}

// ── Editor events (paste / drag-drop) ────────────────────────────────────────
function setupEditorEvents() {
  const ed = document.getElementById('nb-editor');
  ed.addEventListener('paste', async e => {
    const items = e.clipboardData && e.clipboardData.items; if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        await insertImageBlob(item.getAsFile(), item.type); return;
      }
    }
    setTimeout(schedNbSave, 10);
  });
  ed.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  ed.addEventListener('drop', e => {
    let handled = false;
    for (const f of e.dataTransfer.files) {
      if (f.type.startsWith('image/')) { handled = true; e.preventDefault(); insertImageBlob(f, f.type); }
    }
    if (!handled) setTimeout(schedNbSave, 10);
  });
  ed.addEventListener('input', schedNbSave);
}

/* ══════════════════════════════════════════════════════════════
   notebook.js  —  full notebook editor
   • Canvas-style image & code block placement
   • VSCode-style inline notebook naming
   • Sub-notebooks
   • Full MS-Word style toolbar (2 rows)
   • Code blocks: JS, HTML, Python (Pyodide WASM), auto-detect
   • Sticky notes — free-floating, draggable
   • Export: PDF (print), .docx (backend)
   ══════════════════════════════════════════════════════════════ */

/* ─── State ─────────────────────────────────────────────────── */
let notebooks    = [];
let activeNbId   = null;
let nbSaveTimer  = null;
let pyodideReady = false;
let pyodideObj   = null;

/* ─── Tiny helpers ───────────────────────────────────────────── */
function genImgName(type) {
  const ext = (type || 'image/png').split('/')[1] || 'png';
  return 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2,5) + '.' + ext;
}
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error('Read failed'));
    r.readAsDataURL(blob);
  });
}
function mkEl(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls)  el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
}
function mkTb(label)  { const b = mkEl('button','tb-b'); b.innerHTML = label || ''; return b; }
function mkTbs()      { return mkEl('span','tb-s'); }

/* ─── Pyodide (lazy-loaded) ──────────────────────────────────── */
async function ensurePyodide() {
  if (pyodideReady) return pyodideObj;
  toast('Loading Python runtime… (first time only)', 8000);
  pyodideObj   = await loadPyodide({ indexURL:'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/' });
  pyodideReady = true;
  return pyodideObj;
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR — notebook tree
   ═══════════════════════════════════════════════════════════════ */
async function loadNotebooks() {
  try {
    notebooks = await apiGetNotebooks();
    renderNbList();
  } catch(e) { toast('Failed to load notebooks: ' + e.message); }
}

function renderNbList() {
  const list = document.getElementById('nb-tl');
  list.innerHTML = '';
  const roots    = notebooks.filter(n => !n.parentId || n.parentId === 'null');
  const children = pid => notebooks.filter(n => n.parentId && n.parentId !== 'null' && n.parentId === pid);

  function renderItem(nb, isChild) {
    const kids   = children(nb.id);
    const isOpen = nb._open !== false;
    const item   = mkEl('div','nb-tree-item');
    const tab    = mkEl('div','nb-tab' + (nb.id===activeNbId?' active':'') + (isChild?' sub':''));
    tab.dataset.id = nb.id;

    const arrow = mkEl('span','nb-arrow' + (isOpen&&kids.length?' open':''));
    arrow.textContent = kids.length ? '▶' : '·';
    if (kids.length) arrow.addEventListener('click', e => { e.stopPropagation(); nb._open=!nb._open; renderNbList(); });

    const nameSpan = mkEl('span','tn'); nameSpan.textContent = nb.title;

    const acts = mkEl('span','nb-tab-actions');

    if (!isChild) {
      const subBtn = mkEl('button','nb-act-btn'); subBtn.title='Add sub-notebook'; subBtn.textContent='+';
      subBtn.addEventListener('click', e => { e.stopPropagation(); startNewSubNote(nb.id); });
      acts.appendChild(subBtn);
    }

    const renBtn = mkEl('button','nb-act-btn'); renBtn.title='Rename'; renBtn.textContent='✎';
    renBtn.addEventListener('click', e => { e.stopPropagation(); startRename(tab, nb); });

    const delBtn = mkEl('button','nb-act-btn del'); delBtn.title='Delete'; delBtn.textContent='×';
    delBtn.addEventListener('click', e => { e.stopPropagation(); delNb(nb.id); });

    acts.append(renBtn, delBtn);
    tab.append(arrow, nameSpan, acts);
    tab.addEventListener('click', () => selectNb(nb.id));
    item.appendChild(tab);

    if (kids.length && isOpen) kids.forEach(c => item.appendChild(renderItem(c, true)));
    return item;
  }

  roots.forEach(nb => list.appendChild(renderItem(nb, false)));
}

/* ─── Inline rename ──────────────────────────────────────────── */
function startRename(tab, nb) {
  const nameSpan = tab.querySelector('.tn');
  const input    = mkEl('input','tn-input');
  input.value    = nb.title;
  nameSpan.replaceWith(input);
  input.focus(); input.select();

  const commit = async () => {
    const val = input.value.trim() || nb.title;
    nb.title  = val;
    try { await apiUpdateNotebook(nb.id, val); } catch {}
    renderNbList(); schedNbSave();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key==='Enter')  { e.preventDefault(); input.blur(); }
    if (e.key==='Escape') { input.value=nb.title; input.blur(); }
    e.stopPropagation();
  });
}

/* ─── New notebook ───────────────────────────────────────────── */
async function newNotebook() {
  const placeholder = { id:'__new__', title:'', parentId:null, _open:true };
  notebooks.push(placeholder);
  renderNbList();

  let targetTab = null;
  document.querySelectorAll('.nb-tab').forEach(t => { if(t.dataset.id==='__new__') targetTab=t; });
  if (!targetTab) return;

  const input = mkEl('input','tn-input'); input.placeholder='Notebook name…';
  targetTab.querySelector('.tn').replaceWith(input);
  input.focus();

  const commit = async () => {
    const val = input.value.trim();
    notebooks  = notebooks.filter(n => n.id!=='__new__');
    if (!val) { renderNbList(); return; }
    try {
      const nb = await apiCreateNotebook(val);
      notebooks.push(nb); renderNbList(); await selectNb(nb.id);
    } catch(e) { toast('Error: '+e.message); renderNbList(); }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key==='Enter')  { e.preventDefault(); input.blur(); }
    if (e.key==='Escape') { notebooks=notebooks.filter(n=>n.id!=='__new__'); renderNbList(); }
    e.stopPropagation();
  });
}

/* ─── New sub-notebook ───────────────────────────────────────── */
async function startNewSubNote(parentId) {
  const parent = notebooks.find(n => n.id===parentId);
  if (parent) parent._open = true;
  const placeholder = { id:'__newsub__', title:'', parentId:parentId, _open:false };
  notebooks.push(placeholder);
  renderNbList();

  let targetTab = null;
  document.querySelectorAll('.nb-tab').forEach(t => { if(t.dataset.id==='__newsub__') targetTab=t; })
  if (targetTab) targetTab.scrollIntoView({block:'nearest'});
  if (!targetTab) return;

  const input = mkEl('input','tn-input'); input.placeholder='Sub-notebook name…';
  targetTab.querySelector('.tn').replaceWith(input);
  input.focus();

  const commit = async () => {
    const val = input.value.trim();
    notebooks  = notebooks.filter(n => n.id!=='__newsub__');
    if (!val) { renderNbList(); return; }
    try {
      const nb = await apiCreateNotebook(val, parentId);
      notebooks.push(nb); renderNbList(); await selectNb(nb.id);
    } catch(e) { toast('Error: '+e.message); renderNbList(); }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key==='Enter')  { e.preventDefault(); input.blur(); }
    if (e.key==='Escape') { notebooks=notebooks.filter(n=>n.id!=='__newsub__'); renderNbList(); }
    e.stopPropagation();
  });
}

/* ─── Select notebook ────────────────────────────────────────── */
async function selectNb(id) {
  if (id==='__new__'||id==='__newsub__') return;
  if (activeNbId && activeNbId!==id) await saveCurrentNb();
  activeNbId = id;
  const nb   = notebooks.find(n => n.id===id);
  if (!nb) return;
  document.getElementById('nb-inner').style.display = 'flex';
  document.getElementById('nb-empty').style.display = 'none';
  document.getElementById('nb-title').value         = nb.title;
  renderNbList();
  try {
    const { html } = await apiGetContent(id);
    const editor   = document.getElementById('nb-editor');
    editor.innerHTML = html || '';
    restoreEditorContent(id);
  } catch(e) { toast('Failed to load: '+e.message); }
}

/* ─── Restore images & code blocks after load ────────────────── */
function restoreEditorContent(nbId) {
  const editor = document.getElementById('nb-editor');

  editor.querySelectorAll('img[data-iname]').forEach(img => {
    img.src = apiImageUrl(nbId, img.dataset.iname);
    let wrap = img.closest('.nb-img-wrap');
    if (!wrap) {
      wrap = makeImgWrap(img);
      img.parentNode.insertBefore(wrap, img);
      wrap.appendChild(img);
    }
    wrap.classList.remove('selected');
    attachImgEvents(wrap, img);
  });

  editor.querySelectorAll('.code-block-wrap').forEach(cb => {
    const ta = cb.querySelector('.code-textarea');
    if (ta) {
      attachCodeBlockEvents(cb);
      updateLangBadge(cb, ta.dataset.lang || detectLang(ta.value));
      const out   = cb.querySelector('.code-output');
      const ifr   = cb.querySelector('.code-iframe');
      if (out)  { out.classList.remove('visible'); out.textContent=''; }
      if (ifr)  { ifr.classList.remove('visible'); ifr.srcdoc=''; }
      // Restore collapsed state
      applyCodeCollapse(cb);
    }
  });

  // Restore sticky notes
  editor.querySelectorAll('.sticky-note').forEach(sn => {
    attachStickyEvents(sn);
  });
}

/* ─── Save ───────────────────────────────────────────────────── */
async function saveCurrentNb() {
  if (!activeNbId) return;
  try {
    const editor = document.getElementById('nb-editor');
    const clone  = editor.cloneNode(true);
    clone.querySelectorAll('img[data-iname]').forEach(img => {
      img.src = 'images/' + img.dataset.iname;
    });
    clone.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    clone.querySelectorAll('.code-output').forEach(el => { el.classList.remove('visible'); el.textContent=''; });
    clone.querySelectorAll('.code-iframe').forEach(el => { el.classList.remove('visible'); el.srcdoc=''; });
    await apiSaveContent(activeNbId, clone.innerHTML);
    const t = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    document.getElementById('ss').textContent = 'saved ' + t;
  } catch(e) { console.error('Save failed', e); }
}

function onTitleChange() {
  if (!activeNbId) return;
  const nb    = notebooks.find(n => n.id===activeNbId);
  const title = document.getElementById('nb-title').value || 'Untitled';
  if (nb) nb.title = title;
  renderNbList();
  clearTimeout(nbSaveTimer);
  nbSaveTimer = setTimeout(async () => {
    try { await apiUpdateNotebook(activeNbId, title); } catch {}
    await saveCurrentNb();
  }, 1200);
}

async function delNb(id) {
  if (!confirm('Delete this notebook? This cannot be undone.')) return;
  try {
    await apiDeleteNotebook(id);
    notebooks = notebooks.filter(n => n.id!==id && n.parentId!==id);
    if (activeNbId===id) {
      activeNbId = null;
      document.getElementById('nb-inner').style.display='none';
      document.getElementById('nb-empty').style.display='flex';
      document.getElementById('nb-editor').innerHTML='';
    }
    renderNbList();
  } catch(e) { toast('Error: '+e.message); }
}

function schedNbSave() {
  clearTimeout(nbSaveTimer);
  nbSaveTimer = setTimeout(saveCurrentNb, 1500);
}

/* ═══════════════════════════════════════════════════════════════
   CANVAS IMAGE SYSTEM
   ═══════════════════════════════════════════════════════════════ */
async function insertImageBlob(blob, type) {
  if (!activeNbId) { toast('Select a notebook first.'); return; }
  try {
    const name = genImgName(type);
    const b64  = await blobToBase64(blob);
    await apiUploadImage(activeNbId, name, b64.split(',')[1]);

    const img         = document.createElement('img');
    img.dataset.iname = name;
    img.style.width   = '300px';
    img.draggable     = false;
    img.src           = apiImageUrl(activeNbId, name);

    const wrap = makeImgWrap(img);
    attachImgEvents(wrap, img);
    insertAtCursor(document.getElementById('nb-editor'), wrap);
    schedNbSave();
  } catch(e) { toast('Image upload failed: '+e.message); }
}

function makeImgWrap(img) {
  const wrap          = mkEl('span','nb-img-wrap');
  wrap.contentEditable = 'false';

  const tb = mkEl('span','img-toolbar');
  tb.innerHTML =
    '<button class="img-tb-btn" data-a="free">⊹ Free</button>' +
    '<button class="img-tb-btn" data-a="inline">≡ Inline</button>' +
    '<button class="img-tb-btn" data-a="dup">⧉ Dup</button>' +
    '<button class="img-tb-btn" data-a="crop">✂ Crop</button>' +
    '<button class="img-tb-btn" data-a="del">✕ Del</button>';
  wrap.appendChild(tb);
  if (!img.parentNode || img.parentNode !== wrap) wrap.appendChild(img);
  ['nw','ne','sw','se'].forEach(p => wrap.appendChild(mkEl('span','rh '+p)));
  return wrap;
}

function attachImgEvents(wrap, img) {
  wrap.querySelectorAll('.rh').forEach(h => {
    const nh = mkEl('span', h.className);
    h.replaceWith(nh);
  });

  wrap.addEventListener('mousedown', e => {
    if (e.target.classList.contains('img-tb-btn')||e.target.classList.contains('rh')) return;
    e.preventDefault(); selectImgWrap(wrap);
  }, { capture:false });

  const tb = wrap.querySelector('.img-toolbar');
  tb.addEventListener('mousedown', e => e.stopPropagation());
  tb.addEventListener('click', e => {
    const btn = e.target.closest('[data-a]'); if (!btn) return;
    e.stopPropagation();
    const a = btn.dataset.a;
    if (a==='free')   makeImgFree(wrap);
    if (a==='inline') makeImgInline(wrap);
    if (a==='dup')    dupImg(img);
    if (a==='crop')   cropImg(wrap, img);
    if (a==='del')    delImg(wrap, img);
  });

  wrap.querySelectorAll('.rh').forEach(h => {
    const corner = [...h.classList].find(c=>['se','sw','ne','nw'].includes(c));
    h.addEventListener('mousedown', e => startImgResize(e, wrap, img, corner));
  });

  setupImgDrag(wrap);
}

let selectedImg = null;
function selectImgWrap(wrap) {
  if (selectedImg && selectedImg!==wrap) selectedImg.classList.remove('selected');
  selectedImg = wrap; wrap.classList.add('selected');
}
document.addEventListener('mousedown', e => {
  if (selectedImg && !selectedImg.contains(e.target)) {
    selectedImg.classList.remove('selected'); selectedImg=null;
  }
});

function makeImgFree(wrap) {
  if (wrap.classList.contains('canvas-pos')) return;
  const editor  = document.getElementById('nb-editor');
  const edRect  = editor.getBoundingClientRect();
  const wRect   = wrap.getBoundingClientRect();
  const scrollT = editor.parentElement.scrollTop;
  wrap.classList.add('canvas-pos');
  wrap.style.left  = (wRect.left - edRect.left) + 'px';
  wrap.style.top   = (wRect.top  - edRect.top + scrollT) + 'px';
  wrap.style.width = wrap.querySelector('img').offsetWidth + 'px';
  editor.appendChild(wrap);
  schedNbSave();
}
function makeImgInline(wrap) {
  if (!wrap.classList.contains('canvas-pos')) return;
  wrap.classList.remove('canvas-pos');
  wrap.style.left=''; wrap.style.top=''; wrap.style.width='';
  const editor = document.getElementById('nb-editor');
  const p = editor.querySelector('p,div') || editor;
  p.appendChild(wrap);
  schedNbSave();
}

function setupImgDrag(wrap) {
  let drag=false, sx, sy, ol, ot;
  wrap.addEventListener('mousedown', e => {
    if (!wrap.classList.contains('canvas-pos')) return;
    if (e.target.classList.contains('rh')||e.target.classList.contains('img-tb-btn')) return;
    drag=true; sx=e.clientX; sy=e.clientY;
    ol=parseInt(wrap.style.left)||0; ot=parseInt(wrap.style.top)||0;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    wrap.style.left=(ol+e.clientX-sx)+'px'; wrap.style.top=(ot+e.clientY-sy)+'px';
  });
  document.addEventListener('mouseup', () => { if(drag){drag=false;schedNbSave();} });
}

function startImgResize(e, wrap, img, corner) {
  e.preventDefault(); e.stopPropagation(); selectImgWrap(wrap);
  const sx=e.clientX, sw=img.offsetWidth, sh=img.offsetHeight, asp=sw/sh;
  const onMove = ev => {
    const dx = ev.clientX-sx;
    const nw = Math.max(60,(corner==='se'||corner==='ne')?sw+dx:sw-dx);
    img.style.width=nw+'px'; img.style.height=(nw/asp)+'px';
  };
  const onUp = () => { document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); schedNbSave(); };
  document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
}

async function dupImg(img) {
  if (!activeNbId) return;
  try { const r=await fetch(apiImageUrl(activeNbId,img.dataset.iname)); await insertImageBlob(await r.blob(),'image/png'); }
  catch(e){ toast('Dup failed: '+e.message); }
}
async function delImg(wrap, img) {
  if (img.dataset.iname&&activeNbId) { try{await apiDeleteImage(activeNbId,img.dataset.iname);}catch{} }
  if(selectedImg===wrap){selectedImg=null;}
  wrap.remove(); schedNbSave();
}
function cropImg(wrap, img) {
  wrap.classList.remove('selected');
  const W=img.offsetWidth, H=img.offsetHeight, wr=wrap.getBoundingClientRect();
  const ov=mkEl('div'); ov.style.cssText=`position:fixed;left:${wr.left}px;top:${wr.top}px;width:${W}px;height:${H}px;cursor:crosshair;z-index:9999;background:rgba(0,0,0,.5)`;
  const sel=mkEl('div'); sel.style.cssText='position:absolute;border:2px solid #fff;box-sizing:border-box;display:none';
  ov.appendChild(sel); document.body.appendChild(ov);
  let sx=0,sy=0,ex=0,ey=0,drawing=false;
  ov.addEventListener('mousedown',e=>{drawing=true;sx=e.clientX-wr.left;sy=e.clientY-wr.top;sel.style.display='block';sel.style.left=sx+'px';sel.style.top=sy+'px';sel.style.width='0';sel.style.height='0';});
  ov.addEventListener('mousemove',e=>{if(!drawing)return;ex=e.clientX-wr.left;ey=e.clientY-wr.top;const x=Math.min(sx,ex),y=Math.min(sy,ey),w=Math.abs(ex-sx),h=Math.abs(ey-sy);sel.style.left=x+'px';sel.style.top=y+'px';sel.style.width=w+'px';sel.style.height=h+'px';});
  ov.addEventListener('mouseup',async()=>{
    if(!drawing)return;drawing=false;ov.remove();
    const x=Math.min(sx,ex),y=Math.min(sy,ey),w=Math.abs(ex-sx),h=Math.abs(ey-sy);
    if(w<5||h<5)return;
    const scX=img.naturalWidth/W,scY=img.naturalHeight/H;
    const cv=document.createElement('canvas');cv.width=Math.round(w*scX);cv.height=Math.round(h*scY);
    cv.getContext('2d').drawImage(img,x*scX,y*scY,w*scX,h*scY,0,0,cv.width,cv.height);
    cv.toBlob(async blob=>{
      if(!blob||!activeNbId)return;
      try{
        if(img.dataset.iname)await apiDeleteImage(activeNbId,img.dataset.iname);
        const name=genImgName('image/png'),b64=await blobToBase64(blob);
        await apiUploadImage(activeNbId,name,b64.split(',')[1]);
        img.src=apiImageUrl(activeNbId,name);img.dataset.iname=name;
        img.style.width=w+'px';img.style.height='';schedNbSave();
      }catch(e){toast('Crop failed: '+e.message);}
    },'image/png');
  });
  document.addEventListener('keydown',function onKey(e){if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',onKey);}});
}

function onImgFileInput(e) { const f=e.target.files[0];if(!f)return;insertImageBlob(f,f.type);e.target.value=''; }

/* ═══════════════════════════════════════════════════════════════
   DOUBLE-CLICK TO PLACE CURSOR ANYWHERE IN EDITOR
   ═══════════════════════════════════════════════════════════════ */
function setupDoubleClickCursor() {
  const canvasWrap = document.querySelector('.nb-canvas-wrap');
  if (!canvasWrap) return;

  canvasWrap.addEventListener('dblclick', e => {
    const editor = document.getElementById('nb-editor');
    // Only act if click target is the canvas wrap itself (empty area)
    if (e.target !== canvasWrap && e.target !== editor) return;

    editor.focus();

    // Calculate click position relative to editor
    const edRect = editor.getBoundingClientRect();
    const scrollTop = canvasWrap.scrollTop;
    const clickX = e.clientX - edRect.left;
    const clickY = e.clientY - edRect.top + scrollTop;

    // Try to place cursor at the click position using caretRangeFromPoint / caretPositionFromPoint
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }

    // If clicked below all content, append a new paragraph and place cursor there
    if (!range || e.target === canvasWrap) {
      // Insert a paragraph at click point approximation
      const br = document.createElement('p');
      br.innerHTML = '<br>';
      editor.appendChild(br);
      range = document.createRange();
      range.setStart(br, 0);
      range.collapse(true);
    }

    if (range) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   STICKY NOTES
   ═══════════════════════════════════════════════════════════════ */
let stickyColors = ['#FFFDE7','#E8F5E9','#E3F2FD','#FCE4EC','#F3E5F5','#FFF3E0'];
let stickyColorIdx = 0;

function insertStickyNote() {
  if (!activeNbId) { toast('Select a notebook first.'); return; }
  const editor = document.getElementById('nb-editor');
  const canvasWrap = document.querySelector('.nb-canvas-wrap');
  const scrollTop = canvasWrap ? canvasWrap.scrollTop : 0;

  // Default position — center-ish of visible area
  const edRect = editor.getBoundingClientRect();
  const defLeft = Math.max(20, (edRect.width / 2) - 100);
  const defTop  = scrollTop + 60;

  const color = stickyColors[stickyColorIdx % stickyColors.length];
  stickyColorIdx++;

  const note = mkEl('div', 'sticky-note');
  note.contentEditable = 'false';
  note.style.left  = defLeft + 'px';
  note.style.top   = defTop + 'px';
  note.style.background = color;
  note.dataset.color = color;

  // Header (drag handle + controls)
  const header = mkEl('div', 'sticky-header');

  const colorBtns = mkEl('span', 'sticky-colors');
  stickyColors.forEach(c => {
    const sw = mkEl('span', 'sticky-color-sw');
    sw.style.background = c;
    sw.addEventListener('click', e => {
      e.stopPropagation();
      note.style.background = c;
      note.dataset.color = c;
      schedNbSave();
    });
    colorBtns.appendChild(sw);
  });

  const delBtn = mkEl('button', 'sticky-del-btn');
  delBtn.textContent = '×';
  delBtn.title = 'Delete note';
  delBtn.addEventListener('click', e => { e.stopPropagation(); note.remove(); schedNbSave(); });

  header.append(colorBtns, delBtn);

  // Text area
  const content = mkEl('div', 'sticky-content');
  content.contentEditable = 'true';
  content.setAttribute('data-placeholder', 'Type your note…');
  content.addEventListener('input', schedNbSave);
  content.addEventListener('mousedown', e => e.stopPropagation());
  content.addEventListener('click', e => e.stopPropagation());
  content.addEventListener('dblclick', e => e.stopPropagation());

  // Resize handle
  const resizeH = mkEl('div', 'sticky-resize');

  note.append(header, content, resizeH);
  editor.appendChild(note);
  attachStickyEvents(note);
  content.focus();
  schedNbSave();
}

function attachStickyEvents(note) {
  const header  = note.querySelector('.sticky-header');
  const content = note.querySelector('.sticky-content');
  const resizeH = note.querySelector('.sticky-resize');
  const delBtn  = note.querySelector('.sticky-del-btn');

  if (!header) return;

  // Re-attach delete
  if (delBtn) {
    delBtn.onclick = e => { e.stopPropagation(); note.remove(); schedNbSave(); };
  }

  // Re-attach color swatches
  note.querySelectorAll('.sticky-color-sw').forEach(sw => {
    sw.onclick = e => {
      e.stopPropagation();
      note.style.background = sw.style.background;
      note.dataset.color = sw.style.background;
      schedNbSave();
    };
  });

  // Re-attach content edit
  if (content) {
    content.addEventListener('input', schedNbSave);
    content.addEventListener('mousedown', e => e.stopPropagation());
    content.addEventListener('click', e => e.stopPropagation());
    content.addEventListener('dblclick', e => e.stopPropagation());
  }

  // Drag
  let drag=false, sx, sy, ol, ot;
  header.style.cursor = 'grab';
  header.addEventListener('mousedown', e => {
    if (e.target.classList.contains('sticky-del-btn') || e.target.classList.contains('sticky-color-sw')) return;
    drag=true; sx=e.clientX; sy=e.clientY;
    ol=parseInt(note.style.left)||0; ot=parseInt(note.style.top)||0;
    header.style.cursor='grabbing'; e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    note.style.left=(ol+e.clientX-sx)+'px'; note.style.top=(ot+e.clientY-sy)+'px';
  });
  document.addEventListener('mouseup', () => { if(drag){ drag=false; header.style.cursor='grab'; schedNbSave(); } });

  // Resize
  if (resizeH) {
    resizeH.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const sy2=e.clientY, sh=note.offsetHeight, sw2=e.clientX, sw3=note.offsetWidth;
      const onMove=ev=>{
        note.style.height=Math.max(80,sh+ev.clientY-sy2)+'px';
        note.style.width=Math.max(140,sw3+ev.clientX-sw2)+'px';
      };
      const onUp=()=>{ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); schedNbSave(); };
      document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   CODE BLOCKS
   ═══════════════════════════════════════════════════════════════ */
const LANG_PATTERNS = [
  {lang:'html',   re:/<!DOCTYPE|<html|<div|<body|<head/i},
  {lang:'css',    re:/[.#][\w-]+\s*\{|@media|@keyframes/m},
  {lang:'python', re:/def |import |print\(|class |if __name__|:\s*$/m},
  {lang:'bash',   re:/^#!/m},
  {lang:'php',    re:/<\?php|\$[a-zA-Z_]/},
  {lang:'perl',   re:/^use strict|^use warnings|sub [a-z]|my \$/m},
  {lang:'json',   re:/^\s*[\[{]/},
  {lang:'sql',    re:/SELECT|INSERT|UPDATE|DELETE|CREATE TABLE/i},
  {lang:'js',     re:/function |=>|const |let |var |console\./m},
];
const LANG_LABELS = {js:'JavaScript',html:'HTML',css:'CSS',python:'Python',php:'PHP',perl:'Perl',bash:'Bash',json:'JSON',sql:'SQL',text:'Plain Text'};
function detectLang(code) { for(const{lang,re}of LANG_PATTERNS)if(re.test(code))return lang; return 'text'; }

// Lines visible when collapsed
const CODE_COLLAPSE_LINES = 10;

function insertCodeBlock(lang='js') {
  if(!activeNbId){toast('Select a notebook first.');return;}
  const cb=buildCodeBlock('',lang);
  insertAtCursor(document.getElementById('nb-editor'),cb);
  cb.querySelector('.code-textarea').focus();
  schedNbSave();
}

function applyCodeCollapse(wrap) {
  const ta = wrap.querySelector('.code-textarea');
  if (!ta) return;
  const lines = ta.value.split('\n').length;
  const lineH = 19.2; // ~12px font * 1.6 line-height
  const maxH  = CODE_COLLAPSE_LINES * lineH;

  if (lines > CODE_COLLAPSE_LINES) {
    if (!wrap.classList.contains('cb-expanded')) {
      ta.style.height   = maxH + 'px';
      ta.style.overflow = 'hidden';
      ta.style.resize   = 'none';
      showExpandBtn(wrap, true);
    } else {
      ta.style.height   = '';
      ta.style.overflow = '';
      ta.style.resize   = 'vertical';
      showExpandBtn(wrap, false);
    }
  } else {
    ta.style.height   = '';
    ta.style.overflow = '';
    ta.style.resize   = 'vertical';
    hideExpandBtn(wrap);
  }
}

function showExpandBtn(wrap, collapsed) {
  let btn = wrap.querySelector('.cb-expand-btn');
  if (!btn) {
    btn = mkEl('button', 'cb-expand-btn');
    wrap.appendChild(btn);
    btn.addEventListener('click', () => {
      wrap.classList.toggle('cb-expanded');
      applyCodeCollapse(wrap);
    });
  }
  btn.textContent = collapsed ? '▼ Show more' : '▲ Show less';
  btn.style.display = 'block';
}

function hideExpandBtn(wrap) {
  const btn = wrap.querySelector('.cb-expand-btn');
  if (btn) btn.style.display = 'none';
}

function buildCodeBlock(code, lang) {
  lang = lang||'js';
  const wrap = mkEl('div','code-block-wrap');
  wrap.contentEditable='false';

  // Header
  const header = mkEl('div','code-block-header');
  const badge  = mkEl('span','code-lang-badge'); badge.textContent=LANG_LABELS[lang]||lang;
  const sp     = mkEl('span','code-block-sp');

  const movBtn = mkEl('button','code-move-btn'); movBtn.textContent='⊹ Free';
  const cpyBtn = mkEl('button','code-copy-btn'); cpyBtn.textContent='Copy';
  const runBtn = mkEl('button','code-run-btn');  runBtn.textContent='▶ Run';
  const delCbBtn = mkEl('button','code-del-btn'); delCbBtn.textContent='✕';
  delCbBtn.title='Remove block';

  const langSel = mkEl('select','tb-size-sel');
  langSel.style.cssText='font-size:9px;height:20px;margin-left:6px;width:100px;';
  Object.entries(LANG_LABELS).forEach(([k,v])=>{
    const o=mkEl('option');o.value=k;o.textContent=v;if(k===lang)o.selected=true;langSel.appendChild(o);
  });

  header.append(badge,sp,movBtn,cpyBtn,runBtn,langSel,delCbBtn);

  const ta = mkEl('textarea','code-textarea');
  ta.value=code; ta.dataset.lang=lang; ta.placeholder='// Write your code here…'; ta.spellcheck=false;

  const out   = mkEl('div','code-output');
  const iframe= mkEl('iframe','code-iframe');
  iframe.sandbox='allow-scripts allow-same-origin';
  const cbRes = mkEl('div','cb-resize');

  wrap.append(header,ta,out,iframe,cbRes);
  attachCodeBlockEvents(wrap);
  setTimeout(() => applyCodeCollapse(wrap), 0);
  return wrap;
}

function updateLangBadge(wrap,lang) {
  const b=wrap.querySelector('.code-lang-badge');if(b)b.textContent=LANG_LABELS[lang]||lang;
}

function attachCodeBlockEvents(wrap) {
  const ta     = wrap.querySelector('.code-textarea');
  const out    = wrap.querySelector('.code-output');
  const iframe = wrap.querySelector('.code-iframe');
  const runBtn = wrap.querySelector('.code-run-btn');
  const cpyBtn = wrap.querySelector('.code-copy-btn');
  const movBtn = wrap.querySelector('.code-move-btn');
  const delCbBtn = wrap.querySelector('.code-del-btn');
  const langSel= wrap.querySelector('select');

  if (delCbBtn) {
    delCbBtn.onclick = () => { if(confirm('Remove this code block?')) { wrap.remove(); schedNbSave(); } };
  }

  // Tab key support
  ta.addEventListener('keydown', e => {
    if(e.key==='Tab'){e.preventDefault();const s=ta.selectionStart;ta.value=ta.value.slice(0,s)+'  '+ta.value.slice(ta.selectionEnd);ta.selectionStart=ta.selectionEnd=s+2;}
    schedNbSave();
  });
  ta.addEventListener('input', () => {
    ta.dataset.lang=langSel?langSel.value:detectLang(ta.value);
    updateLangBadge(wrap,ta.dataset.lang);
    applyCodeCollapse(wrap);
    schedNbSave();
  });

  if(langSel) langSel.addEventListener('change',()=>{ta.dataset.lang=langSel.value;updateLangBadge(wrap,langSel.value);schedNbSave();});
  if(cpyBtn)  cpyBtn.addEventListener('click',()=>navigator.clipboard.writeText(ta.value).then(()=>toast('Copied!')));

  if(movBtn) {
    movBtn.addEventListener('click',()=>{
      if(wrap.classList.contains('canvas-pos')){
        wrap.classList.remove('canvas-pos');wrap.style.left='';wrap.style.top='';wrap.style.width='';
        movBtn.textContent='⊹ Free';
        insertAtCursor(document.getElementById('nb-editor'),wrap);
      } else {
        makeCodeBlockFree(wrap); movBtn.textContent='≡ Inline';
      }
      schedNbSave();
    });
    setupCodeBlockDrag(wrap);
  }

  // Vertical resize handle (only when expanded/short)
  const cbRes = wrap.querySelector('.cb-resize');
  if(cbRes) cbRes.addEventListener('mousedown',e=>{
    e.preventDefault();const sy=e.clientY,sh=ta.offsetHeight;
    const onMove=ev=>{ta.style.height=Math.max(60,sh+ev.clientY-sy)+'px';};
    const onUp=()=>{document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);};
    document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  });

  if(runBtn) runBtn.addEventListener('click',()=>runCode(wrap,ta,out,iframe,runBtn));
}

function makeCodeBlockFree(wrap) {
  const editor=document.getElementById('nb-editor');
  const er=editor.getBoundingClientRect(),wr=wrap.getBoundingClientRect(),st=editor.parentElement.scrollTop;
  wrap.classList.add('canvas-pos');
  wrap.style.left=(wr.left-er.left)+'px'; wrap.style.top=(wr.top-er.top+st)+'px';
  wrap.style.width=Math.max(400,wrap.offsetWidth)+'px';
  editor.appendChild(wrap);
}

function setupCodeBlockDrag(wrap) {
  const header=wrap.querySelector('.code-block-header');
  let drag=false,sx,sy,ol,ot;
  header.style.cursor='grab';
  header.addEventListener('mousedown',e=>{
    if(!wrap.classList.contains('canvas-pos'))return;
    if(e.target.tagName==='BUTTON'||e.target.tagName==='SELECT')return;
    drag=true;sx=e.clientX;sy=e.clientY;ol=parseInt(wrap.style.left)||0;ot=parseInt(wrap.style.top)||0;
    header.style.cursor='grabbing'; e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{if(!drag)return;wrap.style.left=(ol+e.clientX-sx)+'px';wrap.style.top=(ot+e.clientY-sy)+'px';});
  document.addEventListener('mouseup',()=>{if(drag){drag=false;header.style.cursor='grab';schedNbSave();}});
}

/* ─── Code Runner ────────────────────────────────────────────── */
async function runCode(wrap,ta,out,iframe,runBtn) {
  const lang=ta.dataset.lang||detectLang(ta.value);
  const code=ta.value.trim(); if(!code)return;

  runBtn.textContent='⏳…'; runBtn.classList.add('running'); runBtn.disabled=true;
  out.classList.add('visible'); out.classList.remove('error');
  iframe.classList.remove('visible');
  out.textContent=''; iframe.srcdoc='';

  try {
    if(lang==='html'){
      iframe.classList.add('visible'); out.classList.remove('visible');
      iframe.srcdoc=code;
    } else if(lang==='python') {
      const py=await ensurePyodide();
      py.runPython('import sys,io\n_stdout_=sys.stdout\nsys.stdout=io.StringIO()');
      try{ py.runPython(code); }
      catch(pe){ out.textContent='Error: '+pe.message; out.classList.add('error'); return; }
      const stdout=py.runPython('sys.stdout.getvalue()');
      py.runPython('sys.stdout=_stdout_');
      out.textContent=stdout||'(no output)';
    } else {
      const logs=[];
      const fakeCons={
        log:  (...a)=>logs.push(a.map(String).join(' ')),
        error:(...a)=>logs.push('ERR: '+a.map(String).join(' ')),
        warn: (...a)=>logs.push('WARN: '+a.map(String).join(' ')),
        info: (...a)=>logs.push(a.map(String).join(' ')),
      };
      try {
        // eslint-disable-next-line no-new-func
        const result=(new Function('console',code))(fakeCons);
        if(result!==undefined)logs.push('→ '+String(result));
      } catch(err){ out.textContent='Error: '+err.message; out.classList.add('error'); return; }
      out.textContent=logs.length?logs.join('\n'):'(no output)';
    }
  } finally {
    runBtn.textContent='▶ Run'; runBtn.classList.remove('running'); runBtn.disabled=false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   SETUP EDITOR EVENTS
   ═══════════════════════════════════════════════════════════════ */
function setupEditorEvents() {
  const ed = document.getElementById('nb-editor');
  ed.addEventListener('paste', async e => {
    const items=e.clipboardData&&e.clipboardData.items;if(!items)return;
    for(const item of items){if(item.type.startsWith('image/')){e.preventDefault();await insertImageBlob(item.getAsFile(),item.type);return;}}
    setTimeout(schedNbSave,10);
  });
  ed.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
  ed.addEventListener('drop',e=>{
    let handled=false;
    for(const f of e.dataTransfer.files){if(f.type.startsWith('image/')){handled=true;e.preventDefault();insertImageBlob(f,f.type);}}
    if(!handled)setTimeout(schedNbSave,10);
  });
  ed.addEventListener('input', schedNbSave);

  // Setup double-click cursor placement
  setupDoubleClickCursor();
}

function insertAtCursor(editor, node) {
  editor.focus();
  const sel=window.getSelection();
  if(sel&&sel.rangeCount){
    const range=sel.getRangeAt(0);
    if(editor.contains(range.commonAncestorContainer)){
      range.collapse(false);range.insertNode(node);
      range.setStartAfter(node);sel.removeAllRanges();sel.addRange(range);return;
    }
  }
  editor.appendChild(node);
}

/* ═══════════════════════════════════════════════════════════════
   FULL TOOLBAR
   ═══════════════════════════════════════════════════════════════ */
function ec(cmd,val) {
  document.getElementById('nb-editor').focus();
  document.execCommand(cmd,false,val||null);
  schedNbSave();
}

function buildToolbar() {
  const toolbar = document.getElementById('nb-toolbar');
  toolbar.innerHTML = '';

  /* ROW 1 */
  const r1 = mkEl('div','tb-row');

  const fontSel = mkEl('select','tb-font-sel');
  [
    ['Default (Serif)',    ''],
    ['Aptos',             'Aptos,sans-serif'],
    ['Calibri',           'Calibri,sans-serif'],
    ['IM Fell English',   'IM Fell English,serif'],
    ['Courier Prime',     'Courier Prime,monospace'],
    ['Georgia',           'Georgia,serif'],
    ['Times New Roman',   'Times New Roman,serif'],
    ['Arial',             'Arial,sans-serif'],
    ['Verdana',           'Verdana,sans-serif'],
    ['Trebuchet MS',      'Trebuchet MS,sans-serif'],
    ['Impact',            'Impact,sans-serif'],
    ['Comic Sans MS',     'Comic Sans MS,cursive'],
    ['JetBrains Mono',    '"JetBrains Mono",monospace'],
  ].forEach(([l,v]) => {
    const o = mkEl('option'); o.textContent = l; o.value = v; fontSel.appendChild(o);
  });
  fontSel.addEventListener('change', () => {
    document.getElementById('nb-editor').focus();
    document.execCommand('fontName', false, fontSel.value || 'inherit');
    schedNbSave();
  });

  const sizeSel = mkEl('select','tb-size-sel');
  [8,9,10,11,12,13,14,16,18,20,22,24,28,32,36,48,60,72,96].forEach(s => {
    const o = mkEl('option'); o.textContent = s; o.value = s;
    if (s === 14) o.selected = true;
    sizeSel.appendChild(o);
  });
  sizeSel.addEventListener('change', () => {
    document.getElementById('nb-editor').focus();
    document.execCommand('fontSize', false, '7');
    document.querySelectorAll('font[size="7"]').forEach(el => {
      el.removeAttribute('size'); el.style.fontSize = sizeSel.value + 'px';
    });
    schedNbSave();
  });

  const growBtn   = mkTb('A<sup style="font-size:7px">+</sup>'); growBtn.title   = 'Increase font size';
  const shrinkBtn = mkTb('A<sup style="font-size:7px">-</sup>'); shrinkBtn.title = 'Decrease font size';
  growBtn.addEventListener('click', () => {
    document.execCommand('fontSize', false, '7');
    document.querySelectorAll('font[size="7"]').forEach(f => {
      const cur = parseInt(window.getComputedStyle(f).fontSize) || 14;
      f.removeAttribute('size'); f.style.fontSize = (cur + 2) + 'px';
    }); schedNbSave();
  });
  shrinkBtn.addEventListener('click', () => {
    document.execCommand('fontSize', false, '7');
    document.querySelectorAll('font[size="7"]').forEach(f => {
      const cur = parseInt(window.getComputedStyle(f).fontSize) || 14;
      f.removeAttribute('size'); f.style.fontSize = Math.max(8, cur - 2) + 'px';
    }); schedNbSave();
  });

  r1.append(fontSel, sizeSel, growBtn, shrinkBtn, mkTbs());

  const fmtBtns = [
    ['<b>B</b>','bold','Bold'],
    ['<i>I</i>','italic','Italic'],
    ['<u>U</u>','underline','Underline'],
    ['<s>ab</s>','strikeThrough','Strikethrough'],
    ['x<sub>2</sub>','subscript','Subscript'],
    ['x<sup>2</sup>','superscript','Superscript'],
  ];
  fmtBtns.forEach(([h, cmd, title]) => {
    const b = mkTb(h); b.title = title;
    b.addEventListener('click', () => ec(cmd));
    r1.appendChild(b);
  });

  r1.appendChild(mkTbs());

  // Change case / clear
  const caseWrap = mkEl('span'); caseWrap.style.position = 'relative';
  const caseBtn  = mkTb('Aa'); caseBtn.title = 'Change Case / Clear';
  const caseMenu = mkEl('div','spacing-menu'); caseMenu.style.minWidth = '160px';
  [
    ['Clear Formatting', () => ec('removeFormat')],
    ['UPPERCASE',        () => transformSelection(s => s.toUpperCase())],
    ['lowercase',        () => transformSelection(s => s.toLowerCase())],
    ['Title Case',       () => transformSelection(s => s.replace(/\b\w/g, c => c.toUpperCase()))],
  ].forEach(([label, fn]) => {
    const opt = mkEl('div','sp-opt'); opt.textContent = label;
    opt.addEventListener('click', () => { fn(); caseMenu.classList.remove('open'); });
    caseMenu.appendChild(opt);
  });
  caseBtn.addEventListener('click', e => { e.stopPropagation(); caseMenu.classList.toggle('open'); });
  document.addEventListener('click', () => caseMenu.classList.remove('open'));
  caseWrap.append(caseBtn, caseMenu);
  r1.append(caseWrap, mkTbs());

  // Font color
  const tcWrap   = mkEl('span','tb-color-wrap'); tcWrap.title = 'Font Color';
  const tcBtn    = mkEl('button','tb-color-btn');
  const tcLabel  = mkEl('span'); tcLabel.style.cssText = 'font-family:var(--font-mono);font-size:11px;font-weight:700;pointer-events:none;color:var(--ink);';
  tcLabel.textContent = 'A';
  const tcBar    = mkEl('span'); tcBar.style.cssText = 'display:block;width:14px;height:3px;background:#c0392b;border-radius:1px;margin-top:1px;pointer-events:none;';
  const tcInp    = mkEl('input'); tcInp.type = 'color'; tcInp.value = '#c0392b';
  tcInp.style.cssText = 'position:absolute;width:200%;height:200%;top:-50%;left:-50%;opacity:0;cursor:pointer;';
  tcInp.addEventListener('input', () => {
    tcBar.style.background = tcInp.value;
    document.getElementById('nb-editor').focus();
    document.execCommand('foreColor', false, tcInp.value);
    schedNbSave();
  });
  const tcInner = mkEl('span'); tcInner.style.cssText = 'display:flex;flex-direction:column;align-items:center;position:relative;';
  tcInner.append(tcLabel, tcBar, tcInp);
  tcBtn.appendChild(tcInner); tcWrap.appendChild(tcBtn);

  // Highlight — FIXED: use a custom approach since hiliteColor is unreliable
  const hlWrap = buildHighlightPicker();

  r1.append(tcWrap, hlWrap);
  toolbar.appendChild(r1);

  /* ROW 2 */
  const r2 = mkEl('div','tb-row');

  const ulBtn = mkTb('&#x2022;&#x2013;'); ulBtn.title = 'Bulleted List';
  ulBtn.addEventListener('click', () => ec('insertUnorderedList'));

  const olBtn = mkTb('1.&#x2013;'); olBtn.title = 'Numbered List';
  olBtn.addEventListener('click', () => ec('insertOrderedList'));

  const indBtn  = mkTb('&#x21E5;&#x2261;'); indBtn.title  = 'Increase Indent';
  const outdBtn = mkTb('&#x21E4;&#x2261;'); outdBtn.title = 'Decrease Indent';
  indBtn.addEventListener('click',  () => ec('indent'));
  outdBtn.addEventListener('click', () => ec('outdent'));

  r2.append(ulBtn, olBtn, indBtn, outdBtn, mkTbs());

  [
    ['&#x2261;', 'justifyLeft',   'Align Left'],
    ['&#x2263;', 'justifyCenter', 'Center'],
    ['&#x2262;', 'justifyRight',  'Align Right'],
    ['&#x2261;', 'justifyFull',   'Justify'],
  ].forEach(([h, cmd, title]) => {
    const b = mkTb(h); b.title = title;
    b.addEventListener('click', () => ec(cmd));
    r2.appendChild(b);
  });

  r2.appendChild(mkTbs());

  // Line spacing — now applies to selected paragraphs or editor
  const spWrap = mkEl('span','tb-spacing-wrap');
  const spBtn  = mkTb('&#x2195;'); spBtn.title = 'Line Spacing';
  const spMenu = mkEl('div','spacing-menu');

  const LINE_SPACINGS = [
    ['1.0', '1'],
    ['1.15', '1.15'],
    ['1.4', '1.4'],
    ['1.5', '1.5'],
    ['1.7', '1.7'],
    ['2.0', '2'],
    ['2.5', '2.5'],
  ];

  LINE_SPACINGS.forEach(([label, val]) => {
    const opt = mkEl('div','sp-opt'); opt.textContent = 'Line: ' + label;
    opt.addEventListener('click', () => {
      applyLineSpacing(val);
      spMenu.classList.remove('open');
    });
    spMenu.appendChild(opt);
  });

  // Add spacer
  const spacerDiv = mkEl('div'); spacerDiv.style.borderTop='1px solid var(--rule)'; spacerDiv.style.margin='3px 0';
  spMenu.appendChild(spacerDiv);

  [
    ['Space before paragraph', () => applyParagraphSpacing('12px', 'before')],
    ['No space before paragraph', () => applyParagraphSpacing('0', 'before')],
    ['Space after paragraph', () => applyParagraphSpacing('12px', 'after')],
    ['No space after paragraph', () => applyParagraphSpacing('0', 'after')],
  ].forEach(([label, fn]) => {
    const opt = mkEl('div','sp-opt'); opt.textContent = label;
    opt.addEventListener('click', () => { fn(); spMenu.classList.remove('open'); });
    spMenu.appendChild(opt);
  });

  spBtn.addEventListener('click', e => { e.stopPropagation(); spMenu.classList.toggle('open'); });
  document.addEventListener('click', () => spMenu.classList.remove('open'));
  spWrap.append(spBtn, spMenu);
  r2.append(spWrap, mkTbs());

  // Paragraph / Heading style
  const headSel = mkEl('select','tb-font-sel'); headSel.style.width = '110px';
  [
    ['Normal Text',  'p'],
    ['Heading 1',    'h1'],
    ['Heading 2',    'h2'],
    ['Heading 3',    'h3'],
    ['Quote',        'blockquote'],
    ['Code block',   'pre'],
    ['Address',      'address'],
  ].forEach(([l, t]) => {
    const o = mkEl('option'); o.textContent = l; o.value = t; headSel.appendChild(o);
  });
  headSel.addEventListener('change', () => { ec('formatBlock', headSel.value); headSel.value = 'p'; });
  r2.append(headSel, mkTbs());

  // Insert group
  const hrBtn   = mkTb('&#x2014; Line');   hrBtn.title = 'Horizontal Rule';
  hrBtn.addEventListener('click', () => ec('insertHTML', '<hr>'));

  const linkBtn = mkTb('&#x1F517; Link');  linkBtn.title = 'Insert Hyperlink';
  linkBtn.addEventListener('click', () => {
    const url = prompt('Enter URL:'); if (url) ec('createLink', url);
  });

  const imgBtn  = mkTb('&#x1F5BC; Image'); imgBtn.title = 'Insert Image';
  imgBtn.addEventListener('click', () => document.getElementById('img-input').click());

  // Sticky note button
  const stickyBtn = mkTb('📌 Note'); stickyBtn.title = 'Insert Sticky Note';
  stickyBtn.addEventListener('click', () => insertStickyNote());

  const tableWrap = buildTablePicker();
  const codeWrap  = buildCodeInsertPicker();

  r2.append(hrBtn, linkBtn, imgBtn, stickyBtn, tableWrap, codeWrap);
  toolbar.appendChild(r2);
}

/* ─── Line spacing helpers ───────────────────────────────────── */
function applyLineSpacing(value) {
  const editor = document.getElementById('nb-editor');
  const sel = window.getSelection();

  // If there's a selection, apply to selected block elements
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const startContainer = range.startContainer;
    const endContainer   = range.endContainer;

    // Find all block-level elements in range
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT);
    const blocks = [];
    let node = walker.nextNode();
    while (node) {
      const isBlock = ['P','DIV','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','LI'].includes(node.tagName);
      if (isBlock && range.intersectsNode(node)) blocks.push(node);
      node = walker.nextNode();
    }

    if (blocks.length > 0) {
      blocks.forEach(b => b.style.lineHeight = value);
    } else {
      // Apply to current paragraph
      let node2 = sel.anchorNode;
      while (node2 && node2 !== editor) {
        if (node2.nodeType === 1 && ['P','DIV','H1','H2','H3','H4','H5','H6'].includes(node2.tagName)) {
          node2.style.lineHeight = value; break;
        }
        node2 = node2.parentNode;
      }
    }
  } else {
    // Apply to whole editor
    editor.style.lineHeight = value;
  }
  schedNbSave();
}

function applyParagraphSpacing(value, position) {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode) return;
  const editor = document.getElementById('nb-editor');
  let node = sel.anchorNode;
  while (node && node !== editor) {
    if (node.nodeType === 1 && ['P','DIV','H1','H2','H3'].includes(node.tagName)) {
      if (position === 'before') node.style.marginTop = value;
      else node.style.marginBottom = value;
      break;
    }
    node = node.parentNode;
  }
  schedNbSave();
}

/* ─── Transform selection ────────────────────────────────────── */
function transformSelection(fn) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const text  = range.toString();
  const span  = document.createElement('span');
  span.textContent = fn(text);
  range.deleteContents();
  range.insertNode(span);
  schedNbSave();
}

/* ─── Highlight picker — FIXED ───────────────────────────────── */
function buildHighlightPicker() {
  const wrap = mkEl('span','tb-hl-wrap'); wrap.title = 'Text Highlight Color';
  const btn  = mkEl('button','tb-hl-btn');
  btn.innerHTML = '<span style="font-size:10px;font-weight:700;font-family:var(--font-mono);">ab</span>';
  const hlBar = mkEl('span');
  hlBar.style.cssText = 'display:block;width:16px;height:3px;background:#FFFF00;border-radius:1px;margin:0 auto;pointer-events:none;';
  btn.appendChild(hlBar);

  const palette = mkEl('div','hl-palette');
  const COLORS = [
    '#FFFF00','#FFD700','#FFA500','#FF6347','#FF69B4',
    '#98FB98','#00FA9A','#87CEEB','#DDA0DD','#F5DEB3',
    '#ADD8E6','#E6E6FA','#FFE4E1','#F0FFF0','#FFF8DC',
  ];

  // Store selection before palette opens
  let savedRange = null;
  btn.addEventListener('mousedown', e => {
    // Save selection before click blurs editor
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  });

  COLORS.forEach(c => {
    const sw = mkEl('span','hl-swatch'); sw.style.background = c; sw.title = c;
    sw.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      applyHighlight(c, savedRange);
      hlBar.style.background = c;
      palette.classList.remove('open');
    });
    palette.appendChild(sw);
  });

  const removeBtn = mkEl('span','hl-swatch none'); removeBtn.textContent = '✕'; removeBtn.title = 'Remove Highlight';
  removeBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    applyHighlight(null, savedRange);
    hlBar.style.background = 'transparent';
    palette.classList.remove('open');
  });
  palette.appendChild(removeBtn);

  btn.addEventListener('click', e => { e.stopPropagation(); palette.classList.toggle('open'); });
  document.addEventListener('click', () => palette.classList.remove('open'));
  wrap.append(btn, palette);
  return wrap;
}

function applyHighlight(color, savedRange) {
  const editor = document.getElementById('nb-editor');
  const sel = window.getSelection();

  // Restore saved range if we have one
  if (savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  if (!sel || sel.isCollapsed) return;

  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;

  if (color === null) {
    // Remove highlight — unwrap any highlight spans in selection
    document.execCommand('removeFormat', false, null);
  } else {
    // Wrap selection in a highlight span
    try {
      // Try execCommand first (works in Firefox)
      document.execCommand('hiliteColor', false, color);
    } catch(e) {
      // Fallback: manual span wrapping
      const span = document.createElement('mark');
      span.style.backgroundColor = color;
      span.style.color = 'inherit';
      try {
        range.surroundContents(span);
      } catch(err) {
        // Range spans multiple nodes — use extractContents
        const frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      }
    }
  }
  schedNbSave();
}

/* ─── Table picker ───────────────────────────────────────────── */
function buildTablePicker() {
  const wrap   = mkEl('span','tb-table-wrap');
  const btn    = mkTb('&#x229E; Table'); btn.title = 'Insert Table';
  const picker = mkEl('div','table-picker');
  const info   = mkEl('div','table-info'); info.textContent = 'Insert table';

  const ROWS = 8, COLS = 8;
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    const row = mkEl('div','table-row-cells');
    for (let c = 0; c < COLS; c++) {
      const cell = mkEl('div','table-cell');
      cell.dataset.r = r; cell.dataset.c = c;
      cell.addEventListener('mouseover', () => {
        cells.forEach(cc => {
          cc.classList.toggle('hover', +cc.dataset.r <= r && +cc.dataset.c <= c);
        });
        info.textContent = (r+1) + ' × ' + (c+1);
      });
      cell.addEventListener('click', () => { insertTable(r+1,c+1); picker.classList.remove('open'); });
      cells.push(cell); row.appendChild(cell);
    }
    picker.appendChild(row);
  }
  picker.appendChild(info);
  btn.addEventListener('click', e => { e.stopPropagation(); picker.classList.toggle('open'); });
  document.addEventListener('click', () => picker.classList.remove('open'));
  wrap.append(btn, picker);
  return wrap;
}

/* ─── Code insert picker ─────────────────────────────────────── */
function buildCodeInsertPicker() {
  const wrap = mkEl('span'); wrap.style.position = 'relative';
  const btn  = mkTb('&lt;/&gt; Code'); btn.title = 'Insert Code Block';
  const menu = mkEl('div','spacing-menu'); menu.style.minWidth = '150px';
  Object.entries(LANG_LABELS).forEach(([k, v]) => {
    const opt = mkEl('div','sp-opt'); opt.textContent = v;
    opt.addEventListener('click', () => { insertCodeBlock(k); menu.classList.remove('open'); });
    menu.appendChild(opt);
  });
  btn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
  document.addEventListener('click', () => menu.classList.remove('open'));
  wrap.append(btn, menu);
  return wrap;
}

function insertTable(rows,cols) {
  let html='<table>';
  for(let r=0;r<rows;r++){
    html+='<tr>';
    for(let c=0;c<cols;c++) html+=r===0?'<th><br></th>':'<td><br></td>';
    html+='</tr>';
  }
  html+='</table>'; ec('insertHTML',html);
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT
   ═══════════════════════════════════════════════════════════════ */
async function exportPDF() {
  if(!activeNbId){toast('No notebook selected.');return;}
  await saveCurrentNb();
  const nb=notebooks.find(n=>n.id===activeNbId);
  const editor=document.getElementById('nb-editor');
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${nb?nb.title:'Notebook'}</title>
<link href="https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
<style>
body{font-family:'IM Fell English',serif;font-size:14px;line-height:1.5;color:#1a1510;margin:0;padding:40px 60px;}
h1,h2,h3{font-family:'Courier Prime',monospace;letter-spacing:1px;}
pre,code{font-family:'Courier Prime',monospace;font-size:12px;background:#f0ede6;padding:10px;border-radius:3px;white-space:pre-wrap;}
blockquote{border-left:3px solid #a09080;padding-left:14px;color:#4a4035;font-style:italic;}
table{border-collapse:collapse;width:100%;margin:10px 0;}
td,th{border:1px solid #c8bfaa;padding:6px 10px;}
th{background:#ede8dc;font-weight:700;}
img{max-width:100%;height:auto;}
hr{border:none;border-top:1px solid #c8bfaa;margin:16px 0;}
.code-output,.code-iframe,.code-run-btn,.code-copy-btn,.code-move-btn,.cb-resize,.img-toolbar,.rh,.sticky-note{display:none!important;}
@media print{body{padding:20px 30px;}@page{margin:2cm;}}
</style></head><body>
<h1 style="border-bottom:2px solid #a09080;padding-bottom:8px;">${nb?nb.title:''}</h1>
${editor.innerHTML}
</body></html>`);
  win.document.close();
  setTimeout(()=>win.print(),700);
}

async function exportDOCX() {
  if(!activeNbId){toast('No notebook selected.');return;}
  await saveCurrentNb();
  const nb=notebooks.find(n=>n.id===activeNbId);
  const editor=document.getElementById('nb-editor');
  try {
    toast('Generating .docx…');
    const res=await apiFetch('/notebooks/'+activeNbId+'/export/docx',{
      method:'POST',
      body:{title:nb?nb.title:'Notebook',html:editor.innerHTML}
    });
    const blobRes=await fetch(API_BASE+res.download_url,{headers:{Authorization:'Bearer '+getToken()}});
    const blob=await blobRes.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=(nb?nb.title:'notebook')+'.docx';
    a.click();URL.revokeObjectURL(url);
    toast('Downloaded ✓');
  } catch(e){toast('Export failed: '+e.message);}
}

/* ═══════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════ */
function initNotebook() {
  buildToolbar();
  setupEditorEvents();
}
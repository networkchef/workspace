/* ══════════════════════════════════════════════════════════════
   notebook.js  —  full notebook editor
   • Canvas-style image & code block placement (no stuck state)
   • VSCode-style inline notebook naming (no browser prompt)
   • Sub-notebooks
   • Full MS-Word style toolbar (2 rows)
   • Code blocks: JS, HTML, Python (Pyodide WASM), auto-detect
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
  const roots    = notebooks.filter(n => !n.parentId);
  const children = pid => notebooks.filter(n => n.parentId === pid);

  function renderItem(nb, isChild) {
    const kids   = children(nb.id);
    const isOpen = nb._open !== false;
    const item   = mkEl('div','nb-tree-item');
    const tab    = mkEl('div','nb-tab' + (nb.id===activeNbId?' active':'') + (isChild?' sub':''));
    tab.dataset.id = nb.id;

    // Expand arrow
    const arrow = mkEl('span','nb-arrow' + (isOpen&&kids.length?' open':''));
    arrow.textContent = kids.length ? '▶' : '·';
    if (kids.length) arrow.addEventListener('click', e => { e.stopPropagation(); nb._open=!nb._open; renderNbList(); });

    // Name
    const nameSpan = mkEl('span','tn'); nameSpan.textContent = nb.title;

    // Actions
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

/* ─── Inline rename (VSCode style) ──────────────────────────── */
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

/* ─── New notebook — inline in sidebar ──────────────────────── */
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

/* ─── New sub-notebook — inline ─────────────────────────────── */
async function startNewSubNote(parentId) {
  const parent = notebooks.find(n => n.id===parentId);
  if (parent) parent._open = true;
  const placeholder = { id:'__newsub__', title:'', parentId, _open:false };
  notebooks.push(placeholder);
  renderNbList();

  let targetTab = null;
  document.querySelectorAll('.nb-tab').forEach(t => { if(t.dataset.id==='__newsub__') targetTab=t; });
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

  // Restore images — fix src, re-attach events, clear stuck state
  editor.querySelectorAll('img[data-iname]').forEach(img => {
    img.src = apiImageUrl(nbId, img.dataset.iname);
    let wrap = img.closest('.nb-img-wrap');
    if (!wrap) {
      wrap = makeImgWrap(img);
      img.parentNode.insertBefore(wrap, img);
      wrap.appendChild(img);
    }
    // Clear any lingering selected class from saved HTML
    wrap.classList.remove('selected');
    attachImgEvents(wrap, img);
  });

  // Restore code blocks — re-attach events
  editor.querySelectorAll('.code-block-wrap').forEach(cb => {
    const ta = cb.querySelector('.code-textarea');
    if (ta) {
      attachCodeBlockEvents(cb);
      updateLangBadge(cb, ta.dataset.lang || detectLang(ta.value));
      // Hide any leftover output from previous session
      const out   = cb.querySelector('.code-output');
      const ifr   = cb.querySelector('.code-iframe');
      if (out)  { out.classList.remove('visible'); out.textContent=''; }
      if (ifr)  { ifr.classList.remove('visible'); ifr.srcdoc=''; }
    }
  });
}

/* ─── Save ───────────────────────────────────────────────────── */
async function saveCurrentNb() {
  if (!activeNbId) return;
  try {
    const editor = document.getElementById('nb-editor');
    const clone  = editor.cloneNode(true);
    // Store relative image paths, not live API URLs
    clone.querySelectorAll('img[data-iname]').forEach(img => {
      img.src = 'images/' + img.dataset.iname;
    });
    // Strip selection state & transient output
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
   Images default to inline flow; "Free" button promotes to
   absolute canvas position. After reload, state is restored
   correctly with no stuck-selection bug.
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
  // Remove stale listeners by replacing resize handles
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

  // Resize handles
  wrap.querySelectorAll('.rh').forEach(h => {
    const corner = [...h.classList].find(c=>['se','sw','ne','nw'].includes(c));
    h.addEventListener('mousedown', e => startImgResize(e, wrap, img, corner));
  });

  setupImgDrag(wrap);
}

/* Selection */
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

/* Free / Inline toggle */
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

/* Drag (canvas-pos only) */
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

/* Resize */
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

/* Dup / Del / Crop */
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

/* Input / paste / drop */
function onImgFileInput(e) { const f=e.target.files[0];if(!f)return;insertImageBlob(f,f.type);e.target.value=''; }
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
   CODE BLOCKS
   ═══════════════════════════════════════════════════════════════ */
const LANG_PATTERNS = [
  {lang:'html',   re:/<!DOCTYPE|<html|<div|<body|<head/i},
  {lang:'css',    re:/[.#][\w-]+\s*\{|@media|@keyframes/m},
  {lang:'python', re:/def |import |print\(|class |if __name__|:\s*$/m},
  {lang:'bash',   re:/^#!/m},
  {lang:'json',   re:/^\s*[\[{]/},
  {lang:'sql',    re:/SELECT|INSERT|UPDATE|DELETE|CREATE TABLE/i},
  {lang:'js',     re:/function |=>|const |let |var |console\./m},
];
const LANG_LABELS = {js:'JavaScript',html:'HTML',css:'CSS',python:'Python',bash:'Bash',json:'JSON',sql:'SQL',text:'Plain Text'};
function detectLang(code) { for(const{lang,re}of LANG_PATTERNS)if(re.test(code))return lang; return 'text'; }

function insertCodeBlock(lang='js') {
  if(!activeNbId){toast('Select a notebook first.');return;}
  const cb=buildCodeBlock('',lang);
  insertAtCursor(document.getElementById('nb-editor'),cb);
  cb.querySelector('.code-textarea').focus();
  schedNbSave();
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

  const langSel = mkEl('select','tb-size-sel');
  langSel.style.cssText='font-size:9px;height:20px;margin-left:6px;width:100px;';
  Object.entries(LANG_LABELS).forEach(([k,v])=>{
    const o=mkEl('option');o.value=k;o.textContent=v;if(k===lang)o.selected=true;langSel.appendChild(o);
  });

  header.append(badge,sp,movBtn,cpyBtn,runBtn,langSel);

  const ta = mkEl('textarea','code-textarea');
  ta.value=code; ta.dataset.lang=lang; ta.placeholder='// Write your code here…'; ta.spellcheck=false;

  const out   = mkEl('div','code-output');
  const iframe= mkEl('iframe','code-iframe');
  iframe.sandbox='allow-scripts allow-same-origin';
  const cbRes = mkEl('div','cb-resize');

  wrap.append(header,ta,out,iframe,cbRes);
  attachCodeBlockEvents(wrap);
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
  const langSel= wrap.querySelector('select');

  // Tab key support
  ta.addEventListener('keydown', e => {
    if(e.key==='Tab'){e.preventDefault();const s=ta.selectionStart;ta.value=ta.value.slice(0,s)+'  '+ta.value.slice(ta.selectionEnd);ta.selectionStart=ta.selectionEnd=s+2;}
    schedNbSave();
  });
  ta.addEventListener('input', () => {
    ta.dataset.lang=langSel?langSel.value:detectLang(ta.value);
    updateLangBadge(wrap,ta.dataset.lang);schedNbSave();
  });

  if(langSel) langSel.addEventListener('change',()=>{ta.dataset.lang=langSel.value;updateLangBadge(wrap,langSel.value);schedNbSave();});
  if(cpyBtn)  cpyBtn.addEventListener('click',()=>navigator.clipboard.writeText(ta.value).then(()=>toast('Copied!')));

  // Free / inline toggle
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

  // Vertical resize
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
      // JS runner
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
   FULL TOOLBAR  (2 rows — all MS Word Home features)
   ═══════════════════════════════════════════════════════════════ */
function ec(cmd,val) {
  document.getElementById('nb-editor').focus();
  document.execCommand(cmd,false,val||null);
  schedNbSave();
}

function buildToolbar() {
  const toolbar=document.getElementById('nb-toolbar');
  toolbar.innerHTML='';

  /* ══ ROW 1: Font, Size, Style, Color ══ */
  const r1=mkEl('div','tb-row');

  // Font family
  const fontSel=mkEl('select','tb-font-sel');
  [['Default',''],['IM Fell English','IM Fell English,serif'],['Courier Prime','Courier Prime,monospace'],
   ['Georgia','Georgia,serif'],['Times New Roman','Times New Roman,serif'],['Arial','Arial,sans-serif'],
   ['Verdana','Verdana,sans-serif'],['Trebuchet MS','Trebuchet MS,sans-serif'],
   ['Impact','Impact,sans-serif'],['Comic Sans MS','Comic Sans MS,cursive']
  ].forEach(([l,v])=>{const o=mkEl('option');o.textContent=l;o.value=v;fontSel.appendChild(o);});
  fontSel.addEventListener('change',()=>{document.getElementById('nb-editor').focus();document.execCommand('fontName',false,fontSel.value||'inherit');schedNbSave();});

  // Font size
  const sizeSel=mkEl('select','tb-size-sel');
  [8,9,10,11,12,13,14,16,18,20,22,24,28,32,36,48,60,72,96].forEach(s=>{
    const o=mkEl('option');o.textContent=s;o.value=s;if(s===14)o.selected=true;sizeSel.appendChild(o);
  });
  sizeSel.addEventListener('change',()=>{
    document.getElementById('nb-editor').focus();
    document.execCommand('fontSize',false,'7');
    document.querySelectorAll('font[size="7"]').forEach(el=>{el.removeAttribute('size');el.style.fontSize=sizeSel.value+'px';});
    schedNbSave();
  });

  r1.append(fontSel,sizeSel,mkTbs());

  // Grow / Shrink font
  const growBtn=mkTb('A↑'); growBtn.title='Increase font size';
  growBtn.addEventListener('click',()=>{
    const el=document.querySelector('font[size]');
    document.execCommand('fontSize',false,'7');
    document.querySelectorAll('font[size="7"]').forEach(f=>{
      const cur=parseInt(window.getComputedStyle(f).fontSize)||14;
      f.removeAttribute('size');f.style.fontSize=(cur+2)+'px';
    });schedNbSave();
  });
  const shrinkBtn=mkTb('A↓'); shrinkBtn.title='Decrease font size';
  shrinkBtn.addEventListener('click',()=>{
    document.execCommand('fontSize',false,'7');
    document.querySelectorAll('font[size="7"]').forEach(f=>{
      const cur=parseInt(window.getComputedStyle(f).fontSize)||14;
      f.removeAttribute('size');f.style.fontSize=Math.max(8,cur-2)+'px';
    });schedNbSave();
  });
  r1.append(growBtn,shrinkBtn,mkTbs());

  // Style buttons
  [['<b>B</b>','bold'],['<i>I</i>','italic'],['<u>U</u>','underline'],
   ['<s>S</s>','strikeThrough'],['X₂','subscript'],['X²','superscript']
  ].forEach(([h,cmd])=>{const b=mkTb(h);b.addEventListener('click',()=>ec(cmd));r1.appendChild(b);});

  r1.appendChild(mkTbs());

  // Text color
  const tcWrap=mkEl('span','tb-color-wrap'); tcWrap.title='Font Color';
  const tcBtn=mkEl('button','tb-color-btn');
  const tcSwatch=mkEl('span','tb-color-swatch'); tcSwatch.style.background='#1a1510';
  tcSwatch.textContent='A';tcSwatch.style.cssText='display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;width:14px;height:14px;color:#1a1510;';
  const tcInp=mkEl('input');tcInp.type='color';tcInp.value='#1a1510';
  tcInp.style.cssText='position:absolute;width:200%;height:200%;top:-50%;left:-50%;opacity:0;cursor:pointer;';
  tcInp.addEventListener('input',()=>{
    tcSwatch.style.color=tcInp.value; tcSwatch.style.borderBottom='3px solid '+tcInp.value;
    document.getElementById('nb-editor').focus();
    document.execCommand('foreColor',false,tcInp.value);schedNbSave();
  });
  tcBtn.append(tcSwatch,tcInp);tcWrap.appendChild(tcBtn);

  // Highlight color
  const hlWrap=buildHighlightPicker();

  r1.append(tcWrap,hlWrap,mkTbs());

  // Clear formatting
  const clearBtn=mkTb('Tx'); clearBtn.title='Clear Formatting';
  clearBtn.addEventListener('click',()=>ec('removeFormat'));
  r1.append(clearBtn);

  toolbar.appendChild(r1);

  /* ══ ROW 2: Paragraph, Align, Lists, Indent, Insert ══ */
  const r2=mkEl('div','tb-row');

  // Paragraph style
  const headSel=mkEl('select','tb-font-sel');
  [['Paragraph','p'],['Heading 1','h1'],['Heading 2','h2'],['Heading 3','h3'],
   ['Quote','blockquote'],['Code','pre'],['Address','address']
  ].forEach(([l,t])=>{const o=mkEl('option');o.textContent=l;o.value=t;headSel.appendChild(o);});
  headSel.addEventListener('change',()=>{ec('formatBlock',headSel.value);headSel.value='p';});
  r2.append(headSel,mkTbs());

  // Alignment
  [['≡L','justifyLeft','Align Left'],['≡C','justifyCenter','Center'],['≡R','justifyRight','Align Right'],['≡J','justifyFull','Justify']
  ].forEach(([h,cmd,title])=>{const b=mkTb(h);b.title=title;b.addEventListener('click',()=>ec(cmd));r2.appendChild(b);});

  r2.appendChild(mkTbs());

  // Lists + indent
  [['• List','insertUnorderedList'],['1. List','insertOrderedList'],['→ In','indent'],['← Out','outdent']
  ].forEach(([h,cmd])=>{const b=mkTb(h);b.addEventListener('click',()=>ec(cmd));r2.appendChild(b);});

  r2.appendChild(mkTbs());

  // Line spacing picker
  const spWrap=mkEl('span','tb-spacing-wrap');
  const spBtn=mkTb('↕ Spacing');
  const spMenu=mkEl('div','spacing-menu');
  [['1.0','1'],['1.2','1.2'],['1.5','1.5'],['1.8','1.8'],['2.0','2'],['2.5','2.5'],['3.0','3']
  ].forEach(([l,v])=>{
    const opt=mkEl('div','sp-opt');opt.textContent='Line: '+l;
    opt.addEventListener('click',()=>{document.getElementById('nb-editor').style.lineHeight=v;spMenu.classList.remove('open');});
    spMenu.appendChild(opt);
  });
  spBtn.addEventListener('click',e=>{e.stopPropagation();spMenu.classList.toggle('open');});
  document.addEventListener('click',()=>spMenu.classList.remove('open'));
  spWrap.append(spBtn,spMenu);
  r2.append(spWrap,mkTbs());

  // Insert: HR, Link, Image, Table, Code block
  const hrBtn=mkTb('─ Line'); hrBtn.addEventListener('click',()=>ec('insertHTML','<hr>'));
  const linkBtn=mkTb('🔗 Link'); linkBtn.addEventListener('click',()=>{const url=prompt('URL:');if(url)ec('createLink',url);});
  const imgBtn=mkTb('🖼 Image'); imgBtn.addEventListener('click',()=>document.getElementById('img-input').click());

  const tableWrap=buildTablePicker();
  const codeWrap=buildCodeInsertPicker();

  r2.append(hrBtn,linkBtn,imgBtn,tableWrap,codeWrap);
  toolbar.appendChild(r2);
}

function buildHighlightPicker() {
  const wrap=mkEl('span','tb-hl-wrap'); wrap.title='Highlight Color';
  const btn=mkEl('button','tb-hl-btn'); btn.innerHTML='🖊';
  const palette=mkEl('div','hl-palette');
  ['#FFFF00','#FFD700','#FFA500','#FF6347','#FF69B4',
   '#98FB98','#00FA9A','#87CEEB','#DDA0DD','#F5DEB3',
   '#ADD8E6','#E6E6FA','#FFE4E1','#F0FFF0','#FFF8DC',
   'transparent'
  ].forEach(c=>{
    const sw=mkEl('span',c==='transparent'?'hl-swatch none':'hl-swatch');
    sw.style.background=c==='transparent'?'':c; sw.title=c==='transparent'?'Remove highlight':c;
    sw.textContent=c==='transparent'?'✕':'';
    sw.addEventListener('click',e=>{
      e.stopPropagation();
      document.getElementById('nb-editor').focus();
      document.execCommand('hiliteColor',false,c==='transparent'?'transparent':c);
      palette.classList.remove('open');schedNbSave();
    });
    palette.appendChild(sw);
  });
  btn.addEventListener('click',e=>{e.stopPropagation();palette.classList.toggle('open');});
  document.addEventListener('click',()=>palette.classList.remove('open'));
  wrap.append(btn,palette);
  return wrap;
}

function buildTablePicker() {
  const wrap=mkEl('span','tb-table-wrap');
  const btn=mkTb('⊞ Table');
  const picker=mkEl('div','table-picker');
  const info=mkEl('div','table-info'); info.textContent='0 × 0';
  const ROWS=8,COLS=8; const cells=[];
  for(let r=0;r<ROWS;r++){
    const row=mkEl('div','table-row-cells');
    for(let c=0;c<COLS;c++){
      const cell=mkEl('div','table-cell'); cell.dataset.r=r;cell.dataset.c=c;
      cell.addEventListener('mouseover',()=>{
        cells.forEach(cc=>{const cr=+cc.dataset.r,cv=+cc.dataset.c;cc.classList.toggle('hover',cr<=r&&cv<=c);});
        info.textContent=(r+1)+' × '+(c+1);
      });
      cell.addEventListener('click',()=>{insertTable(r+1,c+1);picker.classList.remove('open');});
      cells.push(cell);row.appendChild(cell);
    }
    picker.appendChild(row);
  }
  picker.appendChild(info);
  btn.addEventListener('click',e=>{e.stopPropagation();picker.classList.toggle('open');});
  document.addEventListener('click',()=>picker.classList.remove('open'));
  wrap.append(btn,picker);
  return wrap;
}

function buildCodeInsertPicker() {
  const wrap=mkEl('span');wrap.style.position='relative';
  const btn=mkTb('</> Code');
  const menu=mkEl('div','spacing-menu'); menu.style.minWidth='140px';
  Object.entries(LANG_LABELS).forEach(([k,v])=>{
    const opt=mkEl('div','sp-opt');opt.textContent=v;
    opt.addEventListener('click',()=>{insertCodeBlock(k);menu.classList.remove('open');});
    menu.appendChild(opt);
  });
  btn.addEventListener('click',e=>{e.stopPropagation();menu.classList.toggle('open');});
  document.addEventListener('click',()=>menu.classList.remove('open'));
  wrap.append(btn,menu);
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
body{font-family:'IM Fell English',serif;font-size:14px;line-height:1.9;color:#1a1510;margin:0;padding:40px 60px;}
h1,h2,h3{font-family:'Courier Prime',monospace;letter-spacing:1px;}
pre,code{font-family:'Courier Prime',monospace;font-size:12px;background:#f0ede6;padding:10px;border-radius:3px;white-space:pre-wrap;}
blockquote{border-left:3px solid #a09080;padding-left:14px;color:#4a4035;font-style:italic;}
table{border-collapse:collapse;width:100%;margin:10px 0;}
td,th{border:1px solid #c8bfaa;padding:6px 10px;}
th{background:#ede8dc;font-weight:700;}
img{max-width:100%;height:auto;}
hr{border:none;border-top:1px solid #c8bfaa;margin:16px 0;}
.code-output,.code-iframe,.code-run-btn,.code-copy-btn,.code-move-btn,.cb-resize,.img-toolbar,.rh{display:none!important;}
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

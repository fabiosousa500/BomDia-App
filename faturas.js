'use strict';
/* ====================================================================
   Confirmação de faturas
   Lê as linhas de uma fatura (Excel .xls/.xlsx, CSV ou texto colado), deixa picar os artigos
   com a câmara confirmando a quantidade recebida e gera o .plt (código|armazém|||quantidade).
   ==================================================================== */
const FT_ARMS = [['1', 'Bom Dia Vales'], ['3', 'Bom Dia Cais']];

/* ---------- leitura de ficheiros ---------- */
// .xlsx = zip com XML; o navegador sabe descomprimir (deflate-raw)
async function ftInflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter();
  w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
async function ftZip(buf) {
  const u = new Uint8Array(buf), dv = new DataView(buf);
  let e = u.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ficheiro .xlsx inválido');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const ent = {};
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const meth = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true),
      el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    ent[new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl))] = { meth, csz, off };
    p += 46 + nl + el + cl;
  }
  const get = async nome => {
    const f = ent[nome]; if (!f) return null;
    const lnl = dv.getUint16(f.off + 26, true), lel = dv.getUint16(f.off + 28, true), ini = f.off + 30 + lnl + lel;
    const d = u.subarray(ini, ini + f.csz);
    return f.meth === 0 ? d : await ftInflateRaw(d);
  };
  return { nomes: Object.keys(ent), get };
}
async function ftLerXlsx(buf) {
  const z = await ftZip(buf), td = new TextDecoder();
  const xml = async n => { const d = await z.get(n); return d ? new DOMParser().parseFromString(td.decode(d), 'application/xml') : null; };
  const ss = [], sx = await xml('xl/sharedStrings.xml');
  if (sx) for (const si of sx.getElementsByTagName('si')) {
    let t = ''; for (const x of si.getElementsByTagName('t')) { if (x.parentNode.nodeName === 'rPh') continue; t += x.textContent; }
    ss.push(t);
  }
  const folha = z.nomes.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))[0];
  if (!folha) throw new Error('não encontrei folhas no ficheiro');
  const sh = await xml(folha), rows = [];
  for (const c of sh.getElementsByTagName('c')) {
    const ref = c.getAttribute('r') || '', m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) continue;
    let col = 0; for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64; col--;
    const r = parseInt(m[2], 10) - 1, t = c.getAttribute('t'), vEl = c.getElementsByTagName('v')[0];
    let val = '';
    if (t === 'inlineStr') { val = [...c.getElementsByTagName('t')].map(x => x.textContent).join(''); }
    else if (vEl) { val = vEl.textContent; if (t === 's') val = ss[parseInt(val, 10)] || ''; }
    (rows[r] = rows[r] || [])[col] = val;
  }
  return rows.map(r => r || []);
}

// .xls antigo (BIFF8 dentro de um contentor OLE): leitor mínimo de texto e números da primeira folha
function ftLerXls(buf) {
  const u = new Uint8Array(buf), dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0xE011CFD0) throw new Error('não é um ficheiro .xls válido');
  const ss = 1 << dv.getUint16(30, true), mss = 1 << dv.getUint16(32, true);
  const dirStart = dv.getUint32(48, true), cutoff = dv.getUint32(56, true), mfStart = dv.getUint32(60, true);
  const difStart = dv.getUint32(68, true), nDif = dv.getUint32(72, true), FIM = 0xFFFFFFFA;
  const off = i => (i + 1) * ss;
  const fatIds = [];
  for (let i = 0; i < 109; i++) { const id = dv.getUint32(76 + 4 * i, true); if (id < FIM) fatIds.push(id); }
  let ds = difStart;
  for (let k = 0; k < nDif && ds < FIM; k++) {
    for (let i = 0; i < ss / 4 - 1; i++) { const id = dv.getUint32(off(ds) + 4 * i, true); if (id < FIM) fatIds.push(id); }
    ds = dv.getUint32(off(ds) + ss - 4, true);
  }
  const fat = [];
  fatIds.forEach(id => { for (let i = 0; i < ss / 4; i++) fat.push(dv.getUint32(off(id) + 4 * i, true)); });
  const cadeia = (ini, tab) => { const l = []; let s = ini, g = 0; while (s < FIM && g++ < 1e6) { l.push(s); s = tab[s]; } return l; };
  const juntar = partes => { const t = partes.reduce((a, p) => a + p.length, 0), o = new Uint8Array(t); let q = 0; partes.forEach(p => { o.set(p, q); q += p.length; }); return o; };
  const lerSect = ini => juntar(cadeia(ini, fat).map(s => u.subarray(off(s), off(s) + ss)));
  const dir = lerSect(dirStart), ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  let raiz = null, wbE = null;
  for (let p = 0; p + 128 <= dir.length; p += 128) {
    const nl = ddv.getUint16(p + 64, true); if (!nl) continue;
    let nome = ''; for (let i = 0; i < (nl / 2) - 1; i++) nome += String.fromCharCode(ddv.getUint16(p + 2 * i, true));
    const tipo = dir[p + 66], ent = { nome, ini: ddv.getUint32(p + 116, true), tam: ddv.getUint32(p + 120, true) };
    if (tipo === 5) raiz = ent; else if (tipo === 2 && (nome === 'Workbook' || nome === 'Book') && !wbE) wbE = ent;
  }
  if (!wbE) throw new Error('não encontrei a folha de cálculo no ficheiro');
  let wb;
  if (wbE.tam < cutoff) {
    const mini = lerSect(raiz.ini), mf = lerSect(mfStart), mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength), mtab = [];
    for (let i = 0; i < mf.length / 4; i++) mtab.push(mdv.getUint32(i * 4, true));
    wb = juntar(cadeia(wbE.ini, mtab).map(s => mini.subarray(s * mss, s * mss + mss))).subarray(0, wbE.tam);
  } else wb = lerSect(wbE.ini).subarray(0, wbE.tam);

  const w = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  const recs = []; let pos = 0;
  while (pos + 4 <= wb.length) { const t = w.getUint16(pos, true), l = w.getUint16(pos + 2, true); recs.push({ t, p: pos + 4, l }); pos += 4 + l; }

  // tabela de textos partilhados (SST + CONTINUE)
  const sst = [];
  const iSst = recs.findIndex(r => r.t === 0x00FC);
  if (iSst >= 0) {
    const ch = [wb.subarray(recs[iSst].p, recs[iSst].p + recs[iSst].l)];
    for (let i = iSst + 1; i < recs.length && recs[i].t === 0x003C; i++) ch.push(wb.subarray(recs[i].p, recs[i].p + recs[i].l));
    const nUn = new DataView(ch[0].buffer, ch[0].byteOffset, ch[0].byteLength).getUint32(4, true);
    let ci = 0, p = 8;
    const byte = () => { while (p >= ch[ci].length) { ci++; p = 0; if (ci >= ch.length) throw new Error('fim inesperado'); } return ch[ci][p++]; };
    const u16 = () => byte() | (byte() << 8), u32 = () => (u16() | (u16() << 16)) >>> 0;
    const salta = n => { while (n > 0) { const av = ch[ci].length - p; if (av <= 0) { if (ci + 1 >= ch.length) return; ci++; p = 0; continue; } const t = Math.min(av, n); p += t; n -= t; } };
    try {
      for (let k = 0; k < nUn; k++) {
        let cch = u16(); const fl = byte(); const rich = fl & 8 ? u16() : 0, ext = fl & 4 ? u32() : 0;
        let hi = fl & 1, s = '';
        while (cch > 0) {
          if (p >= ch[ci].length) { ci++; p = 0; hi = ch[ci][p++] & 1; continue; }   // CONTINUE: o primeiro byte indica a codificação
          if (hi) { s += String.fromCharCode(ch[ci][p] | (ch[ci][p + 1] << 8)); p += 2; } else s += String.fromCharCode(ch[ci][p++]);
          cch--;
        }
        salta(rich * 4 + ext);
        sst.push(s);
      }
    } catch (e) { /* usa o que foi lido */ }
  }

  // primeira folha de cálculo
  const rows = [];
  const poe = (r, c, v) => { (rows[r] = rows[r] || [])[c] = v; };
  const num = x => (Number.isInteger(x) && Math.abs(x) < 1e15) ? String(x) : String(x);
  const rk = v => { let x; if (v & 2) x = v >> 2; else { const t = new DataView(new ArrayBuffer(8)); t.setUint32(4, (v & 0xFFFFFFFC) >>> 0, true); x = t.getFloat64(0, true); } return v & 1 ? x / 100 : x; };
  let dentro = false, feita = false, pend = null;
  const strBiff8 = (p0, lim) => {   // XLUnicodeString começando em p0
    const cch = w.getUint16(p0, true), fl = w.getUint8(p0 + 2); let q = p0 + 3, s = '';
    if (fl & 8) q += 2; if (fl & 4) q += 4;
    for (let i = 0; i < cch && q < lim; i++) { if (fl & 1) { s += String.fromCharCode(w.getUint16(q, true)); q += 2; } else s += String.fromCharCode(w.getUint8(q++)); }
    return s;
  };
  for (const r of recs) {
    if (r.t === 0x0809) { const sub = w.getUint16(r.p + 2, true); if (sub === 0x10 && !feita) dentro = true; continue; }
    if (!dentro) continue;
    if (r.t === 0x000A) { dentro = false; feita = true; break; }
    const row = r.l >= 2 ? w.getUint16(r.p, true) : 0, col = r.l >= 4 ? w.getUint16(r.p + 2, true) : 0;
    if (r.t === 0x00FD) poe(row, col, sst[w.getUint32(r.p + 6, true)] || '');
    else if (r.t === 0x0203) poe(row, col, num(w.getFloat64(r.p + 6, true)));
    else if (r.t === 0x027E) poe(row, col, num(rk(w.getUint32(r.p + 6, true))));
    else if (r.t === 0x00BD) { const n = (r.l - 6) / 6; for (let i = 0; i < n; i++) poe(row, col + i, num(rk(w.getUint32(r.p + 4 + 6 * i + 2, true)))); }
    else if (r.t === 0x0204) poe(row, col, strBiff8(r.p + 6, r.p + r.l));
    else if (r.t === 0x0006) {
      if (w.getUint8(r.p + 6) === 0 && w.getUint16(r.p + 12, true) === 0xFFFF) pend = { row, col };
      else poe(row, col, num(w.getFloat64(r.p + 6, true)));
    } else if (r.t === 0x0207 && pend) { poe(pend.row, pend.col, strBiff8(r.p, r.p + r.l)); pend = null; }
  }
  return rows.map(r => r || []);
}

// PDF com texto (faturas geradas por programa): lê o texto com o pdf.js, que vem com a app
let ftPdfjs = null;
async function ftLerPdf(buf) {
  if (!ftPdfjs) { ftPdfjs = await import('./pdf.min.mjs'); ftPdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', location.href).href; }
  const doc = await ftPdfjs.getDocument({ data: new Uint8Array(buf) }).promise, linhas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent(), its = tc.items.filter(i => i.str && i.str.trim());
    its.sort((a, b) => (b.transform[5] - a.transform[5]) || (a.transform[4] - b.transform[4]));
    let cur = [], y = null;
    const fecha = () => { if (cur.length) { cur.sort((a, b) => a.transform[4] - b.transform[4]); linhas.push(cur.map(i => i.str.trim()).join(' ')); } cur = []; };
    its.forEach(i => { if (y === null || Math.abs(i.transform[5] - y) > 2.5) { fecha(); y = i.transform[5]; } cur.push(i); });
    fecha();
  }
  return linhas.join('\n');
}
// várias faturas no mesmo PDF: separa pelo número ("FACTURA: 000059054")
function ftGrupos(texto) {
  const g = [], idx = new Map(); let atual = null;
  texto.split('\n').forEach(l => {
    const m = /FACTURA\s*:?\s*(?:FT\s*)?([\w\/.-]*\d[\w\/.-]*)/i.exec(l);
    if (m) { if (!idx.has(m[1])) { idx.set(m[1], g.length); g.push({ id: m[1], linhas: [] }); } atual = g[idx.get(m[1])]; }
    if (atual) atual.linhas.push(l);
  });
  return g.length ? g.map(x => ({ id: x.id, texto: x.linhas.join('\n') })) : [{ id: '', texto }];
}

async function ftLerFicheiro(f) {
  const nome = (f.name || '').toLowerCase(), buf = await f.arrayBuffer(), u = new Uint8Array(buf);
  if (nome.endsWith('.xlsx') || (u[0] === 0x50 && u[1] === 0x4B)) return { tipo: 'tabela', rows: await ftLerXlsx(buf) };
  if (nome.endsWith('.xls') || (u[0] === 0xD0 && u[1] === 0xCF)) return { tipo: 'tabela', rows: ftLerXls(buf) };
  if (nome.endsWith('.pdf') || (u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44)) {
    const texto = await ftLerPdf(buf);
    if (!/\d{12,14}/.test(texto)) return { tipo: 'pdf', texto: '', grupos: [] };
    return { tipo: 'pdf', texto, grupos: ftGrupos(texto) };
  }
  const txt = decodificarCSV(buf);
  const rows = parseCSV(txt);
  return { tipo: 'csv', rows, texto: txt };
}

/* ---------- códigos de barras ---------- */
// dígito de controlo GTIN (EAN-8, UPC-A de 12, EAN-13, GTIN-14)
function ftGtinOk(s) {
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return false;
  let t = 0;
  for (let i = s.length - 2, k = 0; i >= 0; i--, k++) t += (+s[i]) * (k % 2 === 0 ? 3 : 1);
  return (10 - t % 10) % 10 === +s[s.length - 1];
}
const ftCodigoOk = s => ftGtinOk(String(s || '').trim());

/* ---------- da tabela / texto para linhas da fatura ---------- */
function ftNumero(v) {
  let t = String(v == null ? '' : v).replace(/[\s€]/g, '').replace(/^[-–—~=_]+/, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = parseFloat(t); return isNaN(n) ? null : n;
}
function ftLinhasDeTabela(rows) {
  rows = rows.filter(r => r && r.some(c => String(c == null ? '' : c).trim() !== ''));
  if (!rows.length) return [];
  const hnorm = r => r.map(c => norm(c));
  let iCab = -1, cCod = -1, cDes = -1, cQtd = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = hnorm(rows[i]);
    const c1 = h.findIndex(x => /(^|[^a-z])(ean|gtin)([^a-z]|$)|barras|barcode/.test(x)) , c1b = h.findIndex(x => /^(cod|codigo|ref|referencia)/.test(x));
    const c2 = h.findIndex(x => /^desc|descri|design|produto|nome/.test(x));
    const c3 = h.findIndex(x => /^(quant|qtd|qtde|qt|qty|unid|un\b|fatur)/.test(x) || /quant/.test(x));
    if ((c1 >= 0 || c1b >= 0) && (c2 >= 0 || c3 >= 0)) { iCab = i; cCod = c1 >= 0 ? c1 : c1b; cDes = c2; cQtd = c3; break; }
  }
  let dados = iCab >= 0 ? rows.slice(iCab + 1) : rows;
  if (iCab < 0) {   // sem cabeçalho: descobre as colunas pelo conteúdo
    const nc = Math.max(...rows.map(r => r.length));
    let melhor = -1, mf = 0;
    for (let c = 0; c < nc; c++) { const f = rows.filter(r => /^\d{8,14}$/.test(String(r[c] == null ? '' : r[c]).trim())).length / rows.length; if (f > mf) { mf = f; melhor = c; } }
    cCod = melhor; let ml = -1, mlen = 0;
    for (let c = 0; c < nc; c++) { if (c === cCod) continue; const m = rows.reduce((a, r) => a + (isNaN(ftNumero(r[c])) || ftNumero(r[c]) === null ? String(r[c] || '').length : 0), 0) / rows.length; if (m > mlen) { mlen = m; ml = c; } }
    cDes = ml;
    cQtd = -1; for (let c = 0; c < nc; c++) { if (c === cCod || c === cDes) continue; if (rows.every(r => r[c] == null || r[c] === '' || ftNumero(r[c]) !== null)) { cQtd = c; break; } }
  }
  if (cCod < 0) return [];
  const out = [];
  dados.forEach(r => {
    let ean = String(r[cCod] == null ? '' : r[cCod]).trim().replace(/\.0+$/, '');
    if (/^\d+(\.\d+)?[eE]\+\d+$/.test(ean)) ean = Number(ean).toFixed(0);
    const desc = cDes >= 0 ? String(r[cDes] == null ? '' : r[cDes]).replace(/\s+/g, ' ').trim() : '';
    const q = cQtd >= 0 ? ftNumero(r[cQtd]) : null;
    if (!ean && !desc) return;
    out.push({ ean, desc, qf: q === null ? 0 : q, semQtd: q === null });
  });
  return out;
}
// Texto colado (de um PDF, ou copiado de uma foto): uma linha por artigo.
// modo: 'auto' | 'iN' (N-ésimo número a seguir ao código, a partir de 0) | 'fN' (N-ésimo número contando do fim da linha, a partir de 1)
function ftLinhasDeTexto(texto, idxQtd) {
  const out = []; let ultimaItem = false;
  for (const raw of String(texto).split(/\r?\n/)) {
    const l = raw.replace(/[\t|]/g, ' ').replace(/\s+/g, ' ').trim(); if (!l) { ultimaItem = false; continue; }
    const tk = l.split(' ');
    let iE = tk.findIndex(t => /^\d{8,14}$/.test(t) && ftGtinOk(t));
    if (iE < 0) iE = tk.findIndex(t => /^\d{12,14}$/.test(t));
    if (iE < 0) {   // continuação da descrição na linha seguinte
      if (ultimaItem && out.length && l.length < 45 && !tk.some(t => /^\d+,\d+$/.test(t)) && !/total|factura|fatura|exento|p[aá]g|cantidad|descri/i.test(l)) out[out.length - 1].desc += ' ' + l;
      else ultimaItem = false;
      continue;
    }
    const ean = tk[iE], resto = tk.filter((t, i) => i !== iE && !/^\d{7,}$/.test(t || ''));
    // números: a sequência final da linha, a começar no primeiro com vírgula decimal (números soltos na descrição, como "820", ficam de fora)
    let k = resto.length; while (k > 0 && /^[-–—~=_]?\d{1,7}([.,]\d+)?$/.test(resto[k - 1])) k--;
    let seq = resto.slice(k); const c0 = seq.findIndex(t => /,/.test(t)); if (c0 > 0) { k += c0; seq = seq.slice(c0); }
    const nums = seq.map(ftNumero), pal = resto.slice(0, k);
    const q = nums[idxQtd == null ? 0 : idxQtd];
    out.push({ ean, desc: pal.join(' ').replace(/\s+/g, ' ').trim(), qf: q == null ? 0 : q, semQtd: q == null });
    ultimaItem = true;
  }
  return out;
}

/* ---------- estado ---------- */
let fts = [], ftId = null, ftCur = null, ftNovo = null, ftCarregado = false, ftMontado = false;
const ftAtual = () => fts.find(f => f.id === ftId);
const ftSalvar = () => kvSet('faturas', fts);
const ftNid = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const ftQ = n => fmtQ(n);
const ftNomeArm = v => { const a = FT_ARMS.find(x => x[0] === v); return a ? v + ' · ' + a[1] : v; };

function ftMontar() {
  if (ftMontado) return; ftMontado = true;
  const opArm = FT_ARMS.map(a => '<option value="' + a[0] + '">' + esc(a[0] + ' · ' + a[1]) + '</option>').join('');
  $('#fat').innerHTML =
    '<div class="card" style="margin-top:0"><label>Fatura</label><select id="ft-sel"></select>' +
    '<div class="row"><button class="pri" id="ft-new">➕ Nova fatura</button><button class="red" id="ft-del">🗑 Apagar</button></div></div>' +

    '<div id="ft-novo" class="card" hidden><div class="big">Nova fatura</div>' +
    '<label>Nome (ex: Riosfarias 53692)</label><input type="text" id="ftn-nome" autocomplete="off">' +
    '<label>Armazém de destino</label><select id="ftn-arm"><option value="">— escolher armazém —</option>' + opArm + '</select>' +
    '<label>Ficheiro da fatura (PDF com texto, Excel ou CSV)</label><input type="file" id="ftn-file" accept=".xls,.xlsx,.csv,.txt,.pdf" style="margin:6px 0;width:100%">' +
    '<label id="ftn-grl" hidden>Este PDF tem mais do que uma fatura. Qual?</label><select id="ftn-grp" hidden></select>' +
    '<details style="margin-top:8px"><summary class="muted">Ou colar o texto da fatura (PDF ou foto)</summary>' +
    '<p class="muted">Para uma foto ou um PDF digitalizado: abre a imagem no telemóvel, seleciona e copia o texto (Google Lens no Android, Texto em Direto no iPhone) e cola aqui. Cada artigo tem de ficar numa linha, com o código de barras.</p>' +
    '<textarea id="ftn-txt" rows="8" style="width:100%;font-size:14px;border:1px solid #bbb;border-radius:8px;padding:8px"></textarea>' +
    '<label>Onde está a quantidade na linha?</label><select id="ftn-q"><option value="auto">Automático</option><option value="i0">1.º número depois do código</option><option value="i1">2.º número depois do código</option><option value="i2">3.º número depois do código</option><option value="f1">Último número da linha</option><option value="f2">Penúltimo número</option><option value="f3">3.º número a contar do fim</option><option value="f4">4.º número a contar do fim</option><option value="f5">5.º número a contar do fim</option></select>' +
    '<button class="sec" id="ftn-ler" style="width:100%">Ler o texto</button></details>' +
    '<div id="ftn-prev"></div>' +
    '<div class="row"><button class="pri" id="ftn-ok" disabled>Criar fatura</button><button class="sec" id="ftn-x">Cancelar</button></div></div>' +

    '<div id="ft-vista" hidden>' +
    '<div class="card"><div class="big" id="ftv-nome"></div>' +
    '<label>Armazém de destino</label><select id="ftv-arm">' + opArm + '</select>' +
    '<div id="ftv-prog" class="muted" style="margin:4px 0 8px"></div>' +
    '<div class="row"><button class="pri" id="ftv-cam" style="font-size:20px;padding:16px">📷 Picar</button></div>' +
    '<input type="search" id="ftv-in" placeholder="Código ou nome (Enter)" autocomplete="off" autocapitalize="off" style="margin-top:10px">' +
    '<label class="chk"><input type="checkbox" id="ftv-cont" checked> Abrir a câmara sozinha depois de confirmar</label>' +
    '<div id="ftv-painel" class="card" hidden style="border:2px solid var(--ye)">' +
    '<div id="ftp-desc" class="big"></div><div id="ftp-info" class="muted"></div><div id="ftp-av" class="warn" hidden></div>' +
    '<div class="row" style="margin:8px 0"><div><label>Faturado</label><div id="ftp-qf" class="big"></div></div><div><label>Recebido</label><input type="text" id="ftp-qr" inputmode="decimal" autocomplete="off"></div></div>' +
    '<div class="row"><button class="pri" id="ftp-ok">✔ Confirmar</button><button class="sec" id="ftp-0">0 · não veio</button></div>' +
    '<div class="row"><button class="sec" id="ftp-ed">✏️ Corrigir código</button><button class="sec" id="ftp-x">Cancelar</button></div></div>' +
    '<div id="ftv-assoc" class="card" hidden style="border:2px solid var(--er)"><div id="fta-msg" style="font-weight:bold"></div>' +
    '<div class="muted" style="margin:6px 0">Se é um artigo da fatura com o código de barras errado, toca na linha certa. Assim fica tudo na mesma linha e o .plt leva o teu código.</div>' +
    '<input type="search" id="fta-in" placeholder="Procurar na fatura (nome)" autocomplete="off"><div id="fta-lista" style="max-height:260px;overflow:auto"></div>' +
    '<div class="row"><button class="sec" id="fta-extra">➕ Não está na fatura (linha a mais)</button><button class="sec" id="fta-x">Cancelar</button></div></div>' +
    '<div class="row" style="margin-top:8px"><button class="sec" id="ftv-plt0">⚡ PLT sem picar</button><button class="sec" id="ftv-rel">📊 Terminar e ver relatório</button></div></div>' +
    '<div id="ftv-relat"></div>' +
    '<label>Mostrar</label><select id="ftv-filtro"><option value="todas">Todas as linhas</option><option value="porpicar">Por picar</option><option value="dif">Com diferenças</option><option value="novos">Artigos novos</option></select>' +
    '<div id="ftv-lista"></div></div>';

  $('#ft-sel').addEventListener('change', e => ftAbrir(e.target.value));
  $('#ft-new').addEventListener('click', ftNovoAbrir);
  $('#ft-del').addEventListener('click', ftApagar);
  $('#ftn-file').addEventListener('change', ftNovoFicheiro);
  $('#ftn-grp').addEventListener('change', ftPdfMostrar);
  $('#ftn-ler').addEventListener('click', ftNovoTexto);
  $('#ftn-q').addEventListener('change', ftNovoTexto);
  $('#ftn-ok').addEventListener('click', ftNovoCriar);
  $('#ftn-x').addEventListener('click', () => { $('#ft-novo').hidden = true; ftNovo = null; ftRender(); });
  $('#ftv-arm').addEventListener('change', async e => { const f = ftAtual(); if (f) { f.arm = e.target.value; await ftSalvar(); } });
  $('#ftv-cam').addEventListener('click', ftCamara);
  $('#ftv-in').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const t = limpar(e.target.value); if (t) { ftPicado(t, true); e.target.value = ''; } } });
  $('#ftv-filtro').addEventListener('change', ftRender);
  $('#ftv-lista').addEventListener('click', e => { const it = e.target.closest('.item'); const f = ftAtual(); if (!it || !f) return; const l = f.linhas.find(x => x.id === it.dataset.id); if (l) ftPainel(l); });
  $('#fta-in').addEventListener('input', ftAssocLista);
  $('#fta-lista').addEventListener('click', e => { const it = e.target.closest('.item'); if (it) ftAssocEscolher(it.dataset.id); });
  $('#fta-extra').addEventListener('click', ftAssocExtra);
  $('#fta-x').addEventListener('click', ftAssocFechar);
  $('#ftp-ok').addEventListener('click', () => ftConfirmar(false));
  $('#ftp-0').addEventListener('click', () => ftConfirmar(true));
  $('#ftp-x').addEventListener('click', () => { ftCur = null; $('#ftv-painel').hidden = true; });
  $('#ftp-ed').addEventListener('click', ftCorrigir);
  $('#ftp-qr').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ftConfirmar(false); } });
  $('#ftv-plt0').addEventListener('click', () => ftExportar(true));
  $('#ftv-rel').addEventListener('click', ftRelatorio);
}

async function ftAbrirSeparador() {
  ftMontar();
  if (!ftCarregado) {
    ftCarregado = true;
    try { fts = (await kvGet('faturas')) || []; const g = await kvGet('faturaId'); ftId = fts.some(f => f.id === g) ? g : (fts[0] ? fts[0].id : null); } catch (e) { fts = []; }
  }
  ftRender();
}

/* ---------- nova fatura ---------- */
function ftNovoAbrir() {
  ftNovo = null; $('#ftn-nome').value = ''; $('#ftn-nome').dataset.base = ''; $('#ftn-arm').value = ''; $('#ftn-file').value = ''; $('#ftn-txt').value = ''; $('#ftn-prev').innerHTML = ''; $('#ftn-ok').disabled = true;
  $('#ft-novo').hidden = false; $('#ftn-nome').focus(); window.scrollTo(0, 0);
}
async function ftNovoFicheiro(e) {
  const f = e.target.files[0]; if (!f) return;
  try {
    const r = await ftLerFicheiro(f);
    if (r.tipo === 'pdf') {
      if (!r.texto) { $('#ftn-prev').innerHTML = '<div class="bad">Este PDF é uma imagem (digitalizado) e não tem texto. Abre-o no telemóvel, copia o texto e cola-o em "Ou colar o texto da fatura".</div>'; ftNovo = null; $('#ftn-ok').disabled = true; return; }
      ftGrp = r.grupos; const sel = $('#ftn-grp');
      sel.innerHTML = r.grupos.map((g, i) => '<option value="' + i + '">Fatura ' + esc(g.id || '(única)') + '</option>').join('') + (r.grupos.length > 1 ? '<option value="todas">Todas juntas</option>' : '');
      sel.hidden = r.grupos.length < 2; $('#ftn-grl').hidden = sel.hidden;
      if (!$('#ftn-nome').value.trim()) $('#ftn-nome').value = f.name.replace(/\.[^.]+$/, '');
      ftPdfMostrar(); return;
    }
    let linhas = ftLinhasDeTabela(r.rows);
    if (!linhas.length && r.texto) linhas = ftLinhasDeTexto(r.texto, 'auto');
    if (!$('#ftn-nome').value.trim()) $('#ftn-nome').value = f.name.replace(/\.[^.]+$/, '');
    ftNovoMostrar(linhas, f.name);
  } catch (err) { $('#ftn-prev').innerHTML = '<div class="bad">Não consegui ler o ficheiro: ' + esc(err.message) + '</div>'; ftNovo = null; $('#ftn-ok').disabled = true; }
}
let ftGrp = [];
function ftPdfMostrar() {
  const v = $('#ftn-grp').value, g = v === 'todas' ? { id: '', texto: ftGrp.map(x => x.texto).join('\n') } : ftGrp[+v || 0];
  { const n = $('#ftn-nome'); if (!n.dataset.base) n.dataset.base = n.value.trim(); if (g.id && v !== 'todas') n.value = (n.dataset.base ? n.dataset.base + ' ' : '') + g.id; else if (v === 'todas') n.value = n.dataset.base; }
  const idx = /T\.?\s*CANTIDAD/i.test(g.texto) ? 2 : 0;
  ftNovoMostrar(ftLinhasDeTexto(g.texto, idx), 'PDF' + (g.id && v !== 'todas' ? ' · fatura ' + g.id : ''));
}
function ftNovoTexto() {
  const t = $('#ftn-txt').value; if (!t.trim()) return;
  ftNovoMostrar(ftLinhasDeTexto(t, $('#ftn-q').value), 'texto colado');
}
function ftNovoMostrar(linhas, origem) {
  ftNovo = linhas.map(l => ({ id: ftNid(), ean: l.ean, desc: l.desc, qf: l.qf, qr: null, extra: false }));
  const rep = new Set(); ftNovo.forEach((l, i) => { if (ftCodigoOk(l.ean) && ftNovo.findIndex(x => x.ean === l.ean) !== i) rep.add(l.ean); });
  const inval = ftNovo.filter(l => !ftCodigoOk(l.ean)), novos = ftNovo.filter(l => ftCodigoOk(l.ean) && !lookup(l.ean));
  const amostra = ftNovo.slice(0, 6).map(l => '<div class="item"><div class="t"><b>' + esc(l.desc || '(sem descrição)') + '</b><span class="muted">' + esc(l.ean) + (ftCodigoOk(l.ean) ? '' : ' · ⚠ código inválido') + '</span></div><div class="q">' + esc(ftQ(l.qf)) + '</div></div>').join('');
  $('#ftn-prev').innerHTML = '<div class="card"><b>' + ftNovo.length + ' linhas lidas</b> de ' + esc(origem) +
    (inval.length ? '<div class="bad">⚠ ' + inval.length + ' com código de barras inválido ou que não é código de barras (ex.: código do fornecedor). Essas linhas ficam de fora do .plt até as corrigires.</div>' : '') +
    (novos.length ? '<div class="warn">🆕 ' + novos.length + ' artigos que ainda não estão na tua lista (vão aparecer com a descrição da fatura).</div>' : '') +
    (rep.size ? '<div class="muted">' + rep.size + ' artigos aparecem em mais do que uma linha da fatura; ficam em linhas separadas e picas cada uma.</div>' : '') + (linhas.some(l => l.semQtd) ? '<div class="warn">Há linhas sem quantidade reconhecida.</div>' : '') + '</div>' + amostra +
    (ftNovo.length > 6 ? '<div class="muted" style="margin:6px 0">… e mais ' + (ftNovo.length - 6) + ' linhas.</div>' : '');
  $('#ftn-ok').disabled = !ftNovo.length;
  if (!ftNovo.length) $('#ftn-prev').innerHTML = '<div class="bad">Não encontrei linhas com código de barras. Confirma que a fatura tem o código de barras de cada artigo.</div>';
}
async function ftNovoCriar() {
  if (!ftNovo || !ftNovo.length) return;
  const nome = $('#ftn-nome').value.trim(), arm = $('#ftn-arm').value;
  if (!nome) { toast('Escreve um nome para a fatura.', 3000); $('#ftn-nome').focus(); return; }
  if (!arm) { toast('Escolhe o armazém de destino (1 ou 3).', 3500); $('#ftn-arm').focus(); return; }
  const f = { id: ftNid(), nome, arm, t: Date.now(), exp: null, linhas: ftNovo };
  fts.push(f); ftNovo = null; $('#ft-novo').hidden = true;
  await ftSalvar(); ftAbrir(f.id);
  toast('Fatura "' + nome + '" criada com ' + f.linhas.length + ' linhas.', 3500);
}
async function ftApagar() {
  const f = ftAtual(); if (!f) return;
  if (!await dlg('Apagar a fatura "' + f.nome + '" e as suas ' + f.linhas.length + ' linhas? Esta ação não se desfaz.')) return;
  fts = fts.filter(x => x !== f); ftId = fts[0] ? fts[0].id : null; await ftSalvar(); await kvSet('faturaId', ftId); ftCur = null; ftRender();
}
function ftAbrir(id) { ftId = id; kvSet('faturaId', id); ftCur = null; $('#ftv-relat').innerHTML = ''; ftRender(); }

/* ---------- ecrã da fatura ---------- */
function ftEstado(l) {   // 'por' | 'ok' | 'dif'
  if (l.qr === null || l.qr === undefined) return 'por';
  return Math.abs(l.qr - l.qf) < 0.0005 ? 'ok' : 'dif';
}
function ftRender() {
  if (!ftMontado) return;
  $('#ft-sel').innerHTML = fts.length ? fts.map(f => '<option value="' + esc(f.id) + '">' + esc(f.nome) + ' · ' + f.linhas.length + ' linhas' + (f.exp ? ' · ✔ PLT gerado' : '') + '</option>').join('') : '<option value="">(nenhuma fatura)</option>';
  const f = ftAtual(); if (f) $('#ft-sel').value = f.id;
  $('#ft-vista').hidden = !f;
  if (!f) { return; }
  $('#ftv-nome').textContent = f.nome; $('#ftv-arm').value = f.arm;
  const pr = f.linhas.filter(l => !l.extra && ftEstado(l) === 'por').length, tot = f.linhas.filter(l => !l.extra).length;
  const inval = f.linhas.filter(l => !ftCodigoOk(l.ean)).length, novos = f.linhas.filter(l => ftCodigoOk(l.ean) && !lookup(l.ean)).length;
  $('#ftv-prog').innerHTML = (tot - pr) + ' de ' + tot + ' linhas picadas · armazém ' + esc(ftNomeArm(f.arm)) +
    (inval ? '<br><b style="color:var(--er)">⚠ ' + inval + ' linhas com código inválido</b>' : '') + (novos ? '<br>🆕 ' + novos + ' artigos novos' : '');
  const fil = $('#ftv-filtro').value;
  const ls = f.linhas.filter(l => fil === 'todas' || (fil === 'porpicar' && ftEstado(l) === 'por') || (fil === 'dif' && ftEstado(l) === 'dif') || (fil === 'novos' && ftCodigoOk(l.ean) && !lookup(l.ean)));
  $('#ftv-lista').innerHTML = ls.map(l => {
    const e = ftEstado(l), a = ftCodigoOk(l.ean) ? lookup(l.ean) : null;
    const marca = (!ftCodigoOk(l.ean) ? ' · ⚠ código inválido' : (!a ? ' · 🆕 novo' : '')) + (l.extra ? ' · fora da fatura' : '') + (l.corr ? ' · código corrigido' : '');
    const cor = e === 'ok' ? 'var(--ok)' : e === 'dif' ? 'var(--er)' : '#888';
    return '<div class="item click" data-id="' + esc(l.id) + '"><div class="t"><b>' + esc(l.desc || (a ? a.desc : '(sem descrição)')) + '</b><span class="muted">' + esc(l.ean) + marca + '</span></div>' +
      '<div class="q" style="color:' + cor + ';font-size:16px">Fat. ' + esc(ftQ(l.qf)) + '<br>Rec. ' + (e === 'por' ? '—' : esc(ftQ(l.qr))) + '</div></div>';
  }).join('') || '<div class="muted" style="padding:10px">Sem linhas neste filtro.</div>';
}

/* ---------- picar ---------- */
function ftCandidatos(raw) {
  const set = new Set(), t = limpar(raw); set.add(t); set.add(converter(t));
  try { const gs = infoGS1(parseGS1(raw)); if (gs && gs.contido) { set.add(gs.contido); set.add(converter('01' + gs.contido)); } } catch (e) { }
  const out = []; set.forEach(x => { if (x) { out.push(x); const s = x.replace(/^0+/, ''); if (s && s !== x) out.push(s); } });
  return out;
}
function ftAcha(f, raw) {
  const cand = ftCandidatos(raw), cs = new Set(cand.map(x => x.replace(/^0+/, '')));
  const iguais = f.linhas.filter(x => cs.has(String(x.ean).replace(/^0+/, '')));
  if (iguais.length) return iguais.find(x => ftEstado(x) === 'por') || iguais[0];
  let l;
  const arts = new Set(); cand.forEach(c => { const a = lookup(c); if (a && a.cod) arts.add(a.cod); });   // outro código de barras do mesmo artigo
  if (arts.size) { const m = f.linhas.filter(x => { const a = ftCodigoOk(x.ean) ? lookup(x.ean) : null; return a && arts.has(a.cod); }); l = m.find(x => ftEstado(x) === 'por') || m[0]; }
  return l || null;
}
async function ftCamara() {
  const f = ftAtual(); if (!f) return;
  if (!f.arm) { toast('Escolhe primeiro o armazém de destino.', 3500); $('#ftv-arm').focus(); return; }
  const raw = await lerCodigo(); if (raw) ftPicado(raw, false);
}
let ftAssoc = null;
function ftAssocFechar() { const m = ftAssoc && !ftAssoc.manual; ftAssoc = null; $('#ftv-assoc').hidden = true; if (m && $('#ftv-cont').checked) setTimeout(ftCamara, 300); }
function ftAssocLista() {
  const f = ftAtual(); if (!f || !ftAssoc) return;
  const nt = norm($('#fta-in').value).split(/\s+/).filter(Boolean);
  const ls = f.linhas.filter(x => !x.extra && ftEstado(x) === 'por' && nt.every(p => norm(x.desc + ' ' + x.ean).includes(p)));
  ls.sort((x, y) => (ftCodigoOk(x.ean) && lookup(x.ean) ? 1 : 0) - (ftCodigoOk(y.ean) && lookup(y.ean) ? 1 : 0));
  $('#fta-lista').innerHTML = ls.map(x => '<div class="item click" data-id="' + esc(x.id) + '"><div class="t"><b>' + esc(x.desc || '(sem descrição)') + '</b><span class="muted">' + esc(x.ean) + (ftCodigoOk(x.ean) && lookup(x.ean) ? '' : ' · código suspeito') + '</span></div><div class="q" style="font-size:16px">Fat. ' + esc(ftQ(x.qf)) + '</div></div>').join('') || '<div class="muted" style="padding:8px">Nenhuma linha por picar com esse nome.</div>';
}
async function ftAssocEscolher(id) {
  const f = ftAtual(); if (!f || !ftAssoc) return;
  const l = f.linhas.find(x => x.id === id); if (!l) return;
  const raw = ftAssoc.raw, novo = ftCandidatos(raw).find(ftCodigoOk) || limpar(raw);
  if (l.ean !== novo) { if (!l.eanFatura) l.eanFatura = l.ean; l.ean = novo; l.corr = true; }
  await ftSalvar(); ftAssoc = null; $('#ftv-assoc').hidden = true; ftRender(); ftPainel(l, raw);
}
async function ftAssocExtra() {
  const f = ftAtual(); if (!f || !ftAssoc) return;
  const raw = ftAssoc.raw, a = lookup(converter(limpar(raw))) || lookup(limpar(raw));
  const ean = ftCandidatos(raw).find(ftCodigoOk) || limpar(raw);
  let l = f.linhas.find(x => x.extra && x.ean === ean), desc = a ? a.desc : '';
  if (!l) {
    if (!a) { const d = await dlg('Este código não está na tua lista nem na fatura (' + ean + ').\nEscreve a descrição do artigo (para o relatório):', ''); if (d === null) return; desc = d.trim(); }
    l = { id: ftNid(), ean, desc, qf: 0, qr: null, extra: true }; f.linhas.push(l);
  }
  await ftSalvar(); ftAssoc = null; $('#ftv-assoc').hidden = true; ftRender(); ftPainel(l, raw);
}
async function ftPicado(raw, manual) {
  const f = ftAtual(); if (!f) return;
  let l = ftAcha(f, raw);
  if (!l) {
    const t = limpar(raw);
    // pesquisa por nome quando escreveram texto
    if (manual && !/^\d+$/.test(t)) {
      const nt = norm(t).split(/\s+/);
      const c = f.linhas.filter(x => nt.every(p => norm(x.desc).includes(p)));
      if (c.length === 1) l = c[0];
      else if (c.length > 1) { $('#ftv-filtro').value = 'todas'; $('#ftv-lista').innerHTML = c.map(x => '<div class="item click" data-id="' + esc(x.id) + '"><div class="t"><b>' + esc(x.desc) + '</b><span class="muted">' + esc(x.ean) + '</span></div><div class="q" style="font-size:16px">Fat. ' + esc(ftQ(x.qf)) + '</div></div>').join(''); toast(c.length + ' linhas correspondem. Toca na que queres.', 3500); return; }
      else { toast('Nenhuma linha da fatura com "' + t + '".', 3000); return; }
    }
  }
  if (!l) {
    ftAssoc = { raw, manual };
    const a = lookup(converter(limpar(raw))) || lookup(limpar(raw));
    $('#fta-msg').textContent = 'Este código não consta da fatura: ' + limpar(raw) + (a ? ' · ' + a.desc : ' · (artigo não identificado)');
    $('#fta-in').value = a ? '' : ''; ftAssocLista();
    $('#ftv-painel').hidden = true; $('#ftv-assoc').hidden = false; $('#ftv-assoc').scrollIntoView({ block: 'nearest' });
    return;
  }
  ftPainel(l, raw);
}
function ftPainel(l, raw) {
  ftCur = l;
  const a = ftCodigoOk(l.ean) ? lookup(l.ean) : null;
  $('#ftp-desc').textContent = l.desc || (a ? a.desc : '(sem descrição)');
  const caixa = raw && limpar(raw).replace(/^0+/, '') !== String(l.ean).replace(/^0+/, '') && ftCandidatos(raw).every(c => c.replace(/^0+/, '') !== String(l.ean).replace(/^0+/, ''));
  $('#ftp-info').innerHTML = esc(l.ean) + (a ? '<br>Na tua lista: ' + esc(a.desc) + (a.preco ? ' · ' + esc(fmtPreco(a.preco)) : '') : (ftCodigoOk(l.ean) ? '<br>🆕 Artigo novo: ainda não está na tua lista' : ''));
  const av = [];
  if (!ftCodigoOk(l.ean)) av.push('⚠ Este código não é um código de barras válido. Corrige-o para entrar no .plt.');
  if (l.extra) av.push('Este artigo não consta da fatura.');
  if (l.corr) av.push('Código corrigido: na fatura vinha ' + l.eanFatura + '.');
  if (caixa) av.push('Leste outro código do mesmo artigo (por exemplo da caixa). Confirma a quantidade em unidades.');
  $('#ftp-av').hidden = !av.length; $('#ftp-av').innerHTML = av.map(esc).join('<br>');
  $('#ftp-qf').textContent = ftQ(l.qf);
  $('#ftp-qr').value = ftQ(l.qr === null || l.qr === undefined ? l.qf : l.qr);
  $('#ftv-painel').hidden = false; $('#ftv-painel').scrollIntoView({ block: 'nearest' });
  const q = $('#ftp-qr'); q.focus(); q.select();
}
async function ftConfirmar(zero) {
  const f = ftAtual(), l = ftCur; if (!f || !l) return;
  let v = 0;
  if (!zero) { v = numS($('#ftp-qr').value); if (v === null || v < 0) { toast('Escreve uma quantidade válida.', 3000); return; } }
  l.qr = Math.round(v * 1000) / 1000;
  await ftSalvar(); ftCur = null; $('#ftv-painel').hidden = true; ftRender();
  if (navigator.vibrate) navigator.vibrate(30);
  if ($('#ftv-cont').checked && document.activeElement && document.activeElement.id !== 'ftv-in') setTimeout(ftCamara, 250);
}
async function ftCorrigir() {
  const f = ftAtual(), l = ftCur; if (!f || !l) return;
  const novo = await dlg('Código de barras correto para "' + (l.desc || l.ean) + '":', l.ean);
  if (novo === null) return;
  const c = limpar(novo).replace(/\s+/g, '');
  if (!c) return;
  l.ean = c; await ftSalvar(); ftRender(); ftPainel(l);
  if (!ftCodigoOk(c)) toast('Atenção: este código continua inválido (dígito de controlo).', 4000);
}

/* ---------- relatório ---------- */
function ftRelatorioDados(f) {
  const falta = [], menos = [], mais = [], extras = [], ok = [];
  f.linhas.forEach(l => {
    const rec = l.qr === null || l.qr === undefined ? 0 : l.qr, naoPicado = l.qr === null || l.qr === undefined;
    if (l.extra) { if (rec > 0) extras.push({ l, rec }); return; }
    if (naoPicado) falta.push({ l, rec: 0 });
    else if (rec < l.qf - 0.0005) menos.push({ l, rec });
    else if (rec > l.qf + 0.0005) mais.push({ l, rec });
    else ok.push({ l, rec });
  });
  return { falta, menos, mais, extras, ok };
}
function ftRelatorioTexto(f) {
  const d = ftRelatorioDados(f), L = [];
  const sec = (tit, arr, fn) => { if (arr.length) { L.push('', tit + ' (' + arr.length + ')'); arr.forEach(x => L.push('- ' + fn(x))); } };
  L.push('Fatura: ' + f.nome, 'Armazém: ' + ftNomeArm(f.arm), 'Linhas certas: ' + d.ok.length);
  const nm = x => (x.l.desc || '(sem descrição)') + ' [' + x.l.ean + ']' + (x.l.corr ? ' (código da fatura: ' + x.l.eanFatura + ')' : '');
  sec('NÃO PICADOS (contam como 0)', d.falta, x => nm(x) + ' · faturado ' + ftQ(x.l.qf));
  sec('MENOS DO QUE O FATURADO', d.menos, x => nm(x) + ' · faturado ' + ftQ(x.l.qf) + ' · recebido ' + ftQ(x.rec));
  sec('MAIS DO QUE O FATURADO', d.mais, x => nm(x) + ' · faturado ' + ftQ(x.l.qf) + ' · recebido ' + ftQ(x.rec));
  sec('CÓDIGO DE BARRAS CORRIGIDO (erro do fornecedor)', f.linhas.filter(l => l.corr), l => (l.desc || '(sem descrição)') + ' · fatura ' + l.eanFatura + ' → ' + l.ean);
  sec('FORA DA FATURA', d.extras, x => nm(x) + ' · recebido ' + ftQ(x.rec));
  const novos = f.linhas.filter(l => ftCodigoOk(l.ean) && !lookup(l.ean));
  sec('ARTIGOS NOVOS (não estão na lista)', novos, l => (l.desc || '(sem descrição)') + ' [' + l.ean + ']');
  const inval = f.linhas.filter(l => !ftCodigoOk(l.ean));
  sec('CÓDIGOS INVÁLIDOS (ficam fora do .plt)', inval, l => (l.desc || '(sem descrição)') + ' [' + l.ean + ']');
  return L.join('\r\n') + '\r\n';
}
function ftRelatorio() {
  const f = ftAtual(); if (!f) return;
  const d = ftRelatorioDados(f);
  const bloco = (tit, cor, arr, fn) => arr.length ? '<div class="card"><b style="color:' + cor + '">' + tit + ' (' + arr.length + ')</b>' + arr.map(x => '<div style="border-top:1px solid #eee;padding:6px 0">' + fn(x) + '</div>').join('') + '</div>' : '';
  const nm = x => '<b>' + esc(x.l.desc || '(sem descrição)') + '</b><br><span class="muted">' + esc(x.l.ean) + (x.l.corr ? ' · código corrigido (fatura: ' + esc(x.l.eanFatura) + ')' : '') + '</span>';
  $('#ftv-relat').innerHTML = '<div class="card"><div class="big">Relatório</div>' + d.ok.length + ' linhas certas de ' + f.linhas.filter(l => !l.extra).length + '</div>' +
    bloco('❌ Não picados (contam como 0)', 'var(--er)', d.falta, x => nm(x) + '<br>Faturado ' + esc(ftQ(x.l.qf))) +
    bloco('⬇️ Menos do que o faturado', 'var(--er)', d.menos, x => nm(x) + '<br>Faturado ' + esc(ftQ(x.l.qf)) + ' · recebido ' + esc(ftQ(x.rec))) +
    bloco('⬆️ Mais do que o faturado', '#b26a00', d.mais, x => nm(x) + '<br>Faturado ' + esc(ftQ(x.l.qf)) + ' · recebido ' + esc(ftQ(x.rec))) +
    bloco('➕ Fora da fatura', '#b26a00', d.extras, x => nm(x) + '<br>Recebido ' + esc(ftQ(x.rec))) +
    '<div class="card"><label class="chk"><input type="checkbox" id="ftr-zero"> Incluir no .plt as linhas com quantidade 0</label>' +
    '<div class="row"><button class="pri" id="ftr-plt">⬇️ Gerar .plt</button><button class="sec" id="ftr-share">📤 Partilhar .plt</button></div>' +
    '<button class="sec" id="ftr-txt" style="width:100%;margin-top:8px">📝 Partilhar relatório (texto)</button></div>';
  $('#ftr-plt').onclick = () => ftExportar(false, 'down');
  $('#ftr-share').onclick = () => ftExportar(false, 'share');
  $('#ftr-txt').onclick = () => ftPartilharTexto(f);
  $('#ftv-relat').scrollIntoView({ block: 'start' });
}
async function ftPartilharTexto(f) {
  const t = ftRelatorioTexto(f), nome = 'relatorio_' + (norm(f.nome).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'fatura') + '.txt';
  const file = new File([t], nome, { type: 'text/plain' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Relatório da fatura ' + f.nome }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  transferir(t, nome);
}

/* ---------- .plt ---------- */
function ftConstruirPlt(f, semPicar, incluirZero) {
  const linhas = [], invalidos = [];
  f.linhas.forEach(l => {   // uma linha do .plt por linha da fatura, pela mesma ordem
    if (!ftCodigoOk(l.ean)) { invalidos.push(l); return; }
    const q = Math.round((semPicar ? l.qf : (l.qr === null || l.qr === undefined ? 0 : l.qr)) * 1000) / 1000;
    if (q === 0 && !incluirZero) return;
    linhas.push(String(l.ean).trim() + '|' + f.arm + '|||' + String(q));
  });
  return { texto: linhas.length ? linhas.join('\r\n') + '\r\n' : '', n: linhas.length, invalidos };
}
async function ftExportar(semPicar, modo) {
  const f = ftAtual(); if (!f) return;
  if (!f.arm) { toast('Escolhe primeiro o armazém de destino.', 3500); $('#ftv-arm').focus(); return; }
  const zero = !!($('#ftr-zero') && $('#ftr-zero').checked);
  const r = ftConstruirPlt(f, semPicar, zero);
  if (!r.n) { toast('Não há linhas para o .plt.', 3500); return; }
  const dif = semPicar ? 0 : f.linhas.filter(l => !l.extra && (l.qr === null || l.qr === undefined)).length;
  let msg = (semPicar ? 'Gerar o .plt com as quantidades faturadas (sem picar)?' : 'Gerar o .plt com as quantidades recebidas?') + '\n' + r.n + ' linhas · armazém ' + ftNomeArm(f.arm);
  if (dif) msg += '\n\n⚠ ' + dif + ' linhas por picar contam como 0 e ficam de fora.';
  if (r.invalidos.length) msg += '\n\n⚠ ' + r.invalidos.length + ' linhas com código de barras inválido ficam de fora:\n' + r.invalidos.slice(0, 5).map(l => '· ' + (l.desc || l.ean)).join('\n') + (r.invalidos.length > 5 ? '\n· …' : '');
  if (!await dlg(msg)) return;
  const nome = nomePlt(f.arm, f.nome);
  if (modo === 'share') {
    const file = new File([r.texto], nome, { type: 'application/octet-stream' });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: f.nome, text: f.nome + ' (armazém ' + f.arm + ')' }); f.exp = Date.now(); await ftSalvar(); ftRender(); return; } } catch (e) { if (e.name === 'AbortError') return; }
  }
  transferir(r.texto, nome); f.exp = Date.now(); await ftSalvar(); ftRender();
  toast('Ficheiro ' + nome + ' guardado em Transferências.', 5000);
}

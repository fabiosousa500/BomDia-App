'use strict';
/* ====================================================================
   Etiquetas de prateleira (66 × 31,5 mm, 3 × 9 por folha A4) em PDF
   ==================================================================== */
const ET = { W: 66, H: 31.5, C: 3, R: 9, MX: 6, MY: 6.75 };
const ETQ_PXMM = 300 / 25.4;
let etqs = [], etqOver = {}, etqCarregado = false, etqMontado = false, etqImg = {};

/* ---------- conteúdo (litros / kg) tirado da descrição ---------- */
function etqConteudo(d) {
  const re = /(^|[^\w.,])(?:(\d{1,3})\s*[xX*]\s*)?(\d+(?:[.,]\d+)?)\s*(kgs?|grs?|g|cl|ml|lts?|l)(?![A-Za-zÀ-ÿ0-9])/gi, c = [];
  let m;
  while ((m = re.exec(String(d || '')))) {
    const mult = m[2] ? parseInt(m[2], 10) : 1, v = parseFloat(m[3].replace(',', '.')), un = m[4].toLowerCase();
    let f, t;
    if (/^kg/.test(un)) { f = 1; t = 'kg'; } else if (/^g/.test(un)) { f = .001; t = 'kg'; }
    else if (un === 'cl') { f = v < 1 ? 1 : .01; t = 'L'; }   // "0,33cl" na descrição quer dizer 33 cl
    else if (un === 'ml') { f = .001; t = 'L'; } else { f = 1; t = 'L'; }
    const tot = mult * v * f; if (!(tot > 0)) continue;
    c.push({ v: Math.round(tot * 10000) / 10000, u: t, mult: m[2] ? 1 : 0, txt: m[0].trim() });
  }
  if (!c.length) return null;
  const pick = c.find(x => x.mult) || c[0];
  const amb = c.some(x => x.u !== pick.u || Math.abs(x.v - pick.v) > pick.v * 0.02);
  return { v: pick.v, u: pick.u, amb, txt: pick.txt };
}

/* ---------- uma etiqueta a partir de um artigo ---------- */
const etqNid = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function etqNova(a, lido) {
  const cod = a.cod || a.bar, ov = etqOver[cod] || {}, bal = !!a.rg, em = emb(a, lido || a.bar);
  const cont = ov.cv != null ? { v: ov.cv, u: ov.cu, amb: false, conf: true } : (bal ? null : etqConteudo(a.desc));
  return {
    id: etqNid(), cod, bar: a.bar || '', lido: lido || '', desc: ov.desc || a.desc, preco: numPT(a.preco), bal,
    cv: cont ? cont.v : 0, cu: cont ? cont.u : 'L', conf: !!(cont && cont.conf), amb: !!(cont && cont.amb),
    volta: ov.volta != null ? !!ov.volta : voltaFator(a.bar || a.cod) > 0,
    cx: em ? { q: em.q, pu: em.pu } : null, copias: 1, bc: !bal
  };
}
function etqPreco(e) { return e.cx ? Math.round(e.cx.q * e.cx.pu * 100) / 100 : e.preco; }
function etqPPU(e) {   // preço por litro / kg
  if (e.bal || !(e.cv > 0)) return null;
  return (e.cx ? e.cx.pu : e.preco) / e.cv;
}
const etqF2 = n => n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const etqF3 = n => n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/* ---------- código de barras EAN-13 / EAN-8 ---------- */
function etqBarras(c) {
  if (!ftGtinOk(c) || (c.length !== 13 && c.length !== 8)) return null;
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R = L.map(x => x.replace(/[01]/g, m => m === '0' ? '1' : '0')), G = R.map(x => x.split('').reverse().join(''));
  const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  let b = '101';
  if (c.length === 13) { const p = P[+c[0]]; for (let i = 1; i < 7; i++) b += (p[i - 1] === 'L' ? L : G)[+c[i]]; b += '01010'; for (let i = 7; i < 13; i++) b += R[+c[i]]; }
  else { for (let i = 0; i < 4; i++) b += L[+c[i]]; b += '01010'; for (let i = 4; i < 8; i++) b += R[+c[i]]; }
  return b + '101';
}

/* ---------- desenho de uma etiqueta (s = pixéis por mm) ---------- */
function etqDesenhar(ctx, ox, oy, e, s, guia) {
  const X = v => ox + v * s, Y = v => oy + v * s, W = ET.W, H = ET.H, mm = pt => pt * 0.3528 * s;
  const fam = 'Arial, Helvetica, sans-serif', fnt = (pt, w) => (w || 'bold') + ' ' + mm(pt) + 'px ' + fam;
  ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, W * s, H * s);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  // logo
  if (etqImg.logo && etqImg.logo.complete && etqImg.logo.naturalWidth) ctx.drawImage(etqImg.logo, X(2.4), Y(1.6), 8 * s, 8 * s);
  // descrição (até 2 linhas, 3 se for preciso)
  const wrap = (txt, maxW) => { const w = txt.split(/\s+/), out = []; let cur = ''; w.forEach(p => { const t = cur ? cur + ' ' + p : p; if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = p; } else cur = t; }); if (cur) out.push(cur); return out; };
  const dW = (W - 11.6 - 2.4) * s, dsc = String(e.desc || '').toUpperCase();
  let pt = 8.2, lh = 3.2, ls;
  ctx.font = fnt(pt); ls = wrap(dsc, dW);
  if (ls.length > 2) { pt = 7; lh = 2.8; ctx.font = fnt(pt); ls = wrap(dsc, dW); }
  if (ls.length > 3) { ls = ls.slice(0, 3); let t = ls[2]; while (t.length > 1 && ctx.measureText(t + '…').width > dW) t = t.slice(0, -1); ls[2] = t + '…'; }
  ctx.fillStyle = '#000'; ls.forEach((t, i) => ctx.fillText(t, X(11.6), Y(1.8 + 2.5 + i * lh)));
  // preço e preço por unidade de medida
  const preco = etqPreco(e), ppu = etqPPU(e), un = e.cu === 'kg' ? 'kg' : 'litro';
  const cx = !!e.cx, volta = !!e.volta;
  if (cx) {
    ctx.font = fnt(6.8); const t = 'CAIXA DE ' + (Math.round(e.cx.q * 1000) / 1000).toString().replace('.', ',') + ' UNIDADES', tw = ctx.measureText(t).width;
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(X(2.6), Y(10.6), tw + 2.8 * s, 3.6 * s, 0.6 * s) : ctx.rect(X(2.6), Y(10.6), tw + 2.8 * s, 3.6 * s); ctx.fill();
    ctx.fillStyle = '#FEC400'; ctx.fillText(t, X(2.6 + 1.4), Y(10.6 + 2.65));
    ctx.fillStyle = '#000'; ctx.font = fnt(7);
    ctx.fillText(etqF3(e.cx.pu) + ' € cada' + (ppu ? ' · ' + etqF2(ppu) + ' € / ' + un : ''), X(2.6), Y(18.1));
  } else if (ppu) { ctx.fillStyle = '#000'; ctx.font = fnt(7.4); ctx.fillText(etqF2(ppu) + ' € / ' + un, X(2.6), Y(volta ? 17.4 : 18.4)); }
  const uEnd = cx ? 40 : (ppu ? 2.6 + ctx.measureText(etqF2(ppu) + ' € / ' + un).width / s : 2.6);
  if (volta) {
    if (etqImg.volta && etqImg.volta.complete && etqImg.volta.naturalWidth) ctx.drawImage(etqImg.volta, X(2.6), Y(19.1), 5.2 * s, 5.2 * s);
    ctx.fillStyle = '#000'; ctx.font = fnt(6.6); ctx.fillText('+ 0,10 € Volta', X(9), Y(22.4));
  }
  // código de barras
  if (e.bc) { const b = etqBarras(e.bar); if (b) { const mw = 24 / b.length; ctx.fillStyle = '#000'; for (let i = 0; i < b.length; i++) if (b[i] === '1') ctx.fillRect(X(2.6 + i * mw), Y(24.9), mw * s + 0.4, 5.2 * s); } }
  // bloco amarelo do preço
  let ppt = cx ? 22 : 24, sm = e.bal ? '€/kg' : '€', txt = etqF2(preco), bw, mw2, sw;
  const medir = () => { ctx.font = fnt(ppt); mw2 = ctx.measureText(txt).width; ctx.font = fnt(ppt * .54); sw = ctx.measureText(sm).width; bw = mw2 + .5 * s + sw + 5 * s; };
  medir(); while (ppt > 14 && (W - bw / s) < uEnd + 1.5) { ppt -= 1; medir(); }
  const bx = X(W) - bw, bh = ppt * 0.3528 + 1.8, by = Y(H - 5.4) - bh * s, r = 2.2 * s;
  ctx.fillStyle = '#FEC400'; ctx.beginPath(); ctx.moveTo(X(W), by); ctx.lineTo(bx + r, by); ctx.arcTo(bx, by, bx, by + r, r); ctx.lineTo(bx, by + bh * s - r); ctx.arcTo(bx, by + bh * s, bx + r, by + bh * s, r); ctx.lineTo(X(W), by + bh * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#000'; const bl = by + (bh - 0.9) * s - 0.2 * ppt * 0.3528 * s;
  ctx.font = fnt(ppt); ctx.fillText(txt, bx + 2.6 * s, bl); ctx.font = fnt(ppt * .54); ctx.fillText(sm, bx + 2.6 * s + mw2 + .5 * s, bl);
  // rodapé
  ctx.fillStyle = '#444'; ctx.font = fnt(5.4, 'normal'); ctx.textAlign = 'right'; ctx.fillText('IVA incluído · ' + String(e.cod).slice(0, 12), X(W - 2.4), Y(H - 1.4 - .5)); ctx.textAlign = 'left';
  if (guia) { ctx.strokeStyle = '#999'; ctx.lineWidth = Math.max(1, .2 * s); ctx.setLineDash([2 * s, 1.2 * s]); ctx.strokeRect(X(0) + .1 * s, Y(0) + .1 * s, (W - .2) * s, (H - .2) * s); ctx.setLineDash([]); }
  ctx.restore();
}
function etqCarregarImgs() {
  return Promise.all([['logo', 'icon-192.png'], ['volta', 'volta.jpg']].map(([k, u]) => new Promise(res => {
    if (etqImg[k]) return res(); const i = new Image(); i.onload = i.onerror = () => res(); i.src = u; etqImg[k] = i;
  })));
}

/* ---------- PDF (uma imagem JPEG 300 dpi por folha A4) ---------- */
function etqPdf(pags) {
  const enc = new TextEncoder(), partes = [], offs = []; let len = 0;
  const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; partes.push(u); len += u.length; };
  const n = pags.length; push('%PDF-1.4\n');
  offs[1] = len; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offs[2] = len; push('2 0 obj\n<< /Type /Pages /Kids [' + pags.map((p, i) => (3 + 3 * i) + ' 0 R').join(' ') + '] /Count ' + n + ' >>\nendobj\n');
  pags.forEach((p, i) => {
    const pg = 3 + 3 * i, ct = pg + 1, im = pg + 2, cs = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
    offs[pg] = len; push(pg + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R >>\nendobj\n');
    offs[ct] = len; push(ct + ' 0 obj\n<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream\nendobj\n');
    offs[im] = len; push(im + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.data.length + ' >>\nstream\n'); push(p.data); push('\nendstream\nendobj\n');
  });
  const x = len, tot = 3 + 3 * n;
  push('xref\n0 ' + tot + '\n0000000000 65535 f \n'); for (let i = 1; i < tot; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  push('trailer\n<< /Size ' + tot + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n');
  return new Blob(partes, { type: 'application/pdf' });
}
async function etqGerarPdf(lista, salto) {
  await etqCarregarImgs();
  const todas = []; lista.forEach(e => { for (let i = 0; i < Math.max(1, e.copias | 0); i++) todas.push(e); });
  const porPag = ET.C * ET.R, pags = [], cv = document.createElement('canvas'); cv.width = Math.round(210 * ETQ_PXMM); cv.height = Math.round(297 * ETQ_PXMM);
  const ctx = cv.getContext('2d'); let pos = Math.max(0, Math.min(porPag - 1, salto | 0));
  const total = Math.ceil((todas.length + pos) / porPag);
  for (let p = 0; p < total; p++) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let k = p === 0 ? pos : 0; k < porPag; k++) {
      const i = p * porPag + k - pos; if (i >= todas.length) break;
      const c = k % ET.C, r = Math.floor(k / ET.C);
      etqDesenhar(ctx, (ET.MX + c * ET.W) * ETQ_PXMM, (ET.MY + r * ET.H) * ETQ_PXMM, todas[i], ETQ_PXMM, true);
    }
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.93));
    pags.push({ data: new Uint8Array(await blob.arrayBuffer()), w: cv.width, h: cv.height });
  }
  return { blob: etqPdf(pags), folhas: total, n: todas.length };
}

/* ---------- ecrã ---------- */
const etqSalvar = () => kvSet('etqLista', etqs);
const etqSalvarOv = () => kvSet('etqOver', etqOver);
function etqMontar() {
  if (etqMontado) return; etqMontado = true;
  $('#etq').innerHTML =
    '<div class="card" style="margin-top:0"><div class="big">🏷 Etiquetas de prateleira</div><div class="muted">66 × 31,5 mm · 27 por folha A4 (3 × 9)</div>' +
    '<label>Juntar os artigos de uma guia</label><div class="row"><select id="etq-doc" style="flex:3"></select><button class="pri" id="etq-doc-ok" style="flex:1">Juntar</button></div>' +
    '<label>Ou acrescentar um artigo</label><div class="row"><input type="search" id="etq-in" placeholder="Código ou nome (Enter)" autocomplete="off" style="flex:3"><button class="sec" id="etq-cam" style="flex:1">📷</button></div>' +
    '<div id="etq-res"></div></div>' +
    '<div id="etq-lista"></div>' +
    '<div class="card" id="etq-fim" hidden><div id="etq-res2" class="muted"></div>' +
    '<label>Começar na etiqueta n.º (para aproveitar uma folha já usada)</label><input type="text" id="etq-salto" inputmode="numeric" value="1" style="width:100px">' +
    '<div class="row" style="margin-top:8px"><button class="pri" id="etq-pdf" style="font-size:18px;padding:14px">📄 Criar PDF</button><button class="red" id="etq-limpar">Limpar lista</button></div>' +
    '<div id="etq-saida"></div></div>';
  $('#etq-doc-ok').addEventListener('click', etqJuntarGuia);
  $('#etq-in').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); etqPesquisa($('#etq-in').value); } });
  $('#etq-cam').addEventListener('click', async () => { const raw = await lerCodigo(); if (raw) { $('#etq-in').value = limpar(raw); etqPesquisa(raw); } });
  $('#etq-res').addEventListener('click', e => { const it = e.target.closest('.item'); if (it && etqPesquisa._r) { etqAdd(etqPesquisa._r[+it.dataset.i], ''); $('#etq-res').innerHTML = ''; $('#etq-in').value = ''; } });
  $('#etq-lista').addEventListener('input', etqEditar);
  $('#etq-lista').addEventListener('change', etqEditar);
  $('#etq-lista').addEventListener('click', etqClique);
  $('#etq-pdf').addEventListener('click', etqPdfClique);
  $('#etq-limpar').addEventListener('click', async () => { if (await dlg('Limpar a lista de etiquetas?')) { etqs = []; await etqSalvar(); etqRender(); } });
}
async function etqAbrir() {
  etqMontar();
  if (!etqCarregado) { etqCarregado = true; try { etqs = (await kvGet('etqLista')) || []; etqOver = (await kvGet('etqOver')) || {}; } catch (e) { } }
  $('#etq-doc').innerHTML = docs.map(d => '<option value="' + esc(d.id) + '">' + esc(d.nome) + ' · ' + d.leit.length + ' linhas</option>').join('');
  if (docId) $('#etq-doc').value = docId;
  await etqCarregarImgs(); etqRender();
}
function etqAdd(a, lido) {
  const cod = a.cod || a.bar, e = etqNova(a, lido);
  if (etqs.some(x => x.cod === cod && (x.cx ? x.lido : '') === (e.cx ? lido : ''))) return false;
  etqs.push(e); return true;
}
async function etqJuntarGuia() {
  const d = docs.find(x => x.id === $('#etq-doc').value); if (!d) return;
  let n = 0, fora = 0;
  d.leit.forEach(l => { const a = lookup(l.final) || lookup(l.lido); if (!a) { fora++; return; } if (etqAdd(a, l.final || l.lido)) n++; });
  await etqSalvar(); etqRender();
  toast(n + ' etiquetas acrescentadas' + (fora ? ' · ' + fora + ' códigos não estão na lista de artigos' : '') + '.', 4500);
}
function etqPesquisa(txt) {
  const t = limpar(txt); if (!t) return;
  const a = lookup(t) || lookup(converter(t));
  if (a) { etqAdd(a, t); etqSalvar(); etqRender(); $('#etq-in').value = ''; $('#etq-res').innerHTML = ''; return; }
  const res = pesquisarNome(t, 'contem', 30); etqPesquisa._r = res;
  $('#etq-res').innerHTML = res.length ? res.map((r, i) => '<div class="item click" data-i="' + i + '"><div class="t"><b>' + esc(r.desc) + '</b><span class="muted">' + esc([r.cod, r.bar].filter(Boolean).join(' · ')) + '</span></div><div class="q" style="font-size:16px">' + esc(fmtPreco(r.preco)) + '</div></div>').join('') : '<div class="bad">Não encontrado: ' + esc(t) + '</div>';
}
function etqRender() {
  if (!etqMontado) return;
  $('#etq-lista').innerHTML = etqs.map(e => {
    const aviso = e.bal ? '<div class="muted">Artigo de balança: sai o preço por kg.</div>' : !(e.cv > 0) ? '<div class="bad">Sem conteúdo: a etiqueta sai sem preço por litro/kg. Escreve o conteúdo.</div>' : (!e.conf ? '<div class="warn">⚠ Conteúdo tirado da descrição' + (e.amb ? ' (há vários valores, confirma)' : '') + '. Confirma.</div>' : '');
    return '<div class="card" data-id="' + e.id + '"><canvas class="etq-cv" style="width:100%;border:1px solid #ddd;border-radius:6px" width="396" height="189"></canvas>' + aviso +
      '<label>Descrição na etiqueta</label><input type="text" data-f="desc" value="' + esc(e.desc) + '">' +
      '<div class="row"><div><label>' + (e.bal ? 'Preço por kg (€)' : 'Preço da unidade (€)') + '</label><input type="text" data-f="preco" inputmode="decimal" value="' + String(e.preco).replace('.', ',') + '"></div>' +
      '<div><label>Conteúdo</label><input type="text" data-f="cv" inputmode="decimal" value="' + (e.cv > 0 ? String(e.cv).replace('.', ',') : '') + '"' + (e.bal ? ' disabled' : '') + '></div>' +
      '<div><label>Unidade</label><select data-f="cu"' + (e.bal ? ' disabled' : '') + '><option value="L"' + (e.cu === 'L' ? ' selected' : '') + '>litros</option><option value="kg"' + (e.cu === 'kg' ? ' selected' : '') + '>kg</option></select></div>' +
      '<div><label>Cópias</label><input type="text" data-f="copias" inputmode="numeric" value="' + e.copias + '"></div></div>' +
      '<div class="row"><label class="chk"><input type="checkbox" data-f="volta"' + (e.volta ? ' checked' : '') + '> ♻️ Volta</label><label class="chk"><input type="checkbox" data-f="bc"' + (e.bc ? ' checked' : '') + '> Código de barras</label><label class="chk"><input type="checkbox" data-f="cxon"' + (e.cx ? ' checked' : '') + '> Caixa</label></div>' +
      (e.cx ? '<div class="row"><div><label>Unidades na caixa</label><input type="text" data-f="cxq" inputmode="decimal" value="' + String(e.cx.q).replace('.', ',') + '"></div><div><label>Preço de cada unidade (€)</label><input type="text" data-f="cxpu" inputmode="decimal" value="' + String(e.cx.pu).replace('.', ',') + '"></div></div>' : '') +
      '<div class="row" style="margin-top:6px"><button class="sec" data-a="ok">✔ Conteúdo certo</button><button class="red" data-a="del">✕ Tirar</button></div></div>';
  }).join('');
  document.querySelectorAll('#etq-lista .card').forEach(c => etqDesenharCard(c));
  $('#etq-fim').hidden = !etqs.length;
  const cop = etqs.reduce((s, e) => s + Math.max(1, e.copias | 0), 0), pend = etqs.filter(e => !e.bal && (!(e.cv > 0) || !e.conf)).length;
  $('#etq-res2').innerHTML = '<b>' + etqs.length + ' artigos · ' + cop + ' etiquetas · ' + Math.ceil(cop / (ET.C * ET.R)) + ' folha(s)</b>' + (pend ? '<br>⚠ ' + pend + ' ainda com o conteúdo por confirmar.' : '');
}
function etqDesenharCard(card) {
  const e = etqs.find(x => x.id === card.dataset.id), cv = card.querySelector('canvas'); if (!e || !cv) return;
  const s = cv.width / ET.W; cv.height = Math.round(ET.H * s); etqDesenhar(cv.getContext('2d'), 0, 0, e, s, true);
}
async function etqEditar(ev) {
  const t = ev.target, f = t.dataset.f, card = t.closest('.card'); if (!f || !card) return;
  const e = etqs.find(x => x.id === card.dataset.id); if (!e) return;
  const ov = etqOver[e.cod] = etqOver[e.cod] || {}, num = v => { const n = numPT(v); return n > 0 ? n : 0; };
  if (f === 'desc') { e.desc = t.value; ov.desc = t.value; }
  else if (f === 'preco') e.preco = num(t.value);
  else if (f === 'cv') { e.cv = num(t.value); e.conf = true; e.amb = false; ov.cv = e.cv; ov.cu = e.cu; }
  else if (f === 'cu') { e.cu = t.value; if (e.cv > 0) { e.conf = true; ov.cv = e.cv; ov.cu = e.cu; } }
  else if (f === 'copias') e.copias = Math.max(1, parseInt(t.value, 10) || 1);
  else if (f === 'volta') { e.volta = t.checked; ov.volta = t.checked; }
  else if (f === 'bc') e.bc = t.checked;
  else if (f === 'cxon') { e.cx = t.checked ? { q: e.cx ? e.cx.q : 6, pu: e.preco } : null; await etqSalvar(); etqRender(); return; }
  else if (f === 'cxq' && e.cx) e.cx.q = num(t.value);
  else if (f === 'cxpu' && e.cx) e.cx.pu = num(t.value);
  etqDesenharCard(card); await etqSalvar(); await etqSalvarOv();
  if (ev.type === 'change' && (f === 'cv' || f === 'cu')) etqRender();
}
async function etqClique(ev) {
  const b = ev.target.closest('button'); if (!b) return; const card = b.closest('.card'), e = etqs.find(x => x.id === card.dataset.id); if (!e) return;
  if (b.dataset.a === 'del') { etqs = etqs.filter(x => x !== e); await etqSalvar(); etqRender(); }
  else if (b.dataset.a === 'ok') { if (!(e.cv > 0) && !e.bal) { toast('Escreve primeiro o conteúdo (ex.: 0,33 litros).', 3500); return; } e.conf = true; e.amb = false; const ov = etqOver[e.cod] = etqOver[e.cod] || {}; ov.cv = e.cv; ov.cu = e.cu; await etqSalvar(); await etqSalvarOv(); etqRender(); }
}
async function etqPdfClique() {
  if (!etqs.length) return;
  const sem = etqs.filter(e => !e.bal && !(e.cv > 0)).length, pend = etqs.filter(e => !e.bal && e.cv > 0 && !e.conf).length;
  if ((sem || pend) && !await dlg((sem ? sem + ' etiquetas sem conteúdo (saem sem preço por litro/kg).\n' : '') + (pend ? pend + ' com o conteúdo por confirmar.\n' : '') + '\nCriar o PDF mesmo assim?')) return;
  $('#etq-saida').innerHTML = '<div class="muted">A criar o PDF…</div>';
  try {
    const r = await etqGerarPdf(etqs, (parseInt($('#etq-salto').value, 10) || 1) - 1), d = new Date(), p = n => String(n).padStart(2, '0');
    const nome = 'etiquetas_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + '.pdf';
    const url = URL.createObjectURL(r.blob);
    $('#etq-saida').innerHTML = '<div class="card" style="margin:10px 0 0"><b>✔ ' + r.n + ' etiquetas em ' + r.folhas + ' folha(s) (' + (r.blob.size / 1048576).toFixed(1) + ' MB)</b>' +
      '<div class="row" style="margin-top:8px"><a class="pri" style="display:block;text-align:center;padding:12px;border-radius:8px;text-decoration:none;color:#111;background:var(--ye);font-weight:bold" href="' + url + '" download="' + nome + '">⬇️ Transferir PDF</a><button class="sec" id="etq-share">📤 Partilhar</button></div>' +
      '<div class="muted" style="margin-top:6px">Imprime a 100 % (tamanho real), sem “ajustar à página”.</div></div>';
    $('#etq-share').onclick = async () => { const f = new File([r.blob], nome, { type: 'application/pdf' }); try { if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: nome }); else toast('Este navegador não partilha ficheiros: usa Transferir.', 4000); } catch (e) { if (e.name !== 'AbortError') toast('Não consegui partilhar: ' + e.message, 4000); } };
    window.__etqUltimo = r.blob;
  } catch (e) { $('#etq-saida').innerHTML = '<div class="bad">Não consegui criar o PDF: ' + esc(e.message) + '</div>'; }
}

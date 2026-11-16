/* ───────────── 화면의 표를 그림(PNG)·PDF 로 저장 ─────────────
   표를 그대로 캔버스에 다시 그립니다. (버튼 ✎ × 같은 편집 도구는 빼고 그림) */
const Snap = (() => {
  const SKIP = (el) => el.closest('button, [hidden], .nosnap, input, select');
  const clear = (c) => !c || c === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c);

  function draw(root, scale) {
    const R = root.getBoundingClientRect(), S = scale || 2;
    const cv = document.createElement('canvas'); cv.width = Math.ceil(R.width * S); cv.height = Math.ceil(R.height * S);
    const g = cv.getContext('2d'); g.scale(S, S);
    const page = getComputedStyle(document.body).backgroundColor;
    g.fillStyle = clear(page) ? '#fff' : page; g.fillRect(0, 0, R.width, R.height);
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {                                   // 1) 배경·테두리
      if (el !== root && SKIP(el)) continue;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      const x = r.left - R.left, y = r.top - R.top;
      if (!clear(cs.backgroundColor)) { g.fillStyle = cs.backgroundColor; g.fillRect(x, y, r.width, r.height); }
      if (el.tagName === 'TD' || el.tagName === 'TH' || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0) {
        g.strokeStyle = !clear(cs.borderTopColor) && parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : (parseFloat(cs.borderLeftWidth) > 0 ? cs.borderLeftColor : 'rgba(128,128,128,.4)');
        g.lineWidth = 1; g.strokeRect(x + .5, y + .5, r.width - 1, r.height - 1);
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const rg = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {   // 2) 글자 (글자마다 위치를 읽어 그대로 찍음)
      const par = n.parentElement; if (!par || SKIP(par) || !n.nodeValue.trim()) continue;
      const cs = getComputedStyle(par); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; g.fillStyle = cs.color; g.textBaseline = 'middle';
      const t = n.nodeValue;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '\n' || t[i] === '\t') continue;
        rg.setStart(n, i); rg.setEnd(n, i + 1);
        const r = rg.getBoundingClientRect(); if (!r.width || !r.height) continue;
        g.fillText(t[i], r.left - R.left, r.top - R.top + r.height / 2);
      }
    }
    return cv;
  }
  const blob = (cv) => new Promise(res => cv.toBlob(res, 'image/png'));
  async function png(root, name) {
    const cv = draw(root, 2), b = await blob(cv), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = `${name || '표'}_${U.stamp ? U.stamp() : Date.now()}.png`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return { w: cv.width, h: cv.height, size: b.size };
  }
  function pdf(root, title) {
    const url = draw(root, 2).toDataURL('image/png'), w = window.open('', '_blank');
    if (!w) { U.toast('팝업이 막혀 있습니다. 주소창의 팝업 허용 후 다시 눌러 주세요.'); return false; }
    w.document.write(`<!doctype html><title>${title || '표'}</title><style>@page{size:A4 landscape;margin:8mm}body{margin:0}img{max-width:100%}</style><img src="${url}"><script>onload=()=>setTimeout(()=>print(),300)<\/script>`);
    w.document.close(); return true;
  }
  return { draw, png, pdf };
})();

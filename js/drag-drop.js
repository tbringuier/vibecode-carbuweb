export class TouchDragReorder {
  constructor(el, opts = {}) {
    this.el = typeof el === 'string' ? document.querySelector(el) : el;
    this.onReorder = opts.onReorder || (() => {});
    this.handleSel = opts.handleSelector || '.fav-h';
    this._a = null; this._g = null; this._ph = null;
    this._ox = 0; this._oy = 0; this._from = -1; this._to = -1;
    this._b = { d: this._down.bind(this), m: this._move.bind(this), u: this._up.bind(this) };
    if (this.el) this.el.addEventListener('pointerdown', this._b.d, { passive: false });
  }
  destroy() { if (this.el) this.el.removeEventListener('pointerdown', this._b.d); this._clean(); }
  _item(t) { let n = t; while (n && n !== this.el) { if (n.matches?.(this.handleSel)) { let p = n.parentElement; while (p && p !== this.el) { if (p.dataset.di !== undefined) return p; p = p.parentElement; } } n = n.parentElement; } return null; }
  _down(e) { const it = this._item(e.target); if (!it) return; e.preventDefault(); const r = it.getBoundingClientRect(); this._from = +it.dataset.di; this._to = this._from; this._ox = e.clientX - r.left; this._oy = e.clientY - r.top; this._a = it; this._g = it.cloneNode(true); Object.assign(this._g.style, { position: 'fixed', zIndex: 9999, pointerEvents: 'none', opacity: '.88', width: r.width + 'px', boxShadow: '0 8px 24px rgba(0,0,0,.15)', borderRadius: '10px', left: r.left + 'px', top: r.top + 'px', transition: 'none' }); document.body.appendChild(this._g); this._ph = document.createElement('div'); this._ph.className = 'dnd-placeholder'; this._ph.style.height = r.height + 'px'; it.after(this._ph); it.classList.add('dragging-item'); document.addEventListener('pointermove', this._b.m, { passive: false }); document.addEventListener('pointerup', this._b.u); document.addEventListener('pointercancel', this._b.u); }
  _move(e) { if (!this._g) return; e.preventDefault(); this._g.style.left = (e.clientX - this._ox) + 'px'; this._g.style.top = (e.clientY - this._oy) + 'px'; const ss = [...this.el.querySelectorAll('[data-di]')].filter(x => !x.classList.contains('dragging-item')); let placed = false; for (let i = 0; i < ss.length; i++) { const r = ss[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { ss[i].before(this._ph); this._to = i; placed = true; break; } this._to = i + 1; } if (!placed && ss.length) this.el.appendChild(this._ph); }
  _up() { document.removeEventListener('pointermove', this._b.m); document.removeEventListener('pointerup', this._b.u); document.removeEventListener('pointercancel', this._b.u); const f = this._from, t = this._to; this._clean(); if (f !== -1 && t !== -1 && f !== t) this.onReorder(f, t); }
  _clean() { if (this._g) { this._g.remove(); this._g = null; } if (this._ph) { this._ph.remove(); this._ph = null; } if (this._a) { this._a.classList.remove('dragging-item'); this._a = null; } this._from = -1; this._to = -1; }
}
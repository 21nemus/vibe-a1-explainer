// HTML pill labels anchored to 3D points (Raptor-style "● Name  sub").

import * as THREE from 'three';

const _p = new THREE.Vector3();

export class LabelLayer {
  constructor(container) {
    this.container = container;
    this.items = [];
    this.root = document.createElement('div');
    this.root.className = 'label-root';
    container.appendChild(this.root);
  }

  /**
   * anchor: Object3D | Vector3 | () => Vector3 (world space)
   * opts: { text, sub, color, small, group, offset: [px, py] }
   */
  add(anchor, opts) {
    const el = document.createElement('div');
    el.className = 'lbl' + (opts.small ? ' small' : '') + (opts.tiny ? ' tiny' : '');
    el.style.setProperty('--c', opts.color ?? '#ffffff');
    const dot = document.createElement('i');
    const text = document.createElement('span');
    text.textContent = opts.text;
    el.append(dot, text);
    let sub = null;
    if (opts.sub !== undefined) {
      sub = document.createElement('em');
      sub.textContent = opts.sub;
      el.append(sub);
    }
    this.root.appendChild(el);
    let line = null;
    const offset = opts.offset ?? [0, 0];
    if (opts.leader ?? Math.hypot(offset[0], offset[1]) > 40) {
      line = document.createElement('div');
      line.className = 'lbl-line';
      line.style.setProperty('--c', opts.color ?? '#ffffff');
      this.root.insertBefore(line, this.root.firstChild);
    }
    const item = {
      el,
      line,
      textEl: text,
      subEl: sub,
      anchor,
      group: opts.group ?? 'default',
      offset,
      visible: false,
      wanted: false,
      setText: (t) => {
        if (text.textContent !== t) text.textContent = t;
      },
      setSub: (t) => {
        if (sub && sub.textContent !== t) sub.textContent = t;
      },
      flash: (ms = 260) => {
        el.classList.add('flash');
        clearTimeout(item._ft);
        item._ft = setTimeout(() => el.classList.remove('flash'), ms);
      },
    };
    this.items.push(item);
    return item;
  }

  show(group, on = true) {
    for (const it of this.items) if (it.group === group) it.wanted = on;
  }

  only(groups) {
    const set = new Set(groups);
    for (const it of this.items) it.wanted = set.has(it.group);
  }

  hideAll() {
    for (const it of this.items) it.wanted = false;
  }

  remove(group) {
    this.items = this.items.filter((it) => {
      if (it.group !== group) return true;
      it.el.remove();
      it.line?.remove();
      return false;
    });
  }

  update(camera, width, height) {
    const k = width < 860 ? 0.55 : 1; // tighter leader lines on phones
    for (const it of this.items) {
      let visible = it.wanted;
      if (visible) {
        const a = it.anchor;
        if (typeof a === 'function') _p.copy(a());
        else if (a.isObject3D) a.getWorldPosition(_p);
        else _p.copy(a);
        _p.project(camera);
        if (_p.z > 1 || _p.z < -1 || Math.abs(_p.x) > 1.2 || Math.abs(_p.y) > 1.2) visible = false;
        else {
          const ax = (_p.x * 0.5 + 0.5) * width;
          const ay = (-_p.y * 0.5 + 0.5) * height;
          let ox = it.offset[0] * k;
          const oy = it.offset[1] * k;
          // keep the pill on screen (width measured once it has been shown)
          const half = (it.w ?? 0) / 2 + 6;
          const x = Math.min(width - half, Math.max(half, ax + ox));
          ox = x - ax;
          const y = ay + oy;
          it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
          if (it.line) {
            const len = Math.hypot(ox, oy);
            const ang = Math.atan2(oy, ox);
            it.line.style.width = `${len.toFixed(1)}px`;
            it.line.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0) rotate(${ang}rad)`;
          }
        }
      }
      if (visible !== it.visible) {
        it.visible = visible;
        it.el.classList.toggle('show', visible);
        it.line?.classList.toggle('show', visible);
        if (visible) it.w = it.el.offsetWidth;
      }
    }
  }

  setActive(on) {
    this.root.style.display = on ? '' : 'none';
  }
}

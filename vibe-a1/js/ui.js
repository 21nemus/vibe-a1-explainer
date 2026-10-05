// HUD: title block, stat chips, info card, control panel, tabs, tooltip, tour.

const $ = (id) => document.getElementById(id);

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  wave: '<svg viewBox="0 0 24 24"><path d="M8.5 11V5.5a1.5 1.5 0 0 1 3 0V10m0-.5V4a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6.5 7-2.6 0-4.3-1.3-5.6-3.4L3.2 12.9a1.5 1.5 0 0 1 2.5-1.6l2.8 3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  kick: '<svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export class UI {
  constructor({ onScene, onShare }) {
    this.onScene = onScene;
    this.onShare = onShare;
    this.scene = null;
    this.state = { follow: 'all', variant: null, view: 'whole', slider: 0 };
    this.cardHTML = '';
    this.tourSteps = null;
    this.lastHud = 0;

    this.el = {
      eyebrow: $('eyebrow'),
      pre: $('title-pre'),
      main: $('title-main'),
      lede: $('lede'),
      stats: $('stats'),
      card: $('card'),
      follow: $('seg-follow'),
      variant: $('seg-variant'),
      view: $('seg-view'),
      followLabel: $('g-follow-label'),
      variantLabel: $('g-variant-label'),
      viewLabel: $('g-view-label'),
      sliderLabel: $('g-slider-label'),
      slider: $('slider'),
      sliderValue: $('slider-value'),
      tour: $('btn-tour'),
      action: $('btn-action'),
      help: $('btn-help'),
      share: $('btn-share'),
      credits: $('btn-credits'),
      helpModal: $('help'),
      helpClose: $('help-close'),
      tooltip: $('tooltip'),
      toast: $('toast'),
      tabs: [...document.querySelectorAll('.tab')],
    };

    this.el.slider.addEventListener('input', () => {
      this.stopTour();
      this.setSlider(this.el.slider.value / 100, false);
    });
    this.el.tour.addEventListener('click', () => (this.tourSteps ? this.stopTour() : this.startTour()));
    this.el.action.addEventListener('click', () => {
      this.stopTour();
      this.scene.action();
      this.syncFromScene();
    });
    this.el.help.addEventListener('click', () => this.toggleHelp());
    this.el.credits.addEventListener('click', () => this.toggleHelp(true));
    this.el.helpClose.addEventListener('click', () => this.toggleHelp(false));
    this.el.helpModal.addEventListener('click', (e) => e.target === this.el.helpModal && this.toggleHelp(false));
    this.el.share.addEventListener('click', () => this.onShare());
    for (const t of this.el.tabs)
      t.addEventListener('click', () => {
        this.stopTour();
        this.onScene(t.dataset.scene);
      });
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('resize', () => this.layout());
  }

  /** On phones the card and toast sit just above the docked control panel. */
  layout() {
    const small = innerWidth < 860;
    const panel = document.getElementById('panel');
    if (!small) {
      this.el.card.style.bottom = '';
      this.el.toast.style.bottom = '';
      return;
    }
    const r = panel.getBoundingClientRect();
    const above = innerHeight - r.top + 8;
    this.el.card.style.bottom = `${above}px`;
    this.el.toast.style.bottom = ''; // phones: toasts sit at the top (CSS)
  }

  /* ---------------- scene binding ---------------- */

  bind(scene) {
    this.scene = scene;
    const c = scene.config;
    this.el.eyebrow.textContent = c.eyebrow;
    this.el.pre.textContent = c.pre;
    this.el.main.textContent = c.title;
    this.el.lede.textContent = c.lede;
    this.el.followLabel.textContent = c.followLabel;
    this.el.variantLabel.textContent = c.variantLabel;
    this.el.viewLabel.textContent = c.viewLabel;
    this.el.sliderLabel.textContent = c.sliderLabel;
    this.el.slider.setAttribute('aria-label', c.sliderLabel);
    this.el.action.innerHTML = ICONS[c.action.icon];
    this.el.action.title = c.action.title;
    const s = scene.state;
    this.state = { follow: s.follow, variant: s.variant ?? s.scenario, view: s.view, slider: s.speed ?? s.slider ?? 0 };
    this.buildSeg(this.el.follow, c.follow, this.state.follow, (k) => this.setFollow(k));
    this.buildSeg(this.el.variant, c.variants, this.state.variant, (k) => this.setVariant(k));
    this.buildSeg(this.el.view, c.views, this.state.view, (k) => this.setView(k));
    this.el.slider.value = Math.round(this.state.slider * 100);
    this.paintSlider();
    for (const t of this.el.tabs) t.classList.toggle('active', t.dataset.scene === scene.name);
    this.cardHTML = '';
    this.cardKey = null;
    this.refresh(true);
    requestAnimationFrame(() => this.layout());
  }

  buildSeg(root, options, current, onPick) {
    root.innerHTML = '';
    for (const o of options) {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.dataset.key = o.key;
      if (o.tone) b.dataset.tone = o.tone;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        this.stopTour();
        onPick(o.key);
      });
      root.appendChild(b);
    }
    this.markSeg(root, current);
  }

  markSeg(root, key) {
    for (const b of root.children) {
      const on = b.dataset.key === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
    }
  }

  setFollow(k) {
    this.state.follow = k;
    this.scene.setFollow(k);
    this.syncFromScene();
  }
  setVariant(k) {
    this.state.variant = k;
    this.scene.setVariant(k);
    this.syncFromScene();
  }
  setView(k) {
    this.state.view = k;
    this.scene.setView(k);
    this.syncFromScene();
  }
  setSlider(u, moveThumb = true) {
    this.state.slider = u;
    this.scene.setSlider(u);
    if (moveThumb) this.el.slider.value = Math.round(u * 100);
    this.syncFromScene();
  }

  /** Scenes may adjust related state (e.g. exploded view stops walking). */
  syncFromScene() {
    const s = this.scene.state;
    this.state.follow = s.follow;
    this.state.view = s.view;
    this.state.variant = s.variant ?? s.scenario;
    const sl = s.speed ?? s.slider ?? 0;
    if (Math.abs(sl - this.state.slider) > 1e-3) {
      this.state.slider = sl;
      this.el.slider.value = Math.round(sl * 100);
    }
    this.markSeg(this.el.follow, this.state.follow);
    this.markSeg(this.el.variant, this.state.variant);
    this.markSeg(this.el.view, this.state.view);
    this.paintSlider();
    this.refresh(true);
  }

  paintSlider() {
    this.el.slider.style.setProperty('--fill', `${this.el.slider.value}%`);
  }

  /* ---------------- per-frame refresh ---------------- */

  refresh(force = false) {
    const now = performance.now();
    if (!force && now - this.lastHud < 120) return;
    this.lastHud = now;
    const h = this.scene.hud();
    if (h.title && this.el.main.textContent !== h.title) this.el.main.textContent = h.title;
    if (h.lede && this.el.lede.textContent !== h.lede) this.el.lede.textContent = h.lede;
    const statsHTML = h.stats.map((s) => `<div class="stat"><div class="k">${s.k}</div><div class="v">${s.v}<small>${s.u}</small></div></div>`).join('');
    if (this.el.stats.innerHTML !== statsHTML) this.el.stats.innerHTML = statsHTML;
    if (h.card !== this.cardHTML) {
      const first = !this.cardHTML;
      const sameTopic = h.cardKey && h.cardKey === this.cardKey;
      this.cardHTML = h.card;
      this.cardKey = h.cardKey;
      if (first || sameTopic) {
        if (!this.cardTimer || sameTopic) this.el.card.innerHTML = h.card;
      } else {
        this.el.card.classList.add('fade');
        clearTimeout(this.cardTimer);
        this.cardTimer = setTimeout(() => {
          this.el.card.innerHTML = this.cardHTML;
          this.el.card.classList.remove('fade');
          this.cardTimer = null;
        }, 180);
      }
    }
    if (this.el.sliderValue.textContent !== h.sliderText) this.el.sliderValue.textContent = h.sliderText;
  }

  /* ---------------- tooltip / toast / help ---------------- */

  tooltip(info, x, y) {
    const t = this.el.tooltip;
    if (!info) {
      t.classList.remove('show');
      return;
    }
    const html = `<b>${info.title}</b><span>${info.sub ?? ''}</span>${info.file ? `<br><code>${info.file}</code>` : ''}`;
    if (t.innerHTML !== html) t.innerHTML = html;
    const w = t.offsetWidth;
    const px = x + 16 + w > innerWidth ? x - w - 14 : x + 16;
    t.style.transform = `translate(${px}px, ${y + 14}px)`;
    t.classList.add('show');
  }

  toast(text, ms = 2200) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  toggleHelp(force) {
    const open = force ?? this.el.helpModal.hidden;
    this.el.helpModal.hidden = !open;
    if (open) this.el.helpClose.focus();
  }

  onKey(e) {
    if (e.target.tagName === 'INPUT' && e.key !== 'Escape') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!this.el.helpModal.hidden) {
      if (e.key === 'Escape' || e.key === 'h' || e.key === 'H') this.toggleHelp(false);
      return;
    }
    const c = this.scene.config;
    const k = e.key.toLowerCase();
    if (['1', '2', '3', '4'].includes(k)) {
      const opt = c.follow[+k - 1];
      if (opt) {
        this.stopTour();
        this.setFollow(opt.key);
      }
    } else if (k === 'w' || k === 'c' || k === 'e') {
      this.stopTour();
      this.setView({ w: 'whole', c: 'cutaway', e: 'exploded' }[k]);
    } else if (k === ' ') {
      e.preventDefault();
      this.tourSteps ? this.stopTour() : this.startTour();
    } else if (k === 's') {
      this.stopTour();
      this.onScene(this.scene.name === 'robot' ? 'servo' : 'robot');
    } else if (k === 'h' || k === '?') this.toggleHelp();
    else if (k === 'arrowup' || k === 'arrowdown') {
      e.preventDefault();
      this.stopTour();
      const u = Math.min(1, Math.max(0, this.state.slider + (k === 'arrowup' ? 0.1 : -0.1)));
      this.setSlider(Math.round(u * 10) / 10);
    }
  }

  /* ---------------- guided tour ---------------- */

  startTour() {
    this.tourSteps = this.scene.tour();
    this.tourT = 0;
    this.tourIndex = 0;
    this.el.tour.innerHTML = ICONS.pause;
    this.el.tour.classList.add('active');
  }

  stopTour() {
    if (!this.tourSteps) return;
    this.tourSteps = null;
    this.waitingScene = null;
    this.el.tour.innerHTML = ICONS.play;
    this.el.tour.classList.remove('active');
  }

  updateTour(dt) {
    if (!this.tourSteps) return;
    // hold the tour clock while a requested scene switch is still fading
    if (this.waitingScene) {
      if (this.scene.name !== this.waitingScene) return;
      this.waitingScene = null;
    }
    this.tourT += dt;
    while (this.tourIndex < this.tourSteps.length && this.tourSteps[this.tourIndex].t <= this.tourT) {
      const step = this.tourSteps[this.tourIndex++];
      if (step.end) {
        this.stopTour();
        return;
      }
      step.do?.();
      const u = step.ui ?? {};
      if (u.scene) {
        const steps = this.tourSteps;
        const t = this.tourT;
        const idx = this.tourIndex;
        this.onScene(u.scene);
        this.waitingScene = u.scene;
        this.tourSteps = steps;
        this.tourT = t;
        this.tourIndex = idx;
        this.el.tour.innerHTML = ICONS.pause;
        this.el.tour.classList.add('active');
      }
      if (u.variant) this.setVariant(u.variant);
      if (u.follow) this.setFollow(u.follow);
      if (u.view) this.setView(u.view);
      if (u.slider !== undefined) this.setSlider(u.slider);
      if (u.action) {
        this.scene.action();
        this.syncFromScene();
      }
      if (u.toast) this.toast(u.toast);
      if (this.waitingScene) return; // apply the rest once the new scene is bound
    }
  }
}

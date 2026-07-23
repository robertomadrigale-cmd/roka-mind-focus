const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 100;
const BREATHING_PATTERNS = {
  resonance: {
    className: 'pattern-resonance',
    cycleTime: 10000,
    steps: [{ ms: 0, text: 'Inhala suave...' }, { ms: 5000, text: 'Exhala lento...' }]
  },
  box: {
    className: 'pattern-box',
    cycleTime: 16000,
    steps: [
      { ms: 0, text: 'Inhala...' },
      { ms: 4000, text: 'Mantén...' },
      { ms: 8000, text: 'Exhala...' },
      { ms: 12000, text: 'Mantén...' }
    ]
  },
  relax: {
    className: 'pattern-relax',
    cycleTime: 19000,
    steps: [
      { ms: 0, text: 'Inhala...' },
      { ms: 4000, text: 'Mantén...' },
      { ms: 11000, text: 'Exhala largo...' }
    ]
  },
  extended: {
    className: 'pattern-extended',
    cycleTime: 10000,
    steps: [{ ms: 0, text: 'Inhala por nariz...' }, { ms: 4000, text: 'Exhala más largo...' }]
  },
  sigh: {
    className: 'pattern-sigh',
    cycleTime: 9000,
    steps: [
      { ms: 0, text: 'Inhala...' },
      { ms: 1800, text: 'Completa un poco más...' },
      { ms: 3000, text: 'Suelta largo...' }
    ]
  },
  diaphragm: {
    className: 'pattern-diaphragm',
    cycleTime: 9000,
    steps: [{ ms: 0, text: 'Expande abdomen...' }, { ms: 3000, text: 'Exhala sin prisa...' }]
  },
  pursed: {
    className: 'pattern-pursed',
    cycleTime: 6000,
    steps: [{ ms: 0, text: 'Inhala nariz...' }, { ms: 2000, text: 'Exhala labios suaves...' }]
  }
};
const BREATHING_PATTERN_CLASSES = Object.values(BREATHING_PATTERNS).map(pattern => pattern.className);

export class Timer {
  constructor({ $, $$, onComplete }) {
    this.$ = $;
    this.$$ = $$;
    this.onComplete = onComplete;
    this.state = { minutes: 25, seconds: 0, running: false, interval: null, totalSeconds: 1500 };
    this.activePattern = 'resonance';
    this.breathingInterval = null;
    this.audioCtx = null;
    this.ambientNode = null;
    this.activeSound = null;
  }

  init() {
    const startBtn = this.$('#timer-start-btn');
    const resetBtn = this.$('#timer-reset-btn');
    const focusBtn = this.$('#deep-focus-btn');
    if (startBtn) startBtn.addEventListener('click', () => this.toggle());
    if (resetBtn) resetBtn.addEventListener('click', () => this.reset());
    if (focusBtn) focusBtn.addEventListener('click', () => this.toggleDeepFocus());

    const timerContainer = document.querySelector('.timer-container');
    if (timerContainer) {
      timerContainer.addEventListener('click', e => {
        const presetBtn = e.target.closest('.preset-btn[data-minutes]');
        const ambientBtn = e.target.closest('.ambient-btn');
        const patternBtn = e.target.closest('.pattern-btn');
        
        if (presetBtn) {
          if (this.state.running) return;
          this.$$('.preset-btn[data-minutes]').forEach(x => x.classList.remove('active'));
          presetBtn.classList.add('active');
          this.setPreset(+presetBtn.dataset.minutes);
        }
        if (ambientBtn) this.toggleAmbient(ambientBtn.dataset.sound, ambientBtn);
        if (patternBtn) {
          if (this.state.running) return;
          this.$$('.pattern-btn').forEach(x => x.classList.remove('active'));
          patternBtn.classList.add('active');
          this.activePattern = BREATHING_PATTERNS[patternBtn.dataset.pattern] ? patternBtn.dataset.pattern : 'resonance';
        }
      });
    }

    this.updateDisplay();
  }

  setPreset(minutes) {
    this.state.minutes = minutes;
    this.state.seconds = 0;
    this.state.totalSeconds = minutes * 60;
    this.updateDisplay();
  }

  toggle() {
    this.state.running ? this.pause() : this.start();
  }

  start() {
    this.state.running = true;
    const startBtn = this.$('#timer-start-btn');
    if (startBtn) {
      startBtn.textContent = '⏸ Pausar';
      startBtn.className = 'zen-btn zen-btn-gold';
    }

    document.body.classList.add('meditation-fullscreen-active');
    
    // Add the specific pattern class to the circle
    const circle = this.$('#timer-circle-container');
    if (circle) {
      const pattern = BREATHING_PATTERNS[this.activePattern] || BREATHING_PATTERNS.resonance;
      circle.classList.remove(...BREATHING_PATTERN_CLASSES);
      circle.classList.add(pattern.className);
    }
    
    const breathingText = this.$('#breathing-text');
    if (breathingText) breathingText.style.display = 'block';

    this.startBreathingCycle();

    this.state.interval = setInterval(() => {
      if (this.state.seconds === 0) {
        if (this.state.minutes === 0) {
          this.complete();
          return;
        }
        this.state.minutes--;
        this.state.seconds = 59;
      } else {
        this.state.seconds--;
      }
      this.updateDisplay();
    }, 1000);
  }

  pause() {
    this.state.running = false;
    clearInterval(this.state.interval);
    this.stopBreathingCycle();

    const startBtn = this.$('#timer-start-btn');
    if (startBtn) {
      startBtn.textContent = '▶ Continuar';
      startBtn.className = 'zen-btn zen-btn-primary';
    }
    document.body.classList.remove('meditation-fullscreen-active');
    
    const circle = this.$('#timer-circle-container');
    if (circle) circle.classList.remove(...BREATHING_PATTERN_CLASSES);
    
    const breathingText = this.$('#breathing-text');
    if (breathingText) breathingText.style.display = 'none';

    this.stopAmbient();
    this.$$('.ambient-btn').forEach(b => b.classList.remove('active'));
    this.activeSound = null;
  }

  reset() {
    this.pause();
    const activePreset = this.$('.preset-btn[data-minutes].active');
    const minutes = activePreset ? +activePreset.dataset.minutes : 5;
    this.state.minutes = minutes;
    this.state.seconds = 0;
    this.state.totalSeconds = minutes * 60;
    const startBtn = this.$('#timer-start-btn');
    if (startBtn) startBtn.textContent = '▶ Iniciar';
    this.updateDisplay();
  }

  complete() {
    this.pause();
    this.state.minutes = 0;
    this.state.seconds = 0;
    this.updateDisplay();
    this.onComplete?.();
    if (document.body.classList.contains('deep-focus-active')) this.toggleDeepFocus();
  }

  updateDisplay() {
    const time = this.$('#timer-time');
    const progress = this.$('#timer-progress');
    if (time) time.textContent = `${String(this.state.minutes).padStart(2, '0')}:${String(this.state.seconds).padStart(2, '0')}`;
    const elapsed = this.state.totalSeconds - (this.state.minutes * 60 + this.state.seconds);
    const percent = this.state.totalSeconds > 0 ? elapsed / this.state.totalSeconds : 0;
    if (progress) progress.setAttribute('stroke-dashoffset', CIRCLE_CIRCUMFERENCE * (1 - percent));
  }

  startBreathingCycle() {
    this.stopBreathingCycle();
    const pattern = BREATHING_PATTERNS[this.activePattern] || BREATHING_PATTERNS.resonance;
    const { cycleTime, steps } = pattern;

    const runCycle = () => {
      const el = this.$('#breathing-text');
      if (!el || !this.state.running) return;
      
      this.breathingTimeouts = steps.map(step => {
        return setTimeout(() => {
          if (this.state.running) el.textContent = step.text;
        }, step.ms);
      });
    };

    runCycle();
    this.breathingInterval = setInterval(runCycle, cycleTime);
  }

  stopBreathingCycle() {
    if (this.breathingInterval) clearInterval(this.breathingInterval);
    if (this.breathingTimeouts) {
      this.breathingTimeouts.forEach(t => clearTimeout(t));
      this.breathingTimeouts = [];
    }
  }

  toggleDeepFocus() {
    const isActive = document.body.classList.contains('deep-focus-active') || document.body.classList.contains('meditation-fullscreen-active');
    document.body.classList.toggle('deep-focus-active', !isActive);
    if (isActive) {
      document.body.classList.remove('meditation-fullscreen-active');
      const circle = this.$('#timer-circle-container');
      if (circle) circle.classList.remove(...BREATHING_PATTERN_CLASSES);
      const breathingText = this.$('#breathing-text');
      if (breathingText && !this.state.running) breathingText.style.display = 'none';
    }
    const btn = this.$('#deep-focus-btn');
    if (!btn) return;
    if (document.body.classList.contains('deep-focus-active') || document.body.classList.contains('meditation-fullscreen-active')) {
      btn.textContent = '✕ Salir';
      btn.className = 'zen-btn zen-btn-primary';
    } else {
      btn.textContent = '◉ Foco Total';
      btn.className = 'zen-btn zen-btn-ghost';
    }
  }

  getAudioContext() {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return this.audioCtx;
  }

  createNoise(type) {
    const ctx = this.getAudioContext();
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'rain' || type === 'forest') {
        data[i] = (low + (0.02 * white)) / 1.02;
        low = data[i];
        data[i] *= 3.5;
      } else {
        data[i] = white;
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    if (type === 'rain') {
      filter.type = 'lowpass';
      filter.frequency.value = 400;
    } else if (type === 'forest') {
      filter.type = 'bandpass';
      filter.frequency.value = 800;
      filter.Q.value = 0.5;
    } else {
      filter.type = 'lowpass';
      filter.frequency.value = 2000;
    }
    const gain = ctx.createGain();
    gain.gain.value = type === 'white' ? 0.03 : 0.04;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    return source;
  }

  toggleAmbient(type, btn) {
    if (this.activeSound === type) {
      this.stopAmbient();
      btn.classList.remove('active');
      this.activeSound = null;
      return;
    }
    this.stopAmbient();
    this.$$('.ambient-btn').forEach(b => b.classList.remove('active'));
    this.ambientNode = this.createNoise(type);
    this.ambientNode.start();
    this.activeSound = type;
    btn.classList.add('active');
  }

  stopAmbient() {
    if (this.ambientNode) {
      try {
        this.ambientNode.stop();
      } catch (e) {
        // Source nodes may already be stopped by the browser.
      }
    }
    this.ambientNode = null;
  }
}

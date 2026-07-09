export const LIFE_WHEEL_AXES = [
  { key: 'lifestyle', label: 'Estilo de Vida' },
  { key: 'contribution', label: 'Contribución' },
  { key: 'joy', label: 'Alegría' },
  { key: 'freedom', label: 'Libertad' },
  { key: 'mindset', label: 'Mentalidad' },
  { key: 'creativity', label: 'Creatividad' },
  { key: 'energy', label: 'Energía' },
  { key: 'production', label: 'Producción' },
  { key: 'connection', label: 'Conexión' },
  { key: 'economy', label: 'Economía' }
];

const CENTER_X = 170;
const CENTER_Y = 170;
const RADIUS = 120;
const SVG_NS = 'http://www.w3.org/2000/svg';

export class LifeWheel {
  constructor({ $, state, saveState }) {
    this.$ = $;
    this.state = state;
    this.saveState = saveState;
    this.dragAxis = null;
    this.boundSvg = null;
  }

  render() {
    const svg = this.$('#life-wheel-svg');
    if (!svg) return;
    svg.innerHTML = '';
    const axisCount = LIFE_WHEEL_AXES.length;
    const angleStep = 360 / axisCount;

    for (let level = 2; level <= 10; level += 2) {
      const points = LIFE_WHEEL_AXES.map((_, i) => {
        const point = this.polar(i * angleStep, (level / 10) * RADIUS);
        return `${point.x},${point.y}`;
      });
      const polygon = document.createElementNS(SVG_NS, 'polygon');
      polygon.setAttribute('points', points.join(' '));
      polygon.setAttribute('class', 'wheel-grid-line');
      svg.appendChild(polygon);
    }

    LIFE_WHEEL_AXES.forEach((axis, i) => {
      const edge = this.polar(i * angleStep, RADIUS);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', CENTER_X);
      line.setAttribute('y1', CENTER_Y);
      line.setAttribute('x2', edge.x);
      line.setAttribute('y2', edge.y);
      line.setAttribute('class', 'wheel-grid-line');
      svg.appendChild(line);

      const score = this.state.lifeWheel[axis.key] || 5;
      const handlePoint = this.polar(i * angleStep, (score / 10) * RADIUS);
      const handle = document.createElementNS(SVG_NS, 'circle');
      handle.setAttribute('cx', handlePoint.x);
      handle.setAttribute('cy', handlePoint.y);
      handle.setAttribute('r', 6);
      handle.setAttribute('class', 'wheel-handle');
      handle.setAttribute('data-axis', i);
      svg.appendChild(handle);

      const labelPoint = this.polar(i * angleStep, RADIUS + 25);
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', labelPoint.x);
      label.setAttribute('y', labelPoint.y);
      label.setAttribute('dominant-baseline', 'middle');
      label.textContent = axis.label;
      svg.appendChild(label);
    });

    const dataPoints = LIFE_WHEEL_AXES.map((axis, i) => {
      const score = this.state.lifeWheel[axis.key] || 5;
      const point = this.polar(i * angleStep, (score / 10) * RADIUS);
      return `${point.x},${point.y}`;
    });
    const area = document.createElementNS(SVG_NS, 'polygon');
    area.setAttribute('points', dataPoints.join(' '));
    area.setAttribute('class', 'wheel-area');
    svg.insertBefore(area, svg.querySelector('.wheel-handle'));

    this.bindDrag(svg);
    this.renderScores();
  }

  renderScores() {
    const container = this.$('#wheel-scores');
    if (!container) return;
    container.innerHTML = LIFE_WHEEL_AXES.map(axis => `
      <div class="wheel-score-item">
        <span class="wheel-score-value">${this.state.lifeWheel[axis.key] || 5}</span>
        <span class="wheel-score-label">${axis.label}</span>
      </div>
    `).join('');
  }

  bindDrag(svg) {
    if (this.boundSvg === svg) return;
    this.boundSvg = svg;
    svg.addEventListener('mousedown', e => this.handleStart(e));
    window.addEventListener('mousemove', e => this.handleMove(e));
    window.addEventListener('mouseup', () => this.handleEnd());
    svg.addEventListener('touchstart', e => this.handleStart(e), { passive: false });
    window.addEventListener('touchmove', e => this.handleMove(e), { passive: false });
    window.addEventListener('touchend', () => this.handleEnd());
  }

  handleStart(e) {
    if (e.target.classList.contains('wheel-handle')) {
      this.dragAxis = +e.target.dataset.axis;
      e.preventDefault();
    }
  }

  handleMove(e) {
    if (this.dragAxis === null) return;
    e.preventDefault();
    const svg = this.$('#life-wheel-svg');
    const rect = svg.getBoundingClientRect();
    const scaleX = 340 / rect.width;
    const scaleY = 340 / rect.height;
    const pointer = e.touches ? e.touches[0] : e;
    const mouseX = (pointer.clientX - rect.left) * scaleX;
    const mouseY = (pointer.clientY - rect.top) * scaleY;
    const dx = mouseX - CENTER_X;
    const dy = mouseY - CENTER_Y;
    const score = Math.max(1, Math.min(10, Math.round(Math.sqrt(dx * dx + dy * dy) / RADIUS * 10)));
    this.state.lifeWheel[LIFE_WHEEL_AXES[this.dragAxis].key] = score;
    this.render();
  }

  handleEnd() {
    if (this.dragAxis !== null) {
      this.saveState();
      this.dragAxis = null;
    }
  }

  polar(angle, radius) {
    const radians = (angle - 90) * Math.PI / 180;
    return {
      x: CENTER_X + radius * Math.cos(radians),
      y: CENTER_Y + radius * Math.sin(radians)
    };
  }
}

import { mountPictureToolDock } from './picture-tool-dock.js';

export const PICTURE_ZOOM_LEVELS = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8];
const MIN_ZOOM = PICTURE_ZOOM_LEVELS[0];
const MAX_ZOOM = PICTURE_ZOOM_LEVELS.at(-1);
const FIT_MIN = 0.001;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const zoomSpan = Math.log(MAX_ZOOM / MIN_ZOOM);
const sliderZoom = value => MIN_ZOOM * Math.exp(clamp(value, 0, 1000) / 1000 * zoomSpan);
const sliderValue = zoom => Math.round(Math.log(clamp(zoom, MIN_ZOOM, MAX_ZOOM) / MIN_ZOOM) / zoomSpan * 1000);
const adjacentZoom = (current, direction) => direction === 'zoom-in'
  ? PICTURE_ZOOM_LEVELS.find(level => level > current + 0.00001) ?? MAX_ZOOM
  : PICTURE_ZOOM_LEVELS.findLast(level => level < current - 0.00001) ?? MIN_ZOOM;

// View state belongs to the preview, independently of the editable/exported SVG.
export class PictureViewport {
  constructor(workspace, state) {
    this.viewport = workspace.querySelector('.picture-viewport');
    this.stage = workspace.querySelector('.picture-stage');
    this.canvas = workspace.querySelector('.picture-canvas');
    this.tools = workspace.querySelector('.picture-tools');
    this.zoomSlider = this.tools.querySelector('[data-picture-zoom-slider]');
    this.zoomToggle = this.tools.querySelector('[data-picture-action="zoom-menu"]');
    this.zoomMenu = this.tools.querySelector('.picture-zoom-menu');
    const svg = this.canvas.querySelector('svg');
    // Export pixels and SVG layout units are independent. A 4K export must not
    // make the same design smaller on screen, or turn a fitted thumbnail into 100%.
    const box = svg.viewBox.baseVal;
    this.width = box.width || Number(svg.getAttribute('width'));
    this.height = box.height || Number(svg.getAttribute('height'));
    this.state = state;
    this.state.zoom = clamp(Number(state.zoom) || 1, FIT_MIN, MAX_ZOOM);
    this.state.center ??= { x: 0.5, y: 0.5 };
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    mountPictureToolDock(workspace, this.tools, this.abort.signal);
    this.viewport.addEventListener('scroll', () => this.remember(), { ...options, passive: true });
    this.viewport.addEventListener('pointerdown', event => this.startPan(event), options);
    this.viewport.addEventListener('pointermove', event => this.movePan(event), options);
    this.viewport.addEventListener('pointerup', event => {
      this.movePan(event);
      this.stopPan(event);
    }, options);
    this.viewport.addEventListener('pointercancel', event => this.stopPan(event), options);
    this.viewport.addEventListener('lostpointercapture', event => this.stopPan(event), options);
    this.viewport.addEventListener('dragstart', event => event.preventDefault(), options);
    window.addEventListener('blur', () => this.stopPan(), options);
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (this.zoomMenu.matches(':popover-open')) {
        event.preventDefault();
        this.closeZoomMenu(true);
        return;
      }
      if (!this.pan) return;
      event.preventDefault();
      this.stopPan();
    }, options);
    document.addEventListener('pointerdown', event => {
      if (!this.tools.contains(event.target)) this.closeZoomMenu();
    }, options);
    this.tools.addEventListener('click', event => {
      const level = event.target.closest('[data-picture-zoom-level]');
      if (level) {
        this.remember();
        this.state.zoom = Number(level.dataset.pictureZoomLevel);
        this.closeZoomMenu(true);
        this.layout();
        return;
      }
      const action = event.target.closest('[data-picture-action]')?.dataset.pictureAction;
      if (!action) return;
      if (action === 'zoom-menu') {
        if (this.zoomMenu.matches(':popover-open')) this.closeZoomMenu();
        else {
          this.zoomMenu.showPopover();
          this.positionZoomMenu();
          this.zoomToggle.setAttribute('aria-expanded', 'true');
          const selected = this.zoomMenu.querySelector('[aria-checked="true"]');
          (selected || this.zoomMenu.querySelector('button'))?.focus();
        }
        return;
      }
      this.closeZoomMenu();
      this.stopPan();
      if (action === 'center' || action === 'reset' || action === 'actual') {
        if (action === 'reset') this.state.zoom = this.fit();
        if (action === 'actual') this.state.zoom = 1;
        this.state.center = { x: 0.5, y: 0.5 };
      } else {
        this.remember();
        this.state.zoom = adjacentZoom(this.state.zoom, action);
      }
      this.layout();
    }, options);
    this.zoomSlider.addEventListener('input', () => {
      this.remember();
      this.stopPan();
      this.state.zoom = sliderZoom(Number(this.zoomSlider.value));
      this.layout();
    }, options);
    this.zoomMenu.addEventListener('toggle', () => {
      this.zoomToggle.setAttribute('aria-expanded', String(this.zoomMenu.matches(':popover-open')));
    }, options);
    this.layout();
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(this.viewport);
  }

  closeZoomMenu(refocus = false) {
    if (!this.zoomMenu.matches(':popover-open')) return;
    this.zoomMenu.hidePopover();
    this.zoomToggle.setAttribute('aria-expanded', 'false');
    if (refocus) this.zoomToggle.focus();
  }

  positionZoomMenu() {
    const anchor = this.zoomToggle.getBoundingClientRect();
    const above = anchor.top - 16;
    const below = window.innerHeight - anchor.bottom - 16;
    const openBelow = below >= above;
    this.zoomMenu.style.maxHeight = `${Math.min(320, Math.max(80, openBelow ? below : above))}px`;
    const width = this.zoomMenu.offsetWidth;
    const height = this.zoomMenu.offsetHeight;
    this.zoomMenu.style.left = `${clamp(anchor.right - width, 8, window.innerWidth - width - 8)}px`;
    this.zoomMenu.style.top = `${openBelow ? anchor.bottom + 8 : anchor.top - height - 8}px`;
  }

  remember() {
    if (!this.geometry) return;
    // Resize can queue a scroll event before ResizeObserver applies the new fit.
    // Keep the last logical center until layout uses the new viewport dimensions.
    if (this.viewport.clientWidth !== this.geometry.viewportWidth ||
        this.viewport.clientHeight !== this.geometry.viewportHeight) return;
    const geometry = this.geometry;
    this.state.center = {
      x: this.state.center.x + (this.viewport.scrollLeft - geometry.scrollLeft) / geometry.width,
      y: this.state.center.y + (this.viewport.scrollTop - geometry.scrollTop) / geometry.height,
    };
    geometry.scrollLeft = this.viewport.scrollLeft;
    geometry.scrollTop = this.viewport.scrollTop;
  }

  startPan(event) {
    if (event.button !== 0 || event.isPrimary === false || !this.geometry || this.pan) return;
    if (event.target.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
    const rect = this.viewport.getBoundingClientRect();
    if (event.clientX >= rect.left + this.viewport.clientLeft + this.viewport.clientWidth ||
        event.clientY >= rect.top + this.viewport.clientTop + this.viewport.clientHeight) return;
    this.remember();
    this.pan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      center: { ...this.state.center },
      width: this.geometry.width,
      height: this.geometry.height,
    };
    this.viewport.setPointerCapture(event.pointerId);
    this.viewport.classList.add('is-panning');
    event.preventDefault();
  }

  movePan(event) {
    if (!this.pan || event.pointerId !== this.pan.pointerId) return;
    this.state.center = {
      x: this.pan.center.x - (event.clientX - this.pan.x) / this.pan.width,
      y: this.pan.center.y - (event.clientY - this.pan.y) / this.pan.height,
    };
    this.layout();
    event.preventDefault();
  }

  stopPan(event) {
    if (!this.pan || event?.pointerId !== undefined && event.pointerId !== this.pan.pointerId) return;
    const { pointerId } = this.pan;
    this.pan = null;
    this.viewport.classList.remove('is-panning');
    if (this.viewport.hasPointerCapture(pointerId)) this.viewport.releasePointerCapture(pointerId);
  }

  fit() {
    const verticalSpace = Math.min(104, Math.max(32, this.viewport.clientHeight - 32));
    return clamp(Math.min((this.viewport.clientWidth - 32) / this.width,
      (this.viewport.clientHeight - verticalSpace) / this.height), FIT_MIN, MAX_ZOOM);
  }

  layout() {
    if (!this.viewport.isConnected) return;
    const center = { ...this.state.center };
    // Re-evaluate once if zooming introduces a non-overlay OS scrollbar.
    for (let pass = 0; pass < 3; pass++) {
      const viewportWidth = this.viewport.clientWidth;
      const viewportHeight = this.viewport.clientHeight;
      if (!viewportWidth || !viewportHeight) return;
      const width = this.width * this.state.zoom;
      const height = this.height * this.state.zoom;
      // Keep a full viewport of transparent workspace around the image.  At
      // low zoom the SVG can otherwise be smaller than its viewport, which
      // clamps scrollLeft/scrollTop to zero and makes pointer panning appear
      // to do nothing even though the user selected a movable canvas.
      const stageWidth = Math.ceil(width + viewportWidth * 2);
      const stageHeight = Math.ceil(height + viewportHeight * 2);
      const left = (stageWidth - width) / 2;
      const top = (stageHeight - height) / 2;
      Object.assign(this.stage.style, { width: `${stageWidth}px`, height: `${stageHeight}px` });
      Object.assign(this.canvas.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      this.geometry = { left, top, width, height, viewportWidth, viewportHeight };
      if (viewportWidth === this.viewport.clientWidth && viewportHeight === this.viewport.clientHeight) break;
    }
    const { left, top, width, height } = this.geometry;
    const wantedLeft = left + width * center.x - this.viewport.clientWidth / 2;
    const wantedTop = top + height * center.y - this.viewport.clientHeight / 2;
    this.viewport.scrollLeft = wantedLeft;
    this.viewport.scrollTop = wantedTop;
    this.geometry.scrollLeft = this.viewport.scrollLeft;
    this.geometry.scrollTop = this.viewport.scrollTop;
    // Use layout positioning rather than compositing a transformed SVG layer.
    // Align its screen origin to device pixels after free panning as well.
    this.geometry.translateX = this.viewport.scrollLeft - wantedLeft;
    this.geometry.translateY = this.viewport.scrollTop - wantedTop;
    const rect = this.viewport.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const x = rect.left + this.viewport.clientLeft + left - this.viewport.scrollLeft + this.geometry.translateX;
    const y = rect.top + this.viewport.clientTop + top - this.viewport.scrollTop + this.geometry.translateY;
    this.geometry.translateX += Math.round(x * ratio) / ratio - x;
    this.geometry.translateY += Math.round(y * ratio) / ratio - y;
    Object.assign(this.canvas.style, { left: `${left + this.geometry.translateX}px`, top: `${top + this.geometry.translateY}px` });
    this.remember();
    this.viewport.dataset.zoom = String(this.state.zoom);
    const zoomLabel = `${Number((this.state.zoom * 100).toFixed(1))}%`;
    this.tools.querySelector('[data-picture-zoom]').textContent = zoomLabel;
    this.zoomSlider.value = String(sliderValue(this.state.zoom));
    this.zoomSlider.setAttribute('aria-valuetext', zoomLabel);
    for (const level of this.zoomMenu.querySelectorAll('[data-picture-zoom-level]')) {
      level.setAttribute('aria-checked', String(Math.abs(Number(level.dataset.pictureZoomLevel) - this.state.zoom) < 0.00001));
    }
    this.tools.querySelector('[data-picture-action="zoom-in"]').disabled = this.state.zoom >= MAX_ZOOM;
    this.tools.querySelector('[data-picture-action="zoom-out"]').disabled = this.state.zoom <= MIN_ZOOM;
    if (this.zoomMenu.matches(':popover-open')) this.positionZoomMenu();
  }

  destroy() {
    this.stopPan();
    this.closeZoomMenu();
    this.remember();
    this.abort.abort();
    this.observer.disconnect();
  }
}

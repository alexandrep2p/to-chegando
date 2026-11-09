import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import * as L from 'leaflet';
import type { LatLng } from '@tc/shared';

export interface MapMarker {
  id: string;
  point: LatLng;
  kind: 'driver' | 'stop' | 'destination' | 'person' | 'me';
  /** Número da parada, ou inicial da pessoa. */
  text?: string;
  /** Etiqueta abaixo do marcador. */
  label?: string;
  /** Destaca a parada de quem está olhando. */
  mine?: boolean;
  /** Parada já concluída. */
  done?: boolean;
  /** Motorista sem sinal. */
  stale?: boolean;
  heading?: number | null;
}

const FLAG =
  '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4h11l-2.5 4 2.5 4H6"/></svg>';
const ARROW = (deg: number) =>
  `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="#fff" style="transform:rotate(${deg}deg)"><path d="M12 3l7 17-7-4-7 4z"/></svg>`;
const CHECK =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function markerHtml(m: MapMarker): string {
  const label = m.label ? `<span class="mk-label${m.mine ? ' mine' : ''}">${esc(m.label)}</span>` : '';
  switch (m.kind) {
    case 'driver':
      return `<span class="mk mk-driver${m.stale ? ' stale' : ''}">${ARROW(m.heading ?? 0)}</span>${label}`;
    case 'destination':
      return `<span class="mk mk-dest${m.done ? ' done' : ''}">${FLAG}</span>${label}`;
    case 'stop':
      return `<span class="mk mk-stop${m.mine ? ' mine' : ''}${m.done ? ' done' : ''}">${m.done ? CHECK : esc(m.text ?? '')}</span>${label}`;
    case 'person':
      return `<span class="mk mk-person">${esc(m.text ?? '')}</span>`;
    case 'me':
      return '<span class="mk mk-me"></span>';
  }
}

const Z_INDEX: Record<MapMarker['kind'], number> = {
  me: 100,
  person: 200,
  destination: 300,
  stop: 400,
  driver: 1000,
};

/** Mapa Leaflet. Recebe tudo por inputs; quem usa não toca na API do Leaflet. */
@Component({
  selector: 'tc-map',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      position: absolute;
      inset: 0;
      background: #e8ecef;
    }
  `,
})
export class MapComponent implements OnDestroy {
  readonly markers = input<MapMarker[]>([]);
  readonly route = input<LatLng[]>([]);
  /** Rota aproximada ou motorista sem sinal: desenha tracejada e cinza. */
  readonly routeDim = input(false);
  readonly trail = input<LatLng[]>([]);
  /** Círculo de precisão do GPS. */
  readonly circle = input<{ center: LatLng; radius: number } | null>(null);
  /** Enquadra estes pontos (enquanto o usuário não arrastar o mapa). */
  readonly fit = input<LatLng[]>([]);
  /** Segue este ponto (enquanto o usuário não arrastar o mapa). Tem prioridade sobre `fit`. */
  readonly follow = input<LatLng | null>(null);
  /** Centro inicial, para mapas sem `fit` nem `follow`. */
  readonly start = input<LatLng | null>(null);
  /** Altura em px coberta por uma folha inferior. */
  readonly padBottom = input(0);
  readonly padTop = input(80);

  readonly centerChange = output<LatLng>();
  readonly mapClick = output<LatLng>();
  /** true depois que o usuário arrasta o mapa; volta a false em recenter(). */
  readonly userMoved = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private map: L.Map | null = null;
  private readonly ready = signal(false);
  private readonly drawn = new Map<string, { marker: L.Marker; html: string }>();
  private routeLine: L.Polyline | null = null;
  private trailLine: L.Polyline | null = null;
  private circleLayer: L.Circle | null = null;
  private tween: number | null = null;
  private placed = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => this.init());

    effect(() => {
      if (!this.ready()) return;
      const markers = this.markers();
      untracked(() => this.drawMarkers(markers));
    });
    effect(() => {
      if (!this.ready()) return;
      const route = this.route();
      const dim = this.routeDim();
      const trail = this.trail();
      untracked(() => this.drawLines(route, dim, trail));
    });
    effect(() => {
      if (!this.ready()) return;
      const c = this.circle();
      untracked(() => {
        this.circleLayer?.remove();
        this.circleLayer = c
          ? L.circle(c.center, {
              radius: c.radius,
              color: '#2F5BEA',
              weight: 1.5,
              opacity: 0.4,
              fillOpacity: 0.12,
              interactive: false,
            }).addTo(this.map!)
          : null;
      });
    });
    effect(() => {
      if (!this.ready()) return;
      this.follow();
      this.fit();
      this.start();
      this.padBottom();
      untracked(() => this.applyCamera(true));
    });
  }

  private init() {
    const map = L.map(this.host.nativeElement, {
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
    });
    L.control.attribution({ prefix: false, position: 'topright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    // Brasil inteiro até chegar o primeiro ponto.
    map.setView([-14.2, -51.9], 4);
    map.on('dragstart', () => this.userMoved.set(true));
    map.on('moveend', () => {
      const c = map.getCenter();
      this.centerChange.emit({ lat: c.lat, lng: c.lng });
    });
    map.on('click', (e) => this.mapClick.emit({ lat: e.latlng.lat, lng: e.latlng.lng }));
    this.map = map;
    // A folha inferior muda de altura: o mapa se ajusta e reenquadra.
    this.resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      this.applyCamera(false);
    });
    this.resizeObserver.observe(this.host.nativeElement);
    this.ready.set(true);
  }

  /** Volta a câmera para o enquadramento automático. */
  recenter() {
    this.userMoved.set(false);
    this.applyCamera(true);
  }

  /** Leva o mapa a um ponto, sem religar o enquadramento automático. */
  flyTo(p: LatLng, zoom = 17) {
    this.map?.setView(p, Math.max(this.map.getZoom(), zoom), { animate: true });
  }

  private applyCamera(animate: boolean) {
    const map = this.map;
    if (!map || this.userMoved()) return;
    const follow = this.follow();
    const fit = this.fit();
    const padBottom = this.padBottom();
    const first = !this.placed;
    if (follow) {
      const zoom = first ? 16.5 : map.getZoom();
      // Desloca o centro para o carro ficar no meio da área livre, acima da folha.
      const target = map.project(follow, zoom).add([0, padBottom / 2 - 20]);
      map.setView(map.unproject(target, zoom), zoom, { animate: animate && !first });
      this.placed = true;
    } else if (fit.length > 1) {
      map.fitBounds(L.latLngBounds(fit.map((p) => [p.lat, p.lng] as [number, number])), {
        paddingTopLeft: [48, this.padTop()],
        paddingBottomRight: [48, padBottom + 64],
        maxZoom: 17,
        animate: animate && !first,
      });
      this.placed = true;
    } else if (fit.length === 1) {
      map.setView(fit[0], first ? 16 : map.getZoom(), { animate: animate && !first });
      this.placed = true;
    } else if (first && this.start()) {
      map.setView(this.start()!, 17, { animate: false });
      this.placed = true;
    }
  }

  private drawMarkers(markers: MapMarker[]) {
    const map = this.map!;
    const seen = new Set<string>();
    for (const m of markers) {
      seen.add(m.id);
      const html = markerHtml(m);
      const existing = this.drawn.get(m.id);
      if (!existing) {
        const marker = L.marker(m.point, {
          icon: L.divIcon({ html, className: 'mk-wrap', iconSize: [0, 0] }),
          interactive: false,
          keyboard: false,
          zIndexOffset: Z_INDEX[m.kind],
        }).addTo(map);
        this.drawn.set(m.id, { marker, html });
        continue;
      }
      if (existing.html !== html) {
        existing.marker.setIcon(L.divIcon({ html, className: 'mk-wrap', iconSize: [0, 0] }));
        existing.html = html;
      }
      if (m.kind === 'driver') this.glide(existing.marker, m.point);
      else existing.marker.setLatLng(m.point);
    }
    for (const [id, d] of this.drawn) {
      if (!seen.has(id)) {
        d.marker.remove();
        this.drawn.delete(id);
      }
    }
  }

  /** Desliza o carro até a nova posição em vez de pular. */
  private glide(marker: L.Marker, to: LatLng) {
    if (this.tween !== null) cancelAnimationFrame(this.tween);
    const from = marker.getLatLng();
    if (from.distanceTo(to) > 500 || document.visibilityState !== 'visible') {
      marker.setLatLng(to);
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1000);
      marker.setLatLng([from.lat + (to.lat - from.lat) * k, from.lng + (to.lng - from.lng) * k]);
      this.tween = k < 1 ? requestAnimationFrame(step) : null;
    };
    this.tween = requestAnimationFrame(step);
  }

  private drawLines(route: LatLng[], dim: boolean, trail: LatLng[]) {
    const map = this.map!;
    this.routeLine?.remove();
    this.trailLine?.remove();
    this.trailLine = trail.length > 1
      ? L.polyline(trail, { color: '#9AA9D6', weight: 6, opacity: 0.9, interactive: false }).addTo(map)
      : null;
    this.routeLine = route.length > 1
      ? L.polyline(route, {
          color: dim ? '#6B7483' : '#2F5BEA',
          weight: dim ? 5 : 7,
          opacity: 0.95,
          dashArray: dim ? '2 12' : undefined,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(map)
      : null;
  }

  ngOnDestroy() {
    if (this.tween !== null) cancelAnimationFrame(this.tween);
    this.resizeObserver?.disconnect();
    this.map?.remove();
    this.map = null;
  }
}

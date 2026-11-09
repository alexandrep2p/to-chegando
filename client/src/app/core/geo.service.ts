import { Injectable, signal } from '@angular/core';
import { bearing, pointAlong, type FixInput, type LatLng } from '@tc/shared';

export type GeoError = 'denied' | 'unavailable' | 'unsupported';

/** Ponto de partida do modo de simulação quando `?sim=1` (Av. Paulista, São Paulo). */
const SIM_DEFAULT: LatLng = { lat: -23.5613, lng: -46.6565 };

interface SimConfig {
  start: LatLng;
  speedMps: number;
}

/**
 * Modo de teste: `?sim=1` ou `?sim=lat,lng` troca o GPS por uma posição simulada.
 * Para o motorista em trajeto, a posição percorre a rota (`&simspeed=km/h`, padrão 40).
 * Fica no sessionStorage para sobreviver à navegação dentro da aba.
 */
function readSim(): SimConfig | null {
  try {
    const params = new URLSearchParams(location.search);
    const raw = params.get('sim');
    if (raw !== null) {
      sessionStorage.setItem('tc:sim', `${raw}|${params.get('simspeed') ?? ''}`);
    }
    const saved = sessionStorage.getItem('tc:sim');
    if (saved === null) return null;
    const [where, speed] = saved.split('|');
    const [lat, lng] = where.split(',').map(Number);
    const start = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : SIM_DEFAULT;
    const kmh = Number(speed) > 0 ? Number(speed) : 40;
    return { start, speedMps: kmh / 3.6 };
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class GeoService {
  readonly fix = signal<FixInput | null>(null);
  readonly error = signal<GeoError | null>(null);
  readonly sim = readSim();

  private watchId: number | null = null;
  private simTimer: ReturnType<typeof setInterval> | null = null;
  private simLine: LatLng[] | null = null;
  private simProgress = 0;
  private simAt: LatLng | null = null;
  private wanted = false;

  get active() {
    return this.wanted;
  }

  start() {
    this.wanted = true;
    if (this.sim) return this.startSim();
    if (this.watchId !== null) return;
    if (!('geolocation' in navigator)) {
      this.error.set('unsupported');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.error.set(null);
        const c = pos.coords;
        this.fix.set({
          lat: c.latitude,
          lng: c.longitude,
          accuracy: c.accuracy,
          heading: c.heading !== null && !Number.isNaN(c.heading) ? c.heading : null,
          speed: c.speed !== null && !Number.isNaN(c.speed) ? c.speed : null,
        });
      },
      (err) => this.error.set(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }

  stop() {
    this.wanted = false;
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.simTimer) clearInterval(this.simTimer);
    this.simTimer = null;
  }

  /** Alguns navegadores suspendem o watch em segundo plano: ao voltar, recomeça do zero. */
  restart() {
    if (!this.wanted) return;
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.start();
  }

  /** Simulação: a rota que o motorista deve percorrer, ou null para ficar parado. */
  simFollow(line: LatLng[] | null) {
    if (!this.sim) return;
    this.simLine = line && line.length > 1 ? line : null;
    this.simProgress = 0;
  }

  private startSim() {
    if (this.simTimer || !this.sim) return;
    const sim = this.sim;
    this.simAt ??= sim.start;
    const tick = () => {
      let heading: number | null = null;
      if (this.simLine) {
        this.simProgress += sim.speedMps;
        const next = pointAlong(this.simLine, this.simProgress);
        if (this.simAt && (next.lat !== this.simAt.lat || next.lng !== this.simAt.lng)) {
          heading = bearing(this.simAt, next);
        }
        this.simAt = next;
      }
      this.fix.set({
        ...this.simAt!,
        accuracy: 5,
        heading,
        speed: this.simLine ? sim.speedMps : 0,
      });
    };
    tick();
    this.simTimer = setInterval(tick, 1000);
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { haversine, type LatLng, type PickupMode } from '@tc/shared';
import { TripStore } from '../core/trip.store';
import { fmtDist } from '../shared/format';
import { Icon } from '../shared/icon';
import { MapComponent, type MapMarker } from '../shared/map';

/** Tela 6: o passageiro move o mapa até o pino ficar onde vai esperar. */
@Component({
  selector: 'tc-pin',
  imports: [MapComponent, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <div class="map-area">
        <tc-map
          [markers]="markers()"
          [circle]="circle()"
          [start]="start()"
          [padTop]="0"
          (centerChange)="center.set($event)"
        />
        <div class="pin" role="img" aria-label="Pino do ponto de encontro">
          <span class="pin-head"></span>
          <span class="pin-shadow"></span>
        </div>

        <div class="over-map top-bar">
          @if (canCancel()) {
            <button class="icon-btn float" type="button" aria-label="Voltar" (click)="cancel()">
              <tc-icon name="back" [stroke]="2.4" />
            </button>
          }
          <div class="tip grow">
            <tc-icon name="move" [size]="22" />
            <span>Mova o mapa até o pino ficar onde você vai esperar.</span>
          </div>
        </div>

        @if (gps()) {
          <button
            class="icon-btn float over-map locate"
            type="button"
            aria-label="Voltar para o meu GPS"
            (click)="toGps()"
          >
            <tc-icon name="target" />
          </button>
        }
      </div>

      <div class="sheet">
        <div class="col head">
          <span class="eyebrow">Seu ponto de encontro</span>
          @if (gps()) {
            <span class="display where">{{ offsetText() }}</span>
          } @else if (store.geo.error()) {
            <span class="display where">Sem acesso ao seu GPS</span>
            <span class="small muted">
              Tudo bem: mova o mapa até o lugar certo e confirme. Para usar o GPS, libere a
              localização nas permissões do navegador.
            </span>
          } @else {
            <span class="display where">Procurando seu GPS…</span>
          }
        </div>

        <div class="card modes" role="group" aria-label="Como o ponto se comporta">
          <button type="button" [attr.aria-pressed]="mode() === 'fixed'" (click)="mode.set('fixed')">
            Ponto fixo
          </button>
          <button
            type="button"
            [attr.aria-pressed]="mode() === 'follow'"
            [disabled]="!gps()"
            (click)="mode.set('follow')"
          >
            Seguir meu GPS
          </button>
        </div>
        <p class="small muted hint">
          @if (mode() === 'fixed') {
            O motorista vai até o pino, mesmo que você ande.
          } @else {
            O ponto começa no pino e passa a andar com você.
          }
        </p>

        <button class="btn" type="button" [disabled]="!center() || busy()" (click)="confirm()">
          Confirmar ponto
        </button>
      </div>
    </main>
  `,
  styles: `
    .pin {
      position: absolute;
      left: 50%;
      top: 50%;
      z-index: 450;
      transform: translate(-50%, -100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
    }
    .pin-head {
      width: 52px;
      height: 52px;
      box-sizing: border-box;
      border-radius: 50% 50% 50% 4px;
      transform: rotate(-45deg);
      background: var(--orange);
      border: 4px solid #fff;
      box-shadow: 0 6px 14px rgb(20 33 61 / 35%);
    }
    .pin-shadow {
      width: 10px;
      height: 4px;
      margin-top: 10px;
      border-radius: 50%;
      background: rgb(20 33 61 / 35%);
    }
    .tip {
      background: var(--ink);
      color: #fff;
      border-radius: 16px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 15px;
      line-height: 1.35;
      font-weight: 500;
      box-shadow: 0 4px 14px rgb(20 33 61 / 25%);
    }
    .locate {
      right: 16px;
      bottom: 40px;
    }
    .sheet {
      padding-top: 22px;
      gap: 14px;
    }
    .head {
      gap: 4px;
    }
    .where {
      font-size: 22px;
    }
    .modes {
      padding: 6px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }
    .modes button {
      height: 46px;
      border: 0;
      border-radius: 12px;
      background: transparent;
      font-weight: 600;
      font-size: 14px;
    }
    .modes button[aria-pressed='true'] {
      background: var(--ink);
      color: #fff;
    }
    .hint {
      line-height: 1.45;
      margin-top: -4px;
    }
  `,
})
export class PinView {
  protected readonly store = inject(TripStore);
  private readonly map = viewChild(MapComponent);

  protected readonly center = signal<LatLng | null>(null);
  protected readonly mode = signal<PickupMode>('fixed');
  protected readonly busy = signal(false);
  private centeredOnGps = false;

  private readonly me = computed(() => {
    const v = this.store.view();
    return v?.members.find((m) => m.id === v.you.memberId) ?? null;
  });
  protected readonly gps = computed<LatLng | null>(() => {
    const f = this.store.geo.fix();
    return f ? { lat: f.lat, lng: f.lng } : null;
  });
  /** Já tem ponto confirmado: está só ajustando, então pode desistir. */
  protected readonly canCancel = computed(
    () => !!this.me()?.pickup?.confirmed || this.store.role() === 'viewer',
  );

  /** Onde o mapa abre: o ponto atual, senão o GPS, senão perto do motorista. */
  protected readonly start = computed<LatLng | null>(() => {
    const pickup = untracked(() => this.me()?.pickup);
    if (pickup) return pickup.point;
    const gps = this.gps();
    if (gps) return gps;
    const driver = untracked(() => this.store.driverFix());
    return driver ? { lat: driver.lat, lng: driver.lng } : null;
  });

  protected readonly markers = computed<MapMarker[]>(() => {
    const gps = this.gps();
    return gps ? [{ id: 'me', kind: 'me', point: gps }] : [];
  });
  protected readonly circle = computed(() => {
    const f = this.store.geo.fix();
    return f && f.accuracy > 8 ? { center: { lat: f.lat, lng: f.lng }, radius: f.accuracy } : null;
  });
  protected readonly offsetText = computed(() => {
    const c = this.center();
    const gps = this.gps();
    if (!c || !gps) return 'No lugar do seu GPS';
    const d = haversine(c, gps);
    return d < 8 ? 'No lugar do seu GPS' : `A ${fmtDist(d)} do seu GPS`;
  });

  constructor() {
    this.store.geo.start();
    const pickup = this.me()?.pickup;
    if (pickup) {
      this.mode.set(pickup.mode);
      this.centeredOnGps = true; // já tinha ponto: não puxa o mapa para o GPS
    }
    // Primeira leitura do GPS: leva o pino até lá, se o mapa abriu em outro lugar.
    effect(() => {
      const gps = this.gps();
      const map = this.map();
      if (!gps || !map || this.centeredOnGps) return;
      this.centeredOnGps = true;
      untracked(() => map.flyTo(gps));
    });
  }

  protected toGps() {
    const gps = this.gps();
    if (gps) this.map()?.flyTo(gps);
  }

  protected cancel() {
    this.store.editingPin.set(false);
  }

  protected async confirm() {
    const point = this.center();
    if (!point || this.busy()) return;
    this.busy.set(true);
    await this.store.setPickup(point, this.mode());
    this.busy.set(false);
  }
}

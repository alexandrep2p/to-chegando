import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import type { LatLng, StopView } from '@tc/shared';
import { TripStore } from '../core/trip.store';
import { fmtClock, fmtDist, fmtEta, fmtNames } from '../shared/format';
import { Icon } from '../shared/icon';
import { MapComponent } from '../shared/map';
import { tripMarkers } from '../shared/trip-map';
import { shareTrip } from './invite.view';

/** Tela 4: o motorista a caminho, com a próxima parada em destaque. */
@Component({
  selector: 'tc-driving',
  imports: [MapComponent, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <div class="map-area">
        <tc-map
          [markers]="markers()"
          [route]="store.routeLine()"
          [routeDim]="!!store.view()?.route?.approximate"
          [trail]="store.trailLine()"
          [follow]="me()"
          [padBottom]="24"
        />

        <div class="over-map top-bar">
          <div class="pill grow" role="status">
            @if (gpsProblem(); as problem) {
              <span class="live-dot off"></span>
              <strong>Sem GPS</strong>
              <span class="muted ellipsis">{{ problem }}</span>
            } @else if (!store.connected()) {
              <span class="live-dot off"></span>
              <strong>Reconectando…</strong>
            } @else {
              <span class="live-dot"></span>
              <strong>Ao vivo</strong>
              <span class="muted ellipsis">{{ watching() }}</span>
            }
          </div>
          <button class="icon-btn float" type="button" aria-label="Opções da viagem" (click)="menu.set(true)">
            <tc-icon name="more" [stroke]="3" />
          </button>
        </div>

        @if (map()?.userMoved()) {
          <button class="icon-btn float over-map locate" type="button" aria-label="Centralizar em mim" (click)="map()?.recenter()">
            <tc-icon name="target" />
          </button>
        }
      </div>

      <div class="sheet">
        <span class="sheet-handle" aria-hidden="true"></span>

        @if (store.nextStop(); as next) {
          <div class="row next">
            <div class="col grow">
              <span class="eyebrow">Próxima parada</span>
              <span class="display title ellipsis">{{ next.label }}</span>
              <span class="small muted ellipsis">{{ subtitle(next) }}</span>
            </div>
            <div class="col right">
              <span class="num big">{{ eta(next) }}</span>
              @if (clock(next); as at) {
                <span class="small muted">chega {{ at }}</span>
              }
            </div>
          </div>

          @if (later().length) {
            <div class="card queue">
              @for (s of later(); track s.id; let i = $index) {
                <div class="row line">
                  <span class="badge sm" [class.dest]="s.kind === 'destination'">
                    @if (s.kind === 'destination') {
                      <tc-icon name="flag" [size]="13" [stroke]="2.8" />
                    } @else {
                      {{ i + 2 }}
                    }
                  </span>
                  <span class="grow name ellipsis">{{ s.label }}</span>
                  <span class="small muted">{{ clock(s) }}</span>
                  <span class="num when">{{ eta(s) }}</span>
                </div>
              }
            </div>
          }

          <button class="btn dark" type="button" [disabled]="busy()" (click)="arrive(next)">
            <tc-icon name="check" [stroke]="2.6" /> <span class="ellipsis">Cheguei: {{ next.label }}</span>
          </button>
        }

        @if (!store.device.wakeLockSupported) {
          <p class="small muted">Mantenha a tela ligada: com ela apagada, sua posição para de ser enviada.</p>
        }
      </div>

      @if (menu()) {
        <div class="scrim" (click)="menu.set(false)"></div>
        <div class="menu" role="dialog" aria-label="Opções da viagem">
          <button type="button" (click)="share()"><tc-icon name="share" /> Compartilhar o link</button>
          <button type="button" (click)="editStops()"><tc-icon name="grip" /> Editar paradas</button>
          <button type="button" class="danger" (click)="end()"><tc-icon name="close" /> Encerrar viagem</button>
          <button type="button" class="cancel" (click)="menu.set(false)">Fechar</button>
        </div>
      }
    </main>
  `,
  styles: `
    .pill strong {
      font-weight: 600;
      white-space: nowrap;
    }
    .locate {
      right: 16px;
      bottom: 40px;
    }
    .next {
      align-items: flex-end;
      gap: 14px;
    }
    .next .col {
      gap: 2px;
    }
    .title {
      font-size: 24px;
    }
    .right {
      align-items: flex-end;
      flex-shrink: 0;
    }
    .big {
      font-size: 34px;
      line-height: 1;
      color: var(--blue);
      white-space: nowrap;
    }
    .queue {
      padding: 4px 14px;
      max-height: 146px;
      overflow-y: auto;
    }
    .line {
      height: 46px;
    }
    .line + .line {
      border-top: 1px solid var(--line);
    }
    .name {
      font-weight: 600;
      font-size: 15px;
    }
    .when {
      font-size: 15px;
      min-width: 56px;
      text-align: right;
      white-space: nowrap;
    }
    .scrim {
      position: absolute;
      inset: 0;
      z-index: 900;
      background: rgb(20 33 61 / 45%);
    }
    .menu {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 901;
      background: var(--bg);
      border-radius: 24px 24px 0 0;
      padding: 12px 12px calc(16px + var(--safe-bottom));
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .menu button {
      min-height: 56px;
      border: 0;
      border-radius: 14px;
      background: transparent;
      padding: 0 16px;
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 16px;
      font-weight: 600;
      text-align: left;
    }
    .menu .danger {
      color: #b3261e;
    }
    .menu .cancel {
      justify-content: center;
      color: var(--muted);
    }
  `,
})
export class DrivingView {
  protected readonly store = inject(TripStore);
  protected readonly map = viewChild(MapComponent);
  protected readonly menu = signal(false);
  protected readonly busy = signal(false);

  protected readonly markers = computed(() => tripMarkers(this.store, { etaLabels: true }));
  protected readonly me = computed<LatLng | null>(() => {
    const f = this.store.driverFix();
    return f ? { lat: f.lat, lng: f.lng } : null;
  });
  protected readonly later = computed(() => this.store.pending().slice(1));
  protected readonly watching = computed(() => {
    const names = (this.store.view()?.members ?? []).filter((m) => m.connected).map((m) => m.name);
    if (names.length === 0) return 'ninguém com o app aberto';
    return `${fmtNames(names)} ${names.length === 1 ? 'está' : 'estão'} vendo`;
  });
  protected readonly gpsProblem = computed(() => {
    const error = this.store.geo.error();
    if (error === 'denied') return 'libere a localização no navegador';
    if (error === 'unsupported') return 'este navegador não tem localização';
    if (error === 'unavailable') return 'procurando sinal…';
    return this.store.driverStale() ? 'procurando sinal…' : null;
  });

  protected eta(s: StopView) {
    const eta = this.store.etaOf(s);
    return eta === null ? '—' : fmtEta(eta);
  }

  protected clock(s: StopView) {
    return fmtClock(this.store.arrivalTimeOf(s));
  }

  protected subtitle(s: StopView) {
    const parts = [s.address, this.store.etaOf(s) === null ? null : fmtDist(s.etaMeters)];
    return parts.filter(Boolean).join(' · ') || (s.kind === 'destination' ? 'Destino final' : 'Ponto confirmado');
  }

  protected async arrive(s: StopView) {
    this.busy.set(true);
    await this.store.arrive(s.id);
    this.busy.set(false);
  }

  protected async share() {
    this.menu.set(false);
    const v = this.store.view();
    if (!v) return;
    const how = await shareTrip(v.code, v.driver.name);
    if (how === 'copied') this.store.say('Link copiado');
    if (how === 'failed') this.store.say('Não deu para compartilhar o link.');
  }

  protected editStops() {
    this.menu.set(false);
    this.store.editingStops.set(true);
  }

  protected async end() {
    this.menu.set(false);
    if (await this.store.ask('Encerrar a viagem agora? O mapa fecha para todo mundo.', 'Encerrar')) {
      void this.store.end();
    }
  }
}

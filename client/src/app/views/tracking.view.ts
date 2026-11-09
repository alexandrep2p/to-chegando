import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { LatLng, StopView } from '@tc/shared';
import { TripStore } from '../core/trip.store';
import { fmtAgo, fmtClock, fmtDist, fmtEta } from '../shared/format';
import { Icon } from '../shared/icon';
import { MapComponent } from '../shared/map';
import { tripMarkers } from '../shared/trip-map';

/** Menos que isto para chegar: "Tá chegando!". */
const ALMOST_THERE_S = 120;

/** Telas 7 e 8: quem espera vê o motorista chegando, ou o aviso de sem sinal. */
@Component({
  selector: 'tc-tracking',
  imports: [MapComponent, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <div class="map-area">
        <tc-map
          [markers]="markers()"
          [route]="store.routeLine()"
          [routeDim]="stale() || !!view().route?.approximate"
          [trail]="store.trailLine()"
          [fit]="bounds()"
          [padBottom]="24"
          [padTop]="stale() ? 150 : 80"
        />

        <div class="over-map top-bar">
          @if (stale()) {
            <div class="notice warn grow" role="status">
              <tc-icon name="nosignal" [size]="22" />
              <p>
                <strong>Sem sinal de {{ driver() }} {{ since() }}</strong>
                A tela pode ter sido bloqueada ou o app trocado. O mapa volta a atualizar sozinho
                quando {{ driver() }} abrir o Tô Chegando.
              </p>
            </div>
          } @else {
            <div class="pill" role="status">
              @if (!store.connected()) {
                <span class="live-dot off"></span>
                <strong>Reconectando…</strong>
              } @else if (store.driverFix()) {
                <span class="live-dot"></span>
                <strong>Ao vivo</strong>
                <span class="muted">atualizado {{ since() }}</span>
              } @else {
                <span class="live-dot off"></span>
                <span class="muted ellipsis">Aguardando a localização de {{ driver() }}</span>
              }
            </div>
          }
        </div>

        @if (map()?.userMoved()) {
          <button class="icon-btn float over-map locate" type="button" aria-label="Enquadrar o trajeto" (click)="map()?.recenter()">
            <tc-icon name="target" />
          </button>
        }
      </div>

      <div class="sheet">
        <span class="sheet-handle" aria-hidden="true"></span>

        <div class="row headline">
          <div class="col grow">
            <span class="eyebrow">{{ head().eyebrow }}</span>
            <span class="num big" [class.dim]="stale() || head().dim" [class.words]="head().words">{{ head().big }}</span>
          </div>
          @if (head().clock) {
            <div class="col right">
              <span class="num clock" [class.dim]="stale()">{{ head().clock }}</span>
              <span class="small muted">{{ head().sub }}</span>
            </div>
          }
        </div>

        @if (queue().length) {
          <div class="card queue">
            @for (q of queue(); track q.stop.id) {
              <div class="row line">
                <span class="badge sm" [class.dest]="q.stop.kind === 'destination'">
                  @if (q.stop.kind === 'destination') {
                    <tc-icon name="flag" [size]="13" [stroke]="2.8" />
                  } @else {
                    {{ q.n }}
                  }
                </span>
                <span class="grow text ellipsis" [class.mine]="q.mine">{{ q.text }}</span>
                <span class="num when" [class.mine]="q.mine && !stale()" [class.dim]="stale()">{{ q.eta }}</span>
              </div>
            }
          </div>
        }

        @if (canPin()) {
          <button class="btn outline small" type="button" (click)="store.editingPin.set(true)">
            <tc-icon name="pin" [size]="18" /> {{ mine() ? 'Ajustar meu ponto' : 'Marcar meu ponto de encontro' }}
          </button>
        }
        <button class="btn-text leave" type="button" (click)="leave()">Sair da viagem</button>
      </div>
    </main>
  `,
  styles: `
    .pill strong {
      font-weight: 600;
      white-space: nowrap;
    }
    .top-bar {
      align-items: flex-start;
    }
    .locate {
      right: 16px;
      bottom: 40px;
    }
    .headline {
      align-items: flex-end;
    }
    .headline .col {
      gap: 2px;
    }
    .eyebrow {
      font-size: 14px;
    }
    .big {
      font-size: 44px;
      line-height: 1.05;
      letter-spacing: -1px;
      color: var(--blue);
    }
    .big.words {
      font-size: 32px;
      letter-spacing: -0.5px;
    }
    .big.dim,
    .clock.dim,
    .when.dim {
      color: var(--muted);
    }
    .right {
      align-items: flex-end;
      padding-bottom: 4px;
      flex-shrink: 0;
    }
    .clock {
      font-size: 20px;
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
    .text {
      font-size: 15px;
    }
    .text.mine {
      font-weight: 600;
    }
    .when {
      font-size: 15px;
      white-space: nowrap;
    }
    .when.mine {
      color: var(--blue);
    }
    .leave {
      color: var(--muted);
      margin: -6px 0 -10px;
    }
  `,
})
export class TrackingView {
  protected readonly store = inject(TripStore);
  private readonly router = inject(Router);
  protected readonly map = viewChild(MapComponent);

  protected readonly view = computed(() => this.store.view()!);
  protected readonly driver = computed(() => this.view().driver.name);
  protected readonly mine = this.store.myStop;
  protected readonly stale = this.store.driverStale;
  protected readonly markers = computed(() => tripMarkers(this.store, { etaLabels: false }));
  protected readonly canPin = computed(() => this.mine()?.status !== 'arrived');

  /** Enquadra o motorista e a minha parada; sem parada, o trajeto todo. */
  protected readonly bounds = computed<LatLng[]>(() => {
    const fix = this.store.driverFix();
    const mine = this.mine();
    const points: LatLng[] =
      mine?.status === 'pending' ? [mine.point] : this.store.pending().map((s) => s.point);
    if (fix) points.push({ lat: fix.lat, lng: fix.lng });
    return points;
  });

  protected readonly since = computed(() => {
    const fix = this.store.driverFix();
    return fix ? fmtAgo(this.store.serverNow() - fix.at) : '';
  });

  private fmt(s: StopView | null): string {
    const eta = this.store.etaOf(s);
    if (eta === null) return '—';
    return `${this.stale() ? '~' : ''}${fmtEta(eta)}`;
  }

  /** O destaque da folha: o que mais importa para quem está olhando agora. */
  protected readonly head = computed(() => {
    const v = this.view();
    const mine = this.mine();
    const target = mine?.status === 'pending' ? mine : this.store.nextStop();
    const eta = this.store.etaOf(target);
    const at = fmtClock(this.store.arrivalTimeOf(target));
    const approx = this.stale() ? '~' : '';
    const clock = eta === null ? '' : `${approx}${at}`;
    const sub = target?.etaMeters != null && eta !== null ? fmtDist(target.etaMeters) : '';
    const name = v.driver.name;

    if (mine?.status === 'arrived') {
      return { eyebrow: 'Sua parada', big: `${name} já chegou`, dim: false, words: true, clock: '', sub: '' };
    }
    if (v.phase === 'lobby') {
      return {
        eyebrow: eta === null ? `${name} ainda não saiu` : `${name} ainda não saiu. Daqui até a parada:`,
        big: eta === null ? 'Aguardando' : `${approx}${fmtEta(eta)}`,
        dim: true,
        words: eta === null,
        clock: '',
        sub: '',
      };
    }
    if (!target) return { eyebrow: name, big: 'A caminho', dim: false, words: true, clock: '', sub: '' };
    if (target !== mine) {
      return { eyebrow: `Próxima parada: ${target.label}`, big: this.fmt(target), dim: false, words: false, clock, sub };
    }
    if (this.stale()) {
      return { eyebrow: 'Última previsão de chegada', big: this.fmt(mine), dim: true, words: false, clock, sub };
    }
    if (eta !== null && eta < ALMOST_THERE_S) {
      return { eyebrow: `${name} chega em ${fmtEta(eta)}`, big: 'Tá chegando!', dim: false, words: true, clock, sub };
    }
    return { eyebrow: `${name} chega em`, big: this.fmt(mine), dim: false, words: false, clock, sub };
  });

  /** A fila de paradas, contada do ponto de vista de quem espera. */
  protected readonly queue = computed(() => {
    const me = this.store.meId();
    const pending = this.store.pending();
    const myIndex = pending.findIndex((s) => s.memberId === me);
    return pending.map((stop, i) => {
      const mine = i === myIndex;
      let text = stop.label;
      if (mine) text = stop.address ? `Você · ${stop.address}` : 'Você';
      else if (myIndex !== -1 && i < myIndex) text = `Antes: ${stop.label}`;
      else if (myIndex !== -1) text = `Depois: ${stop.label}`;
      return { stop, n: i + 1, mine, text, eta: this.fmt(stop) };
    });
  });

  protected async leave() {
    if (!(await this.store.ask('Sair desta viagem?', 'Sair'))) return;
    await this.store.leave();
    void this.router.navigate(['/'], { replaceUrl: true });
  }
}

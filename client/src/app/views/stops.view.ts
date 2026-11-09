import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { LatLng, PlaceResult, StopView } from '@tc/shared';
import { TripStore } from '../core/trip.store';
import { fmtDist, fmtEta } from '../shared/format';
import { Icon } from '../shared/icon';
import { MapComponent } from '../shared/map';
import { tripBounds, tripMarkers } from '../shared/trip-map';

/** Tela 3: o motorista escolhe a ordem das paradas e o destino final. */
@Component({
  selector: 'tc-stops',
  imports: [FormsModule, CdkDropList, CdkDrag, CdkDragHandle, MapComponent, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <div class="map-area">
        <tc-map
          [markers]="markers()"
          [route]="store.routeLine()"
          [routeDim]="!!store.view()?.route?.approximate"
          [fit]="bounds()"
          [padBottom]="24"
          [padTop]="70"
          (mapClick)="onMapClick($event)"
        />
        <div class="over-map top-bar">
          <button class="icon-btn float" type="button" aria-label="Voltar" (click)="back()">
            <tc-icon name="back" [stroke]="2.4" />
          </button>
          @if (picking()) {
            <div class="pill grow tip">Toque no mapa para marcar o destino</div>
          }
        </div>
      </div>

      <div class="sheet">
        @if (adding()) {
          <div class="row">
            <h1 class="display grow">Destino final</h1>
            <button class="icon-btn" type="button" aria-label="Cancelar" (click)="closeSearch()">
              <tc-icon name="close" [size]="18" [stroke]="2.4" />
            </button>
          </div>
          <form class="row search" (ngSubmit)="search()">
            <label class="grow">
              <span class="sr">Endereço ou nome do lugar</span>
              <input
                class="input"
                name="q"
                type="search"
                placeholder="Endereço ou nome do lugar"
                enterkeyhint="search"
                autocomplete="off"
                [(ngModel)]="query"
              />
            </label>
            <button class="btn small" type="submit" aria-label="Buscar" [disabled]="query().trim().length < 3">
              <tc-icon name="search" />
            </button>
          </form>
          <div class="col results">
            @if (searching()) {
              <p class="small muted">Buscando…</p>
            } @else if (results(); as list) {
              @for (r of list; track $index) {
                <button class="card result" type="button" (click)="choose(r)">
                  <tc-icon name="pin" /> <span>{{ r.label }}</span>
                </button>
              } @empty {
                <p class="small muted">Nada encontrado. Tente outro nome, ou marque no mapa.</p>
              }
            }
          </div>
          <button class="btn outline small" type="button" (click)="picking.set(true)">
            <tc-icon name="target" [size]="18" /> Marcar tocando no mapa
          </button>
        } @else {
          <div class="col head">
            <h1 class="display">Quem você busca primeiro?</h1>
            <span class="small muted">
              {{ people().length > 1 ? 'Arraste para mudar a ordem' : 'As paradas aparecem conforme as pessoas confirmam o ponto' }}
            </span>
          </div>

          <div class="col list" cdkDropList (cdkDropListDropped)="drop($event)">
            @for (s of done(); track s.id) {
              <div class="card row stop is-done">
                <span class="badge done" [class.dest]="s.kind === 'destination'">
                  <tc-icon name="check" [size]="16" [stroke]="3" />
                </span>
                <div class="col grow">
                  <span class="name ellipsis">{{ s.label }}</span>
                  <span class="small muted">Concluída</span>
                </div>
              </div>
            }
            @for (s of people(); track s.id; let i = $index) {
              <div class="card row stop" cdkDrag cdkDragLockAxis="y" [cdkDragDisabled]="people().length < 2">
                <span class="badge">{{ i + 1 }}</span>
                <div class="col grow">
                  <span class="name ellipsis">{{ s.label }}</span>
                  <span class="small muted ellipsis">{{ s.address ?? 'Ponto confirmado' }}</span>
                </div>
                <span class="num eta">{{ eta(s) }}</span>
                @if (people().length > 1) {
                  <button class="icon-btn handle" type="button" cdkDragHandle [attr.aria-label]="'Arrastar ' + s.label">
                    <tc-icon name="grip" [size]="18" [stroke]="2.4" />
                  </button>
                }
              </div>
            }
          </div>

          @if (destination(); as d) {
            <div class="card row stop">
              <span class="badge dest"><tc-icon name="flag" [size]="16" [stroke]="2.6" /></span>
              <div class="col grow">
                <span class="name ellipsis">{{ d.label }}</span>
                <span class="small muted ellipsis">Destino final{{ d.address ? ' · ' + d.address : '' }}</span>
              </div>
              <span class="num eta">{{ eta(d) }}</span>
              <button class="icon-btn" type="button" aria-label="Remover destino final" (click)="store.setDestination(null)">
                <tc-icon name="close" [size]="16" [stroke]="2.4" />
              </button>
            </div>
          } @else {
            <button class="add" type="button" (click)="adding.set(true)">
              <tc-icon name="plus" [size]="18" [stroke]="2.4" /> Adicionar destino final (opcional)
            </button>
          }

          @if (pending().length === 0) {
            <p class="small muted empty">
              Ninguém confirmou o ponto de encontro ainda. Você também pode sair só com um destino
              final.
            </p>
          } @else {
            <div class="row totals">
              <span class="small muted grow">
                @if (total(); as t) {
                  Total: <strong>{{ t }}</strong>
                } @else if (!store.driverFix()) {
                  Aguardando sua localização…
                } @else {
                  Calculando a rota…
                }
              </span>
              @if (people().length > 1) {
                <button class="btn-text" type="button" (click)="store.optimize()">Sugerir melhor ordem</button>
              }
            </div>
          }

          @if (driving()) {
            <button class="btn dark cta" type="button" (click)="back()">Voltar ao trajeto</button>
          } @else {
            <button class="btn cta" type="button" [disabled]="pending().length === 0 || busy()" (click)="start()">
              <tc-icon name="nav" [size]="20" /> Começar trajeto
            </button>
          }
        }
      </div>
    </main>
  `,
  styles: `
    .map-area {
      flex: 0 0 36%;
      min-height: 180px;
    }
    .sheet {
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
      padding-top: 22px;
    }
    h1 {
      font-size: 24px;
    }
    .head {
      gap: 4px;
    }
    .list {
      gap: 10px;
    }
    .stop {
      padding: 10px 8px 10px 14px;
      min-height: 44px;
      background: var(--card);
    }
    .stop .col {
      gap: 2px;
    }
    .stop.is-done {
      opacity: 0.7;
      padding-right: 14px;
    }
    .name {
      font-weight: 600;
    }
    .eta {
      font-size: 16px;
      white-space: nowrap;
      padding-right: 6px;
    }
    .handle {
      cursor: grab;
      touch-action: none;
    }
    .add {
      min-height: 56px;
      border: 1.5px dashed #9aa4b2;
      border-radius: 16px;
      background: transparent;
      color: var(--ink);
      font-weight: 600;
      font-size: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .totals {
      padding: 0 4px;
      min-height: 44px;
    }
    .totals strong {
      color: var(--ink);
    }
    .empty {
      line-height: 1.45;
    }
    .cta {
      margin-top: auto;
    }
    .search .btn {
      width: 54px;
      height: 54px;
      padding: 0;
    }
    .results {
      gap: 8px;
      min-height: 24px;
    }
    .result {
      border: 0;
      text-align: left;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 15px;
      line-height: 1.35;
    }
    .result tc-icon {
      color: var(--muted);
    }
    .tip {
      background: var(--ink);
      color: #fff;
      font-weight: 600;
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
})
export class StopsView {
  protected readonly store = inject(TripStore);

  protected readonly adding = signal(false);
  protected readonly picking = signal(false);
  protected readonly query = signal('');
  protected readonly searching = signal(false);
  protected readonly results = signal<PlaceResult[] | null>(null);
  protected readonly busy = signal(false);
  /** Ordem recém-arrastada, mostrada até o servidor confirmar. */
  private readonly localOrder = signal<string[] | null>(null);

  protected readonly driving = computed(() => this.store.view()?.phase === 'driving');
  protected readonly pending = this.store.pending;
  protected readonly done = computed(
    () => this.store.view()?.stops.filter((s) => s.status === 'arrived') ?? [],
  );
  protected readonly destination = computed(
    () => this.pending().find((s) => s.kind === 'destination') ?? null,
  );
  protected readonly people = computed(() => {
    const list = this.pending().filter((s) => s.kind === 'member');
    const order = this.localOrder();
    if (!order) return list;
    const byId = new Map(list.map((s) => [s.id, s]));
    const sorted = order.map((id) => byId.get(id)).filter((s): s is StopView => !!s);
    return sorted.length === list.length ? sorted : list;
  });
  protected readonly markers = computed(() => tripMarkers(this.store, { etaLabels: false }));
  protected readonly bounds = computed(() => tripBounds(this.store));
  protected readonly total = computed(() => {
    const last = this.pending().at(-1);
    const eta = this.store.etaOf(last ?? null);
    if (!last || eta === null) return null;
    return `${fmtEta(eta)} · ${fmtDist(last.etaMeters)}`;
  });

  constructor() {
    // Chegou estado novo do servidor: ele passa a mandar na ordem.
    effect(() => {
      this.store.view();
      untracked(() => this.localOrder.set(null));
    });
  }

  protected eta(s: StopView) {
    const eta = this.store.etaOf(s);
    return eta === null ? '' : fmtEta(eta);
  }

  protected drop(e: CdkDragDrop<unknown>) {
    const ids = this.people().map((s) => s.id);
    // Os itens concluídos vêm antes na mesma lista e não são arrastáveis.
    const offset = this.done().length;
    moveItemInArray(ids, e.previousIndex - offset, e.currentIndex - offset);
    this.localOrder.set(ids);
    void this.store.setOrder(ids);
  }

  protected async search() {
    const q = this.query().trim();
    if (q.length < 3 || this.searching()) return;
    this.searching.set(true);
    this.results.set(await this.store.search(q));
    this.searching.set(false);
  }

  protected async choose(r: PlaceResult) {
    const label = r.label.split(',')[0].trim();
    if (await this.store.setDestination({ point: r.point, label })) this.closeSearch();
  }

  protected async onMapClick(point: LatLng) {
    if (!this.picking()) return;
    if (await this.store.setDestination({ point, label: '' })) this.closeSearch();
  }

  protected closeSearch() {
    this.adding.set(false);
    this.picking.set(false);
    this.results.set(null);
    this.query.set('');
  }

  protected back() {
    if (this.adding()) return this.closeSearch();
    if (this.driving()) this.store.editingStops.set(false);
    else this.store.driverStep.set('invite');
  }

  protected async start() {
    this.busy.set(true);
    await this.store.start();
    this.busy.set(false);
  }
}

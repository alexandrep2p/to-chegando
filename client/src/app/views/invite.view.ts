import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import QRCode from 'qrcode';
import { haversine, type MemberView } from '@tc/shared';
import { TripStore } from '../core/trip.store';
import { fmtDist, initial } from '../shared/format';
import { Icon } from '../shared/icon';

export function tripUrl(code: string) {
  return `${location.origin}/v/${code}`;
}

/** Compartilha pelo menu nativo; sem ele, copia o link. Devolve o que aconteceu. */
export async function shareTrip(code: string, driverName: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = tripUrl(code);
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Tô Chegando',
        text: `${driverName} tá chegando. Acompanhe no mapa:`,
        url,
      });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'shared';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Tela 2: o motorista manda o link e vê quem já entrou. */
@Component({
  selector: 'tc-invite',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen screen-pad">
      <header class="row">
        <div class="col grow">
          <span class="eyebrow">Viagem de {{ view().driver.name }}</span>
          <h1 class="display">Chame quem vai te esperar</h1>
        </div>
        <button class="icon-btn bordered" type="button" aria-label="Encerrar viagem" (click)="end()">
          <tc-icon name="close" [size]="18" [stroke]="2.4" />
        </button>
      </header>

      <section class="card link-card">
        <div class="row link-top">
          @if (qr(); as src) {
            <img class="qr" [src]="src" alt="QR code do link da viagem" width="104" height="104" />
          } @else {
            <div class="qr placeholder" aria-hidden="true"></div>
          }
          <div class="col grow link-text">
            <span class="eyebrow">Link da viagem</span>
            <span class="num link">{{ shortUrl() }}</span>
          </div>
        </div>
        <div class="link-actions">
          <button class="btn small" type="button" (click)="share()">
            <tc-icon name="share" [size]="18" /> Compartilhar
          </button>
          <button class="btn small outline" type="button" (click)="copy()">
            <tc-icon name="copy" [size]="18" /> Copiar link
          </button>
        </div>
      </section>

      <section class="col people grow">
        <h2 class="caps">Quem já entrou · {{ view().members.length }}</h2>
        @for (m of view().members; track m.id) {
          <div class="card row person">
            <span class="avatar" aria-hidden="true">{{ letter(m.name) }}</span>
            <div class="col grow">
              <span class="name ellipsis">{{ m.name }}</span>
              <span class="small" [class.ok]="m.pickup?.confirmed" [class.muted]="!m.pickup?.confirmed">
                {{ statusOf(m) }}
              </span>
            </div>
            <button
              class="icon-btn"
              type="button"
              [attr.aria-label]="'Remover ' + m.name"
              (click)="remove(m)"
            >
              <tc-icon name="close" [size]="16" [stroke]="2.4" />
            </button>
          </div>
        }
        <div class="row waiting small muted">
          <tc-icon name="clock" />
          {{ view().members.length ? 'Aguardando mais gente abrir o link' : 'Aguardando alguém abrir o link' }}
        </div>
      </section>

      <footer class="col foot">
        <button class="btn" type="button" (click)="store.driverStep.set('stops')">
          Montar paradas <tc-icon name="arrow" [stroke]="2.4" />
        </button>
        <p class="small muted">Quem entrar depois ainda pode ser adicionado no caminho.</p>
      </footer>
    </main>
  `,
  styles: `
    h1 {
      font-size: 26px;
    }
    header .col {
      gap: 2px;
    }
    .link-card {
      border-radius: 20px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .link-top {
      gap: 16px;
    }
    .qr {
      width: 104px;
      height: 104px;
      flex-shrink: 0;
      border-radius: 12px;
    }
    .qr.placeholder {
      border: 1.5px dashed #9aa4b2;
    }
    .link-text {
      gap: 6px;
    }
    .link {
      font-size: 17px;
      line-height: 1.25;
      word-break: break-all;
    }
    .link-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .link-actions .btn {
      padding: 0 8px;
      gap: 8px;
    }
    .people {
      gap: 10px;
    }
    .person {
      padding: 10px 6px 10px 16px;
      gap: 14px;
    }
    .person .col {
      gap: 2px;
    }
    .name {
      font-weight: 600;
    }
    .ok {
      color: var(--green);
      font-weight: 500;
    }
    .waiting {
      border: 1.5px dashed #9aa4b2;
      border-radius: 16px;
      padding: 16px;
    }
    .foot {
      gap: 10px;
      text-align: center;
    }
  `,
})
export class InviteView {
  protected readonly store = inject(TripStore);
  protected readonly view = computed(() => this.store.view()!);
  protected readonly qr = signal<string | null>(null);
  protected readonly shortUrl = computed(() => tripUrl(this.view().code).replace(/^https?:\/\//, ''));
  protected readonly letter = initial;

  constructor() {
    QRCode.toDataURL(tripUrl(this.view().code), { margin: 1, width: 208, color: { dark: '#14213D' } })
      .then((src) => this.qr.set(src))
      .catch(() => undefined);
  }

  protected statusOf(m: MemberView): string {
    if (m.role === 'viewer') return 'Só acompanhando';
    if (!m.pickup?.confirmed) return 'Ajustando o ponto de encontro…';
    const fix = this.store.driverFix();
    const where = m.pickup.address ?? 'Ponto confirmado';
    return fix ? `${where} · ${fmtDist(haversine(fix, m.pickup.point))} de você` : where;
  }

  protected async share() {
    const how = await shareTrip(this.view().code, this.view().driver.name);
    if (how === 'copied') this.store.say('Link copiado');
    if (how === 'failed') this.store.say('Não deu para compartilhar. Copie o link acima.');
  }

  protected async copy() {
    try {
      await navigator.clipboard.writeText(tripUrl(this.view().code));
      this.store.say('Link copiado');
    } catch {
      this.store.say('Não deu para copiar. Selecione o link acima.');
    }
  }

  protected async remove(m: MemberView) {
    if (await this.store.ask(`Remover ${m.name} da viagem?`, 'Remover')) {
      void this.store.removeMember(m.id);
    }
  }

  protected async end() {
    if (await this.store.ask('Encerrar a viagem? O link deixa de funcionar para todos.', 'Encerrar')) {
      void this.store.end();
    }
  }
}

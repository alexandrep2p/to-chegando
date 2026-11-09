import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NAME_MAX } from '@tc/shared';
import { sessions } from '../core/session';
import { TripStore } from '../core/trip.store';
import { Icon } from '../shared/icon';

@Component({
  selector: 'tc-home',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <div class="hero">
        <svg aria-hidden="true" viewBox="0 0 390 340" preserveAspectRatio="xMidYMid slice">
          <rect width="390" height="340" fill="#E8ECEF" />
          <rect x="236" y="30" width="80" height="70" rx="12" fill="#D5E6D0" />
          <g stroke="#fff" stroke-width="14" stroke-linecap="round" fill="none">
            <path d="M-10 130 L400 100" />
            <path d="M-10 260 L400 280" />
            <path d="M84 -10 L70 350" />
            <path d="M216 -10 L232 350" />
            <path d="M332 -10 L336 350" />
          </g>
          <g stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none">
            <path d="M-10 40 L400 30" />
            <path d="M-10 195 L400 198" />
            <path d="M150 -10 L150 350" />
          </g>
          <path
            d="M72 320 L74 264 L230 272 L222 113 L333 105"
            fill="none"
            stroke="#2F5BEA"
            stroke-width="6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="72" cy="318" r="25" fill="#2F5BEA" opacity="0.18" />
          <circle cx="72" cy="318" r="15" fill="#2F5BEA" stroke="#fff" stroke-width="4" />
          <g font-family="Space Grotesk, sans-serif" font-weight="700" font-size="14" text-anchor="middle" fill="#14213D">
            <circle cx="230" cy="272" r="14.5" fill="#F26B1D" stroke="#fff" stroke-width="3" />
            <text x="230" y="277">1</text>
            <circle cx="333" cy="105" r="14.5" fill="#F26B1D" stroke="#fff" stroke-width="3" />
            <text x="333" y="110">2</text>
          </g>
        </svg>
        <div class="brand">
          <span class="brand-mark"><tc-icon name="pin" [size]="18" [stroke]="2.4" /></span>
          <span class="display">Tô Chegando</span>
        </div>
      </div>

      <form class="body" (ngSubmit)="create()">
        <div class="col intro">
          <h1 class="display">Mostre que você tá chegando.</h1>
          <p class="muted">
            Crie uma viagem, mande o link e escolha quem buscar primeiro. Todo mundo vê você no mapa
            e o tempo até a sua vez.
          </p>
        </div>

        <div class="field">
          <label for="nome">Como te chamam?</label>
          <input
            id="nome"
            name="nome"
            type="text"
            autocomplete="given-name"
            enterkeyhint="go"
            [maxLength]="max"
            [(ngModel)]="name"
          />
        </div>

        <button class="btn" type="submit" [disabled]="busy() || !name().trim()">
          {{ busy() ? 'Criando…' : 'Criar viagem' }}
          <tc-icon name="arrow" [stroke]="2.4" />
        </button>

        <div class="notice info hint">
          <tc-icon name="link" />
          <p>Recebeu um link? Abra ele no celular pra entrar na viagem. Não precisa de cadastro.</p>
        </div>
      </form>

      @if (store.toast(); as message) {
        <div class="toast" role="status">{{ message }}</div>
      }
    </main>
  `,
  styles: `
    .hero {
      position: relative;
      flex: 0 0 38%;
      min-height: 200px;
      overflow: hidden;
      border-radius: 0 0 28px 28px;
    }
    .hero svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    .brand {
      position: absolute;
      left: 20px;
      top: calc(20px + var(--safe-top));
      display: flex;
      align-items: center;
      gap: 10px;
      background: #fff;
      padding: 8px 14px 8px 8px;
      border-radius: 999px;
      box-shadow: var(--shadow-float);
      font-size: 16px;
    }
    .brand-mark {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--blue);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 28px 24px calc(24px + var(--safe-bottom));
      overflow-y: auto;
    }
    .intro {
      gap: 10px;
    }
    h1 {
      font-size: 34px;
      letter-spacing: -0.5px;
      line-height: 1.08;
    }
    .intro p {
      line-height: 1.45;
    }
    .hint {
      margin-top: auto;
      color: var(--ink);
    }
    .hint tc-icon {
      color: var(--blue-dark);
    }
  `,
})
export class HomePage {
  protected readonly store = inject(TripStore);
  private readonly router = inject(Router);
  protected readonly max = NAME_MAX;
  protected readonly name = signal(sessions.lastName());
  protected readonly busy = signal(false);

  constructor() {
    // Viagem em aberto neste aparelho: volta direto para ela.
    const last = sessions.lastCode();
    if (last && sessions.get(last)) void this.router.navigate(['/v', last], { replaceUrl: true });
  }

  protected async create() {
    const name = this.name().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    const code = await this.store.create(name);
    this.busy.set(false);
    if (code) void this.router.navigate(['/v', code]);
  }
}

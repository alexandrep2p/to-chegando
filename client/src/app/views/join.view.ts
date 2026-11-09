import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NAME_MAX } from '@tc/shared';
import { sessions } from '../core/session';
import { TripStore } from '../core/trip.store';
import { initial } from '../shared/format';
import { Icon } from '../shared/icon';

/** Tela 5: quem abriu o link entra com um apelido. */
@Component({
  selector: 'tc-join',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen screen-pad">
      <div class="row brand">
        <span class="brand-mark"><tc-icon name="pin" [size]="18" [stroke]="2.4" /></span>
        <span class="display">Tô Chegando</span>
      </div>

      <div class="col intro">
        <span class="who display" aria-hidden="true">{{ letter() }}</span>
        <h1 class="display">{{ store.inviter() }} vai passar aí.</h1>
        <p class="muted">
          Entre na viagem pra ver {{ store.inviter() }} chegando no mapa e marcar onde você vai
          estar esperando.
        </p>
      </div>

      <div class="field">
        <label for="apelido">Seu nome ou apelido</label>
        <input
          id="apelido"
          type="text"
          autocomplete="given-name"
          [maxLength]="max"
          [(ngModel)]="name"
        />
      </div>

      <div class="card row why">
        <span class="why-icon"><tc-icon name="target" /></span>
        <div class="col">
          <strong>Vamos pedir sua localização</strong>
          <span class="small muted">
            Ela vira o seu ponto de encontro. Só quem está nesta viagem vê, e some quando a viagem
            acaba.
          </span>
        </div>
      </div>

      <div class="col actions">
        <button class="btn" type="button" [disabled]="!ready()" (click)="join('passenger')">
          Entrar e marcar meu ponto
        </button>
        <button class="btn-text" type="button" [disabled]="!ready()" (click)="join('viewer')">
          Só quero acompanhar
        </button>
      </div>
    </main>
  `,
  styles: `
    .brand {
      gap: 10px;
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
    .intro {
      gap: 14px;
      margin-top: 12px;
    }
    .who {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: var(--blue-soft);
      color: var(--blue-dark);
      font-size: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    h1 {
      font-size: 32px;
      letter-spacing: -0.5px;
      overflow-wrap: anywhere;
    }
    .intro p {
      line-height: 1.45;
    }
    .why {
      padding: 16px;
      gap: 14px;
      align-items: flex-start;
    }
    .why .col {
      gap: 4px;
    }
    .why strong {
      font-size: 15px;
      font-weight: 600;
    }
    .why .small {
      line-height: 1.45;
    }
    .why-icon {
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      border-radius: 12px;
      background: var(--orange-soft);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .actions {
      margin-top: auto;
      gap: 6px;
    }
  `,
})
export class JoinView {
  protected readonly store = inject(TripStore);
  protected readonly max = NAME_MAX;
  protected readonly name = signal(sessions.lastName());
  protected readonly busy = signal(false);

  protected letter = () => initial(this.store.inviter() ?? '');
  protected ready = () => !this.busy() && !!this.name().trim();

  protected async join(role: 'passenger' | 'viewer') {
    if (!this.ready()) return;
    this.busy.set(true);
    await this.store.join(this.name().trim(), role);
    this.busy.set(false);
  }
}

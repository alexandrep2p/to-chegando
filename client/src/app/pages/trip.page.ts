import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { TripStore } from '../core/trip.store';
import { ArrivedView } from '../views/arrived.view';
import { DrivingView } from '../views/driving.view';
import { InviteView } from '../views/invite.view';
import { JoinView } from '../views/join.view';
import { PinView } from '../views/pin.view';
import { StopsView } from '../views/stops.view';
import { TrackingView } from '../views/tracking.view';

/** /v/:code — escolhe a tela pelo papel de quem abriu e pela fase da viagem. */
@Component({
  selector: 'tc-trip',
  imports: [JoinView, PinView, InviteView, StopsView, DrivingView, TrackingView, ArrivedView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (store.screen()) {
      @case ('join') {
        <tc-join />
      }
      @case ('pin') {
        <tc-pin />
      }
      @case ('invite') {
        <tc-invite />
      }
      @case ('stops') {
        <tc-stops />
      }
      @case ('driving') {
        <tc-driving />
      }
      @case ('tracking') {
        <tc-tracking />
      }
      @case ('ended') {
        <main class="screen screen-pad center">
          <span class="mark done" aria-hidden="true">✓</span>
          <h1 class="display">Viagem encerrada</h1>
          <p class="muted">As localizações desta viagem foram apagadas.</p>
          <button class="btn" type="button" (click)="home()">Nova viagem</button>
        </main>
      }
      @case ('notfound') {
        <main class="screen screen-pad center">
          <h1 class="display">Essa viagem não existe mais</h1>
          <p class="muted">O link pode ter expirado, ou a viagem já foi encerrada.</p>
          <button class="btn" type="button" (click)="home()">Criar uma viagem</button>
        </main>
      }
      @case ('removed') {
        <main class="screen screen-pad center">
          <h1 class="display">Você saiu desta viagem</h1>
          <p class="muted">O motorista removeu você da lista.</p>
          <button class="btn" type="button" (click)="home()">Ir para o início</button>
        </main>
      }
      @default {
        <main class="screen screen-pad center" aria-live="polite">
          <span class="spinner" aria-hidden="true"></span>
          <p class="muted">
            {{ store.screen() === 'reconnecting' ? 'Reconectando à viagem…' : 'Abrindo a viagem…' }}
          </p>
          @if (store.screen() === 'reconnecting') {
            <button class="btn-text" type="button" (click)="home()">Sair desta viagem</button>
          }
        </main>
      }
    }

    @if (store.arrival()) {
      <tc-arrived />
    }
    @if (store.question(); as q) {
      <div class="scrim" (click)="q.answer(false)"></div>
      <div class="ask" role="alertdialog" aria-modal="true" aria-labelledby="pergunta">
        <p id="pergunta">{{ q.text }}</p>
        <button class="btn dark" type="button" (click)="q.answer(true)">{{ q.action }}</button>
        <button class="btn outline" type="button" (click)="q.answer(false)">Cancelar</button>
      </div>
    }
    @if (store.toast(); as message) {
      <div class="toast" role="status">{{ message }}</div>
    }
  `,
  styles: `
    .center {
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 14px;
    }
    .center h1 {
      font-size: 28px;
    }
    .center .btn {
      margin-top: 12px;
      align-self: stretch;
    }
    .mark {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: var(--blue-soft);
      color: var(--blue-dark);
      font-size: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .scrim {
      position: fixed;
      inset: 0;
      z-index: 1800;
      background: rgb(20 33 61 / 45%);
    }
    .ask {
      position: fixed;
      left: 50%;
      bottom: 0;
      transform: translateX(-50%);
      z-index: 1801;
      width: 100%;
      max-width: 520px;
      background: var(--bg);
      border-radius: 24px 24px 0 0;
      padding: 24px 20px calc(20px + var(--safe-bottom));
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ask p {
      font-size: 17px;
      font-weight: 600;
      line-height: 1.4;
      margin-bottom: 8px;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 4px solid var(--line-strong);
      border-top-color: var(--blue);
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .scrim {
      position: fixed;
      inset: 0;
      z-index: 1800;
      background: rgb(20 33 61 / 45%);
    }
    .ask {
      position: fixed;
      left: 50%;
      bottom: 0;
      transform: translateX(-50%);
      z-index: 1801;
      width: 100%;
      max-width: 520px;
      background: var(--bg);
      border-radius: 24px 24px 0 0;
      padding: 24px 20px calc(20px + var(--safe-bottom));
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ask p {
      font-size: 17px;
      font-weight: 600;
      line-height: 1.4;
      margin-bottom: 8px;
    }
    .spinner {
        animation-duration: 3s;
      }
    }
  `,
})
export class TripPage {
  /** Vem da rota, via withComponentInputBinding. */
  readonly code = input.required<string>();
  protected readonly store = inject(TripStore);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const code = this.code();
      // open() lê sinais do store; sem untracked, cada mudança de estado reabriria a viagem.
      untracked(() => void this.store.open(code));
    });
  }

  protected async home() {
    await this.store.leave();
    void this.router.navigate(['/'], { replaceUrl: true });
  }
}

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TripStore } from '../core/trip.store';
import { fmtClock } from '../shared/format';
import { Icon } from '../shared/icon';

/** Tela 9: aviso em tela cheia de que o motorista chegou no ponto de quem espera. */
@Component({
  selector: 'tc-arrived',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" role="alertdialog" aria-labelledby="chegou" aria-modal="true">
      <div class="inner">
        <div class="center">
          <div class="rings" aria-hidden="true">
            <span class="ring r1"></span>
            <span class="ring r2"></span>
            <span class="core"><tc-icon name="check" [size]="52" [stroke]="2.8" /></span>
          </div>
          <h1 id="chegou" class="display">{{ driver() }} chegou!</h1>
          <p>
            {{ driver() }} está no seu ponto de encontro.
            @if (detail(); as d) {
              <br />{{ d }}
            }
          </p>
        </div>
        <div class="col actions">
          <button class="go" type="button" (click)="store.dismissArrival()">Tô indo</button>
          <button class="see" type="button" (click)="store.dismissArrival()">Ver no mapa</button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 1500;
      background: var(--blue);
      color: #fff;
      display: flex;
      justify-content: center;
    }
    .inner {
      width: 100%;
      max-width: 520px;
      box-sizing: border-box;
      padding: calc(20px + var(--safe-top)) 24px calc(24px + var(--safe-bottom));
      display: flex;
      flex-direction: column;
    }
    .center {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      text-align: center;
    }
    .rings {
      position: relative;
      width: 220px;
      height: 220px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ring {
      position: absolute;
      border-radius: 50%;
    }
    .r1 {
      inset: 0;
      background: rgb(255 255 255 / 10%);
      animation: pulse 1.6s ease-out infinite;
    }
    .r2 {
      inset: 30px;
      background: rgb(255 255 255 / 16%);
    }
    .core {
      position: relative;
      width: 104px;
      height: 104px;
      border-radius: 50%;
      background: #fff;
      color: var(--blue);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 30px rgb(20 33 61 / 30%);
    }
    h1 {
      font-size: 44px;
      line-height: 1.02;
      letter-spacing: -1px;
      overflow-wrap: anywhere;
    }
    p {
      font-size: 17px;
      line-height: 1.4;
    }
    .actions {
      gap: 6px;
    }
    .go {
      height: 60px;
      border: 0;
      border-radius: 16px;
      background: #fff;
      color: var(--ink);
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 18px;
    }
    .see {
      height: 48px;
      border: 0;
      background: transparent;
      color: #fff;
      font-weight: 600;
      font-size: 15px;
    }
    .overlay :focus-visible {
      outline-color: #fff;
    }
    @keyframes pulse {
      from {
        transform: scale(0.85);
        opacity: 1;
      }
      to {
        transform: scale(1.25);
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .r1 {
        animation: none;
      }
    }
  `,
})
export class ArrivedView {
  protected readonly store = inject(TripStore);
  protected readonly driver = computed(() => this.store.view()?.driver.name ?? 'O motorista');
  protected readonly detail = computed(() => {
    const e = this.store.arrival();
    if (!e) return '';
    const address = this.store.myStop()?.address;
    // e.at está no relógio do servidor; a diferença para o local é irrelevante em HH:MM.
    return [address, fmtClock(e.at)].filter(Boolean).join(' · ');
  });
}

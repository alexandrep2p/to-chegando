import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

const PATHS = {
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  share: '<path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7h14v-7"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  target: '<circle cx="12" cy="12" r="6"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/>',
  grip: '<path d="M5 9h14"/><path d="M5 15h14"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4 2.5 4H6"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  nosignal:
    '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 13a10 10 0 0 1 4-2.6"/><path d="M19 13a10 10 0 0 0-5-2.8"/><path d="M12 20h.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  move: '<path d="M12 3v18"/><path d="M3 12h18"/><path d="M12 3l-3 3"/><path d="M12 3l3 3"/><path d="M12 21l-3-3"/><path d="M12 21l3-3"/><path d="M3 12l3-3"/><path d="M3 12l3 3"/><path d="M21 12l-3-3"/><path d="M21 12l-3 3"/>',
  vibrate: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8v8"/><path d="M20 8v8"/>',
  nav: '<path d="M4 11.5L20 4l-7.5 16-2-6.5z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Ícone de traço, sempre decorativo: quem dá o nome acessível é o botão em volta. */
@Component({
  selector: 'tc-icon',
  template: `<svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    [attr.width]="size()"
    [attr.height]="size()"
    [attr.stroke-width]="stroke()"
    [innerHTML]="html()"
  ></svg>`,
  styles: ':host { display: inline-flex; flex-shrink: 0; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly stroke = input(2.2);
  private readonly sanitizer = inject(DomSanitizer);
  // Os caminhos são constantes deste arquivo, nunca texto de usuário.
  protected readonly html = computed(() => this.sanitizer.bypassSecurityTrustHtml(PATHS[this.name()]));
}

/** "4 min", "1 h 05". Nunca mostra "0 min": menos de um minuto ainda é "1 min". */
export function fmtEta(seconds: number | null): string {
  if (seconds === null) return '—';
  const min = Math.max(1, Math.ceil(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** "18:42" */
export function fmtClock(epochMs: number | null): string {
  if (epochMs === null) return '';
  return new Date(epochMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** "850 m", "1,2 km" */
export function fmtDist(meters: number | null): string {
  if (meters === null) return '';
  if (meters < 950) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

/** "agora", "há 40 s", "há 3 min" */
export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'agora';
  if (s < 60) return `há ${s} s`;
  return `há ${Math.floor(s / 60)} min`;
}

/** "Larissa", "Larissa e Mãe", "Larissa, Mãe e mais 2" */
export function fmtNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} e ${names[2]}`;
  return `${names[0]}, ${names[1]} e mais ${names.length - 2}`;
}

/** Inicial do nome, para avatares. */
export const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

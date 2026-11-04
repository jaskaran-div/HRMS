export const EXIT_TYPES = ['Resigned', 'Terminated', 'Absconded', 'Contract ended', 'Other'] as const;

/** Turns whatever HR typed in a sheet ("resign", "TERMINATION"…) into one of the standard labels; unknown text is kept as typed. */
export function normExitType(v: unknown): string {
  const s = String(v ?? '').trim();
  const k = s.toLowerCase();
  if (!k) return '';
  if (k.startsWith('resign')) return 'Resigned';
  if (k.startsWith('terminat') || k.startsWith('fired') || k.startsWith('dismiss')) return 'Terminated';
  if (k.startsWith('abscond')) return 'Absconded';
  if (k.startsWith('contract')) return 'Contract ended';
  return s;
}

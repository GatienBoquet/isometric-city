export const LAUNCH_KEY = 'isocity-launch';

export type LaunchMode = 'new' | 'continue';

let taken: { mode: LaunchMode | null } | null = null;

export function setLaunchMode(mode: LaunchMode) {
  if (typeof window === 'undefined') return;
  taken = null;
  sessionStorage.setItem(LAUNCH_KEY, mode);
}

export function takeLaunchMode(): LaunchMode | null {
  if (typeof window === 'undefined') return null;
  if (taken) return taken.mode;
  const raw = sessionStorage.getItem(LAUNCH_KEY);
  sessionStorage.removeItem(LAUNCH_KEY);
  const mode = raw === 'new' || raw === 'continue' ? raw : null;
  taken = { mode };
  return mode;
}

const SIDE_KEY = 'uchet1_side_collapsed';

export function readSideCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSideCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDE_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore quota */
  }
}

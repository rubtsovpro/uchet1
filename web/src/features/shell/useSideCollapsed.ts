import { useCallback, useEffect, useState } from 'react';
import { readSideCollapsed, writeSideCollapsed } from '@/shared/lib/storage';

export function useSideCollapsed() {
  const [collapsed, setCollapsed] = useState(readSideCollapsed);

  useEffect(() => {
    document.body.classList.toggle('side-collapsed', collapsed);
    writeSideCollapsed(collapsed);
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setCollapsed((v) => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggle = useCallback(() => setCollapsed((v) => !v), []);

  return { collapsed, toggle, setCollapsed };
}

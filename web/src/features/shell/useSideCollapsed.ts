import { useCallback, useEffect, useState } from 'react';
import { readSideCollapsed, writeSideCollapsed } from '@/shared/lib/storage';

/** Телефон + iPad: сайдбар только drawer (бургер), не в потоке */
const MOBILE_MQ = '(max-width: 1024px)';

function isMobileSide() {
  if (typeof window === 'undefined') return false;
  return (
    document.documentElement.classList.contains('ui-phone') ||
    window.matchMedia(MOBILE_MQ).matches
  );
}

export function useSideCollapsed() {
  const [collapsed, setCollapsed] = useState(readSideCollapsed);
  const [flyoutOpen, setFlyoutOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('side-collapsed', collapsed);
    writeSideCollapsed(collapsed);
  }, [collapsed]);

  useEffect(() => {
    document.body.classList.toggle('side-flyout-open', flyoutOpen);
    document.documentElement.classList.toggle('side-flyout-open', flyoutOpen);
    const dim = flyoutOpen && isMobileSide();
    const viewEl = document.getElementById('view');
    const panelEl = document.getElementById('section-panel');
    viewEl?.classList.toggle('is-flyout-dimmed', dim);
    panelEl?.classList.toggle('is-flyout-dimmed', dim);
    for (const el of [viewEl, panelEl]) {
      if (!el) continue;
      if (dim) {
        el.style.setProperty('opacity', '0.72', 'important');
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('-webkit-filter', 'none', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        el.style.setProperty('background', 'transparent', 'important');
      } else {
        el.style.removeProperty('opacity');
        el.style.removeProperty('filter');
        el.style.removeProperty('-webkit-filter');
        el.style.removeProperty('pointer-events');
        el.style.removeProperty('background');
      }
    }
    return () => {
      document.body.classList.remove('side-flyout-open');
      document.documentElement.classList.remove('side-flyout-open');
      for (const el of [document.getElementById('view'), document.getElementById('section-panel')]) {
        if (!el) continue;
        el.classList.remove('is-flyout-dimmed');
        el.style.removeProperty('opacity');
        el.style.removeProperty('filter');
        el.style.removeProperty('-webkit-filter');
        el.style.removeProperty('pointer-events');
        el.style.removeProperty('background');
      }
    };
  }, [flyoutOpen]);

  useEffect(() => {
    const side = document.getElementById('taxi-side');
    if (!side) return;
    if (isMobileSide()) {
      side.hidden = !flyoutOpen;
      side.setAttribute('aria-hidden', flyoutOpen ? 'false' : 'true');
    } else {
      side.hidden = false;
      side.removeAttribute('aria-hidden');
    }
  }, [flyoutOpen, collapsed]);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => {
      setFlyoutOpen(false);
      const side = document.getElementById('taxi-side');
      if (side && !isMobileSide()) {
        side.hidden = false;
        side.removeAttribute('aria-hidden');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.body.classList.contains('side-flyout-open')) {
        setFlyoutOpen(false);
        return;
      }
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (isMobileSide()) setFlyoutOpen((v) => !v);
      else setCollapsed((v) => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggle = useCallback(() => {
    if (isMobileSide()) setFlyoutOpen((v) => !v);
    else {
      setFlyoutOpen(false);
      setCollapsed((v) => !v);
    }
  }, []);

  const closeFlyout = useCallback(() => setFlyoutOpen(false), []);
  const openFlyout = useCallback(() => setFlyoutOpen(true), []);

  return { collapsed, toggle, setCollapsed, flyoutOpen, closeFlyout, openFlyout };
}

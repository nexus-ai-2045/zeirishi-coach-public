'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import styles from './LearningAtlas.module.css';

/** Connect a card's marker to its visible children without crossing their content. */
export function LearningBranchLinks() {
  const svg = useRef<SVGSVGElement>(null);
  const [drawing, setDrawing] = useState({ width: 1, height: 1, path: '' });
  useLayoutEffect(() => {
    const card = svg.current?.parentElement;
    if (!card) return;
    let frame = 0;
    const measure = () => {
      const marker = card.querySelector<HTMLElement>('[data-branch-marker]');
      const leaves = [...card.querySelectorAll<HTMLElement>('[data-branch-leaf]')].filter(node => node.getClientRects().length > 0);
      const origin = card.getBoundingClientRect();
      if (!marker || !origin.width || !origin.height) return;
      const scaleX = origin.width / card.offsetWidth;
      const scaleY = origin.height / card.offsetHeight;
      const box = marker.getBoundingClientRect();
      const x = (box.left + box.width / 2 - origin.left) / scaleX - card.clientLeft;
      const y = (box.bottom - origin.top) / scaleY - card.clientTop;
      const targets = leaves.map(node => {
        const target = node.getBoundingClientRect();
        return { x: (target.left - origin.left) / scaleX - card.clientLeft,
          y: (target.top + target.height / 2 - origin.top) / scaleY - card.clientTop };
      });
      const path = targets.length ? `M ${x} ${y} V ${targets[targets.length - 1].y} ${targets.map(target => `M ${x} ${target.y} H ${target.x}`).join(' ')}` : '';
      const next = { width: card.clientWidth, height: card.clientHeight, path };
      setDrawing(previous => previous.width === next.width && previous.height === next.height && previous.path === next.path ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(card);
    card.querySelectorAll<HTMLElement>('[data-branch-marker], [data-branch-leaf]').forEach(node => resize.observe(node));
    const mutations = new MutationObserver(schedule);
    mutations.observe(card, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    measure();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); };
  }, []);
  return <svg ref={svg} className={styles.branchConnections} width={drawing.width} height={drawing.height}
    viewBox={`0 0 ${drawing.width} ${drawing.height}`} aria-hidden="true" focusable="false">
    <path d={drawing.path} />
  </svg>;
}

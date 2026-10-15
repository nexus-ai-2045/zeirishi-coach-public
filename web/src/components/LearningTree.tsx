'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styles from './LearningAtlas.module.css';

type Connection = { path: string; state: string };

/** Decorative connections follow card geometry; learning state stays with the cards. */
export function LearningTree({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState({ width: 1, height: 1, connections: [] as Connection[] });
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const root = element.querySelector<HTMLElement>('[data-tree-root]');
      const cards = [...element.querySelectorAll<HTMLElement>('[data-tree-branch]')];
      if (!root || !cards.length) return;
      const origin = element.getBoundingClientRect();
      const scaleX = origin.width/element.offsetWidth;
      const scaleY = origin.height/element.offsetHeight;
      const rect = (node: HTMLElement) => {
        const box = node.getBoundingClientRect();
        return { left: (box.left-origin.left)/scaleX-element.clientLeft, top: (box.top-origin.top)/scaleY-element.clientTop, width: box.width/scaleX, height: box.height/scaleY };
      };
      const start = rect(root);
      const boxes = cards.map(rect);
      const vertical = boxes.length > 1 && boxes.every(box => Math.abs(box.left-boxes[0].left) < 2);
      const fromX = vertical ? boxes[0].left-19 : start.left+start.width/2;
      const fromY = start.top+start.height;
      const busY = fromY+(boxes[0].top-fromY)/2;
      const multipleRows = !vertical && boxes.some(box => Math.abs(box.top-boxes[0].top) > 2);
      const railX = Math.min(...boxes.map(box=>box.left))-16;
      const connections = cards.map((card, index) => {
        const box = boxes[index];
        const endX = vertical ? box.left : box.left+box.width/2;
        const endY = vertical ? box.top+28 : box.top;
        return {
          path: vertical ? `M ${fromX} ${fromY} V ${endY} H ${endX}` : multipleRows ? `M ${fromX} ${fromY} V ${busY} H ${railX} V ${Math.abs(box.top-boxes[0].top)<2?busY:box.top-22} H ${endX} V ${endY}` : `M ${fromX} ${fromY} V ${busY} H ${endX} V ${endY}`,
          state: card.dataset.current === 'true' ? 'current' : card.dataset.confirmed === 'true' ? 'confirmed' : 'unconfirmed',
        };
      });
      const next = { width: element.clientWidth, height: element.clientHeight, connections };
      setDrawing(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    element.querySelectorAll<HTMLElement>('[data-tree-root], [data-tree-branch]').forEach(node => observer.observe(node));
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [children]);
  return <div ref={host} className={styles.tree} aria-label="簿記の全体像">
    <svg className={styles.connections} width={drawing.width} height={drawing.height} viewBox={`0 0 ${drawing.width} ${drawing.height}`} aria-hidden="true" focusable="false">
      {drawing.connections.map((connection, index) => <path key={index} d={connection.path} data-state={connection.state} />)}
    </svg>
    {children}
  </div>;
}

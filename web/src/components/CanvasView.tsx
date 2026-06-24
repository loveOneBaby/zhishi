import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition } from 'cytoscape';
import type { Entry, Theme } from '../types';

interface Props {
  entries: Entry[];
  theme: Theme;
  onOpen: (id: string) => void;
}

// 无限画布：分类节点 → 知识点节点，移植自原 demo 的 buildGraph
export default function CanvasView({ entries, theme: t, onOpen }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!elRef.current) return;
    const cats = [...new Set(entries.map((e) => e.cat))];
    const els: ElementDefinition[] = [];
    cats.forEach((c) => els.push({ data: { id: 'cat_' + c, label: c, type: 'cat' } }));
    entries.forEach((e) => {
      els.push({ data: { id: e.id, label: e.title, type: 'pt' } });
      els.push({ data: { id: 'e_' + e.id, source: 'cat_' + e.cat, target: e.id } });
    });

    // @types/cytoscape 对样式 / 布局键的字面量类型较严格，这里用宽松类型避免类型噪音
    const style: any[] = [
      { selector: 'node[type="cat"]', style: { 'background-color': t.fg, label: 'data(label)', color: t.bg, 'text-valign': 'center', 'text-halign': 'center', 'font-size': 15, 'font-weight': 700, width: 62, height: 62, shape: 'round-rectangle', 'font-family': t.font } },
      { selector: 'node[type="pt"]', style: { 'background-color': t.panel, 'border-color': t.bd, 'border-width': 1, label: 'data(label)', color: t.fg, 'text-valign': 'center', 'text-halign': 'center', 'font-size': 12.5, width: 134, height: 38, 'text-wrap': 'wrap', 'text-max-width': 118, shape: 'round-rectangle', 'font-family': t.font } },
      { selector: 'edge', style: { 'line-color': t.bd, width: 1.5, 'curve-style': 'bezier' } },
      { selector: 'node:active', style: { 'overlay-opacity': 0 } },
    ];
    const layout: any = { name: 'cose', animate: false, padding: 50, nodeRepulsion: 9000, idealEdgeLength: 95, nodeOverlap: 16 };

    const cy = cytoscape({
      container: elRef.current,
      elements: els,
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.25,
      style,
      layout,
    });
    cy.on('tap', 'node[type="pt"]', (evt) => onOpenRef.current(evt.target.id()));
    cy.fit(undefined, 50);
    cyRef.current = cy;

    return () => { cy.destroy(); cyRef.current = null; };
  }, [entries, t]);

  return (
    <div
      ref={elRef}
      style={{ width: '100%', height: '66vh', background: 'var(--panel)', backgroundImage: 'radial-gradient(var(--bd) 1px, transparent 1px)', backgroundSize: '24px 24px', border: '1px solid var(--bd)', borderRadius: 16, overflow: 'hidden' }}
    />
  );
}

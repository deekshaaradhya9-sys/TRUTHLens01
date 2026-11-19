import React, { useMemo, useRef, useState, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { GitFork, Info, Search } from 'lucide-react';
import type { GraphEdgeItem, GraphNodeItem } from '../types/forensics.ts';
import { useI18n } from '../i18n/translations.ts';

interface ContradictionGraphProps {
  nodes: GraphNodeItem[];
  edges: GraphEdgeItem[];
}

interface ForceNode {
  id: string;
  label: string;
  nodeType: string;
  modality: string;
  details: string;
  highlighted?: boolean;
  x?: number;
  y?: number;
}

interface ForceLink {
  id: string;
  source: string | ForceNode;
  target: string | ForceNode;
  relation: 'corroborates' | 'contradicts' | 'inconclusive';
  label: string;
  explanation: string;
  confidenceRange: string;
  limitation: string;
}

type RelationFilter = 'all' | 'corroborates' | 'contradicts' | 'inconclusive';

export const ContradictionGraph: React.FC<ContradictionGraphProps> = ({ nodes, edges }) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 720, height: 420 });
  const [selectedEdge, setSelectedEdge] = useState<ForceLink | null>(null);
  const [selectedNode, setSelectedNode] = useState<ForceNode | null>(null);
  const [relationFilter, setRelationFilter] = useState<RelationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: Math.max(300, Math.floor(rect.width)),
          height: 420,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const graphData = useMemo(() => {
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const safeEdges = Array.isArray(edges) ? edges : [];
    const q = searchQuery.trim().toLowerCase();

    const filteredEdgesRaw =
      relationFilter === 'all'
        ? safeEdges
        : safeEdges.filter((e) => e.relation === relationFilter);

    const activeNodeIds = new Set<string>();
    if (relationFilter !== 'all') {
      for (const e of filteredEdgesRaw) {
        activeNodeIds.add(e.sourceKey);
        activeNodeIds.add(e.targetKey);
      }
    }

    const visibleNodesRaw = safeNodes.filter((n) => {
      const matchesFilter = relationFilter === 'all' || activeNodeIds.has(n.nodeKey);
      if (!matchesFilter) return false;
      if (!q) return true;
      return (
        n.label.toLowerCase().includes(q) ||
        n.details.toLowerCase().includes(q) ||
        n.nodeType.toLowerCase().includes(q) ||
        n.modality.toLowerCase().includes(q)
      );
    });

    const nodeIds = new Set(visibleNodesRaw.map((n) => n.nodeKey));
    const fNodes: ForceNode[] = visibleNodesRaw.map((n) => ({
      id: n.nodeKey,
      label: n.label,
      nodeType: n.nodeType,
      modality: n.modality,
      details: n.details,
      highlighted: Boolean(q),
    }));

    const fLinks: ForceLink[] = filteredEdgesRaw
      .filter((e) => nodeIds.has(e.sourceKey) && nodeIds.has(e.targetKey))
      .map((e) => ({
        id: e.id,
        source: e.sourceKey,
        target: e.targetKey,
        relation: e.relation,
        label: e.label,
        explanation: e.explanation,
        confidenceRange: e.confidenceRange,
        limitation: e.limitation,
      }));

    return { nodes: fNodes, links: fLinks };
  }, [nodes, edges, relationFilter, searchQuery]);

  const edgeColor = (rel: string) => {
    if (rel === 'corroborates') return '#10B981';
    if (rel === 'contradicts') return '#EF4444';
    return '#F59E0B';
  };

  const filterChips: Array<{ id: RelationFilter; label: string; colorClass: string }> = [
    { id: 'all', label: 'All', colorClass: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/40' },
    {
      id: 'corroborates',
      label: t.graphCorroborates,
      colorClass: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40',
    },
    {
      id: 'contradicts',
      label: t.graphContradicts,
      colorClass: 'text-rose-300 border-rose-500/40 bg-rose-950/40',
    },
    {
      id: 'inconclusive',
      label: t.graphInconclusive,
      colorClass: 'text-amber-300 border-amber-500/40 bg-amber-950/40',
    },
  ];

  return (
    <div className="grid lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-8 glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitFork className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">{t.navGraph}</h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search nodes..."
                aria-label="Search contradiction graph nodes"
                className="pl-7 pr-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-36 sm:w-44"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
              {filterChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setRelationFilter(chip.id)}
                  className={`px-2 py-1 rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                    relationFilter === chip.id
                      ? chip.colorClass
                      : 'text-slate-400 border-slate-800 bg-slate-950 hover:text-slate-200'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 py-2 border-b border-slate-800/70 bg-slate-950/50 flex flex-wrap items-center gap-4 text-[11px] font-mono text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 inline-block" />
            Evidence
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" />
            Claim
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rotate-45 bg-amber-400 inline-block" />
            Finding
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" />
            Metadata
          </span>
        </div>

        <div ref={containerRef} className="relative w-full h-[420px] bg-[#050814]">
          {graphData.nodes.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 px-6 text-center">
              {searchQuery || relationFilter !== 'all'
                ? 'No graph nodes match the active filter or search query.'
                : t.findingsEmpty}
            </div>
          ) : (
            <ForceGraph2D
              width={dimensions.width}
              height={dimensions.height}
              graphData={graphData}
              backgroundColor="#050814"
              linkDirectionalArrowLength={6}
              linkDirectionalArrowRelPos={0.85}
              linkWidth={2.6}
              linkColor={(link) => edgeColor((link as ForceLink).relation)}
              onLinkClick={(link) => {
                setSelectedNode(null);
                setSelectedEdge(link as ForceLink);
              }}
              onNodeClick={(node) => {
                setSelectedEdge(null);
                setSelectedNode(node as ForceNode);
              }}
              nodeCanvasObject={(nodeObj, ctx, globalScale) => {
                const node = nodeObj as ForceNode;
                const x = node.x ?? 0;
                const y = node.y ?? 0;
                const fontSize = Math.max(10, 12 / globalScale);

                if (node.nodeType === 'finding') {
                  // Amber diamond for flagged forensic findings
                  const r = 8;
                  ctx.beginPath();
                  ctx.moveTo(x, y - r);
                  ctx.lineTo(x + r, y);
                  ctx.lineTo(x, y + r);
                  ctx.lineTo(x - r, y);
                  ctx.closePath();
                  ctx.fillStyle = '#F59E0B';
                  ctx.fill();
                  ctx.lineWidth = 1.6;
                  ctx.strokeStyle = '#FEF3C7';
                  ctx.stroke();
                } else {
                  const fill =
                    node.nodeType === 'evidence'
                      ? '#06B6D4'
                      : node.nodeType === 'claim'
                        ? '#8B5CF6'
                        : '#94A3B8';

                  ctx.beginPath();
                  ctx.arc(x, y, 7, 0, 2 * Math.PI, false);
                  ctx.fillStyle = fill;
                  ctx.fill();
                  ctx.lineWidth = node.highlighted ? 2.2 : 1.5;
                  ctx.strokeStyle = node.highlighted ? '#38BDF8' : '#050814';
                  ctx.stroke();
                }

                ctx.font = `500 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
                const textWidth = ctx.measureText(node.label).width;
                const padX = 6;
                const boxH = fontSize + 6;
                ctx.fillStyle = 'rgba(11, 17, 30, 0.9)';
                ctx.fillRect(x - textWidth / 2 - padX, y + 11, textWidth + padX * 2, boxH);
                ctx.strokeStyle =
                  node.nodeType === 'finding'
                    ? 'rgba(245, 158, 11, 0.45)'
                    : 'rgba(56, 189, 248, 0.25)';
                ctx.lineWidth = 0.8;
                ctx.strokeRect(x - textWidth / 2 - padX, y + 11, textWidth + padX * 2, boxH);

                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = node.nodeType === 'finding' ? '#FDE68A' : '#E2E8F0';
                ctx.fillText(node.label, x, y + 11 + boxH / 2);
              }}
            />
          )}
        </div>
        <div className="px-4 py-2.5 border-t border-slate-800/90 text-xs text-slate-400">
          {t.graphHint}
        </div>
      </div>

      {/* Inspector Drawer */}
      <div className="lg:col-span-4 glass-panel rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Info className="w-4 h-4 text-violet-400" />
          <span>{t.graphInspectTitle}</span>
        </div>

        {selectedEdge ? (
          <div className="space-y-3 text-xs">
            <div
              className={`font-mono font-semibold ${
                selectedEdge.relation === 'contradicts'
                  ? 'text-rose-400'
                  : selectedEdge.relation === 'corroborates'
                    ? 'text-emerald-400'
                    : 'text-amber-400'
              }`}
            >
              {selectedEdge.relation.toUpperCase()} · {selectedEdge.label}
            </div>
            <div className="text-slate-200 leading-relaxed">{selectedEdge.explanation}</div>
            <div className="pt-2 border-t border-slate-800 space-y-1.5 font-mono">
              <div className="text-slate-400">
                Confidence: <span className="text-cyan-300">{selectedEdge.confidenceRange}</span>
              </div>
              <div className="text-slate-400 font-sans">
                <span className="text-slate-500 font-mono">{t.limitationLabel}: </span>
                {selectedEdge.limitation}
              </div>
            </div>
          </div>
        ) : selectedNode ? (
          <div className="space-y-3 text-xs">
            <div
              className={`font-mono uppercase ${
                selectedNode.nodeType === 'finding' ? 'text-amber-300' : 'text-cyan-300'
              }`}
            >
              {selectedNode.nodeType} · {selectedNode.modality}
            </div>
            <div className="text-sm font-semibold text-white">{selectedNode.label}</div>
            <div className="text-slate-300 leading-relaxed">{selectedNode.details}</div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-400 leading-relaxed">{t.graphInspectPrompt}</p>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {graphData.links.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => setSelectedEdge(link)}
                  className="w-full text-left p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 hover:border-cyan-500/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className={`font-mono font-semibold ${
                        link.relation === 'contradicts'
                          ? 'text-rose-400'
                          : link.relation === 'corroborates'
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {link.relation.toUpperCase()}
                    </span>
                    <span className="font-mono text-slate-400 tabular-nums">{link.confidenceRange}</span>
                  </div>
                  <div className="text-xs text-slate-200 mt-1">{link.label}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

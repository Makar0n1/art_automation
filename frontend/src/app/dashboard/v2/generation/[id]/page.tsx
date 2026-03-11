/**
 * Generation 2.0 — Coverage Console view
 * Shows Coverage, Intent Map, Entity Clusters, and article blocks with cluster badges.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Atom,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Card, CardContent, Badge, ProgressBar } from '@/components/ui';
import { generationsApi } from '@/lib/api';
import { initSocket, subscribeToGeneration } from '@/lib/socket';
import {
  Generation,
  GenerationStatus,
  GenerationLog,
  ArticleBlock,
  EntityCluster,
  EntityCoverage,
  IntentMap,
  GenerationQualityScores,
} from '@/types';
import { getStatusLabel, cn } from '@/lib/utils';

/* ─── helpers ─── */

const getBlockMarkdown = (block: ArticleBlock): string => {
  const raw = (block.content || '').replace(/^#{1,6}\s+[^\n]+\n+/, '').trim();
  switch (block.type) {
    case 'h1':         return `# ${raw}`;
    case 'intro':      return raw;
    case 'h2':         return `## ${block.heading}\n\n${raw}`;
    case 'h3':         return `### ${block.heading}\n\n${raw}`;
    case 'conclusion': return block.heading ? `## ${block.heading}\n\n${raw}` : raw;
    case 'faq':        return block.heading ? `## ${block.heading}\n\n${raw}` : `## FAQ\n\n${raw}`;
    default:           return raw;
  }
};

/* ─── sub-components ─── */

const CoverageBar = ({
  value,
  max,
  label,
  suffix = '%',
}: {
  value: number;
  max: number;
  label: string;
  suffix?: string;
}) => {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : value;
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-400'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-16 text-right text-xs font-semibold text-gray-700 dark:text-gray-200">
        {suffix === '%' ? `${Math.round(pct)}%` : `${value}/${max}`}
      </span>
    </div>
  );
};

const CoherenceDot = ({ score }: { score: number }) => (
  <span
    className={cn(
      'inline-block h-2 w-2 rounded-full',
      score >= 0.75 ? 'bg-emerald-500' : score >= 0.55 ? 'bg-amber-500' : 'bg-red-400'
    )}
  />
);

const PriorityBadge = ({ priority }: { priority: 'critical' | 'supporting' | 'optional' }) => {
  const cls =
    priority === 'critical'
      ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
      : priority === 'supporting'
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', cls)}>
      {priority}
    </span>
  );
};

/* ─── Coverage Console panel ─── */

const CoverageConsole = ({
  qualityScores,
  entityCoverage,
  intentMap,
  entityClusters,
}: {
  qualityScores?: GenerationQualityScores;
  entityCoverage?: EntityCoverage[];
  intentMap?: IntentMap;
  entityClusters?: EntityCluster[];
}) => {
  const [clustersOpen, setClustersOpen] = useState(true);
  const [intentOpen, setIntentOpen] = useState(true);
  const [entityOpen, setEntityOpen] = useState(false);

  if (!qualityScores && !intentMap && (!entityClusters || entityClusters.length === 0)) return null;

  const missedEntities = entityCoverage?.filter(e => !e.mentioned && e.priority === 'critical') ?? [];
  const coveredCount = entityCoverage?.filter(e => e.mentioned).length ?? 0;
  const totalCount = entityCoverage?.length ?? 0;

  return (
    <div className="space-y-3">
      {/* ── Quality Scores ── */}
      {qualityScores && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Atom className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Coverage</span>
              {qualityScores.criticalEntitiesMissed > 0 && (
                <span className="ml-auto flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {qualityScores.criticalEntitiesMissed} critical missed
                </span>
              )}
            </div>
            <div className="space-y-2">
              <CoverageBar
                value={coveredCount}
                max={totalCount}
                label="Entities covered"
                suffix="ratio"
              />
              <CoverageBar
                value={qualityScores.intentPlannedPercent}
                max={100}
                label="Intent planned"
              />
              <CoverageBar
                value={qualityScores.intentRealizedPercent}
                max={100}
                label="Intent realized"
              />
            </div>
            {qualityScores.unsupportedHardClaims > 0 && (
              <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-900/10">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  {qualityScores.unsupportedHardClaims} unsupported hard claim
                  {qualityScores.unsupportedHardClaims > 1 ? 's' : ''} detected
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Intent Map ── */}
      {intentMap && (
        <Card>
          <CardContent className="p-4">
            <button
              onClick={() => setIntentOpen(o => !o)}
              className="flex w-full items-center justify-between"
            >
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Intent Map</span>
              {intentOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>
            {intentOpen && (
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-500 dark:text-gray-400">
                  <span><strong className="text-gray-700 dark:text-gray-300">Page type:</strong> {intentMap.pageType}</span>
                  <span><strong className="text-gray-700 dark:text-gray-300">Funnel:</strong> {intentMap.funnelStage}</span>
                  <span>
                    <strong className="text-gray-700 dark:text-gray-300">Confidence:</strong>{' '}
                    <span className={cn(
                      intentMap.heuristicConfidence === 'high' ? 'text-emerald-600' :
                      intentMap.heuristicConfidence === 'medium' ? 'text-amber-600' : 'text-red-600'
                    )}>{intentMap.heuristicConfidence}</span>
                  </span>
                </div>
                <p className="text-gray-600 dark:text-gray-300">
                  <strong>Primary:</strong> {intentMap.primaryIntent}
                </p>
                {intentMap.hiddenIntents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-gray-500 dark:text-gray-400">Hidden intents:</span>
                    {intentMap.hiddenIntents.map((h, i) => (
                      <span key={i} className="rounded-md bg-violet-50 px-2 py-0.5 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300">
                        {h}
                      </span>
                    ))}
                  </div>
                )}
                {intentMap.mustAnswerQuestions.length > 0 && (
                  <div className="mt-1 space-y-1">
                    <p className="font-medium text-gray-700 dark:text-gray-300">Must-answer questions:</p>
                    {intentMap.mustAnswerQuestions.map((q, i) => {
                      const planned = intentMap.plannedCoverage?.[i];
                      return (
                        <div key={i} className="flex items-start gap-2">
                          <span className={cn(
                            'mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full',
                            planned ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                          )} />
                          <span className="text-gray-600 dark:text-gray-400">{q}</span>
                          {planned && (
                            <span className="ml-auto shrink-0 text-emerald-600 dark:text-emerald-400">→ {planned}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Entity Clusters ── */}
      {entityClusters && entityClusters.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <button
              onClick={() => setClustersOpen(o => !o)}
              className="flex w-full items-center justify-between"
            >
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                Entity Clusters
                <span className="ml-2 text-xs font-normal text-gray-400">({entityClusters.length})</span>
              </span>
              {clustersOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>
            {clustersOpen && (
              <div className="mt-3 space-y-2">
                {entityClusters.map(cluster => {
                  const missed = entityCoverage?.filter(
                    e => !e.mentioned && cluster.entities.some(ce => ce.name === e.entityName)
                  ) ?? [];
                  return (
                    <div
                      key={cluster.id}
                      className={cn(
                        'rounded-lg border p-3',
                        missed.length > 0
                          ? 'border-amber-200 bg-amber-50/50 dark:border-amber-700/40 dark:bg-amber-900/10'
                          : 'border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <CoherenceDot score={cluster.coherenceScore} />
                        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                          {cluster.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {cluster.entities.length} entities · coh: {cluster.coherenceScore.toFixed(2)}
                        </span>
                        {missed.length > 0 && (
                          <span className="ml-auto text-xs font-medium text-amber-600 dark:text-amber-400">
                            {missed.length} missed
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {cluster.entities.map(entity => {
                          const cov = entityCoverage?.find(e => e.entityName === entity.name);
                          return (
                            <span
                              key={entity.name}
                              className={cn(
                                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
                                cov?.mentioned === false
                                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                                  : cov?.mentioned
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                              )}
                            >
                              {entity.priority && (
                                <span
                                  className={cn(
                                    'h-1.5 w-1.5 rounded-full',
                                    entity.priority === 'critical' ? 'bg-red-500' :
                                    entity.priority === 'supporting' ? 'bg-amber-500' : 'bg-gray-400'
                                  )}
                                />
                              )}
                              {entity.name}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Missed critical entities list ── */}
      {missedEntities.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-700/40 dark:bg-red-900/10">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5" />
            Critical entities not mentioned
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missedEntities.map(e => (
              <span key={e.entityName} className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-800/30 dark:text-red-300">
                {e.entityName}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Entity coverage detail (toggle) ── */}
      {entityCoverage && entityCoverage.length > 0 && (
        <div>
          <button
            onClick={() => setEntityOpen(o => !o)}
            className="flex w-full items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {entityOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            All entity coverage ({coveredCount}/{totalCount})
          </button>
          {entityOpen && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Entity</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Priority</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Coverage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {entityCoverage.map(e => (
                    <tr key={e.entityName} className={cn(!e.mentioned && e.priority === 'critical' ? 'bg-red-50/50 dark:bg-red-900/10' : '')}>
                      <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{e.entityName}</td>
                      <td className="px-3 py-1.5"><PriorityBadge priority={e.priority} /></td>
                      <td className="px-3 py-1.5">
                        {e.mentioned ? (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />{e.coverageLevel}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-500 dark:text-red-400">
                            <AlertCircle className="h-3 w-3" />not found
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── Block with cluster badge ─── */

const ArticleBlockCard = ({
  block,
  clusters,
  entityCoverage,
}: {
  block: ArticleBlock;
  clusters: EntityCluster[];
  entityCoverage?: EntityCoverage[];
}) => {
  const cluster =
    block.primaryClusterIndex != null ? clusters[block.primaryClusterIndex] : null;

  const missedInCluster =
    cluster && entityCoverage
      ? entityCoverage.filter(
          e => !e.mentioned && cluster.entities.some(ce => ce.name === e.entityName)
        ).length
      : 0;

  const hasMissed = missedInCluster > 0;

  if (!block.content) return null;

  return (
    <div id={`v2-block-${block.id}`} className="space-y-2">
      {cluster && (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium',
              hasMissed
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                hasMissed ? 'bg-amber-500' : 'bg-emerald-500'
              )}
            />
            Cluster {cluster.id}: {cluster.label}
            {hasMissed ? ` ⚠ ${missedInCluster} missed` : ' ✓ covered'}
          </span>
          {block.targetOutcome && (
            <span className="truncate text-[11px] text-gray-400" title={block.targetOutcome}>
              → {block.targetOutcome}
            </span>
          )}
        </div>
      )}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{getBlockMarkdown(block)}</ReactMarkdown>
      </div>
    </div>
  );
};

/* ─── main component ─── */

export default function V2GenerationPage() {
  const params = useParams();
  const router = useRouter();
  const generationId = params.id as string;

  const [generation, setGeneration] = useState<Generation | null>(null);
  const [logs, setLogs] = useState<GenerationLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  const isCompleted = generation?.status === GenerationStatus.COMPLETED;
  const isFailed = generation?.status === GenerationStatus.FAILED;
  const isActive = !!generation && !isCompleted && !isFailed;

  // Fetch
  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await generationsApi.getOne(generationId);
        if (res.success) {
          setGeneration(res.data as Generation);
          setLogs((res.data as Generation).logs || []);
        }
      } catch {
        toast.error('Failed to load generation');
        router.push('/dashboard/v2');
      } finally {
        setIsLoading(false);
      }
    };
    fetch();
  }, [generationId, router]);

  // Socket
  const generationLoaded = !!generation;
  useEffect(() => {
    if (!generationLoaded) return;
    const token = localStorage.getItem('token');
    if (token) initSocket(token);

    const unsubscribe = subscribeToGeneration(generationId, {
      onLog: (log) => setLogs(prev => [...prev, log]),
      onStatus: (status, progress) =>
        setGeneration(prev => prev ? { ...prev, status, progress } : null),
      onBlocks: (blocks: ArticleBlock[]) =>
        setGeneration(prev => prev ? { ...prev, articleBlocks: blocks } : null),
      onCompleted: async () => {
        try {
          const res = await generationsApi.getOne(generationId);
          if (res.success) setGeneration(res.data as Generation);
        } catch { /* noop */ }
      },
      onError: (error) => {
        setGeneration(prev => prev ? { ...prev, status: GenerationStatus.FAILED, error } : null);
      },
    });
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationId, generationLoaded]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCopy = async () => {
    const text = generation?.article || generation?.generatedArticle || '';
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
      </div>
    );
  }

  if (!generation) return null;

  const blocks = generation.articleBlocks?.filter(b => b && b.type && b.content) ?? [];
  const clusters = generation.entityClusters ?? [];
  const entityCoverage = generation.entityCoverage ?? generation.preReviewEntityCoverage;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 pb-4">
        <Link
          href="/dashboard/v2"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <div className="flex items-center gap-2 min-w-0">
          <Atom className="h-4 w-4 shrink-0 text-violet-600" />
          <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            {generation.config.mainKeyword}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isActive && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
              <span className="text-xs text-gray-500">{getStatusLabel(generation.status)}</span>
            </div>
          )}
          {isCompleted && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {isCopied ? 'Copied' : 'Copy article'}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar (active only) */}
      {isActive && (
        <div className="mb-3 shrink-0">
          <ProgressBar value={generation.progress} className="h-1.5" />
          <p className="mt-1 text-xs text-gray-400">{generation.currentStep}</p>
        </div>
      )}

      {/* Error */}
      {isFailed && generation.error && (
        <div className="mb-4 shrink-0 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-700/40 dark:bg-red-900/10">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-300">{generation.error}</p>
        </div>
      )}

      {/* Main content — two columns on large screens */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Left: Coverage Console */}
        <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto pr-1 xl:w-96">
          <CoverageConsole
            qualityScores={generation.qualityScores}
            entityCoverage={entityCoverage}
            intentMap={generation.intentMap}
            entityClusters={clusters}
          />

          {/* Logs toggle */}
          <Card>
            <CardContent className="p-3">
              <button
                onClick={() => setIsLogsOpen(o => !o)}
                className="flex w-full items-center justify-between text-xs font-medium text-gray-600 dark:text-gray-400"
              >
                <span>Generation logs ({logs.length})</span>
                {isLogsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {isLogsOpen && (
                <div
                  ref={logsRef}
                  className="mt-2 h-48 overflow-y-auto rounded bg-gray-50 p-2 font-mono text-[10px] dark:bg-gray-900"
                >
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={cn(
                        'leading-relaxed',
                        log.level === 'error' ? 'text-red-500' :
                        log.level === 'warn' ? 'text-amber-500' :
                        'text-gray-500 dark:text-gray-400'
                      )}
                    >
                      {log.message}
                    </div>
                  ))}
                  {logs.length === 0 && <p className="text-gray-400">No logs yet.</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Article */}
        <div className="flex-1 overflow-y-auto">
          {blocks.length > 0 ? (
            <div className="space-y-6 pb-8">
              {blocks.map(block => (
                <ArticleBlockCard
                  key={block.id}
                  block={block}
                  clusters={clusters}
                  entityCoverage={entityCoverage}
                />
              ))}
            </div>
          ) : isActive ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-violet-400" />
                <p className="text-sm text-gray-400">Generating article…</p>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-gray-400">No content yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

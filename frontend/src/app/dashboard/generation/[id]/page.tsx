/**
 * Generation Detail Page — state-aware two-column layout
 * Panels: Plan (Structure + Meta) | Output (Article) | Logs
 * No outer scroll — each panel scrolls internally.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowDown,
  Copy,
  Check,
  AlertCircle,
  Clock,
  FileText,
  Loader2,
  RotateCcw,
  List,
  ChevronDown,
  ChevronUp,
  Terminal,
  Settings,
  Maximize2,
  Sparkles,
  DollarSign,
} from 'lucide-react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  Card,
  Button,
  Badge,
  ProgressBar,
  Modal,
} from '@/components/ui';
import { ModelSelector } from '@/components/ModelSelector';
import { BlockContextMenu } from '@/components/BlockContextMenu';
import { BlockEditModal } from '@/components/BlockEditModal';
import { SeoEditModal } from '@/components/SeoEditModal';
import { CostModal } from '@/components/CostModal';
import { TypewriterMarkdown } from '@/components/TypewriterMarkdown';
import { useTypewriter } from '@/hooks/useTypewriter';
import { generationsApi } from '@/lib/api';
import { initSocket, subscribeToGeneration } from '@/lib/socket';
import { ArticleBlock, Generation, GenerationLog, GenerationStatus } from '@/types';
import { getStatusLabel, cn } from '@/lib/utils';

/* ─── helpers ─── */

const isApiKeyError = (error: string): { isApiError: boolean; service: string | null } => {
  const e = error.toLowerCase();
  if (e.includes('openrouter') || e.includes('open router')) return { isApiError: true, service: 'OpenRouter' };
  if (e.includes('firecrawl') || e.includes('fire crawl'))  return { isApiError: true, service: 'Firecrawl' };
  if (e.includes('supabase'))                                return { isApiError: true, service: 'Supabase' };
  if (e.includes('api key') || e.includes('invalid key') || e.includes('unauthorized') || e.includes('401'))
    return { isApiError: true, service: null };
  return { isApiError: false, service: null };
};

/** Build markdown for a single block (strip any leading heading AI might have repeated) */
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

/** SEO field with backspace→type animation */
const SeoField = ({ label, maxLen, value, oldValue, animating, onCopy, isCopied, onAnimationDone }: {
  label: string; maxLen: number; value: string; oldValue?: string; animating: boolean;
  onCopy: () => void; isCopied: boolean; onAnimationDone: () => void;
}) => {
  const { displayText, isTyping } = useTypewriter({
    text: value, oldText: oldValue, enabled: animating, mode: 'char',
    speed: 20, chunksPerFrame: 2, eraseSpeed: 10, eraseChunksPerFrame: 8,
    onComplete: onAnimationDone,
  });
  const isDark = label.includes('Description');
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
          {label}
          <span className="ml-1 font-normal text-emerald-500">({value.length}/{maxLen})</span>
        </span>
        <p className={cn('mt-0.5 text-sm leading-snug', isDark ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-white')}>
          {animating ? displayText : value}
          {isTyping && <span className="typewriter-cursor" />}
        </p>
      </div>
      <button
        onClick={onCopy}
        className="shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
      >
        {isCopied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
      </button>
    </div>
  );
};

/* ─── component ─── */

export default function GenerationPage() {
  const params = useParams();
  const router = useRouter();
  const generationId = params.id as string;

  /* state */
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [logs, setLogs]             = useState<GenerationLog[]>([]);
  const [isLoading, setIsLoading]   = useState(true);

  const [isCopied, setIsCopied]         = useState(false);
  const [isTitleCopied, setIsTitleCopied] = useState(false);
  const [isDescCopied, setIsDescCopied]   = useState(false);

  const [isRestarting, setIsRestarting]             = useState(false);
  const [isLogsExpanded, setIsLogsExpanded]         = useState(true);
  const [isArticleFullscreen, setIsArticleFullscreen] = useState(false);
  const [isConfigExpanded, setIsConfigExpanded] = useState(false);
  const [selectedModel, setSelectedModel]       = useState('');
  const [isLogsAtBottom, setIsLogsAtBottom]     = useState(true);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; blockId: number } | null>(null);
  const [editingBlock, setEditingBlock] = useState<ArticleBlock | null>(null);
  const [isSeoEditOpen, setIsSeoEditOpen] = useState(false);
  const [isCostOpen, setIsCostOpen] = useState(false);
  const [editingBlockIds, setEditingBlockIds] = useState<Set<number>>(new Set());
  const [animatingBlocks, setAnimatingBlocks] = useState<Map<number, { oldContent: string }>>(new Map());
  const [seoAnimating, setSeoAnimating] = useState(false);
  const [seoOldValues, setSeoOldValues] = useState<{ title: string; description: string }>({ title: '', description: '' });
  const pendingScrollBlockIdRef = useRef<number | null>(null);
  const prevBlocksRef = useRef<ArticleBlock[]>([]);

  /* refs */
  const logsEndRef       = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  /* ─── derived ─── */

  const isCompleted  = generation?.status === GenerationStatus.COMPLETED;
  const isFailed     = generation?.status === GenerationStatus.FAILED;
  const isQueued     = generation?.status === GenerationStatus.QUEUED;
  const isActive     = !!generation && !isCompleted && !isFailed;
  const isInProgress = isActive && !isQueued;

  const blocks            = generation?.articleBlocks?.filter(b => b && b.type) || [];
  const blocksWithContent = blocks.filter(b => b.content);
  const hasBlocks         = blocks.length > 0;
  const hasArticle        = !!(generation?.generatedArticle || generation?.article || blocksWithContent.length > 0);
  const hasMeta           = !!(generation?.seoTitle || generation?.seoDescription);

  // First block without content → currently being written
  const currentBlockId = isInProgress && hasBlocks
    ? (blocks.find(b => !b.content)?.id ?? -1)
    : -1;

  /* ─── effects ─── */

  // Fetch on mount
  useEffect(() => {
    const fetchGeneration = async () => {
      try {
        const response = await generationsApi.getOne(generationId);
        if (response.success) {
          const gen = response.data as Generation;
          setGeneration(gen);
          setLogs(gen.logs || []);
          if (gen.config.model) setSelectedModel(gen.config.model);
        }
      } catch {
        toast.error('Failed to load generation');
        router.push('/dashboard');
      } finally {
        setIsLoading(false);
      }
    };
    fetchGeneration();
  }, [generationId, router]);

  // Socket.IO
  useEffect(() => {
    if (!generation) return;
    const token = localStorage.getItem('token');
    if (token) initSocket(token);

    const unsubscribe = subscribeToGeneration(generationId, {
      onLog: (log) => setLogs(prev => [...prev, log]),
      onStatus: (status, progress) =>
        setGeneration(prev => prev ? { ...prev, status, progress } : null),
      onBlocks: (newBlocks: ArticleBlock[]) => {
        const prev = prevBlocksRef.current;
        const scrollId = pendingScrollBlockIdRef.current;

        // Detect new content (generation pipeline) or changed content (edit/revert)
        for (const nb of newBlocks) {
          if (!nb.content) continue;
          const pb = prev.find(b => b.id === nb.id);

          if (scrollId === nb.id) {
            // This block was edited/reverted — remove overlay, start erase→type animation
            pendingScrollBlockIdRef.current = null;
            setEditingBlockIds(s => { const n = new Set(s); n.delete(nb.id); return n; });
            const oldContent = pb ? getBlockMarkdown(pb) : '';
            setAnimatingBlocks(m => { const n = new Map(m); n.set(nb.id, { oldContent }); return n; });
            // Scroll to it
            setTimeout(() => {
              const el = document.getElementById(`article-block-${nb.id}`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              const se = document.getElementById(`structure-block-${nb.id}`);
              if (se) se.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 150);
          } else if (!pb || !pb.content) {
            // New block during generation — snap previous, type-only (no erase)
            setAnimatingBlocks(() => new Map([[nb.id, { oldContent: '' }]]));
          } else if (pb.content !== nb.content) {
            // Content changed (revert via Socket.IO without pendingScroll)
            const oldContent = getBlockMarkdown(pb);
            setAnimatingBlocks(m => { const n = new Map(m); n.set(nb.id, { oldContent }); return n; });
          }
        }

        prevBlocksRef.current = newBlocks;
        setGeneration(prev => prev ? { ...prev, articleBlocks: newBlocks } : null);
      },
      onSeo: (data) => {
        setGeneration(prev => {
          if (prev) setSeoOldValues({ title: prev.seoTitle || '', description: prev.seoDescription || '' });
          return prev ? { ...prev, ...data } : null;
        });
        setSeoAnimating(true);
      },
      onCompleted: (article) => {
        setGeneration(prev => {
          if (prev) setSeoOldValues({ title: prev.seoTitle || '', description: prev.seoDescription || '' });
          return prev ? { ...prev, status: GenerationStatus.COMPLETED, progress: 100, article } : null;
        });
        setSeoAnimating(true);
        toast.success('Article generation completed!');
      },
      onError: (error) => {
        setGeneration(prev => prev ? { ...prev, status: GenerationStatus.FAILED, error } : null);
        const { isApiError, service } = isApiKeyError(error);
        if (isApiError) {
          toast.error(`${service ? service + ' ' : ''}API key error. Check Settings.`, { duration: 5000 });
          setTimeout(() => router.push('/dashboard/settings'), 2000);
        } else {
          toast.error(`Generation failed: ${error}`);
        }
      },
    });
    return () => { unsubscribe(); };
  }, [generation, generationId, router]);

  // Auto-scroll logs only when at bottom
  useEffect(() => {
    if (isLogsAtBottom) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, isLogsAtBottom]);

  /* ─── handlers ─── */

  const handleLogsScroll = useCallback(() => {
    const el = logsContainerRef.current;
    if (!el) return;
    setIsLogsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 50);
  }, []);

  const jumpToLatest = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsLogsAtBottom(true);
  };

  const scrollToBlock = (blockId: number) => {
    const el = document.getElementById(`article-block-${blockId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.45)';
    el.style.borderRadius = '6px';
    setTimeout(() => { el.style.boxShadow = ''; el.style.borderRadius = ''; }, 2000);
  };

  const copyArticle = async () => {
    const text = generation?.generatedArticle || generation?.article;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      toast.success('Article copied');
      setTimeout(() => setIsCopied(false), 2000);
    } catch { toast.error('Failed to copy'); }
  };

  const copySeoTitle = async () => {
    if (!generation?.seoTitle) return;
    try {
      await navigator.clipboard.writeText(generation.seoTitle);
      setIsTitleCopied(true);
      toast.success('SEO Title copied');
      setTimeout(() => setIsTitleCopied(false), 2000);
    } catch { toast.error('Failed to copy'); }
  };

  const copySeoDescription = async () => {
    if (!generation?.seoDescription) return;
    try {
      await navigator.clipboard.writeText(generation.seoDescription);
      setIsDescCopied(true);
      toast.success('SEO Description copied');
      setTimeout(() => setIsDescCopied(false), 2000);
    } catch { toast.error('Failed to copy'); }
  };

  const handleRestart = async () => {
    if (!generation) return;
    setIsRestarting(true);
    try {
      const response = await generationsApi.restart(generationId, selectedModel || generation.config.model);
      if (response.success) {
        toast.success('Generation restarted');
        setLogs([]);
        const fresh = await generationsApi.getOne(generationId);
        if (fresh.success) {
          const gen = fresh.data as Generation;
          setGeneration(gen);
          if (gen.config.model) setSelectedModel(gen.config.model);
          setIsLogsExpanded(true);
        }
      }
    } catch { toast.error('Failed to restart'); }
    finally { setIsRestarting(false); }
  };

  /* ─── loading / empty ─── */

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!generation) return null;

  const projectName = typeof generation.projectId === 'object' ? generation.projectId.name : 'Unknown Project';
  const projectId   = typeof generation.projectId === 'object' ? generation.projectId._id : generation.projectId;

  /* ═══════════════════════════════ RENDER ═══════════════════════════════ */

  return (
    <div className="noise-bg flex h-full flex-col gap-2">
      {/* ──────── Header ──────── */}
      <div className="shrink-0 flex items-center justify-between rounded-lg border border-gray-100/60 bg-white/80 px-4 py-2.5 dark:border-gray-700/30 dark:bg-gray-800/80">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/dashboard/project/${projectId}`}>
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold text-gray-900 dark:text-white">
                {generation.config.mainKeyword}
              </h1>
              <Badge variant={isCompleted ? 'success' : isFailed ? 'error' : 'info'} size="sm">
                {getStatusLabel(generation.status)}
              </Badge>
              {isInProgress && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span>{projectName}</span>
              <span>&middot;</span>
              <span className="capitalize">{generation.config.articleType}</span>
              <span>&middot;</span>
              <span className="uppercase">{generation.config.language}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setIsConfigExpanded(p => !p)} className="text-gray-400">
            <Settings className="h-4 w-4" />
          </Button>
          {(isFailed || isCompleted) && (
            <>
              <ModelSelector
                value={selectedModel || generation.config.model || 'openai/gpt-5.2'}
                onChange={setSelectedModel}
                className="w-48"
              />
              <Button
                variant="secondary" size="sm"
                leftIcon={isRestarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                onClick={handleRestart} disabled={isRestarting}
              >
                {isRestarting ? 'Restarting\u2026' : 'Restart'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ──────── Config panel (collapsible) ──────── */}
      {isConfigExpanded && (
        <div className="shrink-0 rounded-lg border border-gray-100/60 bg-white/60 px-4 py-2.5 dark:border-gray-700/30 dark:bg-gray-800/60">
          <div className="grid gap-3 text-xs sm:grid-cols-4">
            <div><span className="text-gray-400">Type</span><p className="font-medium capitalize text-gray-900 dark:text-white">{generation.config.articleType}</p></div>
            <div><span className="text-gray-400">Language</span><p className="font-medium uppercase text-gray-900 dark:text-white">{generation.config.language}</p></div>
            <div><span className="text-gray-400">Region</span><p className="font-medium uppercase text-gray-900 dark:text-white">{generation.config.region}</p></div>
            <div><span className="text-gray-400">Model</span><p className="font-medium text-gray-900 dark:text-white">{generation.config.model || 'openai/gpt-5.2'}</p></div>
            {generation.config.keywords && generation.config.keywords.length > 0 && (
              <div className="sm:col-span-4">
                <span className="text-gray-400">Keywords</span>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {generation.config.keywords.map((kw, i) => <Badge key={i} variant="default" size="sm">{kw}</Badge>)}
                </div>
              </div>
            )}
            {generation.config.comment && (
              <div className="sm:col-span-4">
                <span className="text-gray-400">Comment</span>
                <p className="mt-0.5 whitespace-pre-wrap text-gray-700 dark:text-gray-300">{generation.config.comment}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──────── Progress bar ──────── */}
      {(isActive || generation.progress > 0) && (
        <div className="shrink-0 flex items-center gap-3 px-1">
          <div className="flex-1"><ProgressBar value={generation.progress} size="sm" /></div>
          <span className="min-w-[3rem] text-right text-xs font-medium text-gray-500">{generation.progress}%</span>
        </div>
      )}

      {/* ════════════════ Main two-column grid ════════════════ */}
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_minmax(260px,30%)] gap-3">

        {/* ──── Left column: Meta → Article + Structure side-by-side ──── */}
        <div className="min-h-0 flex flex-col gap-2">

          {/* Error banner — Failed only */}
          {isFailed && generation.error && (
            <div className="shrink-0 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-red-800 dark:text-red-300">Generation Failed</p>
                  <p className="truncate text-[11px] text-red-600 dark:text-red-400">{generation.error}</p>
                </div>
              </div>
              {isApiKeyError(generation.error).isApiError && (
                <Link href="/dashboard/settings">
                  <Button variant="secondary" size="sm">Settings</Button>
                </Link>
              )}
            </div>
          )}

          {/* SEO Metadata — full width on top */}
          {hasMeta && (
            <div className="shrink-0 flex flex-col gap-1.5 rounded-lg border border-emerald-200/60 bg-emerald-50/40 px-3 py-2.5 dark:border-emerald-800/40 dark:bg-emerald-900/10">
              <div className="flex justify-end gap-1">
                {isCompleted && (generation.seoTitleHistory?.length || generation.seoDescriptionHistory?.length) ? (
                  <>
                    <button
                      onClick={() => {
                        generationsApi.revertSeo(generationId, 'previous').then(res => {
                          if (res.success) toast.success('SEO reverted to previous');
                          else toast.error('Failed to revert');
                        }).catch(() => toast.error('Failed to revert'));
                      }}
                      className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-amber-600 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/30"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Previous
                    </button>
                    <button
                      onClick={() => {
                        generationsApi.revertSeo(generationId, 'original').then(res => {
                          if (res.success) toast.success('SEO reverted to original');
                          else toast.error('Failed to revert');
                        }).catch(() => toast.error('Failed to revert'));
                      }}
                      className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-orange-600 transition-colors hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Original
                    </button>
                  </>
                ) : null}
                {isCompleted && (
                  <button
                    onClick={() => setIsCostOpen(true)}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                  >
                    <DollarSign className="h-3 w-3" />
                    Cost
                  </button>
                )}
                {isCompleted && (
                  <button
                    onClick={() => setIsSeoEditOpen(true)}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                  >
                    <Sparkles className="h-3 w-3" />
                    Edit with AI
                  </button>
                )}
              </div>
              {generation.seoTitle && (
                <SeoField
                  label="SEO Title" maxLen={60} value={generation.seoTitle}
                  oldValue={seoOldValues.title}
                  animating={seoAnimating} onCopy={copySeoTitle} isCopied={isTitleCopied}
                  onAnimationDone={() => {}}
                />
              )}
              {generation.seoDescription && (
                <SeoField
                  label="SEO Description" maxLen={160} value={generation.seoDescription}
                  oldValue={seoOldValues.description}
                  animating={seoAnimating} onCopy={copySeoDescription} isCopied={isDescCopied}
                  onAnimationDone={() => setSeoAnimating(false)}
                />
              )}
            </div>
          )}

          {/* Content area: Article + Structure side by side */}
          <div className="flex flex-1 min-h-0 gap-2">

            {/* Article Card — takes remaining width */}
            <Card className="card-shine flex min-h-0 flex-1 flex-col overflow-hidden !p-0">
              {/* Sticky header with Copy */}
              <div className="shrink-0 flex items-center justify-between border-b border-gray-100/60 px-3 py-2 dark:border-gray-700/30">
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Generated Article</span>
                </div>
                {hasArticle && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setIsArticleFullscreen(true)}
                      className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                      title="Open fullscreen"
                    >
                      <Maximize2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={copyArticle}
                      className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                    >
                      {isCopied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
                    </button>
                  </div>
                )}
              </div>

              {/* Scrollable article content */}
              <div className="flex-1 overflow-y-auto px-3 py-2">
                {blocksWithContent.length > 0 ? (
                  /* Block-by-block rendering — supports click-to-scroll from Structure */
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-bold prose-h1:text-xl prose-h1:mt-0 prose-h2:text-lg prose-h2:mt-5 prose-h2:mb-2 prose-h3:text-base prose-h3:mt-3 prose-h3:mb-1.5 prose-p:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-strong:text-gray-900 dark:prose-strong:text-white prose-table:w-full prose-table:border-collapse prose-th:border prose-th:border-gray-300 prose-th:bg-gray-50 prose-th:px-3 prose-th:py-1.5 prose-th:text-left prose-th:text-xs prose-th:font-semibold prose-td:border prose-td:border-gray-200 prose-td:px-3 prose-td:py-1.5 prose-td:text-xs dark:prose-th:border-gray-600 dark:prose-th:bg-gray-800 dark:prose-td:border-gray-700 prose-a:text-blue-600 prose-a:underline dark:prose-a:text-blue-400 prose-blockquote:border-l-4 prose-blockquote:border-blue-400 prose-blockquote:bg-blue-50/50 prose-blockquote:pl-4 prose-blockquote:pr-3 prose-blockquote:py-2 prose-blockquote:italic prose-blockquote:text-gray-700 dark:prose-blockquote:border-blue-500 dark:prose-blockquote:bg-blue-900/20 dark:prose-blockquote:text-gray-300 prose-blockquote:rounded-r-lg prose-blockquote:not-italic">
                    {blocksWithContent.map(block => {
                      const isBlockEditing = editingBlockIds.has(block.id);
                      const blockAnim = animatingBlocks.get(block.id);
                      const isBlockAnimating = !!blockAnim;

                      return (
                        <section
                          key={block.id}
                          id={`article-block-${block.id}`}
                          className="relative scroll-mt-2 transition-[box-shadow,border-radius] duration-500"
                          onContextMenu={(e) => {
                            if (!isCompleted) return;
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY, blockId: block.id });
                          }}
                        >
                          {isBlockEditing && (
                            <div className="block-edit-overlay">
                              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                            </div>
                          )}
                          {isBlockAnimating ? (
                            <TypewriterMarkdown
                              content={getBlockMarkdown(block)}
                              oldContent={blockAnim!.oldContent}
                              enabled={true}
                              onComplete={() => setAnimatingBlocks(m => { const n = new Map(m); n.delete(block.id); return n; })}
                            />
                          ) : (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{getBlockMarkdown(block)}</ReactMarkdown>
                          )}
                        </section>
                      );
                    })}
                  </div>
                ) : (generation.generatedArticle || generation.article) ? (
                  /* Fallback: full assembled article */
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-bold prose-h1:text-xl prose-h1:mt-0 prose-h2:text-lg prose-h2:mt-5 prose-h2:mb-2 prose-h3:text-base prose-h3:mt-3 prose-h3:mb-1.5 prose-p:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-strong:text-gray-900 dark:prose-strong:text-white prose-table:w-full prose-table:border-collapse prose-th:border prose-th:border-gray-300 prose-th:bg-gray-50 prose-th:px-3 prose-th:py-1.5 prose-th:text-left prose-th:text-xs prose-th:font-semibold prose-td:border prose-td:border-gray-200 prose-td:px-3 prose-td:py-1.5 prose-td:text-xs dark:prose-th:border-gray-600 dark:prose-th:bg-gray-800 dark:prose-td:border-gray-700 prose-a:text-blue-600 prose-a:underline dark:prose-a:text-blue-400 prose-blockquote:border-l-4 prose-blockquote:border-blue-400 prose-blockquote:bg-blue-50/50 prose-blockquote:pl-4 prose-blockquote:pr-3 prose-blockquote:py-2 prose-blockquote:italic prose-blockquote:text-gray-700 dark:prose-blockquote:border-blue-500 dark:prose-blockquote:bg-blue-900/20 dark:prose-blockquote:text-gray-300 prose-blockquote:rounded-r-lg prose-blockquote:not-italic">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{generation.generatedArticle || generation.article || ''}</ReactMarkdown>
                  </div>
                ) : (
                  /* Empty placeholder */
                  <div className="flex h-full items-center justify-center text-center text-xs text-gray-400">
                    <div>
                      {isQueued ? (
                        <><Clock className="mx-auto h-6 w-6 opacity-40" /><p className="mt-1.5">Waiting in queue&hellip;</p></>
                      ) : isInProgress ? (
                        <><Loader2 className="mx-auto h-6 w-6 animate-spin opacity-40" /><p className="mt-1.5">Generating content&hellip;</p></>
                      ) : isFailed ? (
                        <><AlertCircle className="mx-auto h-6 w-6 opacity-40" /><p className="mt-1.5">No content generated</p></>
                      ) : (
                        <><FileText className="mx-auto h-6 w-6 opacity-40" /><p className="mt-1.5">No content</p></>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Structure panel — fixed width sidebar */}
            {hasBlocks && (
              <Card className="card-shine flex w-[300px] shrink-0 min-h-0 flex-col overflow-hidden !p-0">
                <div className="shrink-0 flex items-center gap-2 border-b border-gray-100/60 px-3 py-2 dark:border-gray-700/30">
                  <List className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Structure
                    <span className="ml-1 font-normal text-gray-400">
                      ({blocksWithContent.length}/{blocks.length})
                    </span>
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1.5">
                  <div className="space-y-0.5">
                    {blocks.map(block => {
                      const done      = !!block.content;
                      const isCurrent = block.id === currentBlockId;
                      return (
                        <button
                          key={block.id}
                          id={`structure-block-${block.id}`}
                          type="button"
                          onClick={() => done && scrollToBlock(block.id)}
                          disabled={!done}
                          className={cn(
                            'w-full rounded-md px-2 py-1 text-left text-[11px] transition-all',
                            block.type === 'h3' && 'pl-5',
                            done && 'cursor-pointer hover:bg-gray-100/80 dark:hover:bg-gray-700/40',
                            !done && !isCurrent && 'opacity-50',
                            isCurrent && 'bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-900/20 dark:ring-blue-700',
                          )}
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            {done ? (
                              <Check className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
                            ) : isCurrent ? (
                              <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-blue-500" />
                            ) : (
                              <div className="h-2.5 w-2.5 shrink-0 rounded-full border border-gray-300 dark:border-gray-600" />
                            )}
                            <span className={cn(
                              'min-w-0 truncate',
                              done ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400',
                            )}>
                              {block.heading || '(No heading)'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* ──── Right column: Logs ──── */}
        <div className="min-h-0 flex flex-col">
          <Card className={cn(
            'card-shine flex flex-col overflow-hidden !p-0 transition-all',
            isLogsExpanded ? 'flex-1' : 'h-[300px] shrink-0'
          )}>
            {/* Logs header — click to expand/collapse */}
            <div
              className="shrink-0 flex cursor-pointer items-center justify-between border-b border-gray-100/60 px-3 py-2 dark:border-gray-700/30"
              onClick={() => setIsLogsExpanded(p => !p)}
            >
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Logs <span className="font-normal text-gray-400">({logs.length})</span>
                </span>
                {isActive && <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />}
              </div>
              <div className="flex items-center gap-1">
                {!isLogsAtBottom && isLogsExpanded && (
                  <button
                    onClick={(e) => { e.stopPropagation(); jumpToLatest(); }}
                    className="rounded p-0.5 text-gray-400 hover:text-blue-500"
                    title="Jump to latest"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                )}
                {isLogsExpanded
                  ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
                  : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                }
              </div>
            </div>

            {/* Logs content */}
            <div
              ref={logsContainerRef}
              onScroll={handleLogsScroll}
              className="flex-1 overflow-y-auto px-2 py-1"
            >
              {logs.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-xs text-gray-400">
                  <div>
                    <Clock className="mx-auto h-5 w-5 opacity-40" />
                    <p className="mt-1">Waiting&hellip;</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={cn(
                        'rounded px-2 py-1 text-[11px] leading-relaxed',
                        log.level === 'thinking' && 'bg-purple-50/80 text-purple-700 italic dark:bg-purple-900/20 dark:text-purple-300',
                        log.level === 'error'    && 'bg-red-50/80 text-red-700 dark:bg-red-900/20 dark:text-red-300',
                        log.level === 'warn'     && 'bg-yellow-50/80 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300',
                        (log.level === 'info' || !log.level) && 'text-gray-600 dark:text-gray-400',
                      )}
                    >
                      <span className="mr-1.5 opacity-40">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      <span className="break-words">{log.message}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ════════════════ Fullscreen Article Modal ════════════════ */}
      <Modal
        isOpen={isArticleFullscreen}
        onClose={() => setIsArticleFullscreen(false)}
        size="full"
      >
        <div className="flex h-[85vh] flex-col pr-4">
          {/* Modal header — pr-8 avoids X close button */}
          <div className="shrink-0 flex items-center justify-between border-b border-gray-200 pb-3 pr-6 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {generation.config.mainKeyword}
            </h2>
            <button
              onClick={copyArticle}
              className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              {isCopied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy Article</>}
            </button>
          </div>

          {/* SEO Meta inside modal */}
          {hasMeta && (
            <div className="shrink-0 mt-3 flex flex-col gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50/40 px-4 py-3 dark:border-emerald-800/40 dark:bg-emerald-900/10">
              {generation.seoTitle && (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      SEO Title
                      <span className="ml-1.5 font-normal text-emerald-500">({generation.seoTitle.length}/60)</span>
                    </span>
                    <p className="mt-0.5 text-sm text-gray-900 dark:text-white">{generation.seoTitle}</p>
                  </div>
                  <button
                    onClick={copySeoTitle}
                    className="shrink-0 flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                  >
                    {isTitleCopied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy Title</>}
                  </button>
                </div>
              )}
              {generation.seoDescription && (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      SEO Description
                      <span className="ml-1.5 font-normal text-emerald-500">({generation.seoDescription.length}/160)</span>
                    </span>
                    <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">{generation.seoDescription}</p>
                  </div>
                  <button
                    onClick={copySeoDescription}
                    className="shrink-0 flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                  >
                    {isDescCopied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy Desc</>}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Scrollable article body — full width */}
          <div className="mt-3 flex-1 min-h-0 overflow-y-auto rounded-lg border border-gray-100 bg-white px-4 py-4 dark:border-gray-700 dark:bg-gray-800/50">
            <div className="prose prose-base max-w-none dark:prose-invert prose-headings:font-bold prose-h1:text-2xl prose-h1:mt-0 prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-3 prose-h3:text-lg prose-h3:mt-5 prose-h3:mb-2 prose-p:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-strong:text-gray-900 dark:prose-strong:text-white prose-table:w-full prose-table:border-collapse prose-th:border prose-th:border-gray-300 prose-th:bg-gray-50 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-sm prose-th:font-semibold prose-td:border prose-td:border-gray-200 prose-td:px-3 prose-td:py-2 prose-td:text-sm dark:prose-th:border-gray-600 dark:prose-th:bg-gray-800 dark:prose-td:border-gray-700 prose-a:text-blue-600 prose-a:underline dark:prose-a:text-blue-400 prose-blockquote:border-l-4 prose-blockquote:border-blue-400 prose-blockquote:bg-blue-50/50 prose-blockquote:pl-4 prose-blockquote:pr-3 prose-blockquote:py-3 prose-blockquote:italic prose-blockquote:text-gray-700 dark:prose-blockquote:border-blue-500 dark:prose-blockquote:bg-blue-900/20 dark:prose-blockquote:text-gray-300 prose-blockquote:rounded-r-lg prose-blockquote:not-italic">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {generation.generatedArticle || generation.article || ''}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </Modal>

      {/* ════════════════ Block Context Menu + Edit Modals ════════════════ */}
      {contextMenu && (
        <BlockContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          blockId={contextMenu.blockId}
          hasHistory={(blocks.find(b => b.id === contextMenu.blockId)?.contentHistory?.length ?? 0) > 0}
          onEditWithAI={(blockId) => {
            const block = blocks.find(b => b.id === blockId);
            if (block) setEditingBlock(block);
            setContextMenu(null);
          }}
          onRevert={(blockId, mode) => {
            setContextMenu(null);
            pendingScrollBlockIdRef.current = blockId;
            generationsApi.revertBlock(generationId, blockId, mode).then(res => {
              if (res.success) toast.success(`Block reverted to ${mode}`);
              else toast.error(res.error || 'Failed to revert');
            }).catch(() => toast.error('Failed to revert block'));
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {editingBlock && (
        <BlockEditModal
          isOpen={true}
          onClose={() => setEditingBlock(null)}
          block={editingBlock}
          onSubmit={(blockId, prompt) => {
            setEditingBlock(null);
            pendingScrollBlockIdRef.current = blockId;
            setEditingBlockIds(s => new Set(s).add(blockId));
            generationsApi.editBlock(generationId, blockId, prompt).then(res => {
              if (!res.success) {
                setEditingBlockIds(s => { const n = new Set(s); n.delete(blockId); return n; });
                toast.error(res.error || 'Failed to edit block');
              }
            }).catch(() => {
              setEditingBlockIds(s => { const n = new Set(s); n.delete(blockId); return n; });
              toast.error('Failed to edit block');
            });
          }}
        />
      )}

      <CostModal
        isOpen={isCostOpen}
        onClose={() => setIsCostOpen(false)}
        generation={generation}
      />

      <SeoEditModal
        isOpen={isSeoEditOpen}
        onClose={() => setIsSeoEditOpen(false)}
        currentTitle={generation?.seoTitle}
        currentDescription={generation?.seoDescription}
        onSubmit={(prompt) => {
          setIsSeoEditOpen(false);
          generationsApi.editSeo(generationId, prompt).then(res => {
            if (!res.success) toast.error(res.error || 'Failed to edit SEO');
            // Socket.IO generation:seo event handles state update + animation
          }).catch(() => toast.error('Failed to edit SEO metadata'));
        }}
      />
    </div>
  );
}

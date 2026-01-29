/**
 * Generation Detail Page with Real-time Logs
 * Redesigned with compact logs panel and prominent intermediate results
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Copy,
  Check,
  AlertCircle,
  Clock,
  FileText,
  Loader2,
  Play,
  List,
  ChevronDown,
  ChevronUp,
  Terminal,
  Settings,
} from 'lucide-react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  ProgressBar,
} from '@/components/ui';
import { generationsApi } from '@/lib/api';
import { initSocket, subscribeToGeneration } from '@/lib/socket';
import { ArticleBlock, Generation, GenerationLog, GenerationStatus } from '@/types';
import { getStatusLabel, isPausedStatus, cn } from '@/lib/utils';

// Helper function to detect API-related errors
const isApiKeyError = (error: string): { isApiError: boolean; service: string | null } => {
  const errorLower = error.toLowerCase();

  if (errorLower.includes('openrouter') || errorLower.includes('open router')) {
    return { isApiError: true, service: 'OpenRouter' };
  }
  if (errorLower.includes('firecrawl') || errorLower.includes('fire crawl')) {
    return { isApiError: true, service: 'Firecrawl' };
  }
  if (errorLower.includes('supabase')) {
    return { isApiError: true, service: 'Supabase' };
  }
  if (errorLower.includes('api key') || errorLower.includes('invalid key') || errorLower.includes('unauthorized') || errorLower.includes('401')) {
    return { isApiError: true, service: null };
  }

  return { isApiError: false, service: null };
};

export default function GenerationPage() {
  const params = useParams();
  const router = useRouter();
  const generationId = params.id as string;

  const [generation, setGeneration] = useState<Generation | null>(null);
  const [logs, setLogs] = useState<GenerationLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isTitleCopied, setIsTitleCopied] = useState(false);
  const [isDescCopied, setIsDescCopied] = useState(false);
  const [isLogsExpanded, setIsLogsExpanded] = useState(false);
  const [isConfigExpanded, setIsConfigExpanded] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const fetchGeneration = async () => {
      try {
        const response = await generationsApi.getOne(generationId);
        if (response.success) {
          const gen = response.data as Generation;
          setGeneration(gen);
          setLogs(gen.logs || []);
        }
      } catch (error) {
        toast.error('Failed to load generation');
        router.push('/dashboard');
      } finally {
        setIsLoading(false);
      }
    };

    fetchGeneration();
  }, [generationId, router]);

  useEffect(() => {
    if (!generation) return;

    const token = localStorage.getItem('token');
    if (token) {
      initSocket(token);
    }

    const unsubscribe = subscribeToGeneration(generationId, {
      onLog: (log) => {
        setLogs((prev) => [...prev, log]);
      },
      onStatus: (status, progress) => {
        setGeneration((prev) =>
          prev ? { ...prev, status, progress } : null
        );
      },
      onBlocks: (blocks: ArticleBlock[]) => {
        setGeneration((prev) =>
          prev ? { ...prev, articleBlocks: blocks } : null
        );
      },
      onCompleted: (article) => {
        setGeneration((prev) =>
          prev
            ? { ...prev, status: GenerationStatus.COMPLETED, progress: 100, article: article }
            : null
        );
        toast.success('Article generation completed!');
      },
      onError: (error) => {
        setGeneration((prev) =>
          prev ? { ...prev, status: GenerationStatus.FAILED, error } : null
        );

        // Check if this is an API key related error
        const { isApiError, service } = isApiKeyError(error);
        if (isApiError) {
          const serviceText = service ? `${service} ` : '';
          toast.error(`${serviceText}API key error. Please check your API keys in Settings.`, {
            duration: 5000,
          });
          // Delay redirect slightly so user can see the error
          setTimeout(() => {
            router.push('/dashboard/settings');
          }, 2000);
        } else {
          toast.error(`Generation failed: ${error}`);
        }
      },
    });

    return () => {
      unsubscribe();
    };
  }, [generation, generationId]);

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  const copyArticle = async () => {
    const articleText = generation?.generatedArticle || generation?.article;
    if (!articleText) return;

    try {
      await navigator.clipboard.writeText(articleText);
      setIsCopied(true);
      toast.success('Article copied to clipboard');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const copySeoTitle = async () => {
    if (!generation?.seoTitle) return;
    try {
      await navigator.clipboard.writeText(generation.seoTitle);
      setIsTitleCopied(true);
      toast.success('SEO Title copied');
      setTimeout(() => setIsTitleCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const copySeoDescription = async () => {
    if (!generation?.seoDescription) return;
    try {
      await navigator.clipboard.writeText(generation.seoDescription);
      setIsDescCopied(true);
      toast.success('SEO Description copied');
      setTimeout(() => setIsDescCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleContinue = async () => {
    if (!generation) return;

    setIsContinuing(true);
    try {
      const response = await generationsApi.continue(generationId);
      if (response.success) {
        toast.success('Generation continued');
        // Update local state to show it's processing again
        setGeneration((prev) =>
          prev ? { ...prev, status: GenerationStatus.PROCESSING } : null
        );
      }
    } catch (error) {
      toast.error('Failed to continue generation');
    } finally {
      setIsContinuing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!generation) {
    return null;
  }

  const projectName = typeof generation.projectId === 'object'
    ? generation.projectId.name
    : 'Unknown Project';

  const projectId = typeof generation.projectId === 'object'
    ? generation.projectId._id
    : generation.projectId;

  const isActive =
    generation.status !== GenerationStatus.COMPLETED &&
    generation.status !== GenerationStatus.FAILED &&
    !isPausedStatus(generation.status);

  const canContinue = isPausedStatus(generation.status);

  return (
    <div className="space-y-4">
      {/* Compact Header with Status */}
      <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/project/${projectId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                {generation.config.mainKeyword}
              </h1>
              <Badge
                variant={
                  generation.status === GenerationStatus.COMPLETED
                    ? 'success'
                    : generation.status === GenerationStatus.FAILED
                    ? 'error'
                    : canContinue
                    ? 'warning'
                    : 'info'
                }
              >
                {getStatusLabel(generation.status)}
              </Badge>
              {isActive && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 dark:text-gray-400">
              <span>{projectName}</span>
              <span>•</span>
              <span className="capitalize">{generation.config.articleType}</span>
              <span>•</span>
              <span className="uppercase">{generation.config.language}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Config toggle button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsConfigExpanded(!isConfigExpanded)}
            className="text-gray-500"
          >
            <Settings className="h-4 w-4" />
          </Button>
          {canContinue && (
            <Button
              variant="primary"
              size="sm"
              leftIcon={isContinuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              onClick={handleContinue}
              disabled={isContinuing}
            >
              {isContinuing ? 'Continuing...' : 'Continue'}
            </Button>
          )}
        </div>
      </div>

      {/* Collapsible Config Panel */}
      {isConfigExpanded && (
        <Card className="border-gray-200 dark:border-gray-700">
          <CardContent className="py-3">
            <div className="grid gap-3 md:grid-cols-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Type</span>
                <p className="font-medium text-gray-900 dark:text-white capitalize">
                  {generation.config.articleType}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Language</span>
                <p className="font-medium text-gray-900 dark:text-white uppercase">
                  {generation.config.language}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Region</span>
                <p className="font-medium text-gray-900 dark:text-white uppercase">
                  {generation.config.region}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Mode</span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {generation.config.continuousMode ? 'Continuous' : 'Step-by-step'}
                </p>
              </div>
              {generation.config.keywords?.length > 0 && (
                <div className="md:col-span-4">
                  <span className="text-gray-500 dark:text-gray-400">Keywords</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {generation.config.keywords.map((kw, i) => (
                      <Badge key={i} variant="default" size="sm">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {generation.config.comment && (
                <div className="md:col-span-4">
                  <span className="text-gray-500 dark:text-gray-400">Comment</span>
                  <p className="text-gray-700 dark:text-gray-300 text-xs mt-1 whitespace-pre-wrap">
                    {generation.config.comment}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress Bar - inline and compact */}
      {(isActive || generation.progress > 0) && (
        <div className="flex items-center gap-3 px-1">
          <div className="flex-1">
            <ProgressBar value={generation.progress} size="sm" />
          </div>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[3rem] text-right">
            {generation.progress}%
          </span>
        </div>
      )}

      {/* Main Content Grid - Logs on right, Results on left */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main Results Column (2/3 width) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Article Blocks - Main Focus */}
          {generation.articleBlocks && generation.articleBlocks.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <List className="h-4 w-4" />
                  Article Structure ({generation.articleBlocks.filter(b => b?.content).length}/{generation.articleBlocks.length} written)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {generation.articleBlocks.filter(block => block && block.type).map((block) => (
                    <div
                      key={block.id}
                      className={cn(
                        'rounded-lg border p-3 transition-all',
                        block.content && 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-900/10',
                        !block.content && block.type === 'h1' && 'border-purple-200 bg-purple-50/50 dark:border-purple-800 dark:bg-purple-900/10',
                        !block.content && block.type === 'intro' && 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10',
                        !block.content && (block.type === 'h2' || block.type === 'h3') && 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800',
                        !block.content && block.type === 'conclusion' && 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10',
                        !block.content && block.type === 'faq' && 'border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-900/10',
                        block.type === 'h3' && 'ml-4'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <Badge
                          variant={block.content ? 'success' : 'default'}
                          size="sm"
                          className="shrink-0"
                        >
                          {block.type?.toUpperCase() || 'BLOCK'}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm text-gray-900 dark:text-white truncate">
                            {block.heading || '(No heading)'}
                          </h4>
                          {block.content && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {block.content.split(/\s+/).length} words
                            </p>
                          )}
                          {!block.content && block.instruction && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                              {block.instruction}
                            </p>
                          )}
                        </div>
                        {block.content && <Check className="h-4 w-4 text-green-600 shrink-0" />}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* SEO Metadata - Compact */}
          {(generation.seoTitle || generation.seoDescription) && (
            <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10">
              <CardContent className="py-3">
                <div className="space-y-2">
                  {generation.seoTitle && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          Title ({generation.seoTitle.length}/60)
                        </span>
                        <p className="text-sm text-gray-900 dark:text-white truncate">
                          {generation.seoTitle}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={copySeoTitle}
                        className="h-7 px-2"
                      >
                        {isTitleCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  )}
                  {generation.seoDescription && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          Description ({generation.seoDescription.length}/160)
                        </span>
                        <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">
                          {generation.seoDescription}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={copySeoDescription}
                        className="h-7 px-2"
                      >
                        {isDescCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Generated Article */}
          {(generation.generatedArticle || generation.article) && (
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Generated Article
                  </CardTitle>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    onClick={copyArticle}
                    className="h-7"
                  >
                    {isCopied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="prose prose-sm max-w-none dark:prose-invert max-h-[600px] overflow-y-auto prose-headings:font-bold prose-h1:text-2xl prose-h1:mt-0 prose-h2:text-xl prose-h2:mt-6 prose-h2:mb-3 prose-h3:text-lg prose-h3:mt-4 prose-h3:mb-2 prose-p:my-3 prose-ul:my-2 prose-li:my-1 prose-strong:text-gray-900 dark:prose-strong:text-white">
                  <ReactMarkdown>
                    {generation.generatedArticle || generation.article || ''}
                  </ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Error Display */}
          {generation.status === GenerationStatus.FAILED && generation.error && (
            <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
                    <div>
                      <p className="font-medium text-red-800 dark:text-red-300 text-sm">
                        Generation Failed
                      </p>
                      <p className="text-xs text-red-600 dark:text-red-400">
                        {generation.error}
                      </p>
                    </div>
                  </div>
                  {isApiKeyError(generation.error).isApiError && (
                    <Link href="/dashboard/settings">
                      <Button variant="secondary" size="sm">
                        Go to Settings
                      </Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Logs Column (1/3 width) */}
        <div className="lg:col-span-1">
          <Card className="sticky top-4">
            <CardHeader className="py-2 px-3 cursor-pointer" onClick={() => setIsLogsExpanded(!isLogsExpanded)}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  Logs ({logs.length})
                  {isActive && <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                </CardTitle>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  {isLogsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
            </CardHeader>
            <CardContent className={cn(
              "px-3 pb-3 pt-0 transition-all overflow-hidden",
              isLogsExpanded ? "max-h-[600px]" : "max-h-[250px]"
            )}>
              <div className={cn(
                "overflow-y-auto space-y-1",
                isLogsExpanded ? "h-[580px]" : "h-[230px]"
              )}>
                {logs.length === 0 ? (
                  <div className="py-4 text-center text-gray-500 dark:text-gray-400">
                    <Clock className="mx-auto h-6 w-6 opacity-50" />
                    <p className="mt-1 text-xs">Waiting...</p>
                  </div>
                ) : (
                  logs.map((log, index) => (
                    <div
                      key={index}
                      className={cn(
                        'rounded px-2 py-1.5 text-xs',
                        log.level === 'thinking' && 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300 italic',
                        log.level === 'error' && 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300',
                        log.level === 'warn' && 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300',
                        log.level === 'info' && 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                        !log.level && 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 opacity-50">
                          {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span className="break-words">{log.message}</span>
                      </div>
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

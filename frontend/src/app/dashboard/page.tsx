/**
 * Dashboard Overview Page — right-rail layout with premium visual polish
 * Left 7/12: Generations (infinite scroll, sorted by updatedAt)
 * Right 5/12: KPI 2x2 grid + Projects list (visual anchor, accented)
 */

'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  FolderPlus,
  FileText,
  Clock,
  CheckCircle2,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent, Button, Badge, ProgressBar } from '@/components/ui';
import { projectsApi, generationsApi } from '@/lib/api';
import { Project, Generation, QueueStats, GenerationStatus } from '@/types';
import { formatRelativeTime, getStatusLabel } from '@/lib/utils';

const PAGE_SIZE = 20;

/* ── Status → left-stripe color mapping ── */
const statusStripeColor = (status: GenerationStatus): string => {
  switch (status) {
    case GenerationStatus.COMPLETED:
      return 'bg-emerald-400';
    case GenerationStatus.FAILED:
      return 'bg-red-400';
    case GenerationStatus.QUEUED:
      return 'bg-amber-400';
    default:
      // All in-progress statuses
      return 'bg-blue-400';
  }
};

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [generationsMap, setGenerationsMap] = useState<Map<string, Generation>>(new Map());
  const [totalGenerations, setTotalGenerations] = useState(0);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Derived sorted list
  const sortedGenerations = useMemo(
    () =>
      Array.from(generationsMap.values()).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [generationsMap]
  );

  const hasMore = generationsMap.size < totalGenerations;

  // Merge generations into map (deduplicates by _id)
  const mergeGenerations = useCallback((generations: Generation[], total: number) => {
    setTotalGenerations(total);
    setGenerationsMap((prev) => {
      const next = new Map(prev);
      for (const gen of generations) next.set(gen._id, gen);
      return next;
    });
  }, []);

  // Fetch page 1 + projects + stats (used for initial load and polling)
  const fetchData = useCallback(async () => {
    try {
      const [projectsRes, generationsRes, statsRes] = await Promise.all([
        projectsApi.getAll(),
        generationsApi.getAll({ limit: PAGE_SIZE, offset: 0 }),
        generationsApi.getQueueStats(),
      ]);

      if (projectsRes.success) {
        setProjects(projectsRes.data as Project[]);
      }
      if (generationsRes.success) {
        const data = generationsRes.data as { generations: Generation[]; total: number };
        mergeGenerations(data.generations, data.total);
      }
      if (statsRes.success) {
        setQueueStats(statsRes.data as QueueStats);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [mergeGenerations]);

  // Initial load + polling every 10s
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Load next page (infinite scroll)
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const res = await generationsApi.getAll({ limit: PAGE_SIZE, offset: generationsMap.size });
      if (res.success) {
        const data = res.data as { generations: Generation[]; total: number };
        mergeGenerations(data.generations, data.total);
      }
    } catch (error) {
      console.error('Failed to load more generations:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, generationsMap.size, mergeGenerations]);

  // IntersectionObserver — trigger loadMore when sentinel enters viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { root: container, rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const isActive = (status: GenerationStatus) =>
    status !== GenerationStatus.COMPLETED &&
    status !== GenerationStatus.FAILED &&
    status !== GenerationStatus.QUEUED;

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="h-7 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="grid min-h-0 flex-1 grid-cols-12 gap-3">
          <div className="col-span-7 rounded-xl bg-gray-200 dark:bg-gray-700" />
          <div className="col-span-5 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-gray-200 dark:bg-gray-700" />
              ))}
            </div>
            <div className="flex-1 rounded-xl bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="noise-bg flex h-full flex-col gap-3">
      {/* Header with gradient underline */}
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="header-underline text-2xl font-bold text-gray-900 dark:text-white">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Overview of your SEO article generation activity
          </p>
        </div>
        <Link href="/dashboard/projects">
          <Button size="sm" leftIcon={<FolderPlus className="h-4 w-4" />}>
            New Project
          </Button>
        </Link>
      </div>

      {/* Main grid: left 7/12 + right 5/12 */}
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3">
        {/* LEFT: Generations — infinite scroll, card shine, hairline border */}
        <Card className="card-shine col-span-7 flex flex-col overflow-hidden border-gray-100/80 !p-0 dark:border-gray-700/40">
          <CardHeader className="shrink-0 border-b border-gray-100/60 !px-3 !py-2.5 dark:border-gray-700/30">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-gray-400" />
              Generations
              {totalGenerations > 0 && (
                <span className="text-xs font-normal text-gray-400">({totalGenerations})</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto !px-3 !pb-2.5 !pt-2">
            {sortedGenerations.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-gray-500 dark:text-gray-400">
                <div>
                  <FileText className="mx-auto h-10 w-10 opacity-50" />
                  <p className="mt-2 text-sm">No generations yet</p>
                  <p className="text-xs">Create a project and start generating articles</p>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {sortedGenerations.map((gen) => (
                  <Link
                    key={gen._id}
                    href={`/dashboard/generation/${gen._id}`}
                    className={`group relative block overflow-hidden rounded-lg border border-gray-100/70 pl-1 transition-all hover:bg-gray-50/80 hover:shadow-sm active:translate-y-px dark:border-gray-700/40 dark:hover:bg-gray-700/30 ${
                      isActive(gen.status) ? 'active-glow' : ''
                    }`}
                  >
                    {/* Color stripe left edge */}
                    <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l ${statusStripeColor(gen.status)}`} />

                    <div className="flex items-center justify-between px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-snug text-gray-900 dark:text-white">
                          {gen.config.mainKeyword}
                        </p>
                        <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">
                          {typeof gen.projectId === 'object' ? gen.projectId.name : 'Unknown Project'}
                        </p>
                      </div>
                      <div className="ml-3 flex items-center gap-2">
                        {gen.config.mode === 'v2' && (
                          <Badge size="sm" className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                            v2
                          </Badge>
                        )}
                        <Badge
                          variant={
                            gen.status === GenerationStatus.COMPLETED
                              ? 'success'
                              : gen.status === GenerationStatus.FAILED
                              ? 'error'
                              : 'info'
                          }
                          size="sm"
                        >
                          {getStatusLabel(gen.status)}
                        </Badge>
                        <ArrowRight className="h-3.5 w-3.5 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400" />
                      </div>
                    </div>

                    {isActive(gen.status) && (
                      <div className="px-2 pb-1.5">
                        <ProgressBar value={gen.progress} size="sm" />
                      </div>
                    )}
                  </Link>
                ))}

                {/* Sentinel for infinite scroll */}
                <div ref={sentinelRef} className="flex justify-center py-2">
                  {isLoadingMore && (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* RIGHT: KPI 2x2 + Projects — subtle panel background */}
        <div className="col-span-5 flex min-h-0 flex-col gap-3 rounded-2xl bg-gray-50/50 p-2 dark:bg-gray-800/30">
          {/* KPI 2x2 grid — attention-first with colored accent stripes */}
          <div className="grid shrink-0 grid-cols-2 gap-2">
            {/* Active */}
            <Card className="card-shine kpi-accent kpi-accent-purple !px-3 !py-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <TrendingUp className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-[11px] leading-tight text-gray-500 dark:text-gray-400">Active</p>
                  <p className="text-base font-bold leading-tight text-gray-900 dark:text-white">
                    {queueStats?.active || 0}
                  </p>
                </div>
              </div>
            </Card>

            {/* In Queue */}
            <Card className="card-shine kpi-accent kpi-accent-yellow !px-3 !py-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
                  <Clock className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div>
                  <p className="text-[11px] leading-tight text-gray-500 dark:text-gray-400">In Queue</p>
                  <p className="text-base font-bold leading-tight text-gray-900 dark:text-white">
                    {queueStats?.waiting || 0}
                  </p>
                </div>
              </div>
            </Card>

            {/* Completed */}
            <Card className="card-shine kpi-accent kpi-accent-green !px-3 !py-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-[11px] leading-tight text-gray-500 dark:text-gray-400">Completed</p>
                  <p className="text-base font-bold leading-tight text-gray-900 dark:text-white">
                    {queueStats?.completed || 0}
                  </p>
                </div>
              </div>
            </Card>

            {/* Projects */}
            <Card className="card-shine kpi-accent kpi-accent-blue !px-3 !py-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <FolderPlus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-[11px] leading-tight text-gray-500 dark:text-gray-400">Projects</p>
                  <p className="text-base font-bold leading-tight text-gray-900 dark:text-white">
                    {projects.length}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Your Projects — fills remaining height, card shine, stronger border */}
          <Card className="card-shine flex min-h-0 flex-1 flex-col overflow-hidden border-gray-200/80 !p-0 dark:border-gray-600/60">
            <CardHeader className="shrink-0 border-b border-gray-100/60 !px-3 !py-2.5 dark:border-gray-700/30">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FolderPlus className="h-4 w-4 text-gray-400" />
                Your Projects
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto !px-3 !pb-2.5 !pt-2">
              {projects.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-gray-500 dark:text-gray-400">
                  <div>
                    <FolderPlus className="mx-auto h-10 w-10 opacity-50" />
                    <p className="mt-2 text-sm">No projects yet</p>
                    <Link href="/dashboard/projects">
                      <Button variant="secondary" size="sm" className="mt-3">
                        Create First Project
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {projects.map((project) => (
                    <Link
                      key={project._id}
                      href={`/dashboard/project/${project._id}`}
                      className="group flex items-center justify-between rounded-lg border border-gray-100/70 px-2.5 py-1.5 transition-all hover:bg-gray-50/80 hover:shadow-sm active:translate-y-px dark:border-gray-700/40 dark:hover:bg-gray-700/30"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-snug text-gray-900 dark:text-white">
                          {project.name}
                        </p>
                        <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">
                          {project.generationsCount || 0} generations
                        </p>
                      </div>
                      <div className="ml-3 flex items-center gap-2">
                        <span className="text-xs text-gray-400">
                          {formatRelativeTime(project.createdAt)}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

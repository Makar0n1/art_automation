/**
 * Generation 2.0 — list all v2 generations across projects
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Atom, ArrowRight, Clock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, Badge } from '@/components/ui';
import { generationsApi } from '@/lib/api';
import { Generation, GenerationStatus } from '@/types';
import { formatRelativeTime, getStatusLabel, cn } from '@/lib/utils';

const statusColor: Record<string, string> = {
  [GenerationStatus.COMPLETED]: 'success',
  [GenerationStatus.FAILED]: 'error',
  [GenerationStatus.PROCESSING]: 'warning',
  [GenerationStatus.QUEUED]: 'default',
};

const StatusIcon = ({ status }: { status: GenerationStatus }) => {
  if (status === GenerationStatus.COMPLETED) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === GenerationStatus.FAILED) return <AlertCircle className="h-4 w-4 text-red-500" />;
  if (status === GenerationStatus.PROCESSING) return <Loader2 className="h-4 w-4 animate-spin text-amber-500" />;
  return <Clock className="h-4 w-4 text-gray-400" />;
};

const CoverageBar = ({ percent, label }: { percent: number; label: string }) => (
  <div className="flex items-center gap-2">
    <span className="w-28 shrink-0 text-xs text-gray-500 dark:text-gray-400">{label}</span>
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
      <div
        className={cn(
          'h-full rounded-full transition-all',
          percent >= 80 ? 'bg-emerald-500' : percent >= 50 ? 'bg-amber-500' : 'bg-red-400'
        )}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
    <span className="w-8 text-right text-xs font-medium text-gray-700 dark:text-gray-300">{Math.round(percent)}%</span>
  </div>
);

export default function V2DashboardPage() {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await generationsApi.getAll({ limit: 100 });
        if (res.success && Array.isArray(res.data)) {
          const v2 = (res.data as Generation[]).filter(g => g.config?.mode === 'v2');
          setGenerations(v2);
        }
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const projectName = (gen: Generation): string => {
    if (typeof gen.projectId === 'object' && gen.projectId !== null) {
      return gen.projectId.name;
    }
    return String(gen.projectId);
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600">
          <Atom className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Generation 2.0</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Entity · Intent · Evidence pipeline
          </p>
        </div>
        <Link
          href="/dashboard/projects"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <ArrowRight className="h-4 w-4" /> New generation
        </Link>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
        </div>
      ) : generations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 dark:bg-violet-900/20">
              <Atom className="h-7 w-7 text-violet-600" />
            </div>
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              No Generation 2.0 articles yet.
              <br />
              Open a project and toggle <strong>Generation 2.0</strong> mode in the generation form.
            </p>
            <Link
              href="/dashboard/projects"
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              Go to Projects <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {generations.map(gen => {
            const qs = gen.qualityScores;
            const clusters = gen.entityClusters ?? [];
            return (
              <Link
                key={gen._id}
                href={`/dashboard/v2/generation/${gen._id}`}
                className="block"
              >
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      {/* Left */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <StatusIcon status={gen.status} />
                          <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                            {gen.config.mainKeyword}
                          </span>
                          <Badge variant={statusColor[gen.status] as 'success' | 'error' | 'warning' | 'default' ?? 'default'}>
                            {getStatusLabel(gen.status)}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-400">{projectName(gen)} · {formatRelativeTime(gen.updatedAt)}</p>

                        {/* Coverage mini-bars (completed only) */}
                        {gen.status === GenerationStatus.COMPLETED && qs && (
                          <div className="mt-3 space-y-1.5">
                            <CoverageBar percent={qs.entityCoveragePercent} label="Entities" />
                            <CoverageBar percent={qs.intentRealizedPercent} label="Intent realized" />
                          </div>
                        )}
                      </div>

                      {/* Right — compact stats */}
                      {gen.status === GenerationStatus.COMPLETED && (
                        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                          {qs && qs.criticalEntitiesMissed > 0 && (
                            <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400">
                              {qs.criticalEntitiesMissed} critical missed
                            </span>
                          )}
                          {qs && qs.unsupportedHardClaims > 0 && (
                            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
                              {qs.unsupportedHardClaims} unsupported claims
                            </span>
                          )}
                          <span className="text-xs text-gray-400">
                            {clusters.length} cluster{clusters.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )}

                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

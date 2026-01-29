/**
 * Dashboard Overview Page
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FolderPlus,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent, Button, Badge, ProgressBar } from '@/components/ui';
import { projectsApi, generationsApi } from '@/lib/api';
import { Project, Generation, QueueStats, GenerationStatus } from '@/types';
import { formatRelativeTime, getStatusLabel, getStatusColor, cn } from '@/lib/utils';

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentGenerations, setRecentGenerations] = useState<Generation[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [projectsRes, generationsRes, statsRes] = await Promise.all([
          projectsApi.getAll(),
          generationsApi.getAll({ limit: 5 }),
          generationsApi.getQueueStats(),
        ]);

        if (projectsRes.success) {
          setProjects(projectsRes.data as Project[]);
        }
        if (generationsRes.success) {
          setRecentGenerations((generationsRes.data as { generations: Generation[] }).generations);
        }
        if (statsRes.success) {
          setQueueStats(statsRes.data as QueueStats);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const totalGenerations = recentGenerations.length;
  const completedGenerations = recentGenerations.filter(
    (g) => g.status === GenerationStatus.COMPLETED
  ).length;
  const activeGenerations = recentGenerations.filter(
    (g) => ![GenerationStatus.COMPLETED, GenerationStatus.FAILED, GenerationStatus.QUEUED].includes(g.status)
  ).length;

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="grid gap-6 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 rounded-xl bg-gray-200 dark:bg-gray-700" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Dashboard
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Overview of your SEO article generation activity
          </p>
        </div>
        <Link href="/dashboard/projects">
          <Button leftIcon={<FolderPlus className="h-4 w-4" />}>
            New Project
          </Button>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
                <FolderPlus className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Projects</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {projects.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Completed</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {queueStats?.completed || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-100 dark:bg-yellow-900/30">
                <Clock className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">In Queue</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {queueStats?.waiting || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/30">
                <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Active</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {queueStats?.active || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Generations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Recent Generations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentGenerations.length === 0 ? (
              <div className="py-8 text-center text-gray-500 dark:text-gray-400">
                <FileText className="mx-auto h-12 w-12 opacity-50" />
                <p className="mt-2">No generations yet</p>
                <p className="text-sm">Create a project and start generating articles</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentGenerations.map((gen) => (
                  <Link
                    key={gen._id}
                    href={`/dashboard/generation/${gen._id}`}
                    className="block rounded-lg border border-gray-100 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium text-gray-900 dark:text-white">
                          {gen.config.mainKeyword}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {typeof gen.projectId === 'object' ? gen.projectId.name : 'Unknown Project'}
                        </p>
                      </div>
                      <div className="ml-4 flex items-center gap-3">
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
                        <ArrowRight className="h-4 w-4 text-gray-400" />
                      </div>
                    </div>
                    {gen.status !== GenerationStatus.COMPLETED &&
                      gen.status !== GenerationStatus.FAILED &&
                      gen.status !== GenerationStatus.QUEUED && (
                        <ProgressBar value={gen.progress} className="mt-2" size="sm" />
                      )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Projects Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5" />
              Your Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <div className="py-8 text-center text-gray-500 dark:text-gray-400">
                <FolderPlus className="mx-auto h-12 w-12 opacity-50" />
                <p className="mt-2">No projects yet</p>
                <Link href="/dashboard/projects">
                  <Button variant="secondary" size="sm" className="mt-4">
                    Create First Project
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {projects.slice(0, 5).map((project) => (
                  <Link
                    key={project._id}
                    href={`/dashboard/project/${project._id}`}
                    className="flex items-center justify-between rounded-lg border border-gray-100 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                  >
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {project.name}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {project.generationsCount || 0} generations
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400">
                        {formatRelativeTime(project.createdAt)}
                      </span>
                      <ArrowRight className="h-4 w-4 text-gray-400" />
                    </div>
                  </Link>
                ))}
                {projects.length > 5 && (
                  <Link
                    href="/dashboard/projects"
                    className="block text-center text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    View all projects
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

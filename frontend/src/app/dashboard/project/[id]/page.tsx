/**
 * Single Project Page with Generation Form
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Rocket,
  FileText,
  Link as LinkIcon,
  Settings2,
} from 'lucide-react';

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Button,
  Input,
  TextArea,
  Select,
  Modal,
  ModalFooter,
  Badge,
  ProgressBar,
} from '@/components/ui';
import { projectsApi, generationsApi, apiKeysApi } from '@/lib/api';
import { Project, Generation, ArticleType, LinkDisplayType, LinkPosition, GenerationStatus } from '@/types';
import { formatRelativeTime, getStatusLabel, cn } from '@/lib/utils';

const generationSchema = z.object({
  mainKeyword: z.string().min(1, 'Main keyword is required'),
  articleType: z.string(),
  keywords: z.string().optional(),
  language: z.string(),
  region: z.string(),
  lsiKeywords: z.string().optional(),
  comment: z.string().optional(),
  continuousMode: z.boolean(),
  linksAsList: z.boolean(),
  linksListPosition: z.string().optional(),
  internalLinks: z.array(z.object({
    anchor: z.string().optional(),
    url: z.string().url('Invalid URL'),
    isAnchorless: z.boolean(),
    displayType: z.string(),
    position: z.string(),
  })),
});

type GenerationFormData = z.infer<typeof generationSchema>;

const articleTypeOptions = [
  { value: 'informational', label: 'Informational' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'transactional', label: 'Transactional' },
  { value: 'navigational', label: 'Navigational' },
  { value: 'review', label: 'Review' },
  { value: 'comparison', label: 'Comparison' },
  { value: 'howto', label: 'How-To Guide' },
  { value: 'listicle', label: 'Listicle' },
];

const linkDisplayOptions = [
  { value: 'inline', label: 'Inline (in text)' },
  { value: 'list_end', label: 'List at end' },
  { value: 'list_start', label: 'List at start' },
  { value: 'sidebar', label: 'Sidebar' },
];

const linkPositionOptions = [
  { value: 'intro', label: 'Introduction' },
  { value: 'body', label: 'Body' },
  { value: 'conclusion', label: 'Conclusion' },
  { value: 'any', label: 'Any position' },
];

const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Russian' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'uk', label: 'Ukrainian' },
];

const regionOptions = [
  { value: 'us', label: 'United States' },
  { value: 'gb', label: 'United Kingdom' },
  { value: 'de', label: 'Germany' },
  { value: 'fr', label: 'France' },
  { value: 'ru', label: 'Russia' },
  { value: 'es', label: 'Spain' },
  { value: 'it', label: 'Italy' },
  { value: 'nl', label: 'Netherlands' },
  { value: 'pl', label: 'Poland' },
  { value: 'ua', label: 'Ukraine' },
];

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<(Project & { generations: Generation[] }) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleteGenerationId, setDeleteGenerationId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GenerationFormData>({
    resolver: zodResolver(generationSchema),
    defaultValues: {
      articleType: 'informational',
      language: 'en',
      region: 'us',
      continuousMode: true,
      linksAsList: false,
      internalLinks: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'internalLinks',
  });

  const linksAsList = watch('linksAsList');

  const fetchProject = async () => {
    try {
      const response = await projectsApi.getOne(projectId);
      if (response.success) {
        setProject(response.data as Project & { generations: Generation[] });
      }
    } catch (error) {
      toast.error('Failed to load project');
      router.push('/dashboard/projects');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProject();
    const interval = setInterval(fetchProject, 10000);
    return () => clearInterval(interval);
  }, [projectId]);

  const onSubmit = async (data: GenerationFormData) => {
    try {
      // Check API keys status before starting generation
      const keysResponse = await apiKeysApi.getMaskedKeys();
      if (keysResponse.success && keysResponse.data) {
        const keys = keysResponse.data as {
          openRouter: { isConfigured: boolean; isValid: boolean; lastChecked?: string | null };
          firecrawl: { isConfigured: boolean; isValid: boolean; lastChecked?: string | null };
        };

        // Check OpenRouter
        if (!keys.openRouter.isConfigured) {
          toast.error('OpenRouter API key is not configured. Please add it in Settings.');
          router.push('/dashboard/settings');
          return;
        }
        if (!keys.openRouter.lastChecked) {
          toast.error('OpenRouter API key has not been tested. Please test it in Settings.');
          router.push('/dashboard/settings');
          return;
        }
        if (!keys.openRouter.isValid) {
          toast.error('OpenRouter API key is not valid. Please update it in Settings.');
          router.push('/dashboard/settings');
          return;
        }

        // Check Firecrawl
        if (!keys.firecrawl.isConfigured) {
          toast.error('Firecrawl API key is not configured. Please add it in Settings.');
          router.push('/dashboard/settings');
          return;
        }
        if (!keys.firecrawl.lastChecked) {
          toast.error('Firecrawl API key has not been tested. Please test it in Settings.');
          router.push('/dashboard/settings');
          return;
        }
        if (!keys.firecrawl.isValid) {
          toast.error('Firecrawl API key is not valid. Please update it in Settings.');
          router.push('/dashboard/settings');
          return;
        }
      }

      const config = {
        mainKeyword: data.mainKeyword,
        articleType: data.articleType,
        keywords: data.keywords?.split(',').map((k) => k.trim()).filter(Boolean) || [],
        language: data.language,
        region: data.region,
        lsiKeywords: data.lsiKeywords?.split(',').map((k) => k.trim()).filter(Boolean) || [],
        comment: data.comment,
        continuousMode: data.continuousMode,
        internalLinks: data.internalLinks,
        linksAsList: data.linksAsList,
        linksListPosition: data.linksListPosition,
      };

      const response = await generationsApi.create(projectId, config);

      if (response.success) {
        toast.success('Generation started!');
        setIsFormOpen(false);
        reset();
        fetchProject();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start generation';
      toast.error(message);
    }
  };

  const addLink = () => {
    append({
      anchor: '',
      url: '',
      isAnchorless: false,
      displayType: 'inline',
      position: 'body',
    });
  };

  const handleDeleteGeneration = async () => {
    if (!deleteGenerationId) return;

    setIsDeleting(true);
    try {
      const response = await generationsApi.delete(deleteGenerationId);
      if (response.success) {
        toast.success('Generation deleted');
        setDeleteGenerationId(null);
        fetchProject();
      }
    } catch (error) {
      toast.error('Failed to delete generation');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-64 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-40 rounded-xl bg-gray-200 dark:bg-gray-700" />
      </div>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/projects">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {project.name}
            </h1>
            {project.description && (
              <p className="mt-1 text-gray-600 dark:text-gray-400">
                {project.description}
              </p>
            )}
          </div>
        </div>
        <Button
          leftIcon={<Rocket className="h-4 w-4" />}
          onClick={() => setIsFormOpen(true)}
        >
          New Generation
        </Button>
      </div>

      {/* Generations List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Generations ({project.generations?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!project.generations?.length ? (
            <div className="py-12 text-center">
              <Rocket className="mx-auto h-16 w-16 text-gray-300 dark:text-gray-600" />
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
                No generations yet
              </h3>
              <p className="mt-2 text-gray-500 dark:text-gray-400">
                Start your first article generation in this project
              </p>
              <Button
                className="mt-6"
                leftIcon={<Rocket className="h-4 w-4" />}
                onClick={() => setIsFormOpen(true)}
              >
                Start First Generation
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {project.generations.map((gen) => (
                <div
                  key={gen._id}
                  className="rounded-lg border border-gray-100 p-4 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                >
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/dashboard/generation/${gen._id}`}
                      className="flex-1 min-w-0"
                    >
                      <div className="flex items-center gap-3">
                        <h4 className="truncate font-medium text-gray-900 dark:text-white">
                          {gen.config.mainKeyword}
                        </h4>
                        <Badge
                          variant={
                            gen.status === GenerationStatus.COMPLETED
                              ? 'success'
                              : gen.status === GenerationStatus.FAILED
                              ? 'error'
                              : gen.status === GenerationStatus.QUEUED
                              ? 'default'
                              : 'info'
                          }
                          size="sm"
                        >
                          {getStatusLabel(gen.status)}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        <span>{gen.config.articleType}</span>
                        <span>{gen.config.language.toUpperCase()}</span>
                        <span>{formatRelativeTime(gen.createdAt)}</span>
                      </div>
                    </Link>
                    <div className="flex items-center gap-2 ml-4">
                      {gen.status !== GenerationStatus.COMPLETED &&
                        gen.status !== GenerationStatus.FAILED &&
                        gen.status !== GenerationStatus.QUEUED && (
                          <div className="w-32">
                            <ProgressBar value={gen.progress} size="sm" />
                          </div>
                        )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteGenerationId(gen._id);
                        }}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generation Form Modal */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title="New Article Generation"
        description="Configure your SEO article generation settings"
        size="xl"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
          {/* Main Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Basic Settings
            </h3>

            <Input
              label="Main Keyword *"
              placeholder="e.g., best coffee makers 2024"
              error={errors.mainKeyword?.message}
              {...register('mainKeyword')}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Article Type"
                options={articleTypeOptions}
                {...register('articleType')}
              />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  label="Language"
                  options={languageOptions}
                  {...register('language')}
                />
                <Select
                  label="Region"
                  options={regionOptions}
                  {...register('region')}
                />
              </div>
            </div>

            <Input
              label="Additional Keywords"
              placeholder="keyword1, keyword2, keyword3"
              helperText="Comma-separated keywords to include in the article"
              {...register('keywords')}
            />

            <Input
              label="LSI Keywords"
              placeholder="related1, related2, related3"
              helperText="Latent Semantic Indexing keywords"
              {...register('lsiKeywords')}
            />

            <TextArea
              label="Comment / Instructions"
              placeholder="Special instructions for the AI..."
              rows={2}
              {...register('comment')}
            />

            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <input
                type="checkbox"
                className="rounded border-gray-300 h-5 w-5"
                {...register('continuousMode')}
              />
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Continuous Mode
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Run full pipeline without pauses (SERP → Structure → Questions → Writing → Review → Done)
                </p>
              </div>
            </label>
          </div>

          {/* Internal Links */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Internal Links
              </h3>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={addLink}
              >
                Add Link
              </Button>
            </div>

            {fields.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      {...register('linksAsList')}
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      Display links as a list
                    </span>
                  </label>
                  {linksAsList && (
                    <Select
                      options={linkPositionOptions}
                      className="w-40"
                      {...register('linksListPosition')}
                    />
                  )}
                </div>

                {fields.map((field, index) => (
                  <Card key={field.id} className="p-4">
                    <div className="flex items-start gap-4">
                      <LinkIcon className="mt-2 h-5 w-5 text-gray-400" />
                      <div className="flex-1 space-y-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input
                            placeholder="URL *"
                            error={errors.internalLinks?.[index]?.url?.message}
                            {...register(`internalLinks.${index}.url`)}
                          />
                          <Input
                            placeholder="Anchor text (optional)"
                            {...register(`internalLinks.${index}.anchor`)}
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300"
                              {...register(`internalLinks.${index}.isAnchorless`)}
                            />
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              No anchor (bare URL)
                            </span>
                          </label>
                          <Select
                            options={linkDisplayOptions}
                            className="w-36"
                            {...register(`internalLinks.${index}.displayType`)}
                          />
                          <Select
                            options={linkPositionOptions}
                            className="w-36"
                            {...register(`internalLinks.${index}.position`)}
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {fields.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No internal links added. Click &quot;Add Link&quot; to include links in your article.
              </p>
            )}
          </div>

          <ModalFooter className="sticky bottom-0 bg-white dark:bg-gray-800 pt-4 border-t">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={isSubmitting}
              leftIcon={<Rocket className="h-4 w-4" />}
            >
              Start Generation
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteGenerationId}
        onClose={() => setDeleteGenerationId(null)}
        title="Delete Generation"
        description="Are you sure you want to delete this generation? This action cannot be undone."
        size="sm"
      >
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setDeleteGenerationId(null)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            isLoading={isDeleting}
            leftIcon={<Trash2 className="h-4 w-4" />}
            onClick={handleDeleteGeneration}
          >
            Delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

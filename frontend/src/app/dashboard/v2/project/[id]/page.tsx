/**
 * Generation 2.0 — New generation form for a project
 * Guided mode (default): required fields visible, optional fields collapsed.
 */

'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Atom,
  Rocket,
  ChevronDown,
  ChevronUp,
  X,
  Plus,
  Link as LinkIcon,
  Trash2,
  Loader2,
} from 'lucide-react';

import { Card, CardContent, Button, Input, TextArea, Select } from '@/components/ui';
import { ModelSelector } from '@/components/ModelSelector';
import { projectsApi, generationsApi, apiKeysApi } from '@/lib/api';
import { Project } from '@/types';
import { cn } from '@/lib/utils';

/* ─── Validation schema ─── */

const v2Schema = z.object({
  mainKeyword: z.string().trim().min(3, 'At least 3 characters').max(160),
  articleType: z.enum(['informational', 'commercial', 'howto', 'comparison', 'review']),
  language: z.string().min(2),
  country: z.string().min(2),
  minWords: z.number().int().min(600).max(5000),
  maxWords: z.number().int().min(800).max(7000),
  model: z.string().min(1),

  // optional
  secondaryKeywords: z.array(z.string().trim().min(2).max(120)).max(10),
  internalLinks: z.array(z.object({
    url: z.string().url('Invalid URL'),
    anchor: z.string().max(120).optional(),
  })).max(20),
  audience: z.string().trim().max(120).optional(),
  comment: z.string().trim().max(1500).optional(),
  mustCover: z.array(z.string().trim().min(2).max(120)).max(8),
  mustAvoid: z.array(z.string().trim().min(2).max(120)).max(8),
}).refine(d => d.maxWords >= d.minWords, {
  message: 'Max words must be ≥ min words',
  path: ['maxWords'],
}).refine(d => d.maxWords - d.minWords >= 200, {
  message: 'Range must be at least 200 words',
  path: ['maxWords'],
});

type V2FormData = z.infer<typeof v2Schema>;

/* ─── Options ─── */

const articleTypeOptions = [
  { value: 'informational', label: 'Informational' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'howto', label: 'How-To Guide' },
  { value: 'comparison', label: 'Comparison' },
  { value: 'review', label: 'Review' },
];

const languageOptions = [
  { value: 'de', label: 'German' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Russian' },
  { value: 'pl', label: 'Polish' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'uk', label: 'Ukrainian' },
];

const countryOptions = [
  { value: 'DE', label: 'Germany' },
  { value: 'AT', label: 'Austria' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'PL', label: 'Poland' },
  { value: 'RU', label: 'Russia' },
  { value: 'FR', label: 'France' },
  { value: 'ES', label: 'Spain' },
  { value: 'IT', label: 'Italy' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'UA', label: 'Ukraine' },
];

/* ─── Tag input component ─── */

const TagInput = ({
  value,
  onChange,
  placeholder,
  max,
  label,
  helperText,
  error,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max: number;
  label?: string;
  helperText?: string;
  error?: string;
}) => {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const v = inputValue.trim();
    if (!v || value.length >= max) return;
    const deduped = value.filter(x => x.toLowerCase() !== v.toLowerCase());
    onChange([...deduped, v]);
    setInputValue('');
  };

  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    if (e.key === 'Backspace' && !inputValue && value.length > 0) remove(value.length - 1);
  };

  return (
    <div className="w-full">
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          <span className="ml-1 text-xs font-normal text-gray-400">({value.length}/{max})</span>
        </label>
      )}
      <div
        className={cn(
          'flex min-h-[42px] w-full flex-wrap gap-1.5 rounded-lg border bg-white px-3 py-2 transition-colors',
          'focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20',
          'dark:border-gray-600 dark:bg-gray-800',
          error ? 'border-red-500' : 'border-gray-300'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/20 dark:text-violet-300"
          >
            {tag}
            <button type="button" onClick={() => remove(i)} className="text-violet-400 hover:text-violet-600">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {value.length < max && (
          <input
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={onKey}
            onBlur={add}
            placeholder={value.length === 0 ? placeholder : ''}
            className="min-w-[120px] flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white"
          />
        )}
      </div>
      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
      {helperText && !error && <p className="mt-1 text-xs text-gray-500">{helperText}</p>}
    </div>
  );
};

/* ─── Section header with collapse toggle ─── */

const SectionToggle = ({
  label,
  open,
  onToggle,
  count,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  count?: number;
}) => (
  <button
    type="button"
    onClick={onToggle}
    className="flex w-full items-center justify-between rounded-lg border border-dashed border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
  >
    <span>
      {label}
      {count != null && count > 0 && (
        <span className="ml-2 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/20 dark:text-violet-300">
          {count}
        </span>
      )}
    </span>
    {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
  </button>
);

/* ─── Page component ─── */

export default function V2ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [links, setLinks] = useState<Array<{ url: string; anchor: string }>>([]);

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<V2FormData>({
    resolver: zodResolver(v2Schema),
    defaultValues: {
      mainKeyword: '',
      articleType: 'informational',
      language: 'de',
      country: 'DE',
      minWords: 1200,
      maxWords: 1800,
      model: 'openai/gpt-5.2',
      secondaryKeywords: [],
      internalLinks: [],
      audience: '',
      comment: '',
      mustCover: [],
      mustAvoid: [],
    },
  });

  useEffect(() => {
    projectsApi.getOne(projectId)
      .then(res => { if (res.success) setProject(res.data as Project); })
      .catch(() => router.push('/dashboard/v2'))
      .finally(() => setIsLoading(false));
  }, [projectId, router]);

  const addLink = () => setLinks(l => [...l, { url: '', anchor: '' }]);
  const removeLink = (i: number) => setLinks(l => l.filter((_, idx) => idx !== i));

  const secondaryKeywords = watch('secondaryKeywords');
  const mustCover = watch('mustCover');
  const mustAvoid = watch('mustAvoid');
  const audience = watch('audience');
  const comment = watch('comment');

  const optionalCount =
    secondaryKeywords.length + mustCover.length + mustAvoid.length +
    links.length + (audience ? 1 : 0) + (comment ? 1 : 0);

  const onSubmit = async (data: V2FormData) => {
    try {
      // Validate API keys
      const keysRes = await apiKeysApi.getMaskedKeys();
      if (keysRes.success && keysRes.data) {
        const keys = keysRes.data as {
          openRouter: { isConfigured: boolean; isValid: boolean; lastChecked?: string | null };
          firecrawl: { isConfigured: boolean; isValid: boolean; lastChecked?: string | null };
        };
        if (!keys.openRouter.isConfigured || !keys.openRouter.isValid) {
          toast.error('OpenRouter API key not configured or invalid.');
          router.push('/dashboard/settings');
          return;
        }
        if (!keys.firecrawl.isConfigured || !keys.firecrawl.isValid) {
          toast.error('Firecrawl API key not configured or invalid.');
          router.push('/dashboard/settings');
          return;
        }
      }

      // Validate links
      const validLinks = links.filter(l => l.url.trim());
      for (const l of validLinks) {
        try { new URL(l.url); } catch {
          toast.error(`Invalid URL: ${l.url}`);
          return;
        }
      }

      const res = await generationsApi.create(projectId, {
        mainKeyword: data.mainKeyword,
        articleType: data.articleType,
        keywords: data.secondaryKeywords,
        language: data.language,
        region: data.country.toLowerCase(),
        lsiKeywords: [],
        comment: data.comment || undefined,
        audience: data.audience || undefined,
        mustCover: data.mustCover.length > 0 ? data.mustCover : undefined,
        mustAvoid: data.mustAvoid.length > 0 ? data.mustAvoid : undefined,
        minWords: data.minWords,
        maxWords: data.maxWords,
        model: data.model,
        mode: 'v2',
        internalLinks: validLinks.map(l => ({
          url: l.url.trim(),
          anchor: l.anchor.trim() || undefined,
          isAnchorless: !l.anchor.trim(),
          displayType: 'inline',
          position: 'body',
        })),
        linksAsList: false,
      });

      if (res.success) {
        const gen = res.data as { id?: string; generation?: { _id: string } };
        const genId = gen.id || gen.generation?._id;
        toast.success('Generation 2.0 started!');
        router.push(genId ? `/dashboard/v2/generation/${genId}` : '/dashboard/v2');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start generation');
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 pb-5">
        <Link
          href="/dashboard/v2"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" /> Generation 2.0
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <div className="flex items-center gap-2">
          <Atom className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            New generation — {project?.name ?? projectId}
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 pb-10">
        <Card>
          <CardContent className="space-y-4 p-5">
            {/* Main keyword */}
            <Input
              label="Main keyword *"
              placeholder="e.g. ghostwriter bachelorarbeit"
              error={errors.mainKeyword?.message}
              {...register('mainKeyword')}
            />

            {/* Article type + Language + Country */}
            <div className="grid grid-cols-3 gap-3">
              <Controller
                name="articleType"
                control={control}
                render={({ field }) => (
                  <Select
                    label="Article type *"
                    options={articleTypeOptions}
                    error={errors.articleType?.message}
                    {...field}
                  />
                )}
              />
              <Controller
                name="language"
                control={control}
                render={({ field }) => (
                  <Select
                    label="Language *"
                    options={languageOptions}
                    error={errors.language?.message}
                    {...field}
                  />
                )}
              />
              <Controller
                name="country"
                control={control}
                render={({ field }) => (
                  <Select
                    label="Country *"
                    options={countryOptions}
                    error={errors.country?.message}
                    {...field}
                  />
                )}
              />
            </div>

            {/* Word count */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Min words *"
                type="number"
                error={errors.minWords?.message}
                {...register('minWords', { valueAsNumber: true })}
              />
              <Input
                label="Max words *"
                type="number"
                error={errors.maxWords?.message}
                {...register('maxWords', { valueAsNumber: true })}
              />
            </div>

            {/* Model */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                AI model *
              </label>
              <Controller
                name="model"
                control={control}
                render={({ field }) => (
                  <ModelSelector value={field.value} onChange={field.onChange} />
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Optional section toggle */}
        <SectionToggle
          label="Optional settings"
          open={optionalOpen}
          onToggle={() => setOptionalOpen(o => !o)}
          count={optionalCount}
        />

        {optionalOpen && (
          <Card>
            <CardContent className="space-y-5 p-5">
              {/* Secondary keywords */}
              <Controller
                name="secondaryKeywords"
                control={control}
                render={({ field }) => (
                  <TagInput
                    label="Secondary keywords"
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Type and press Enter or comma…"
                    max={10}
                    helperText="Additional SEO keywords. Press Enter or comma to add."
                    error={errors.secondaryKeywords?.message}
                  />
                )}
              />

              {/* Audience */}
              <Input
                label="Audience"
                placeholder="e.g. Studierende in Deutschland"
                helperText="Who is this article for? Max 120 chars."
                error={errors.audience?.message}
                {...register('audience')}
              />

              {/* Must cover */}
              <Controller
                name="mustCover"
                control={control}
                render={({ field }) => (
                  <TagInput
                    label="Must cover"
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="legality, costs, risks…"
                    max={8}
                    helperText="Topics that must be addressed in the article."
                    error={errors.mustCover?.message}
                  />
                )}
              />

              {/* Must avoid */}
              <Controller
                name="mustAvoid"
                control={control}
                render={({ field }) => (
                  <TagInput
                    label="Must avoid"
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="guarantees, aggressive sales…"
                    max={8}
                    helperText="Claims or phrases the article must never include."
                    error={errors.mustAvoid?.message}
                  />
                )}
              />

              {/* Comment */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Comment
                </label>
                <TextArea
                  placeholder="Tone instructions, brand requirements, anything else…"
                  rows={3}
                  {...register('comment')}
                />
                {errors.comment && <p className="mt-1 text-sm text-red-500">{errors.comment.message}</p>}
              </div>

              {/* Internal links */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Internal links
                    <span className="ml-1 text-xs font-normal text-gray-400">({links.length}/20)</span>
                  </label>
                  {links.length < 20 && (
                    <button
                      type="button"
                      onClick={addLink}
                      className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add link
                    </button>
                  )}
                </div>

                {links.length === 0 ? (
                  <button
                    type="button"
                    onClick={addLink}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 py-3 text-sm text-gray-400 hover:border-gray-300 hover:text-gray-500 dark:border-gray-700 dark:hover:border-gray-600"
                  >
                    <LinkIcon className="h-4 w-4" /> Add internal link
                  </button>
                ) : (
                  <div className="space-y-2">
                    {links.map((link, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="flex-1 space-y-2">
                          <input
                            type="url"
                            placeholder="https://example.com/page"
                            value={link.url}
                            onChange={e => setLinks(l => l.map((x, idx) => idx === i ? { ...x, url: e.target.value } : x))}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                          />
                          <input
                            type="text"
                            placeholder="Anchor text (optional)"
                            value={link.anchor}
                            onChange={e => setLinks(l => l.map((x, idx) => idx === i ? { ...x, anchor: e.target.value } : x))}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLink(i)}
                          className="mt-2 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Submit */}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 focus:ring-violet-500/20"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            {isSubmitting ? 'Starting…' : 'Generate 2.0'}
          </Button>
        </div>
      </form>
    </div>
  );
}

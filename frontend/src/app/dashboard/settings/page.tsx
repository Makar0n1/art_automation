/**
 * Settings Page - API Keys Management with PIN Protection
 */

'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { AxiosError } from 'axios';
import {
  Key,
  Check,
  X,
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
  Database,
  Flame,
  Bot,
  Lock,
  Edit3,
  Shield,
} from 'lucide-react';

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Input,
  Badge,
  Modal,
} from '@/components/ui';
import { apiKeysApi, authApi } from '@/lib/api';
import { MaskedApiKeys } from '@/types';
import { formatDate } from '@/lib/utils';

type EditMode = 'openRouter' | 'supabase' | 'firecrawl' | null;

export default function SettingsPage() {
  const [maskedKeys, setMaskedKeys] = useState<MaskedApiKeys | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState({
    openRouter: false,
    supabase: false,
    firecrawl: false,
  });

  // PIN modal state
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [isPinVerifying, setIsPinVerifying] = useState(false);
  const [pendingEditMode, setPendingEditMode] = useState<EditMode>(null);
  const [hasPinConfigured, setHasPinConfigured] = useState(false);
  const [verifiedPin, setVerifiedPin] = useState<string | null>(null);

  // Edit mode state
  const [editMode, setEditMode] = useState<EditMode>(null);

  const openRouterForm = useForm({ defaultValues: { apiKey: '' } });
  const supabaseForm = useForm({ defaultValues: { url: '', secretKey: '' } });
  const firecrawlForm = useForm({ defaultValues: { apiKey: '' } });

  const fetchMaskedKeys = async () => {
    try {
      const response = await apiKeysApi.getMaskedKeys();
      if (response.success) {
        setMaskedKeys(response.data as MaskedApiKeys);
      }
    } catch (error) {
      toast.error('Failed to load API keys');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPinStatus = async () => {
    try {
      const response = await authApi.getPinStatus();
      if (response.success) {
        setHasPinConfigured((response.data as { hasPinConfigured: boolean }).hasPinConfigured);
      }
    } catch (error) {
      console.error('Failed to fetch PIN status');
    }
  };

  useEffect(() => {
    fetchMaskedKeys();
    fetchPinStatus();
  }, []);

  const handleEditClick = (service: EditMode) => {
    if (!hasPinConfigured) {
      // No PIN configured, allow direct edit
      setEditMode(service);
      return;
    }

    // PIN is configured, verify first
    setPendingEditMode(service);
    setIsPinModalOpen(true);
    setPinInput('');
  };

  const handlePinVerify = async () => {
    if (!pinInput || pinInput.length < 4) {
      toast.error('Please enter a valid PIN');
      return;
    }

    setIsPinVerifying(true);
    try {
      const response = await apiKeysApi.verifyPin(pinInput);
      if (response.success) {
        setVerifiedPin(pinInput);
        setEditMode(pendingEditMode);
        setIsPinModalOpen(false);
        toast.success('PIN verified');
      } else {
        toast.error(response.error || 'Invalid PIN');
      }
    } catch (error) {
      // Extract error message from axios error response (403 for wrong PIN or blocked IP)
      if (error instanceof AxiosError && error.response?.data) {
        const data = error.response.data as { error?: string; isBlocked?: boolean };
        if (data.isBlocked) {
          toast.error(data.error || 'Too many failed attempts. Your IP has been blocked.', { duration: 6000 });
          setIsPinModalOpen(false);
        } else {
          toast.error(data.error || 'Invalid PIN');
        }
      } else {
        toast.error('PIN verification failed');
      }
    } finally {
      setIsPinVerifying(false);
    }
  };

  const handleCancelEdit = () => {
    setEditMode(null);
    setVerifiedPin(null);
    openRouterForm.reset();
    supabaseForm.reset();
    firecrawlForm.reset();
  };

  const saveOpenRouter = async (data: { apiKey: string }) => {
    if (!data.apiKey) {
      toast.error('Please enter an API key');
      return;
    }
    try {
      const response = await apiKeysApi.updateOpenRouter(data.apiKey, verifiedPin || undefined);
      if (response.success) {
        toast.success('OpenRouter API key saved');
        openRouterForm.reset();
        setEditMode(null);
        setVerifiedPin(null);
        fetchMaskedKeys();
      } else {
        toast.error(response.error || 'Failed to save API key');
      }
    } catch (error) {
      toast.error('Failed to save API key');
    }
  };

  const testOpenRouter = async () => {
    setTestingKey('openRouter');
    try {
      const response = await apiKeysApi.testOpenRouter();
      if (response.success) {
        toast.success(response.message || 'API key is valid');
      } else {
        toast.error(response.error || 'Invalid API key');
      }
      fetchMaskedKeys();
    } catch (error) {
      toast.error('Test failed');
    } finally {
      setTestingKey(null);
    }
  };

  const saveSupabase = async (data: { url: string; secretKey: string }) => {
    if (!data.url || !data.secretKey) {
      toast.error('Please enter both URL and secret key');
      return;
    }
    try {
      const response = await apiKeysApi.updateSupabase(data.url, data.secretKey, verifiedPin || undefined);
      if (response.success) {
        toast.success('Supabase credentials saved');
        supabaseForm.reset();
        setEditMode(null);
        setVerifiedPin(null);
        fetchMaskedKeys();
      } else {
        toast.error(response.error || 'Failed to save credentials');
      }
    } catch (error) {
      toast.error('Failed to save credentials');
    }
  };

  const testSupabase = async () => {
    setTestingKey('supabase');
    try {
      const response = await apiKeysApi.testSupabase();
      if (response.success) {
        toast.success(response.message || 'Credentials are valid');
      } else {
        toast.error(response.error || 'Invalid credentials');
      }
      fetchMaskedKeys();
    } catch (error) {
      toast.error('Test failed');
    } finally {
      setTestingKey(null);
    }
  };

  const saveFirecrawl = async (data: { apiKey: string }) => {
    if (!data.apiKey) {
      toast.error('Please enter an API key');
      return;
    }
    try {
      const response = await apiKeysApi.updateFirecrawl(data.apiKey, verifiedPin || undefined);
      if (response.success) {
        toast.success('Firecrawl API key saved');
        firecrawlForm.reset();
        setEditMode(null);
        setVerifiedPin(null);
        fetchMaskedKeys();
      } else {
        toast.error(response.error || 'Failed to save API key');
      }
    } catch (error) {
      toast.error('Failed to save API key');
    }
  };

  const testFirecrawl = async () => {
    setTestingKey('firecrawl');
    try {
      const response = await apiKeysApi.testFirecrawl();
      if (response.success) {
        toast.success(response.message || 'API key is valid');
      } else {
        toast.error(response.error || 'Invalid API key');
      }
      fetchMaskedKeys();
    } catch (error) {
      toast.error('Test failed');
    } finally {
      setTestingKey(null);
    }
  };

  const StatusBadge = ({ isConfigured, isValid, lastChecked }: { isConfigured: boolean; isValid: boolean; lastChecked?: string | null }) => {
    const badgeClass = "text-base px-4 py-2 rounded-full min-w-[100px] justify-center";
    if (!isConfigured) {
      return <Badge variant="default" className={badgeClass}>Not Configured</Badge>;
    }
    // Key is configured but never tested
    if (!lastChecked) {
      return <Badge variant="default" className={badgeClass}>Not Tested</Badge>;
    }
    // Key was tested
    if (isValid) {
      return (
        <Badge variant="success" className={badgeClass}>
          <Check className="mr-1.5 h-5 w-5" />
          Valid
        </Badge>
      );
    }
    return (
      <Badge variant="error" className={badgeClass}>
        <X className="mr-1.5 h-5 w-5" />
        Not Valid
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-64 rounded-xl bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Configure your API keys for external services
        </p>
      </div>

      {/* PIN Verification Modal */}
      <Modal
        isOpen={isPinModalOpen}
        onClose={() => {
          setIsPinModalOpen(false);
          setPendingEditMode(null);
          setPinInput('');
        }}
        title="Enter PIN to Edit"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-700 dark:text-amber-300">
              API key changes are protected by PIN
            </p>
          </div>
          <Input
            label="PIN Code"
            type="password"
            placeholder="Enter your PIN"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePinVerify()}
            autoFocus
          />
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setIsPinModalOpen(false);
                setPendingEditMode(null);
                setPinInput('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePinVerify}
              disabled={isPinVerifying || pinInput.length < 4}
              leftIcon={isPinVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            >
              Verify PIN
            </Button>
          </div>
        </div>
      </Modal>
      {/* OpenRouter */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/30">
              <Bot className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-xl">OpenRouter</CardTitle>
              <CardDescription>AI model provider</CardDescription>
            </div>
          </div>
          {maskedKeys && <StatusBadge isConfigured={maskedKeys.openRouter.isConfigured} isValid={maskedKeys.openRouter.isValid} lastChecked={maskedKeys.openRouter.lastChecked} />}
        </CardHeader>
        <CardContent>
          {editMode === 'openRouter' ? (
            <form onSubmit={openRouterForm.handleSubmit(saveOpenRouter)} className="space-y-4">
              <div className="relative">
                <Input
                  label="New API Key"
                  type={showKeys.openRouter ? 'text' : 'password'}
                  placeholder="sk-or-v1-..."
                  {...openRouterForm.register('apiKey')}
                  autoFocus
                  className="pr-12"
                />
                <button
                  type="button"
                  className="absolute right-2 top-[26px] bottom-0 flex items-center justify-center w-10 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
                  onClick={() => setShowKeys((s) => ({ ...s, openRouter: !s.openRouter }))}
                >
                  {showKeys.openRouter ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={handleCancelEdit}>
                  Cancel
                </Button>
                <Button
                  onClick={openRouterForm.handleSubmit(saveOpenRouter)}
                  disabled={openRouterForm.formState.isSubmitting}
                >
                  Save Key
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex justify-between items-end">
              <div className="space-y-2">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">API Key</p>
                  <p className="font-mono text-lg text-gray-900 dark:text-white">
                    {maskedKeys?.openRouter.isConfigured ? maskedKeys.openRouter.maskedKey : '—'}
                  </p>
                </div>
                {maskedKeys?.openRouter.lastChecked && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Last tested: {formatDate(maskedKeys.openRouter.lastChecked)}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 ml-4">
                <Button
                  className="w-full"
                  onClick={() => handleEditClick('openRouter')}
                  leftIcon={<Edit3 className="h-4 w-4" />}
                >
                  {maskedKeys?.openRouter.isConfigured ? 'Change' : 'Add'}
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={testOpenRouter}
                  disabled={!maskedKeys?.openRouter.isConfigured || testingKey === 'openRouter'}
                  leftIcon={
                    testingKey === 'openRouter' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )
                  }
                >
                  Test
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Supabase */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/30">
              <Database className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <CardTitle className="text-xl">Supabase</CardTitle>
              <CardDescription>Vector database</CardDescription>
            </div>
          </div>
          {maskedKeys && <StatusBadge isConfigured={maskedKeys.supabase.isConfigured} isValid={maskedKeys.supabase.isValid} lastChecked={maskedKeys.supabase.lastChecked} />}
        </CardHeader>
        <CardContent>
          {editMode === 'supabase' ? (
            <form onSubmit={supabaseForm.handleSubmit(saveSupabase)} className="space-y-4">
              <Input
                label="Project URL"
                type="url"
                placeholder="https://your-project.supabase.co"
                defaultValue={maskedKeys?.supabase.url || ''}
                {...supabaseForm.register('url')}
              />
              <div className="relative">
                <Input
                  label="Service Role Key (Secret)"
                  type={showKeys.supabase ? 'text' : 'password'}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  {...supabaseForm.register('secretKey')}
                  className="pr-12"
                />
                <button
                  type="button"
                  className="absolute right-2 top-[26px] bottom-0 flex items-center justify-center w-10 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
                  onClick={() => setShowKeys((s) => ({ ...s, supabase: !s.supabase }))}
                >
                  {showKeys.supabase ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={handleCancelEdit}>
                  Cancel
                </Button>
                <Button
                  onClick={supabaseForm.handleSubmit(saveSupabase)}
                  disabled={supabaseForm.formState.isSubmitting}
                >
                  Save
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex justify-between items-end">
              <div className="space-y-2 flex-1 min-w-0 mr-4">
                <div className="flex gap-8">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Service Role Key</p>
                    <p className="font-mono text-lg text-gray-900 dark:text-white">
                      {maskedKeys?.supabase.isConfigured ? maskedKeys.supabase.maskedKey : '—'}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Project URL</p>
                    <p className="font-mono text-lg text-gray-900 dark:text-white truncate">
                      {maskedKeys?.supabase.isConfigured ? maskedKeys.supabase.url : '—'}
                    </p>
                  </div>
                </div>
                {maskedKeys?.supabase.lastChecked && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Last tested: {formatDate(maskedKeys.supabase.lastChecked)}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  onClick={() => handleEditClick('supabase')}
                  leftIcon={<Edit3 className="h-4 w-4" />}
                >
                  {maskedKeys?.supabase.isConfigured ? 'Change' : 'Add'}
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={testSupabase}
                  disabled={!maskedKeys?.supabase.isConfigured || testingKey === 'supabase'}
                  leftIcon={
                    testingKey === 'supabase' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )
                  }
                >
                  Test
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Firecrawl */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/30">
              <Flame className="h-6 w-6 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <CardTitle className="text-xl">Firecrawl</CardTitle>
              <CardDescription>SERP scraping</CardDescription>
            </div>
          </div>
          {maskedKeys && <StatusBadge isConfigured={maskedKeys.firecrawl.isConfigured} isValid={maskedKeys.firecrawl.isValid} lastChecked={maskedKeys.firecrawl.lastChecked} />}
        </CardHeader>
        <CardContent>
          {editMode === 'firecrawl' ? (
            <form onSubmit={firecrawlForm.handleSubmit(saveFirecrawl)} className="space-y-4">
              <div className="relative">
                <Input
                  label="New API Key"
                  type={showKeys.firecrawl ? 'text' : 'password'}
                  placeholder="fc-..."
                  {...firecrawlForm.register('apiKey')}
                  autoFocus
                  className="pr-12"
                />
                <button
                  type="button"
                  className="absolute right-2 top-[26px] bottom-0 flex items-center justify-center w-10 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
                  onClick={() => setShowKeys((s) => ({ ...s, firecrawl: !s.firecrawl }))}
                >
                  {showKeys.firecrawl ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={handleCancelEdit}>
                  Cancel
                </Button>
                <Button
                  onClick={firecrawlForm.handleSubmit(saveFirecrawl)}
                  disabled={firecrawlForm.formState.isSubmitting}
                >
                  Save Key
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex justify-between items-end">
              <div className="space-y-2">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">API Key</p>
                  <p className="font-mono text-lg text-gray-900 dark:text-white">
                    {maskedKeys?.firecrawl.isConfigured ? maskedKeys.firecrawl.maskedKey : '—'}
                  </p>
                </div>
                {maskedKeys?.firecrawl.lastChecked && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Last tested: {formatDate(maskedKeys.firecrawl.lastChecked)}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 ml-4">
                <Button
                  className="w-full"
                  onClick={() => handleEditClick('firecrawl')}
                  leftIcon={<Edit3 className="h-4 w-4" />}
                >
                  {maskedKeys?.firecrawl.isConfigured ? 'Change' : 'Add'}
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={testFirecrawl}
                  disabled={!maskedKeys?.firecrawl.isConfigured || testingKey === 'firecrawl'}
                  leftIcon={
                    testingKey === 'firecrawl' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )
                  }
                >
                  Test
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Key className="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="font-medium text-blue-900 dark:text-blue-300">
                API Keys are stored securely
              </p>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
                Your API keys are encrypted with AES-256-GCM before storage.
                {hasPinConfigured
                  ? ' Changes require PIN verification for security.'
                  : ' Set up a PIN in Account Settings to protect API key changes.'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

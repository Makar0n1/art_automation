/**
 * Settings Page - API Keys Management with PIN Protection — dashboard visual style
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

  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [isPinVerifying, setIsPinVerifying] = useState(false);
  const [pendingEditMode, setPendingEditMode] = useState<EditMode>(null);
  const [hasPinConfigured, setHasPinConfigured] = useState(false);
  const [pinSessionToken, setPinSessionToken] = useState<string | null>(null);
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
    // Restore PIN session token from localStorage (persists across navigation)
    const storedToken = localStorage.getItem('pinSessionToken');
    const storedAt = localStorage.getItem('pinSessionTokenSetAt');
    if (storedToken && storedAt) {
      const elapsed = Date.now() - parseInt(storedAt, 10);
      if (elapsed < 5 * 60 * 1000) {
        setPinSessionToken(storedToken);
      } else {
        // Token already expired — clean up
        localStorage.removeItem('pinSessionToken');
        localStorage.removeItem('pinSessionTokenSetAt');
      }
    }
  }, []);

  // Silent auto-lock: check every 30s if PIN session token has expired (5-min TTL)
  useEffect(() => {
    if (!pinSessionToken) return;
    const interval = setInterval(() => {
      const storedAt = localStorage.getItem('pinSessionTokenSetAt');
      if (!storedAt || Date.now() - parseInt(storedAt, 10) >= 5 * 60 * 1000) {
        setPinSessionToken(null);
        setEditMode(null);
        localStorage.removeItem('pinSessionToken');
        localStorage.removeItem('pinSessionTokenSetAt');
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [pinSessionToken]);

  const handleEditClick = (service: EditMode) => {
    if (!hasPinConfigured) {
      setEditMode(service);
      return;
    }
    // If we already have a session token, skip PIN modal
    if (pinSessionToken) {
      setEditMode(service);
      return;
    }
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
        const token = (response.data as { pinSessionToken: string })?.pinSessionToken;
        setPinSessionToken(token);
        localStorage.setItem('pinSessionToken', token);
        localStorage.setItem('pinSessionTokenSetAt', Date.now().toString());
        setEditMode(pendingEditMode);
        setIsPinModalOpen(false);
        toast.success('PIN verified');
      } else {
        toast.error(response.error || 'Invalid PIN');
      }
    } catch (error) {
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
    openRouterForm.reset();
    supabaseForm.reset();
    firecrawlForm.reset();
  };

  const saveOpenRouter = async (data: { apiKey: string }) => {
    if (!data.apiKey) { toast.error('Please enter an API key'); return; }
    try {
      const response = await apiKeysApi.updateOpenRouter(data.apiKey, pinSessionToken || undefined);
      if (response.success) {
        toast.success('OpenRouter API key saved');
        openRouterForm.reset(); setEditMode(null); fetchMaskedKeys();
      } else { toast.error(response.error || 'Failed to save API key'); }
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 403) {
        // Token expired — clear it and prompt for PIN again
        setPinSessionToken(null);
        localStorage.removeItem('pinSessionToken');
        localStorage.removeItem('pinSessionTokenSetAt');
        toast.error('PIN session expired. Please verify your PIN again.');
        setEditMode(null);
      } else { toast.error('Failed to save API key'); }
    }
  };

  const testOpenRouter = async () => {
    setTestingKey('openRouter');
    try {
      const response = await apiKeysApi.testOpenRouter();
      if (response.success) toast.success(response.message || 'API key is valid');
      else toast.error(response.error || 'Invalid API key');
      fetchMaskedKeys();
    } catch { toast.error('Test failed'); }
    finally { setTestingKey(null); }
  };

  const saveSupabase = async (data: { url: string; secretKey: string }) => {
    if (!data.url || !data.secretKey) { toast.error('Please enter both URL and secret key'); return; }
    try {
      const response = await apiKeysApi.updateSupabase(data.url, data.secretKey, pinSessionToken || undefined);
      if (response.success) {
        toast.success('Supabase credentials saved');
        supabaseForm.reset(); setEditMode(null); fetchMaskedKeys();
      } else { toast.error(response.error || 'Failed to save credentials'); }
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 403) {
        setPinSessionToken(null);
        localStorage.removeItem('pinSessionToken');
        localStorage.removeItem('pinSessionTokenSetAt');
        toast.error('PIN session expired. Please verify your PIN again.');
        setEditMode(null);
      } else { toast.error('Failed to save credentials'); }
    }
  };

  const testSupabase = async () => {
    setTestingKey('supabase');
    try {
      const response = await apiKeysApi.testSupabase();
      if (response.success) toast.success(response.message || 'Credentials are valid');
      else toast.error(response.error || 'Invalid credentials');
      fetchMaskedKeys();
    } catch { toast.error('Test failed'); }
    finally { setTestingKey(null); }
  };

  const saveFirecrawl = async (data: { apiKey: string }) => {
    if (!data.apiKey) { toast.error('Please enter an API key'); return; }
    try {
      const response = await apiKeysApi.updateFirecrawl(data.apiKey, pinSessionToken || undefined);
      if (response.success) {
        toast.success('Firecrawl API key saved');
        firecrawlForm.reset(); setEditMode(null); fetchMaskedKeys();
      } else { toast.error(response.error || 'Failed to save API key'); }
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 403) {
        setPinSessionToken(null);
        localStorage.removeItem('pinSessionToken');
        localStorage.removeItem('pinSessionTokenSetAt');
        toast.error('PIN session expired. Please verify your PIN again.');
        setEditMode(null);
      } else { toast.error('Failed to save API key'); }
    }
  };

  const testFirecrawl = async () => {
    setTestingKey('firecrawl');
    try {
      const response = await apiKeysApi.testFirecrawl();
      if (response.success) toast.success(response.message || 'API key is valid');
      else toast.error(response.error || 'Invalid API key');
      fetchMaskedKeys();
    } catch { toast.error('Test failed'); }
    finally { setTestingKey(null); }
  };

  const StatusBadge = ({ isConfigured, isValid, lastChecked }: { isConfigured: boolean; isValid: boolean; lastChecked?: string | null }) => {
    if (!isConfigured) return <Badge variant="default" size="sm">Not Configured</Badge>;
    if (!lastChecked) return <Badge variant="default" size="sm">Not Tested</Badge>;
    if (isValid) return <Badge variant="success" size="sm"><Check className="mr-1 h-3.5 w-3.5" />Valid</Badge>;
    return <Badge variant="error" size="sm"><X className="mr-1 h-3.5 w-3.5" />Not Valid</Badge>;
  };

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="h-7 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>
    );
  }

  return (
    <div className="noise-bg flex h-full flex-col gap-3 overflow-y-auto">
      {/* Header */}
      <div className="shrink-0">
        <h1 className="header-underline text-2xl font-bold text-gray-900 dark:text-white">API Keys</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Configure your API keys for external services
        </p>
      </div>

      {/* PIN Verification Modal */}
      <Modal
        isOpen={isPinModalOpen}
        onClose={() => { setIsPinModalOpen(false); setPendingEditMode(null); setPinInput(''); }}
        title="Enter PIN to Edit"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
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
            <Button variant="secondary" size="sm" onClick={() => { setIsPinModalOpen(false); setPendingEditMode(null); setPinInput(''); }}>
              Cancel
            </Button>
            <Button
              size="sm"
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
      <Card className="card-shine shrink-0 !p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
            <Bot className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 dark:text-white">OpenRouter</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">AI model provider</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="font-mono text-gray-600 dark:text-gray-300">
                {maskedKeys?.openRouter.isConfigured ? maskedKeys.openRouter.maskedKey : '---'}
              </span>
              {maskedKeys?.openRouter.lastChecked && (
                <span className="text-xs text-gray-400">
                  tested {formatDate(maskedKeys.openRouter.lastChecked)}
                </span>
              )}
            </div>
          </div>
          {maskedKeys && (
            <StatusBadge
              isConfigured={maskedKeys.openRouter.isConfigured}
              isValid={maskedKeys.openRouter.isValid}
              lastChecked={maskedKeys.openRouter.lastChecked}
            />
          )}
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => handleEditClick('openRouter')} leftIcon={<Edit3 className="h-3.5 w-3.5" />}>
              {maskedKeys?.openRouter.isConfigured ? 'Change' : 'Add'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={testOpenRouter}
              disabled={!maskedKeys?.openRouter.isConfigured || testingKey === 'openRouter'}
              leftIcon={testingKey === 'openRouter' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            >
              Test
            </Button>
          </div>
        </div>
        {editMode === 'openRouter' && (
          <form onSubmit={openRouterForm.handleSubmit(saveOpenRouter)} className="mt-3 border-t border-gray-100/60 pt-3 dark:border-gray-700/30">
            <div className="flex items-end gap-3">
              <div className="relative flex-1">
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
                  className="absolute bottom-2 right-2 flex items-center justify-center text-gray-400 hover:text-gray-600"
                  onClick={() => setShowKeys((s) => ({ ...s, openRouter: !s.openRouter }))}
                >
                  {showKeys.openRouter ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button size="sm" variant="secondary" onClick={handleCancelEdit}>Cancel</Button>
              <Button size="sm" onClick={openRouterForm.handleSubmit(saveOpenRouter)} disabled={openRouterForm.formState.isSubmitting}>
                Save
              </Button>
            </div>
          </form>
        )}
      </Card>

      {/* Supabase */}
      <Card className="card-shine shrink-0 !p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
            <Database className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 dark:text-white">Supabase</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">Vector database</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="font-mono text-gray-600 dark:text-gray-300">
                {maskedKeys?.supabase.isConfigured ? maskedKeys.supabase.maskedKey : '---'}
              </span>
              {maskedKeys?.supabase.url && (
                <span className="truncate text-xs text-gray-400">
                  {maskedKeys.supabase.url}
                </span>
              )}
              {maskedKeys?.supabase.lastChecked && (
                <span className="text-xs text-gray-400">
                  tested {formatDate(maskedKeys.supabase.lastChecked)}
                </span>
              )}
            </div>
          </div>
          {maskedKeys && (
            <StatusBadge
              isConfigured={maskedKeys.supabase.isConfigured}
              isValid={maskedKeys.supabase.isValid}
              lastChecked={maskedKeys.supabase.lastChecked}
            />
          )}
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => handleEditClick('supabase')} leftIcon={<Edit3 className="h-3.5 w-3.5" />}>
              {maskedKeys?.supabase.isConfigured ? 'Change' : 'Add'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={testSupabase}
              disabled={!maskedKeys?.supabase.isConfigured || testingKey === 'supabase'}
              leftIcon={testingKey === 'supabase' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            >
              Test
            </Button>
          </div>
        </div>
        {editMode === 'supabase' && (
          <form onSubmit={supabaseForm.handleSubmit(saveSupabase)} className="mt-3 border-t border-gray-100/60 pt-3 dark:border-gray-700/30">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Input
                  label="Project URL"
                  type="url"
                  placeholder="https://your-project.supabase.co"
                  defaultValue={maskedKeys?.supabase.url || ''}
                  {...supabaseForm.register('url')}
                />
              </div>
              <div className="relative flex-1">
                <Input
                  label="Service Role Key"
                  type={showKeys.supabase ? 'text' : 'password'}
                  placeholder="eyJhbGciOiJ..."
                  {...supabaseForm.register('secretKey')}
                  className="pr-12"
                />
                <button
                  type="button"
                  className="absolute bottom-2 right-2 flex items-center justify-center text-gray-400 hover:text-gray-600"
                  onClick={() => setShowKeys((s) => ({ ...s, supabase: !s.supabase }))}
                >
                  {showKeys.supabase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button size="sm" variant="secondary" onClick={handleCancelEdit}>Cancel</Button>
              <Button size="sm" onClick={supabaseForm.handleSubmit(saveSupabase)} disabled={supabaseForm.formState.isSubmitting}>
                Save
              </Button>
            </div>
          </form>
        )}
      </Card>

      {/* Firecrawl */}
      <Card className="card-shine shrink-0 !p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
            <Flame className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 dark:text-white">Firecrawl</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">SERP scraping</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="font-mono text-gray-600 dark:text-gray-300">
                {maskedKeys?.firecrawl.isConfigured ? maskedKeys.firecrawl.maskedKey : '---'}
              </span>
              {maskedKeys?.firecrawl.lastChecked && (
                <span className="text-xs text-gray-400">
                  tested {formatDate(maskedKeys.firecrawl.lastChecked)}
                </span>
              )}
            </div>
          </div>
          {maskedKeys && (
            <StatusBadge
              isConfigured={maskedKeys.firecrawl.isConfigured}
              isValid={maskedKeys.firecrawl.isValid}
              lastChecked={maskedKeys.firecrawl.lastChecked}
            />
          )}
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => handleEditClick('firecrawl')} leftIcon={<Edit3 className="h-3.5 w-3.5" />}>
              {maskedKeys?.firecrawl.isConfigured ? 'Change' : 'Add'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={testFirecrawl}
              disabled={!maskedKeys?.firecrawl.isConfigured || testingKey === 'firecrawl'}
              leftIcon={testingKey === 'firecrawl' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            >
              Test
            </Button>
          </div>
        </div>
        {editMode === 'firecrawl' && (
          <form onSubmit={firecrawlForm.handleSubmit(saveFirecrawl)} className="mt-3 border-t border-gray-100/60 pt-3 dark:border-gray-700/30">
            <div className="flex items-end gap-3">
              <div className="relative flex-1">
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
                  className="absolute bottom-2 right-2 flex items-center justify-center text-gray-400 hover:text-gray-600"
                  onClick={() => setShowKeys((s) => ({ ...s, firecrawl: !s.firecrawl }))}
                >
                  {showKeys.firecrawl ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button size="sm" variant="secondary" onClick={handleCancelEdit}>Cancel</Button>
              <Button size="sm" onClick={firecrawlForm.handleSubmit(saveFirecrawl)} disabled={firecrawlForm.formState.isSubmitting}>
                Save
              </Button>
            </div>
          </form>
        )}
      </Card>

      {/* Info banner */}
      <div className="flex shrink-0 items-center gap-2.5 rounded-lg bg-blue-50/80 px-4 py-2.5 dark:bg-blue-900/20">
        <Key className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <p className="text-sm text-blue-700 dark:text-blue-400">
          API keys are encrypted with AES-256-GCM.
          {hasPinConfigured
            ? ' Changes require PIN verification.'
            : ' Set up a PIN in Account to protect changes.'}
        </p>
      </div>
    </div>
  );
}

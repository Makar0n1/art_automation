/**
 * Account Settings Page - Password & PIN Management
 * PIN-gated: requires PIN session token (JWT, 5-min TTL) for protected operations
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { AxiosError } from 'axios';
import {
  Lock,
  Shield,
  Eye,
  EyeOff,
  Loader2,
  Check,
  AlertTriangle,
  KeyRound,
} from 'lucide-react';

import {
  Card,
  CardContent,
  Button,
  Input,
  Badge,
} from '@/components/ui';
import { authApi, apiKeysApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface PinFormData {
  currentPin: string;
  newPin: string;
  confirmPin: string;
  password: string;
}

export default function AccountPage() {
  const { user } = useAuthStore();

  /* ─── PIN gate state ─── */
  const [hasPinConfigured, setHasPinConfigured] = useState<boolean | null>(null);
  const [isPinVerified, setIsPinVerified] = useState(false);
  const [pinSessionToken, setPinSessionToken] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [isPinLoading, setIsPinLoading] = useState(false);
  const [showGatePin, setShowGatePin] = useState(false);

  /* ─── Page state ─── */
  const [isLoading, setIsLoading] = useState(true);
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [showPins, setShowPins] = useState({
    current: false,
    new: false,
    confirm: false,
    password: false,
  });

  const passwordForm = useForm<PasswordFormData>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const pinForm = useForm<PinFormData>({
    defaultValues: { currentPin: '', newPin: '', confirmPin: '', password: '' },
  });

  /* ─── Fetch PIN status + restore session token on mount ─── */
  useEffect(() => {
    const fetchPinStatus = async () => {
      try {
        const response = await authApi.getPinStatus();
        if (response.success) {
          setHasPinConfigured((response.data as { hasPinConfigured: boolean }).hasPinConfigured);
        }
      } catch {
        console.error('Failed to fetch PIN status');
      } finally {
        setIsLoading(false);
      }
    };
    fetchPinStatus();
    // Restore PIN session token from localStorage (persists across navigation)
    const storedToken = localStorage.getItem('pinSessionToken');
    const storedAt = localStorage.getItem('pinSessionTokenSetAt');
    if (storedToken && storedAt) {
      const elapsed = Date.now() - parseInt(storedAt, 10);
      if (elapsed < 60 * 1000) {
        setPinSessionToken(storedToken);
        setIsPinVerified(true);
      } else {
        // Token already expired — clean up
        localStorage.removeItem('pinSessionToken');
        localStorage.removeItem('pinSessionTokenSetAt');
      }
    }
  }, []);

  /* ─── PIN gate verification ─── */
  const handlePinGateSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinInput.trim()) return;

    setIsPinLoading(true);
    try {
      const response = await apiKeysApi.verifyPin(pinInput);
      if (response.success) {
        const token = (response.data as { pinSessionToken: string })?.pinSessionToken;
        setPinSessionToken(token);
        localStorage.setItem('pinSessionToken', token);
        localStorage.setItem('pinSessionTokenSetAt', Date.now().toString());
        setIsPinVerified(true);
        setPinInput('');
        toast.success('Access granted');
      }
    } catch (error) {
      if (error instanceof AxiosError && error.response?.data) {
        const data = error.response.data as { error?: string; isBlocked?: boolean; attemptsRemaining?: number };
        if (data.isBlocked) {
          toast.error(data.error || 'Too many failed attempts. Your IP has been blocked.', { duration: 6000 });
        } else {
          toast.error(data.error || 'Invalid PIN');
        }
      } else {
        toast.error('PIN verification failed');
      }
      setPinInput('');
    } finally {
      setIsPinLoading(false);
    }
  }, [pinInput]);

  // Silent auto-lock: check every 30s if PIN session token has expired (5-min TTL)
  useEffect(() => {
    if (!pinSessionToken) return;
    const interval = setInterval(() => {
      const storedAt = localStorage.getItem('pinSessionTokenSetAt');
      if (!storedAt || Date.now() - parseInt(storedAt, 10) >= 60 * 1000) {
        setPinSessionToken(null);
        setIsPinVerified(false);
        localStorage.removeItem('pinSessionToken');
        localStorage.removeItem('pinSessionTokenSetAt');
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [pinSessionToken]);

  /** Clear PIN session on 403 (expired token) */
  const handleSessionExpired = () => {
    setPinSessionToken(null);
    setIsPinVerified(false);
    localStorage.removeItem('pinSessionToken');
    localStorage.removeItem('pinSessionTokenSetAt');
    toast.error('PIN session expired. Please verify your PIN again.');
  };

  /* ─── Form handlers ─── */
  const handlePasswordChange = async (data: PasswordFormData) => {
    if (data.newPassword !== data.confirmPassword) { toast.error('New passwords do not match'); return; }
    if (data.newPassword.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    try {
      const response = await authApi.changePassword(data.currentPassword, data.newPassword, pinSessionToken || undefined);
      if (response.success) { toast.success('Password changed successfully'); passwordForm.reset(); }
      else toast.error(response.error || 'Failed to change password');
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 403) {
        handleSessionExpired();
      } else {
        toast.error('Failed to change password');
      }
    }
  };

  const handlePinChange = async (data: PinFormData) => {
    if (data.newPin !== data.confirmPin) { toast.error('PINs do not match'); return; }
    if (data.newPin.length < 4) { toast.error('PIN must be at least 4 characters'); return; }
    try {
      const response = await authApi.changePin(
        data.newPin,
        hasPinConfigured ? data.currentPin : undefined,
        !hasPinConfigured ? data.password : undefined,
        pinSessionToken || undefined
      );
      if (response.success) {
        toast.success(hasPinConfigured ? 'PIN changed' : 'PIN set up');
        pinForm.reset();
        setHasPinConfigured(true);
      } else toast.error(response.error || 'Failed to change PIN');
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 403) {
        handleSessionExpired();
      } else {
        toast.error('Failed to change PIN');
      }
    }
  };

  const PasswordToggle = ({ show, toggle }: { show: boolean; toggle: () => void }) => (
    <button
      type="button"
      className="absolute bottom-2 right-2 flex items-center justify-center text-gray-400 hover:text-gray-600"
      onClick={toggle}
    >
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

  /* ─── Loading skeleton ─── */
  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="h-7 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="grid flex-1 grid-cols-2 gap-3">
          <div className="rounded-xl bg-gray-200 dark:bg-gray-700" />
          <div className="rounded-xl bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    );
  }

  // Whether the PIN gate should be active
  const showPinGate = hasPinConfigured && !isPinVerified;

  return (
    <div className="noise-bg relative flex h-full flex-col gap-3">

      {/* ═══ PIN Gate Overlay ═══ */}
      {showPinGate && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm rounded-lg">
          <Card className="card-shine w-full max-w-sm !p-6">
            <div className="text-center mb-5">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <KeyRound className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Enter PIN</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Account settings are protected by PIN
              </p>
            </div>
            <form onSubmit={handlePinGateSubmit}>
              <div className="relative">
                <Input
                  type={showGatePin ? 'text' : 'password'}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="Enter your PIN"
                  autoFocus
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute bottom-2 right-2 flex items-center justify-center text-gray-400 hover:text-gray-600"
                  onClick={() => setShowGatePin(p => !p)}
                >
                  {showGatePin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                type="submit"
                className="mt-3 w-full"
                disabled={isPinLoading || !pinInput.trim()}
                leftIcon={isPinLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              >
                {isPinLoading ? 'Verifying...' : 'Unlock'}
              </Button>
            </form>
          </Card>
        </div>
      )}

      {/* ═══ Page Content (blurred when gate is active) ═══ */}
      <div className={cn(
        'flex h-full flex-col gap-3 transition-all duration-300',
        showPinGate && 'blur-md pointer-events-none select-none'
      )}>
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between">
          <div>
            <h1 className="header-underline text-2xl font-bold text-gray-900 dark:text-white">Account</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {user?.email} &mdash; Administrator
            </p>
          </div>
        </div>

        {/* Password & PIN side by side */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          {/* Change Password */}
          <Card className="card-shine flex flex-col overflow-hidden !p-4">
            <div className="mb-3 flex items-center gap-2.5 shrink-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Lock className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Change Password</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Update your account password</p>
              </div>
            </div>
            <form onSubmit={passwordForm.handleSubmit(handlePasswordChange)} className="flex flex-1 flex-col space-y-3">
              <div className="relative">
                <Input
                  label="Current Password"
                  type={showPasswords.current ? 'text' : 'password'}
                  placeholder="Enter current password"
                  {...passwordForm.register('currentPassword', { required: true })}
                  className="pr-10"
                />
                <PasswordToggle show={showPasswords.current} toggle={() => setShowPasswords((s) => ({ ...s, current: !s.current }))} />
              </div>
              <div className="relative">
                <Input
                  label="New Password"
                  type={showPasswords.new ? 'text' : 'password'}
                  placeholder="Min 6 characters"
                  {...passwordForm.register('newPassword', { required: true, minLength: 6 })}
                  className="pr-10"
                />
                <PasswordToggle show={showPasswords.new} toggle={() => setShowPasswords((s) => ({ ...s, new: !s.new }))} />
              </div>
              <div className="relative">
                <Input
                  label="Confirm"
                  type={showPasswords.confirm ? 'text' : 'password'}
                  placeholder="Confirm new password"
                  {...passwordForm.register('confirmPassword', { required: true })}
                  className="pr-10"
                />
                <PasswordToggle show={showPasswords.confirm} toggle={() => setShowPasswords((s) => ({ ...s, confirm: !s.confirm }))} />
              </div>
              <div className="!mt-auto flex justify-end pt-2">
                <Button
                  size="sm"
                  onClick={passwordForm.handleSubmit(handlePasswordChange)}
                  disabled={passwordForm.formState.isSubmitting}
                  leftIcon={passwordForm.formState.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                >
                  Change Password
                </Button>
              </div>
            </form>
          </Card>

          {/* PIN Management */}
          <Card className="card-shine flex flex-col overflow-hidden !p-4">
            <div className="mb-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Security PIN</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {hasPinConfigured ? 'Protects API key changes' : 'Set up to protect API keys'}
                  </p>
                </div>
              </div>
              {hasPinConfigured ? (
                <Badge variant="success" size="sm"><Check className="mr-1 h-3 w-3" />Active</Badge>
              ) : (
                <Badge variant="warning" size="sm"><AlertTriangle className="mr-1 h-3 w-3" />Not Set</Badge>
              )}
            </div>

            {!hasPinConfigured && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 shrink-0">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Set up a PIN to secure API key changes
              </div>
            )}

            <form onSubmit={pinForm.handleSubmit(handlePinChange)} className="flex flex-1 flex-col space-y-3">
              {hasPinConfigured ? (
                <div className="relative">
                  <Input
                    label="Current PIN"
                    type={showPins.current ? 'text' : 'password'}
                    placeholder="Enter current PIN"
                    {...pinForm.register('currentPin', { required: hasPinConfigured })}
                    className="pr-10"
                  />
                  <PasswordToggle show={showPins.current} toggle={() => setShowPins((s) => ({ ...s, current: !s.current }))} />
                </div>
              ) : (
                <div className="relative">
                  <Input
                    label="Account Password"
                    type={showPins.password ? 'text' : 'password'}
                    placeholder="Enter password to set up PIN"
                    {...pinForm.register('password', { required: !hasPinConfigured })}
                    className="pr-10"
                  />
                  <PasswordToggle show={showPins.password} toggle={() => setShowPins((s) => ({ ...s, password: !s.password }))} />
                </div>
              )}

              <div className="relative">
                <Input
                  label={hasPinConfigured ? 'New PIN' : 'PIN'}
                  type={showPins.new ? 'text' : 'password'}
                  placeholder="Min 4 characters"
                  {...pinForm.register('newPin', { required: true, minLength: 4 })}
                  className="pr-10"
                />
                <PasswordToggle show={showPins.new} toggle={() => setShowPins((s) => ({ ...s, new: !s.new }))} />
              </div>

              <div className="relative">
                <Input
                  label="Confirm PIN"
                  type={showPins.confirm ? 'text' : 'password'}
                  placeholder="Confirm PIN"
                  {...pinForm.register('confirmPin', { required: true })}
                  className="pr-10"
                />
                <PasswordToggle show={showPins.confirm} toggle={() => setShowPins((s) => ({ ...s, confirm: !s.confirm }))} />
              </div>

              <div className="!mt-auto flex items-center justify-between gap-4 pt-2">
                <p className="text-xs text-gray-400">Min 4 chars, letters/numbers/symbols</p>
                <Button
                  size="sm"
                  onClick={pinForm.handleSubmit(handlePinChange)}
                  disabled={pinForm.formState.isSubmitting}
                  leftIcon={pinForm.formState.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                >
                  {hasPinConfigured ? 'Change PIN' : 'Set Up PIN'}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* Security tip */}
        <p className="shrink-0 text-center text-xs text-gray-400 dark:text-gray-500">
          Use strong, unique credentials. Never share your password or PIN.
        </p>
      </div>
    </div>
  );
}

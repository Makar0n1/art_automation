/**
 * Account Settings Page - Password & PIN Management — dashboard visual style
 */

'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  Lock,
  Shield,
  Eye,
  EyeOff,
  Loader2,
  Check,
  AlertTriangle,
} from 'lucide-react';

import {
  Card,
  CardContent,
  Button,
  Input,
  Badge,
} from '@/components/ui';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

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
  const [hasPinConfigured, setHasPinConfigured] = useState(false);
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

  const fetchPinStatus = async () => {
    try {
      const response = await authApi.getPinStatus();
      if (response.success) {
        setHasPinConfigured((response.data as { hasPinConfigured: boolean }).hasPinConfigured);
      }
    } catch (error) {
      console.error('Failed to fetch PIN status');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPinStatus();
  }, []);

  const handlePasswordChange = async (data: PasswordFormData) => {
    if (data.newPassword !== data.confirmPassword) { toast.error('New passwords do not match'); return; }
    if (data.newPassword.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    try {
      const response = await authApi.changePassword(data.currentPassword, data.newPassword);
      if (response.success) { toast.success('Password changed successfully'); passwordForm.reset(); }
      else toast.error(response.error || 'Failed to change password');
    } catch { toast.error('Failed to change password'); }
  };

  const handlePinChange = async (data: PinFormData) => {
    if (data.newPin !== data.confirmPin) { toast.error('PINs do not match'); return; }
    if (data.newPin.length < 4) { toast.error('PIN must be at least 4 characters'); return; }
    try {
      const response = await authApi.changePin(
        data.newPin,
        hasPinConfigured ? data.currentPin : undefined,
        !hasPinConfigured ? data.password : undefined
      );
      if (response.success) {
        toast.success(hasPinConfigured ? 'PIN changed' : 'PIN set up');
        pinForm.reset();
        setHasPinConfigured(true);
      } else toast.error(response.error || 'Failed to change PIN');
    } catch { toast.error('Failed to change PIN'); }
  };

  const PasswordToggle = ({ field, show, toggle }: { field: string; show: boolean; toggle: () => void }) => (
    <button
      type="button"
      className="absolute bottom-2 right-2 flex items-center justify-center text-gray-400 hover:text-gray-600"
      onClick={toggle}
    >
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

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

  return (
    <div className="noise-bg flex h-full flex-col gap-3">
      {/* Header with profile info merged */}
      <div className="shrink-0">
        <h1 className="header-underline text-2xl font-bold text-gray-900 dark:text-white">Account</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {user?.email} &mdash; Administrator
        </p>
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
              <PasswordToggle field="current" show={showPasswords.current} toggle={() => setShowPasswords((s) => ({ ...s, current: !s.current }))} />
            </div>
            <div className="relative">
              <Input
                label="New Password"
                type={showPasswords.new ? 'text' : 'password'}
                placeholder="Min 6 characters"
                {...passwordForm.register('newPassword', { required: true, minLength: 6 })}
                className="pr-10"
              />
              <PasswordToggle field="new" show={showPasswords.new} toggle={() => setShowPasswords((s) => ({ ...s, new: !s.new }))} />
            </div>
            <div className="relative">
              <Input
                label="Confirm"
                type={showPasswords.confirm ? 'text' : 'password'}
                placeholder="Confirm new password"
                {...passwordForm.register('confirmPassword', { required: true })}
                className="pr-10"
              />
              <PasswordToggle field="confirm" show={showPasswords.confirm} toggle={() => setShowPasswords((s) => ({ ...s, confirm: !s.confirm }))} />
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
                <PasswordToggle field="current" show={showPins.current} toggle={() => setShowPins((s) => ({ ...s, current: !s.current }))} />
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
                <PasswordToggle field="password" show={showPins.password} toggle={() => setShowPins((s) => ({ ...s, password: !s.password }))} />
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
              <PasswordToggle field="new" show={showPins.new} toggle={() => setShowPins((s) => ({ ...s, new: !s.new }))} />
            </div>

            <div className="relative">
              <Input
                label="Confirm PIN"
                type={showPins.confirm ? 'text' : 'password'}
                placeholder="Confirm PIN"
                {...pinForm.register('confirmPin', { required: true })}
                className="pr-10"
              />
              <PasswordToggle field="confirm" show={showPins.confirm} toggle={() => setShowPins((s) => ({ ...s, confirm: !s.confirm }))} />
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
  );
}

/**
 * Account Settings Page - Password & PIN Management
 */

'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  User,
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
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
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
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const pinForm = useForm<PinFormData>({
    defaultValues: {
      currentPin: '',
      newPin: '',
      confirmPin: '',
      password: '',
    },
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
    if (data.newPassword !== data.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (data.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    try {
      const response = await authApi.changePassword(data.currentPassword, data.newPassword);
      if (response.success) {
        toast.success('Password changed successfully');
        passwordForm.reset();
      } else {
        toast.error(response.error || 'Failed to change password');
      }
    } catch (error) {
      toast.error('Failed to change password');
    }
  };

  const handlePinChange = async (data: PinFormData) => {
    if (data.newPin !== data.confirmPin) {
      toast.error('PINs do not match');
      return;
    }

    if (data.newPin.length < 4) {
      toast.error('PIN must be at least 4 characters');
      return;
    }

    try {
      const response = await authApi.changePin(
        data.newPin,
        hasPinConfigured ? data.currentPin : undefined,
        !hasPinConfigured ? data.password : undefined
      );
      if (response.success) {
        toast.success(hasPinConfigured ? 'PIN changed successfully' : 'PIN set up successfully');
        pinForm.reset();
        setHasPinConfigured(true);
      } else {
        toast.error(response.error || 'Failed to change PIN');
      }
    } catch (error) {
      toast.error('Failed to change PIN');
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        {[...Array(2)].map((_, i) => (
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
          Account Settings
        </h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Manage your password and security settings
        </p>
      </div>

      {/* User Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Your account information</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Email</p>
            <p className="font-medium text-gray-900 dark:text-white">{user?.email}</p>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Lock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>Update your account password</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={passwordForm.handleSubmit(handlePasswordChange)} className="space-y-4">
            <div className="relative">
              <Input
                label="Current Password"
                type={showPasswords.current ? 'text' : 'password'}
                placeholder="Enter current password"
                {...passwordForm.register('currentPassword', { required: true })}
              />
              <button
                type="button"
                className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPasswords((s) => ({ ...s, current: !s.current }))}
              >
                {showPasswords.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="relative">
              <Input
                label="New Password"
                type={showPasswords.new ? 'text' : 'password'}
                placeholder="Enter new password (min 6 characters)"
                {...passwordForm.register('newPassword', { required: true, minLength: 6 })}
              />
              <button
                type="button"
                className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPasswords((s) => ({ ...s, new: !s.new }))}
              >
                {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="relative">
              <Input
                label="Confirm New Password"
                type={showPasswords.confirm ? 'text' : 'password'}
                placeholder="Confirm new password"
                {...passwordForm.register('confirmPassword', { required: true })}
              />
              <button
                type="button"
                className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPasswords((s) => ({ ...s, confirm: !s.confirm }))}
              >
                {showPasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </form>
        </CardContent>
        <CardFooter>
          <Button
            onClick={passwordForm.handleSubmit(handlePasswordChange)}
            disabled={passwordForm.formState.isSubmitting}
            leftIcon={
              passwordForm.formState.isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lock className="h-4 w-4" />
              )
            }
          >
            Change Password
          </Button>
        </CardFooter>
      </Card>

      {/* PIN Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <CardTitle>Security PIN</CardTitle>
                <CardDescription>
                  {hasPinConfigured
                    ? 'Your PIN protects API key changes'
                    : 'Set up a PIN to protect API key changes'}
                </CardDescription>
              </div>
            </div>
            {hasPinConfigured ? (
              <Badge variant="success">
                <Check className="mr-1 h-3 w-3" />
                Configured
              </Badge>
            ) : (
              <Badge variant="warning">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Not Set
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!hasPinConfigured && (
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    PIN not configured
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Set up a PIN to add an extra layer of security for API key changes.
                  </p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={pinForm.handleSubmit(handlePinChange)} className="space-y-4">
            {hasPinConfigured ? (
              <div className="relative">
                <Input
                  label="Current PIN"
                  type={showPins.current ? 'text' : 'password'}
                  placeholder="Enter current PIN"
                  {...pinForm.register('currentPin', { required: hasPinConfigured })}
                />
                <button
                  type="button"
                  className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPins((s) => ({ ...s, current: !s.current }))}
                >
                  {showPins.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  label="Account Password"
                  type={showPins.password ? 'text' : 'password'}
                  placeholder="Enter your account password to set up PIN"
                  {...pinForm.register('password', { required: !hasPinConfigured })}
                />
                <button
                  type="button"
                  className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPins((s) => ({ ...s, password: !s.password }))}
                >
                  {showPins.password ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}

            <div className="relative">
              <Input
                label={hasPinConfigured ? 'New PIN' : 'PIN'}
                type={showPins.new ? 'text' : 'password'}
                placeholder="Enter PIN (min 4 characters)"
                {...pinForm.register('newPin', {
                  required: true,
                  minLength: 4,
                })}
              />
              <button
                type="button"
                className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPins((s) => ({ ...s, new: !s.new }))}
              >
                {showPins.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="relative">
              <Input
                label="Confirm PIN"
                type={showPins.confirm ? 'text' : 'password'}
                placeholder="Confirm PIN"
                {...pinForm.register('confirmPin', { required: true })}
              />
              <button
                type="button"
                className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPins((s) => ({ ...s, confirm: !s.confirm }))}
              >
                {showPins.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400">
              PIN must be at least 4 characters (letters, numbers, symbols allowed). This PIN will be required when changing API keys.
            </p>
          </form>
        </CardContent>
        <CardFooter>
          <Button
            onClick={pinForm.handleSubmit(handlePinChange)}
            disabled={pinForm.formState.isSubmitting}
            leftIcon={
              pinForm.formState.isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shield className="h-4 w-4" />
              )
            }
          >
            {hasPinConfigured ? 'Change PIN' : 'Set Up PIN'}
          </Button>
        </CardFooter>
      </Card>

      {/* Security Info */}
      <Card className="bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="font-medium text-blue-900 dark:text-blue-300">
                Security Best Practices
              </p>
              <ul className="mt-2 text-sm text-blue-700 dark:text-blue-400 list-disc list-inside space-y-1">
                <li>Use a strong password with at least 6 characters</li>
                <li>Choose a unique PIN that you don&apos;t use elsewhere</li>
                <li>Never share your password or PIN with anyone</li>
                <li>Change your credentials periodically</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

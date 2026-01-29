/**
 * API Client for Backend Communication
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { ApiResponse } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/**
 * Create Axios instance with default config
 */
const createApiClient = (): AxiosInstance => {
  const client = axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  // Request interceptor to add auth token
  client.interceptors.request.use(
    (config) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor for error handling
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError<ApiResponse>) => {
      if (error.response?.status === 401) {
        // Clear token and redirect to login
        if (typeof window !== 'undefined') {
          localStorage.removeItem('token');
          window.location.href = '/';
        }
      }
      return Promise.reject(error);
    }
  );

  return client;
};

export const api = createApiClient();

/**
 * Auth API
 */
export const authApi = {
  login: async (email: string, password: string) => {
    const response = await api.post<ApiResponse>('/auth/login', { email, password });
    return response.data;
  },

  getMe: async () => {
    const response = await api.get<ApiResponse>('/auth/me');
    return response.data;
  },

  refreshToken: async () => {
    const response = await api.post<ApiResponse>('/auth/refresh');
    return response.data;
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const response = await api.put<ApiResponse>('/auth/password', {
      currentPassword,
      newPassword,
    });
    return response.data;
  },

  changePin: async (newPin: string, currentPin?: string, password?: string) => {
    const response = await api.put<ApiResponse>('/auth/pin', {
      newPin,
      currentPin,
      password,
    });
    return response.data;
  },

  getPinStatus: async () => {
    const response = await api.get<ApiResponse>('/auth/pin-status');
    return response.data;
  },
};

/**
 * API Keys API
 */
export const apiKeysApi = {
  getStatus: async () => {
    const response = await api.get<ApiResponse>('/settings/api-keys');
    return response.data;
  },

  getMaskedKeys: async () => {
    const response = await api.get<ApiResponse>('/settings/api-keys/masked');
    return response.data;
  },

  verifyPin: async (pin: string) => {
    const response = await api.post<ApiResponse>('/settings/api-keys/verify-pin', { pin });
    return response.data;
  },

  updateOpenRouter: async (apiKey: string, pin?: string) => {
    const response = await api.put<ApiResponse>('/settings/api-keys/openrouter', { apiKey, pin });
    return response.data;
  },

  testOpenRouter: async () => {
    const response = await api.post<ApiResponse>('/settings/api-keys/openrouter/test');
    return response.data;
  },

  updateSupabase: async (url: string, secretKey: string, pin?: string) => {
    const response = await api.put<ApiResponse>('/settings/api-keys/supabase', { url, secretKey, pin });
    return response.data;
  },

  testSupabase: async () => {
    const response = await api.post<ApiResponse>('/settings/api-keys/supabase/test');
    return response.data;
  },

  updateFirecrawl: async (apiKey: string, pin?: string) => {
    const response = await api.put<ApiResponse>('/settings/api-keys/firecrawl', { apiKey, pin });
    return response.data;
  },

  testFirecrawl: async () => {
    const response = await api.post<ApiResponse>('/settings/api-keys/firecrawl/test');
    return response.data;
  },
};

/**
 * Projects API
 */
export const projectsApi = {
  getAll: async () => {
    const response = await api.get<ApiResponse>('/projects');
    return response.data;
  },

  getOne: async (id: string) => {
    const response = await api.get<ApiResponse>(`/projects/${id}`);
    return response.data;
  },

  create: async (name: string, description?: string) => {
    const response = await api.post<ApiResponse>('/projects', { name, description });
    return response.data;
  },

  update: async (id: string, data: { name?: string; description?: string }) => {
    const response = await api.put<ApiResponse>(`/projects/${id}`, data);
    return response.data;
  },

  delete: async (id: string) => {
    const response = await api.delete<ApiResponse>(`/projects/${id}`);
    return response.data;
  },
};

/**
 * Generations API
 */
export const generationsApi = {
  getAll: async (params?: { status?: string; limit?: number; offset?: number }) => {
    const response = await api.get<ApiResponse>('/generations', { params });
    return response.data;
  },

  getOne: async (id: string) => {
    const response = await api.get<ApiResponse>(`/generations/${id}`);
    return response.data;
  },

  getLogs: async (id: string, since?: string) => {
    const response = await api.get<ApiResponse>(`/generations/${id}/logs`, {
      params: since ? { since } : undefined,
    });
    return response.data;
  },

  create: async (projectId: string, config: {
    mainKeyword: string;
    articleType?: string;
    keywords?: string[];
    language?: string;
    region?: string;
    lsiKeywords?: string[];
    comment?: string;
    internalLinks?: Array<{
      anchor?: string;
      url: string;
      isAnchorless: boolean;
      displayType: string;
      position: string;
    }>;
    linksAsList?: boolean;
    linksListPosition?: string;
  }) => {
    const response = await api.post<ApiResponse>(`/projects/${projectId}/generations`, config);
    return response.data;
  },

  delete: async (id: string) => {
    const response = await api.delete<ApiResponse>(`/generations/${id}`);
    return response.data;
  },

  continue: async (id: string) => {
    const response = await api.post<ApiResponse>(`/generations/${id}/continue`);
    return response.data;
  },

  getQueueStats: async () => {
    const response = await api.get<ApiResponse>('/generations/queue/stats');
    return response.data;
  },
};

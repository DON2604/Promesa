'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  AnalyticsView,
  MarketplaceView,
  MerchantWorkspaceView,
  NotificationView,
  OrgProfileView,
  Preferences,
  ProposalDecisionRequest,
  PublishMissionRequest,
  ShortageForecastView,
  SubmitProposalRequest,
  VerificationRequest,
  DashboardView,
  MerchantActionRequest,
  MissionLifecycleView,
  DemoScenarioView,
  HealthBreakdownView,
  Me,
  MissionDetail,
  OffersResponse,
  PayPalHealth,
  Persona,
  PurchaseDetail,
  SnapshotDetail,
  SnapshotsPage,
  ThreadsView,
  ContrastView,
  TwinDetail,
} from '@promesa/contracts';
import { api } from './api';

export const qk = {
  me: ['me'] as const,
  personas: ['personas'] as const,
  paypalHealth: ['paypal-health'] as const,
  dashboard: ['dashboard'] as const,
  scenarios: ['demo-scenarios'] as const,
  purchase: (id: string) => ['purchase', id] as const,
  purchaseOffers: (id: string) => ['purchase', id, 'offers'] as const,
  mission: (id: string) => ['mission', id] as const,
  missionOffers: (id: string) => ['mission', id, 'offers'] as const,
  twin: (id: string) => ['twin', id] as const,
  twinPart: (id: string, part: string) => ['twin', id, part] as const,
  snapshot: (twinId: string, snapshotId: string) =>
    ['twin', twinId, 'snapshot', snapshotId] as const,
};

type Opts<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;

export const useMe = (o?: Opts<Me>) =>
  useQuery({ queryKey: qk.me, queryFn: () => api<Me>('/v1/me'), ...o });
export const usePersonas = () =>
  useQuery({
    queryKey: qk.personas,
    queryFn: () =>
      api<{ identityProvider: 'DEMO'; enabled: boolean; personas: Persona[] }>('/v1/auth/personas'),
    staleTime: Infinity,
  });
export const usePayPalHealth = () =>
  useQuery({
    queryKey: qk.paypalHealth,
    queryFn: () => api<PayPalHealth>('/v1/integrations/paypal/health'),
    staleTime: 60_000,
  });
export const useDashboard = () =>
  useQuery({ queryKey: qk.dashboard, queryFn: () => api<DashboardView>('/v1/operations/summary') });
export const useScenarios = () =>
  useQuery({
    queryKey: qk.scenarios,
    queryFn: () => api<DemoScenarioView[]>('/v1/demo/scenarios'),
  });

export const usePurchase = (id: string) =>
  useQuery({
    queryKey: qk.purchase(id),
    queryFn: () => api<PurchaseDetail>(`/v1/purchases/${id}`),
  });
export const usePurchaseOffers = (id: string) =>
  useQuery({
    queryKey: qk.purchaseOffers(id),
    queryFn: () => api<OffersResponse>(`/v1/purchases/${id}/offers`),
  });
export const useMission = (id: string) =>
  useQuery({ queryKey: qk.mission(id), queryFn: () => api<MissionDetail>(`/v1/missions/${id}`) });
export const useMissionOffers = (id: string) =>
  useQuery({
    queryKey: qk.missionOffers(id),
    queryFn: () => api<OffersResponse>(`/v1/missions/${id}/offers`),
  });

// ---------- NeedMesh mission lifecycle ----------
// Key is a child of ['mission', id], so the existing SSE invalidation refreshes it live.
export const useMissionLifecycle = (id: string) =>
  useQuery({
    queryKey: [...qk.mission(id), 'lifecycle'] as const,
    queryFn: () => api<MissionLifecycleView>(`/v1/missions/${id}/lifecycle`),
    refetchInterval: 15_000,
  });

export function useMissionActions(missionId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: qk.mission(missionId) });
  const post = <T>(path: string, body: unknown = {}) =>
    api<T>(`/v1/missions/${missionId}${path}`, { method: 'POST', body });
  const opts = { onSettled: refresh };
  return {
    plan: useMutation({ mutationFn: () => post<MissionLifecycleView>('/agents/plan'), ...opts }),
    approve: useMutation({
      mutationFn: (orderId: string) =>
        post<{ approveUrl: string | null; state: string }>(`/orders/${orderId}/approve`),
      ...opts,
    }),
    authorize: useMutation({
      mutationFn: (v: { orderId: string; paypalOrderId: string }) =>
        post<MissionLifecycleView>(`/orders/${v.orderId}/authorize`, {
          paypalOrderId: v.paypalOrderId,
        }),
      ...opts,
    }),
    merchant: useMutation({
      mutationFn: (v: { orderId: string; action: MerchantActionRequest['action'] }) =>
        post<MissionLifecycleView>(`/orders/${v.orderId}/merchant`, { action: v.action }),
      ...opts,
    }),
    acknowledge: useMutation({
      mutationFn: (v: { orderId: string; quantityReceived: number; note?: string }) =>
        post<MissionLifecycleView>(`/orders/${v.orderId}/acknowledge`, {
          quantityReceived: v.quantityReceived,
          note: v.note,
        }),
      ...opts,
    }),
    reconcile: useMutation({ mutationFn: () => post<MissionLifecycleView>('/reconcile'), ...opts }),
    publish: useMutation({
      mutationFn: (v: PublishMissionRequest) => post<{ visibility: string }>('/publish', v),
      ...opts,
    }),
    repeat: useMutation({
      mutationFn: (v: { deadlineISO?: string } = {}) => post<{ missionId: string }>('/repeat', v),
    }),
    propose: useMutation({
      mutationFn: (v: SubmitProposalRequest) =>
        post<{ proposalId: string; recommendation: string }>('/proposals', v),
      ...opts,
    }),
    decide: useMutation({
      mutationFn: (v: { proposalId: string } & ProposalDecisionRequest) =>
        api(`/v1/proposals/${v.proposalId}/decision`, {
          method: 'POST',
          body: { action: v.action, counterUnitPriceMinor: v.counterUnitPriceMinor },
        }),
      ...opts,
    }),
  };
}

// ---------- NeedMesh marketplace, merchant workspace, org settings, outcomes ----------
export const useMarketplace = (q: { q?: string; category?: string }) =>
  useQuery({
    queryKey: ['marketplace', q.q ?? '', q.category ?? ''] as const,
    queryFn: () => {
      const p = new URLSearchParams();
      if (q.q) p.set('q', q.q);
      if (q.category) p.set('category', q.category);
      const s = p.toString();
      return api<MarketplaceView>(`/v1/marketplace/missions${s ? `?${s}` : ''}`);
    },
  });
export const useMerchantWorkspace = (enabled = true) =>
  useQuery({
    queryKey: ['merchant-workspace'] as const,
    queryFn: () => api<MerchantWorkspaceView>('/v1/merchant/workspace'),
    enabled,
  });
export const useOrgProfile = () =>
  useQuery({
    queryKey: ['org-profile'] as const,
    queryFn: () => api<OrgProfileView>('/v1/org/profile'),
  });
export const useAnalytics = () =>
  useQuery({
    queryKey: ['analytics'] as const,
    queryFn: () => api<AnalyticsView>('/v1/analytics'),
  });
export const useForecast = (enabled = true) =>
  useQuery({
    queryKey: ['forecast'] as const,
    queryFn: () => api<ShortageForecastView>('/v1/forecast'),
    enabled,
  });
export const useNotifications = () =>
  useQuery({
    queryKey: ['notifications'] as const,
    queryFn: () => api<NotificationView>('/v1/notifications'),
    refetchInterval: 30_000,
  });

export function useOrgSettings() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['org-profile'] });
  return {
    preferences: useMutation({
      mutationFn: (v: Preferences) =>
        api<OrgProfileView>('/v1/org/preferences', { method: 'PUT', body: v }),
      onSettled: refresh,
    }),
    verify: useMutation({
      mutationFn: (v: VerificationRequest) =>
        api<OrgProfileView>('/v1/org/verification', { method: 'POST', body: v }),
      onSettled: refresh,
    }),
  };
}

export function useProposalDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { proposalId: string } & ProposalDecisionRequest) =>
      api(`/v1/proposals/${v.proposalId}/decision`, {
        method: 'POST',
        body: { action: v.action, counterUnitPriceMinor: v.counterUnitPriceMinor },
      }),
    onSettled: () => qc.invalidateQueries(),
  });
}

export const useTwin = (id: string) =>
  useQuery({ queryKey: qk.twin(id), queryFn: () => api<TwinDetail>(`/v1/twins/${id}`) });
export const useThreads = (id: string) =>
  useQuery({
    queryKey: qk.twinPart(id, 'threads'),
    queryFn: () => api<ThreadsView>(`/v1/twins/${id}/threads`),
  });
export const useContrast = (id: string) =>
  useQuery({
    queryKey: qk.twinPart(id, 'contrast'),
    queryFn: () => api<ContrastView>(`/v1/twins/${id}/contrast`),
  });
export const useHealthBreakdown = (id: string) =>
  useQuery({
    queryKey: qk.twinPart(id, 'health-breakdown'),
    queryFn: () => api<HealthBreakdownView>(`/v1/twins/${id}/health-breakdown`),
  });
export const useSnapshots = (id: string) =>
  useQuery({
    queryKey: qk.twinPart(id, 'snapshots'),
    queryFn: () => api<SnapshotsPage>(`/v1/twins/${id}/snapshots?limit=50`),
  });
export const useSnapshot = (twinId: string, snapshotId: string | null) =>
  useQuery({
    queryKey: qk.snapshot(twinId, snapshotId ?? 'none'),
    queryFn: () => api<SnapshotDetail>(`/v1/twins/${twinId}/snapshots/${snapshotId}`),
    enabled: !!snapshotId,
    staleTime: Infinity,
  });

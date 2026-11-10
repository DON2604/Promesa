'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { StreamEvent } from '@promesa/contracts';
import { API_BASE_URL } from './api';
import { qk } from './queries';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

/**
 * Subscribes to the authenticated SSE stream. Events are invalidation hints only: the UI always
 * refetches the authoritative read model rather than trusting event payloads. EventSource resends
 * Last-Event-ID on reconnect, and the server replays from the outbox sequence.
 */
export function useEventStream(enabled: boolean): StreamStatus {
  const client = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource(`${API_BASE_URL}/v1/stream`, { withCredentials: true });
    let failures = 0;
    let lastSeq = 0;
    // One business action emits several outbox events; coalesce them into a single refetch.
    const pending = new Map<string, readonly unknown[]>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const queue = (key: readonly unknown[]) => {
      pending.set(JSON.stringify(key), key);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        for (const k of pending.values()) void client.invalidateQueries({ queryKey: k });
        pending.clear();
      }, 300);
    };

    source.onopen = () => {
      failures = 0;
      setStatus('live');
    };
    source.onmessage = (raw: MessageEvent<string>) => {
      let evt: StreamEvent;
      try {
        evt = JSON.parse(raw.data) as StreamEvent;
      } catch {
        return;
      }
      if (evt.seq <= lastSeq) return;
      lastSeq = evt.seq;
      queue(qk.dashboard);
      if (evt.aggregateType === 'twin') queue(qk.twin(evt.aggregateId));
      if (evt.aggregateType === 'purchase') queue(qk.purchase(evt.aggregateId));
      if (evt.aggregateType === 'mission') queue(qk.mission(evt.aggregateId));
      if (evt.aggregateType === 'demo') queue(qk.scenarios);
    };
    source.onerror = () => {
      failures += 1;
      setStatus(failures > 3 ? 'offline' : 'reconnecting');
    };
    return () => {
      clearTimeout(flushTimer);
      source.close();
    };
  }, [client, enabled]);

  return status;
}

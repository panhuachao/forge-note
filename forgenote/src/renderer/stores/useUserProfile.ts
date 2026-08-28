// 用户画像渲染层 Hook（doc/用户画像实现方案.md §6.3）
import { useCallback, useEffect, useState } from 'react';
import { useKBStore } from './kb-store';
import type { UserProfile } from '@shared/types';

export function useUserProfile() {
  const { activeKb } = useKBStore();
  const kbId = activeKb?.id;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!kbId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    try {
      const p = await window.forge.profile.get(kbId);
      setProfile(p);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  const save = useCallback(
    async (next: UserProfile) => {
      if (!kbId) return;
      const saved = await window.forge.profile.save(kbId, next);
      setProfile(saved);
      return saved;
    },
    [kbId]
  );

  const reset = useCallback(async () => {
    if (!kbId) return;
    const cleared = await window.forge.profile.reset(kbId);
    setProfile(cleared);
  }, [kbId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profile, loading, refresh, save, reset, kbId };
}

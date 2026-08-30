import { useEffect, useCallback } from 'react';
import { getReports } from '../api/client';
import { useApp } from '../context/AppContext';

/**
 * useReports — fetches /reports on mount.
 * Re-fetch is triggered manually after a successful POST.
 */
export function useReports() {
  const { actions } = useApp();

  const fetchReports = useCallback(async () => {
    try {
      const reports = await getReports();
      actions.setReports(Array.isArray(reports) ? reports : []);
    } catch (err) {
      console.warn('[useReports] fetch error:', err);
    }
  }, [actions]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return { refresh: fetchReports };
}

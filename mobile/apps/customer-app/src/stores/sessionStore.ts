import { create } from 'zustand';
import api from '../services/api.service';

interface SessionState {
  session: any | null;
  isLoading: boolean;
  error?: string | null;
  activateSession: (customerId: string, orderId: string, ttl: number) => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  isLoading: false,
  error: null,
  activateSession: async (customerId, orderId, ttl) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/api/v1/sessions', {
        customer_id: customerId,
        order_id: orderId,
        ttl_seconds: ttl,
      });
      set({ session: res.data, isLoading: false });
    } catch (e: any) {
      set({ error: e?.message || 'Activation failed', isLoading: false });
    }
  },
}));
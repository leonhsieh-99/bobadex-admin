import { writable } from 'svelte/store';

type Toast = {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
  ttl?: number;
};

function createToasts() {
  const { subscribe, update } = writable<Toast[]>([]);
  let id = 1;

  function push(kind: Toast['kind'], message: string, ttl = 2500) {
    const t: Toast = { id: id++, kind, message, ttl };
    update((list) => [...list, t]);
    if (ttl > 0) {
      setTimeout(() => dismiss(t.id), ttl);
    }
  }

  function dismiss(id: number) {
    update((list) => list.filter((t) => t.id !== id));
  }

  return {
    subscribe,
    success: (m: string, ttl?: number) => push('success', m, ttl),
    error: (m: string, ttl?: number) => push('error', m, ttl),
    info: (m: string, ttl?: number) => push('info', m, ttl),
    dismiss
  };
}

export const toasts = createToasts();

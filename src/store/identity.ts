import { defineStore } from 'pinia';
import { newId } from '@/utils/id';

function normalizeId(raw: string | undefined): string {
  const s = (raw ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  return s || '';
}

function storageKey(roomId: string, key: 'playerId' | 'displayName'): string {
  return `my-vue-game:room/${roomId}:${key}`;
}

export const useIdentityStore = defineStore('identity', {
  state: () => ({
    roomId: '' as string,
    playerId: '' as string,
    displayName: '' as string,
    joined: false as boolean,
  }),
  actions: {
    /** Try read persisted identity for a room */
    loadFromStorage(roomId: string): { playerId?: string; displayName?: string } {
      const pid = localStorage.getItem(storageKey(roomId, 'playerId')) || undefined;
      const name = localStorage.getItem(storageKey(roomId, 'displayName')) || undefined;
      return { playerId: pid, displayName: name };
    },

    /** Ensure a stable playerId for the room (persist if newly generated). */
    ensurePlayerId(roomId: string): string {
      const normRoom = normalizeId(roomId) || 'dev';
      const existing = localStorage.getItem(storageKey(normRoom, 'playerId'));
      if (existing) return existing;
      // Generate, normalize, and trim
      const gen = normalizeId(newId());
      const pid = gen || `p-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(storageKey(normRoom, 'playerId'), pid);
      return pid;
    },

    /** Set identity, persist, and expose globals for networking layer. */
    setIdentity(payload: { roomId: string; playerId: string; displayName: string }): void {
      const room = normalizeId(payload.roomId) || 'dev';
      const pid = normalizeId(payload.playerId);
      const name = (payload.displayName ?? '').toString().trim().slice(0, 12);

      this.roomId = room;
      this.playerId = pid;
      this.displayName = name;

      localStorage.setItem(storageKey(room, 'playerId'), pid);
      localStorage.setItem(storageKey(room, 'displayName'), name);

      // Expose globals consumed by broadcast/bootstrap
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.__ROOM__ = room;
      w.__PLAYER__ = pid;
      w.__NAME__ = name;
    },

    markJoined(): void {
      this.joined = true;
    },
  },
});

export default useIdentityStore;


// services/broadcast.ts
// In-memory message bus for dev/local testing.
// - Channel-scoped (one instance per room/channelName)
// - Topic-based publish/subscribe within a channel
// - Presence list per channel (id === playerId, as required)
//
// NOTE: This is an in-memory transport. It does NOT cross browser tabs or processes.

export interface IBroadcast {
  publish<T>(topic: string, payload: T): Promise<void>;
  subscribe<T>(topic: string, handler: (payload: T) => void): () => void;
  presence(): {
    // presence clientId MUST equal playerId (enforced by storing playerId as id)
    enter(meta: { playerId: string; name: string }): Promise<void>;
    leave(): Promise<void>;
    getMembers(): Promise<
      Array<{ id: string; data: { playerId: string; name: string } }>
    >;
  };
}

type TopicHandler<T = any> = (payload: T) => void;

type PresenceMeta = { playerId: string; name: string };

interface ChannelState {
  subs: Map<string, Set<TopicHandler>>;
  members: Map<string, PresenceMeta>;
}

const __registry = new Map<string, ChannelState>();

function getOrCreateChannel(name: string): ChannelState {
  let ch = __registry.get(name);
  if (!ch) {
    ch = { subs: new Map(), members: new Map() };
    __registry.set(name, ch);
  }
  return ch;
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/**
 * Create an in-memory broadcast bound to a channel (e.g. "game-ROOM123").
 * @param channelName Unique channel identifier (per room)
 * @param opts Optional latency simulation
 */
export function createMemoryBroadcast(
  channelName: string,
  opts?: { latencyMs?: number }
): IBroadcast {
  const channel = getOrCreateChannel(channelName);
  const latency = Math.max(0, opts?.latencyMs ?? 0);

  // Track the "local" presence for this instance so leave() knows whom to remove.
  let currentClientId: string | null = null;

  return {
    async publish<T>(topic: string, payload: T): Promise<void> {
      // Simulate network latency then fan-out to current subscribers snapshot.
      await delay(latency);
      const handlers = channel.subs.get(topic);
      if (!handlers || handlers.size === 0) return;

      // Copy before iterating to avoid mutation issues during delivery.
      const snapshot = Array.from(handlers);
      for (const fn of snapshot) {
        try {
          fn(payload as any);
        } catch (err) {
          // Isolate listener errors; log so devs can see issues during local runs.
          // eslint-disable-next-line no-console
          console.error('[broadcast] handler error on topic', topic, err);
        }
      }
    },

    subscribe<T>(topic: string, handler: (payload: T) => void): () => void {
      const set = channel.subs.get(topic) ?? new Set<TopicHandler>();
      set.add(handler as TopicHandler);
      channel.subs.set(topic, set);

      let unsubbed = false;
      return () => {
        if (unsubbed) return;
        unsubbed = true;
        const s = channel.subs.get(topic);
        if (!s) return;
        s.delete(handler as TopicHandler);
        if (s.size === 0) channel.subs.delete(topic);
      };
    },

    presence() {
      return {
        async enter(meta: { playerId: string; name: string }): Promise<void> {
          if (!meta || !meta.playerId) {
            throw new Error('presence.enter requires { playerId, name }');
          }
          currentClientId = meta.playerId;
          // Enforce presence id === playerId
          channel.members.set(meta.playerId, {
            playerId: meta.playerId,
            name: meta.name,
          });
          await delay(latency);
        },

        async leave(): Promise<void> {
          if (currentClientId) {
            channel.members.delete(currentClientId);
            currentClientId = null;
          }
          await delay(latency);
        },

        async getMembers(): Promise<
          Array<{ id: string; data: { playerId: string; name: string } }>
        > {
          await delay(latency);
          // Return deterministic order (lexicographic by id) to help tests/host-election.
          const list = Array.from(channel.members.values()).map((m) => ({
            id: m.playerId,
            data: { playerId: m.playerId, name: m.name },
          }));
          list.sort((a, b) => a.id.localeCompare(b.id));
          return list;
        },
      };
    },
  };
}

/**
 * Test helper: clear all channels/state. Useful between test cases.
 */
export function __resetMemoryBroadcast(): void {
  __registry.clear();
}

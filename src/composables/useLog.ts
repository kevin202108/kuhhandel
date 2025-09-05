import { readonly, ref, type Ref } from 'vue';

/**
 * 簡單的 UI 端 Log 工具：
 * - 本地維護一份可顯示於 HUD 的字串陣列。
 * - push 時自動加上 [HH:MM:SS] 前綴。
 * - 不與 store 綁定（Phase 2 不做持久化與外部副作用）。
 */

export interface UseLog {
  /** 供 UI 顯示的已格式化行（唯讀暴露） */
  lines: Readonly<Ref<readonly string[]>>;
  /** 推入一則訊息，回傳已格式化的字串 */
  push(msg: string): string;
  /** 清空本地 log 緩衝 */
  clear(): void;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function stamp(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function useLog(): UseLog {
  const buffer = ref<string[]>([]);

  function push(msg: string): string {
    const line = `[${stamp()}] ${msg}`;
    buffer.value = [...buffer.value, line];
    return line;
  }

  function clear(): void {
    buffer.value = [];
  }

  return { lines: readonly(buffer), push, clear };
}

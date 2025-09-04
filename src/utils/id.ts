// src/utils/id.ts
import { customAlphabet } from 'nanoid';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const nano = customAlphabet(alphabet, 21);

export function newId(): string {
  let id = nano();
  // 避免一開始就是符號，造成 'p--xxxx' 之類視覺混淆
  while (id.startsWith('-') || id.startsWith('_')) {
    id = nano();
  }
  return id;
}

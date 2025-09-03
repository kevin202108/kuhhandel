/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ABLY_API_KEY: string;
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

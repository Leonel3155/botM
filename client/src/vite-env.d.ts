/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Application ID del bot (Discord Developer Portal). Se usa para el enlace "Invitar bot". */
  readonly VITE_DISCORD_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

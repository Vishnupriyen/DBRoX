/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_SERVER_URL?: string; readonly VITE_SUPPORT_WHATSAPP?: string; readonly VITE_MAPS_KEY?: string }
interface ImportMeta { readonly env: ImportMetaEnv }

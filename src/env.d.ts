import type { ScopeApi } from "../electron/types";
declare global {
  const __APP_VERSION__: string;
  interface Window {
    scope: ScopeApi;
  }
}

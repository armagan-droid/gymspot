import { type ReactNode, createContext, useContext, useMemo } from "react";
import { type CredentialStore, type GymApi, createGymApi, localCredentialStore } from "./api/client";
import { type CameraResult, requestCamera } from "./camera";
import { createMediaPipeSource } from "./pose/mediapipe";
import type { PoseSource } from "./pose/source";
import { type CuePlayerDeps, browserCueDeps } from "./session/audio";
import { type QrScanner, createJsQrScanner } from "./station/scanner";
import { RecordQueue, indexedDbStorage } from "./sync/queue";
import { SyncService } from "./sync/service";
import type { PersistRecord } from "@gymspot/engine";

// Everything that touches the browser or the network, injectable for tests.

export interface RecordSink {
  push(record: PersistRecord): Promise<void>;
}

export interface AppServices {
  api: GymApi;
  store: CredentialStore;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  requestCamera: () => Promise<CameraResult>;
  createPoseSource: () => PoseSource;
  createScanner: () => QrScanner;
  /** Record queue per writer (device or member token). */
  createSync: (as: "device" | "member") => RecordSink;
  cueDeps: () => Pick<CuePlayerDeps, "files" | "playFile" | "speak">;
  now: () => number;
  online: () => boolean;
  newId: () => string;
  /** Saves a file on the device (data export, specs/07). */
  download: (filename: string, content: string) => void;
}

export function browserServices(): AppServices {
  const baseUrl = import.meta.env.VITE_API_URL ?? "/api";
  const store = localCredentialStore();
  const api = createGymApi({ baseUrl, store });
  return {
    api,
    store,
    storage: localStorage,
    requestCamera,
    createPoseSource: () => createMediaPipeSource("lite"),
    createScanner: createJsQrScanner,
    createSync: (as) => {
      const send = as === "device" ? api.ingestAsDevice : api.ingestAsMember;
      return new SyncService(new RecordQueue({ storage: indexedDbStorage(`gymspot-sync-${as}`), send }));
    },
    cueDeps: browserCueDeps,
    now: () => Date.now(),
    online: () => navigator.onLine,
    newId: () => crypto.randomUUID(),
    download: (filename, content) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  };
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ services, children }: { services?: AppServices; children: ReactNode }) {
  const value = useMemo(() => services ?? browserServices(), [services]);
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("useServices outside ServicesProvider");
  return s;
}

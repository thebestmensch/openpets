import { contextBridge, ipcRenderer } from "electron";
import type { OpenPetsEvent, OpenPetsState } from "@open-pets/core";
import type { LoadedCodexPet } from "@open-pets/pet-format-codex";

export type RendererPetState = {
  state: OpenPetsState;
  event?: OpenPetsEvent;
  activePet: (LoadedCodexPet & { spritesheetUrl: string }) | null;
  scale?: number;
};

const api = {
  onPetState(callback: (state: RendererPetState) => void) {
    const listener = (_event: unknown, state: RendererPetState) => callback(state);
    ipcRenderer.on("pet-state", listener);
    return () => {
      ipcRenderer.removeListener("pet-state", listener);
    };
  },
  ready() {
    ipcRenderer.send("renderer-ready");
  },
  windowAction(action: unknown) {
    if (action === "show" || action === "hide" || action === "sleep" || action === "quit") {
      ipcRenderer.send("window-action", action);
    }
  },
  setBubbleActive(active: boolean) {
    ipcRenderer.send("bubble-active", Boolean(active));
  },
  petInteraction(interaction: unknown) {
    if (!interaction || typeof interaction !== "object") return;
    const record = interaction as Record<string, unknown>;
    const type = record.type;
    if (type !== "drag-start" && type !== "drag-move" && type !== "drag-end" && type !== "click") return;
    ipcRenderer.send("pet-interaction", {
      type,
      screenX: typeof record.screenX === "number" ? record.screenX : 0,
      screenY: typeof record.screenY === "number" ? record.screenY : 0,
    });
  },
};

contextBridge.exposeInMainWorld("openPets", api);

declare global {
  interface Window {
    openPets: typeof api;
  }
}

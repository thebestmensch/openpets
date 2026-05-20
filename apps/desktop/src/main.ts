import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from "electron";
import type { MenuItemConstructorOptions, Rectangle } from "electron";
import {
  createInitialPetRuntimeState,
  createLifecycleLeaseState,
  createManualEvent,
  applyLeaseAction,
  getActiveLeaseCount,
  reducePetEvent,
  tickPetState,
  type LeaseParams,
  type OpenPetsEvent,
} from "@open-pets/core";
import type { OpenPetsHealthV2, OpenPetsWindowAction } from "@open-pets/core/ipc";
import { getOpenPetsConfigPath, getOpenPetsPetsDir, type OpenPetsConfig } from "@open-pets/core/config";
import { loadCodexPetDirectory, type LoadedCodexPet } from "@open-pets/pet-format-codex";
import { createDesktopIpcHandlers, startDesktopIpcServer, type DesktopIpcServerHandle } from "./ipc-server.js";

const CODEX_FRAME_WIDTH = 192;
const CODEX_FRAME_HEIGHT = 208;
const BASE_PIXEL_SCALE = 0.5;
const PET_SAFE_PAD_X = 12;
const PET_SAFE_PAD_TOP = 8;
const PET_SAFE_PAD_BOTTOM = 16;
const SPEECH_BUBBLE_SLOT_HEIGHT = 72;
const SPEECH_BUBBLE_MAX_OUTER_WIDTH = 168;
const MIN_WINDOW_WIDTH = 128;
const DEFAULT_PET_SCALE = 1;
const DEFAULT_FOCUS_FOLLOW_APP = "ghostty";
const FOCUS_POLL_INTERVAL_MS = 500;
const FOCUS_POLL_FAILURE_THRESHOLD = 5;

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let runtimeState = createInitialPetRuntimeState();
let lifecycleState = createLifecycleLeaseState({ managed: false });
let activePet: LoadedCodexPet | null = null;
let installedPets: LoadedCodexPet[] = [];
let config: OpenPetsConfig = {};
let expirationTimer: ReturnType<typeof setTimeout> | null = null;
let ipcServerHandle: DesktopIpcServerHandle | null = null;
let tray: Tray | null = null;
let debugMode = isDebugEnabled(process.argv);
let dragState: { startCursor: { x: number; y: number }; startBounds: Rectangle } | null = null;
let rendererReady = false;
let bubbleSlotActive = false;
let focusFollowHidden = false;
let focusPollTimer: ReturnType<typeof setInterval> | null = null;
let focusPollInFlight = false;
let focusPollFailures = 0;
let frontwinBinaryPath: string | null = null;
let frontwinLastWarningAt = 0;

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  void handleSecondInstance(argv);
});

app.whenReady().then(async () => {
  hideDockIcon();
  Menu.setApplicationMenu(null);
  installSecurityHeaders();
  debugLog("app ready", { argv: process.argv, debugMode });
  config = await loadConfig();
  await seedBundledPets();
  await applyArgv(process.argv);
  installedPets = await loadInstalledPets();
  await startLocalIpcServer();
  createTray();
  await createPetWindow();
  publishState();
  applyFocusFollowConfig();
});

app.on("before-quit", () => {
  void ipcServerHandle?.close();
  stopFocusFollow();
});

app.on("window-all-closed", () => {
  // Keep the pet process alive unless the user explicitly quits.
});

ipcMain.on("renderer-ready", () => {
  rendererReady = true;
  publishState();
});
ipcMain.on("window-action", (_event, action: unknown) => {
  if (isWindowAction(action)) {
    void handleWindowAction(action);
  }
});
ipcMain.on("pet-interaction", (_event, interaction: unknown) => handlePetInteraction(interaction));
ipcMain.on("bubble-active", (_event, active: unknown) => {
  setBubbleSlotActive(Boolean(active));
});

async function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const windowSize = getWindowContentSize();
  const initialPosition = config.position ?? {
    x: workArea.x + workArea.width - windowSize.width - 24,
    y: workArea.y + workArea.height - windowSize.height - 24,
  };
  const position = clampWindowPosition(initialPosition, windowSize);

  mainWindow = new BrowserWindow({
    width: windowSize.width,
    height: windowSize.height,
    useContentSize: true,
    x: position.x,
    y: position.y,
    transparent: !debugMode,
    frame: debugMode,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: debugMode,
    resizable: debugMode,
    movable: true,
    hasShadow: false,
    backgroundColor: debugMode ? "#1f2937" : "#00000000",
    show: false,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  debugLog("created window", { position, bounds: mainWindow.getBounds() });
  applyClickThroughState();
  mainWindow.on("moved", () => void saveWindowPosition());
  mainWindow.webContents.on("did-finish-load", () => {
    debugLog("renderer did-finish-load");
    showPetWindow("did-finish-load");
    applyClickThroughState();
    publishState();
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    debugLog("renderer did-fail-load", { errorCode, errorDescription, validatedURL });
  });
  mainWindow.once("ready-to-show", () => {
    debugLog("window ready-to-show");
    showPetWindow("ready-to-show");
  });
  hardenWindowNavigation(mainWindow);

  try {
    if (app.isPackaged) {
      await mainWindow.loadFile(join(__dirname, "renderer", "index.html"));
    } else {
      await mainWindow.loadURL("http://127.0.0.1:5173");
    }
  } catch (error) {
    const fallbackRenderer = join(__dirname, "renderer", "index.html");
    console.error(`OpenPets renderer load failed; trying built renderer. ${String(error)}`);
    await mainWindow.loadFile(fallbackRenderer).catch((fallbackError) => {
      console.error(`OpenPets built renderer load failed. ${String(fallbackError)}`);
    });
  }
  showPetWindow("post-load");
  if (debugMode) mainWindow.webContents.openDevTools({ mode: "detach" });
}

function showPetWindow(reason: string) {
  if (!mainWindow || config.hidden || focusFollowHidden) return;
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  if (debugMode) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    mainWindow.showInactive();
  }
  resizeWindowForCurrentScale();
  debugLog("show window", { reason, visible: mainWindow.isVisible(), bounds: mainWindow.getBounds() });
}

function hideDockIcon() {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
}

function createTray() {
  if (tray) return;
  tray = new Tray(getTrayIcon());
  tray.setToolTip("OpenPets");
  tray.on("double-click", () => {
    void handleWindowAction(config.hidden || !mainWindow?.isVisible() ? "show" : "hide");
  });
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(createTrayMenuTemplate()));
}

function createTrayMenuTemplate(): MenuItemConstructorOptions[] {
  const scale = normalizeScale(config.scale);
  const activePetLabel = activePet?.id ? `Pet: ${activePet.id}` : "Pet: Loading…";
  return [
    { label: "OpenPets", enabled: false },
    { type: "separator" },
    {
      label: config.hidden ? "Show Pet" : "Hide Pet",
      click: () => void handleWindowAction(config.hidden ? "show" : "hide"),
    },
    {
      label: "Sleep",
      click: () => void handleWindowAction("sleep"),
    },
    {
      label: "Click-through (lock pet)",
      type: "checkbox",
      checked: Boolean(config.clickThrough),
      click: () => void setClickThrough(!config.clickThrough),
    },
    {
      label: `Hide when ${getFocusFollowApp()} not on screen`,
      type: "checkbox",
      checked: Boolean(config.focusFollowEnabled),
      enabled: process.platform === "darwin",
      click: () => void setFocusFollowEnabled(!config.focusFollowEnabled),
    },
    { type: "separator" },
    {
      label: activePetLabel,
      enabled: false,
    },
    {
      label: "Installed Pets",
      submenu: createInstalledPetsSubmenu(),
    },
    {
      label: "Choose Pet…",
      click: () => void choosePetDirectory(),
    },
    {
      label: "Use Default Pet",
      click: () => void useDefaultPet(),
    },
    {
      label: "Scale",
      submenu: [0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({
        label: `${Math.round(value * 100)}%`,
        type: "radio" as const,
        checked: Math.abs(scale - value) < 0.001,
        click: () => void setPetScale(value),
      })),
    },
    { type: "separator" },
    {
      label: "Settings",
      submenu: [
        {
          label: "Open Config File",
          click: () => void openConfigFile(),
        },
        {
          label: "Reveal Config Folder",
          click: () => void revealConfigFolder(),
        },
        {
          label: `Active leases: ${getActiveLeaseCount(lifecycleState)}`,
          enabled: false,
        },
        {
          label: `Mode: ${lifecycleState.managed ? "Managed" : "Manual"}`,
          enabled: false,
        },
      ],
    },
    { type: "separator" },
    {
      label: "Quit OpenPets",
      click: () => void handleWindowAction("quit"),
    },
  ];
}

function createInstalledPetsSubmenu(): MenuItemConstructorOptions[] {
  if (installedPets.length === 0) {
    return [{ label: "No installed pets yet", enabled: false }];
  }

  return installedPets.map((pet) => ({
    label: pet.displayName || pet.id,
    sublabel: pet.id,
    type: "radio" as const,
    checked: activePet?.directory === pet.directory,
    click: () => void selectInstalledPet(pet.directory),
  }));
}

function getTrayIcon() {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "assets", "tray-icon.png")]
    : [join(__dirname, "../../../assets/tray-icon.png")];
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return image.resize({ width: 18, height: 18, quality: "best" });
  }
  return nativeImage.createEmpty();
}

function installSecurityHeaders() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' file: data:",
            "connect-src 'self' ws://127.0.0.1:5173 http://127.0.0.1:5173",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
          ].join("; "),
        ],
      },
    });
  });
}

function hardenWindowNavigation(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererNavigation(url)) {
      event.preventDefault();
    }
  });
}

function isAllowedRendererNavigation(url: string) {
  return url === "http://127.0.0.1:5173/" || url.startsWith(pathToFileURL(join(__dirname, "renderer")).href);
}

async function startLocalIpcServer() {
  if (ipcServerHandle) return;
  const handlers = createDesktopIpcHandlers({
    getHealth: getIpcHealth,
    applyEvent,
    handleWindowAction,
    handleLease,
    selectPet,
  });
  try {
    ipcServerHandle = await startDesktopIpcServer({
      handlers,
      onError: (error) => console.error(`OpenPets IPC server error: ${String(error)}`),
    });
    debugLog("ipc server started", { endpoint: ipcServerHandle.endpoint });
  } catch (error) {
    console.error(`OpenPets IPC server failed to start: ${String(error)}`);
    app.exit(1);
    return;
  }
}

function getIpcHealth(): OpenPetsHealthV2 {
  return {
    app: "openpets",
    ok: true,
    version: app.getVersion(),
    protocolVersion: 2,
    transport: "ipc",
    capabilities: ["event-v2", "window-v1", "speech-v1", "lease-v1", "pet-v1"],
    ready: Boolean(mainWindow && rendererReady && activePet),
    activePet: activePet?.id ?? null,
    activeLeases: getActiveLeaseCount(lifecycleState),
    managed: lifecycleState.managed,
    debug: debugMode,
    window: mainWindow
      ? {
          visible: mainWindow.isVisible(),
          bounds: mainWindow.getBounds(),
          focused: mainWindow.isFocused(),
        }
      : null,
  };
}

function handleLease(params: LeaseParams) {
  const result = applyLeaseAction(lifecycleState, params);
  if (!result.ok) {
    const error = new Error(result.error) as Error & { code: "invalid-params" };
    error.code = "invalid-params";
    throw error;
  }
  updateTrayMenu();
  return result.result;
}

function applyEvent(event: OpenPetsEvent) {
  runtimeState = reducePetEvent(tickPetState(runtimeState), event);
  publishState();
  scheduleExpiration();
}

function publishState() {
  resizeWindowForCurrentScale();
  mainWindow?.webContents.send("pet-state", {
    state: runtimeState.rendered,
    event: runtimeState.event,
    activePet: activePet ? { ...activePet, spritesheetUrl: pathToFileURL(activePet.spritesheetPath).href } : null,
    scale: normalizeScale(config.scale),
  });
  updateTrayMenu();
}

async function handleSecondInstance(argv: string[]) {
  const action = await applyArgv(argv);
  if (action !== "hide" && action !== "quit") {
    showPetWindow("second-instance");
  }
  publishState();
}

async function applyArgv(argv: string[]) {
  debugMode = debugMode || isDebugEnabled(argv);
  const actionIndex = argv.indexOf("--openpets-action");
  const action = actionIndex >= 0 ? argv[actionIndex + 1] : undefined;

  const petIndex = argv.indexOf("--pet");
  const petPath = petIndex >= 0 ? argv[petIndex + 1] : undefined;
  const scaleIndex = argv.indexOf("--scale");
  const scaleValue = scaleIndex >= 0 ? Number(argv[scaleIndex + 1]) : NaN;
  if (Number.isFinite(scaleValue)) {
    config = { ...config, scale: normalizeScale(scaleValue) };
    await saveConfig(config);
    resizeWindowForCurrentScale();
  }
  if (petPath) {
    const loaded = await loadCodexPetDirectory(resolve(petPath));
    if (loaded.ok) {
      activePet = loaded.pet;
      config = { ...config, petPath: activePet.directory };
      await saveConfig(config);
    } else {
      console.error(loaded.issues.map((item) => item.message).join("\n"));
    }
  } else if (config.petPath) {
    const loaded = await loadCodexPetDirectory(config.petPath);
    if (loaded.ok) {
      activePet = loaded.pet;
    } else {
      console.error(loaded.issues.map((item) => item.message).join("\n"));
      await loadDefaultPet();
    }
  } else {
    await loadDefaultPet();
  }

  if (action === "show" || action === "hide" || action === "sleep" || action === "quit") {
    await handleWindowAction(action);
  }
  return action;
}

async function handleWindowAction(action: OpenPetsWindowAction) {
  switch (action) {
    case "show":
      config = { ...config, hidden: false };
      await saveConfig(config);
      showPetWindow("show-action");
      updateTrayMenu();
      break;
    case "hide":
      config = { ...config, hidden: true };
      await saveConfig(config);
      mainWindow?.hide();
      updateTrayMenu();
      break;
    case "sleep":
      applyEvent(createManualEvent("sleeping", { source: "desktop" }));
      break;
    case "quit":
      app.exit(0);
      break;
  }
}

async function choosePetDirectory() {
  const result = await dialog.showOpenDialog({
    title: "Choose OpenPets pet folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return;

  const loaded = await loadCodexPetDirectory(result.filePaths[0]);
  if (!loaded.ok) {
    await dialog.showMessageBox({
      type: "error",
      title: "Invalid pet folder",
      message: "That folder is not a valid OpenPets/Codex pet.",
      detail: loaded.issues.map((item) => item.message).join("\n"),
    });
    return;
  }

  activePet = loaded.pet;
  config = { ...config, petPath: activePet.directory };
  await saveConfig(config);
  installedPets = await loadInstalledPets();
  publishState();
}

async function selectPet(params: { path: string }) {
  const loaded = await loadCodexPetDirectory(resolve(params.path));
  if (!loaded.ok) {
    throw new Error(loaded.issues.map((item) => item.message).join("\n"));
  }

  activePet = loaded.pet;
  config = { ...config, petPath: activePet.directory, hidden: false };
  await saveConfig(config);
  installedPets = await loadInstalledPets();
  showPetWindow("select-pet");
  publishState();
  return {
    pet: {
      id: activePet.id,
      displayName: activePet.displayName,
      directory: activePet.directory,
    },
  };
}

async function selectInstalledPet(directory: string) {
  await selectPet({ path: directory }).catch(async (error: unknown) => {
    await dialog.showMessageBox({
      type: "error",
      title: "Could not switch pet",
      message: error instanceof Error ? error.message : "OpenPets could not load that pet.",
    });
  });
}

async function loadInstalledPets() {
  const petsDir = getOpenPetsPetsDir();
  const entries = await readdir(petsDir, { withFileTypes: true }).catch(() => []);
  const pets: LoadedCodexPet[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const loaded = await loadCodexPetDirectory(join(petsDir, entry.name));
    if (loaded.ok) pets.push(loaded.pet);
  }
  return pets.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function useDefaultPet() {
  const seeded = await loadCodexPetDirectory(bundledPetTargetDir(DEFAULT_PET_SLUG));
  const loaded = seeded.ok ? seeded : await loadCodexPetDirectory(getBundledDefaultPetPath());
  if (!loaded.ok) return;
  activePet = loaded.pet;
  const { petPath: _petPath, ...nextConfig } = config;
  config = nextConfig;
  await saveConfig(config);
  publishState();
}

async function setPetScale(scale: number) {
  config = { ...config, scale: normalizeScale(scale) };
  await saveConfig(config);
  resizeWindowForCurrentScale();
  publishState();
}

async function setClickThrough(enabled: boolean) {
  config = { ...config, clickThrough: enabled };
  await saveConfig(config);
  applyClickThroughState();
  updateTrayMenu();
}

function applyClickThroughState() {
  if (!mainWindow) return;
  if (debugMode) return;
  mainWindow.setIgnoreMouseEvents(Boolean(config.clickThrough), { forward: true });
}

async function openConfigFile() {
  await mkdir(dirname(getOpenPetsConfigPath()), { recursive: true });
  await saveConfig(config);
  await reportShellOpenFailure("Open config file", shell.openPath(getOpenPetsConfigPath()));
}

async function revealConfigFolder() {
  const configDir = dirname(getOpenPetsConfigPath());
  await mkdir(configDir, { recursive: true });
  await reportShellOpenFailure("Reveal config folder", shell.openPath(configDir));
}

async function reportShellOpenFailure(title: string, operation: Promise<string>) {
  const error = await operation;
  if (!error) return;
  await dialog.showMessageBox({
    type: "error",
    title,
    message: "OpenPets could not open that path.",
    detail: error,
  });
}

function isWindowAction(action: unknown): action is "show" | "hide" | "sleep" | "quit" {
  return action === "show" || action === "hide" || action === "sleep" || action === "quit";
}

function handlePetInteraction(interaction: unknown) {
  if (!mainWindow || !interaction || typeof interaction !== "object") return;
  const record = interaction as Record<string, unknown>;
  const type = record.type;
  const screenX = typeof record.screenX === "number" ? record.screenX : 0;
  const screenY = typeof record.screenY === "number" ? record.screenY : 0;

  if (type === "click") {
    debugLog("pet click");
    return;
  }

  if (type === "drag-start") {
    dragState = {
      startCursor: { x: screenX, y: screenY },
      startBounds: mainWindow.getBounds(),
    };
    return;
  }

  if (type === "drag-move" && dragState) {
    const nextX = Math.round(dragState.startBounds.x + screenX - dragState.startCursor.x);
    const nextY = Math.round(dragState.startBounds.y + screenY - dragState.startCursor.y);
    const currentBounds = mainWindow.getBounds();
    if (currentBounds.x === nextX && currentBounds.y === nextY) return;
    mainWindow.setPosition(nextX, nextY, false);
    return;
  }

  if (type === "drag-end") {
    dragState = null;
    void saveWindowPosition();
  }
}

let savingWindowPosition = false;
async function saveWindowPosition() {
  if (dragState) return;
  // Re-entrancy guard: our own setPosition below emits a "moved" event, which
  // re-enters here. The clamp is idempotent so it short-circuits in the steady
  // state, but if anything resizes the window between the user's drop and the
  // re-entry (e.g. a bubble-active IPC firing), the clamp picks a slightly
  // different position and we ping-pong before settling. Single-flight it.
  if (savingWindowPosition) return;
  savingWindowPosition = true;
  try {
    const bounds = mainWindow?.getBounds();
    if (!bounds) return;
    // Clamp to workArea: macOS NSWindow.constrainFrameRect snaps off-screen
    // windows back inside on the next show, which looked like the pet drifting
    // on hide/show cycles when the user dragged it partially off-screen (most
    // visible at the right edge). Apply the snap now so what they drop is
    // where it stays.
    const clamped = clampWindowPosition({ x: bounds.x, y: bounds.y }, { width: bounds.width, height: bounds.height });
    if ((clamped.x !== bounds.x || clamped.y !== bounds.y) && mainWindow) {
      mainWindow.setPosition(clamped.x, clamped.y, false);
    }
    config = { ...config, position: clamped };
    await saveConfig(config);
  } finally {
    savingWindowPosition = false;
  }
}

async function loadConfig(): Promise<OpenPetsConfig> {
  try {
    const content = await readFile(getOpenPetsConfigPath(), "utf8");
    return JSON.parse(content) as OpenPetsConfig;
  } catch {
    return {};
  }
}

async function saveConfig(nextConfig: OpenPetsConfig) {
  const configPath = getOpenPetsConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
}

function scheduleExpiration() {
  if (expirationTimer) {
    clearTimeout(expirationTimer);
    expirationTimer = null;
  }
  if (runtimeState.temporaryUntil === null) return;
  const delay = Math.max(0, runtimeState.temporaryUntil - Date.now());
  expirationTimer = setTimeout(() => {
    runtimeState = tickPetState(runtimeState);
    publishState();
    scheduleExpiration();
  }, delay + 5);
}

async function loadDefaultPet() {
  const seededPath = bundledPetTargetDir(DEFAULT_PET_SLUG);
  const seeded = await loadCodexPetDirectory(seededPath);
  if (seeded.ok) {
    activePet = seeded.pet;
    config = { ...config, petPath: activePet.directory };
    await saveConfig(config);
    return;
  }
  const fallback = await loadCodexPetDirectory(getBundledDefaultPetPath());
  if (fallback.ok) {
    activePet = fallback.pet;
  } else {
    console.error(fallback.issues.map((item) => item.message).join("\n"));
  }
}

const BUNDLED_PET_SLUGS = ["bean", "gia", "ruthie", "ollie", "couple"] as const;
const DEFAULT_PET_SLUG: (typeof BUNDLED_PET_SLUGS)[number] = "bean";

function getBundledPetsRoot() {
  if (app.isPackaged) {
    return join(process.resourcesPath, "pets");
  }
  return resolve(__dirname, "../../../examples/pets");
}

function getBundledDefaultPetPath() {
  return join(getBundledPetsRoot(), DEFAULT_PET_SLUG);
}

function bundledPetTargetDir(slug: string) {
  const hash = createHash("sha256").update(`bundled:${slug}`).digest("hex").slice(0, 8);
  return join(getOpenPetsPetsDir(), `${slug}-${hash}`);
}

async function seedBundledPets() {
  const root = getBundledPetsRoot();
  const petsDir = getOpenPetsPetsDir();
  await mkdir(petsDir, { recursive: true });

  for (const slug of BUNDLED_PET_SLUGS) {
    const source = join(root, slug);
    const target = bundledPetTargetDir(slug);

    const existing = await loadCodexPetDirectory(target);
    if (existing.ok) continue;

    const stagingDir = `${target}.tmp-${process.pid}-${Date.now()}`;
    try {
      await rm(stagingDir, { recursive: true, force: true });
      await cp(source, stagingDir, { recursive: true, errorOnExist: false, force: true });
      const staged = await loadCodexPetDirectory(stagingDir);
      if (!staged.ok) {
        console.error(
          `Failed to validate seeded pet ${slug}:`,
          staged.issues.map((item) => item.message).join("\n"),
        );
        await rm(stagingDir, { recursive: true, force: true });
        continue;
      }
      await rm(target, { recursive: true, force: true });
      await rename(stagingDir, target);
    } catch (error) {
      console.error(`Failed to seed bundled pet ${slug}:`, error);
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function normalizeScale(scale: unknown) {
  return typeof scale === "number" && Number.isFinite(scale)
    ? Math.min(2, Math.max(0.25, scale))
    : DEFAULT_PET_SCALE;
}

function getVisualScale() {
  return normalizeScale(config.scale) * BASE_PIXEL_SCALE;
}

function getWindowContentSize() {
  const visualScale = getVisualScale();
  const petWidth = Math.ceil(CODEX_FRAME_WIDTH * visualScale);
  const petHeight = Math.ceil(CODEX_FRAME_HEIGHT * visualScale);
  const bubbleSlot = bubbleSlotActive ? SPEECH_BUBBLE_SLOT_HEIGHT : 0;
  // When the speech bubble is showing, reserve its full max width so word-wrap is stable.
  // When it's not, shrink to the pet's actual bounding box so the user can park the pet
  // close to a screen edge without transparent padding pushing the window off-screen.
  const bubbleWidthFloor = bubbleSlotActive ? SPEECH_BUBBLE_MAX_OUTER_WIDTH : 0;
  return {
    width: Math.ceil(Math.max(petWidth + PET_SAFE_PAD_X * 2, bubbleWidthFloor, MIN_WINDOW_WIDTH)),
    height: Math.ceil(bubbleSlot + PET_SAFE_PAD_TOP + petHeight + PET_SAFE_PAD_BOTTOM),
  };
}

function setBubbleSlotActive(active: boolean) {
  if (bubbleSlotActive === active) return;
  bubbleSlotActive = active;
  resizeWindowForCurrentScale();
}

function clampWindowPosition(position: { x: number; y: number }, size: { width: number; height: number }) {
  const { workArea } = screen.getDisplayNearestPoint(position);
  return {
    x: clamp(position.x, workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(position.y, workArea.y, workArea.y + workArea.height - size.height),
  };
}

function resizeWindowForCurrentScale() {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) return;
  const size = getWindowContentSize();
  const [currentWidth, currentHeight] = mainWindow.getContentSize();
  if (currentWidth === size.width && currentHeight === size.height) return;

  const oldBounds = mainWindow.getBounds();
  const anchorX = oldBounds.x + oldBounds.width;
  const anchorY = oldBounds.y + oldBounds.height;
  mainWindow.setContentSize(size.width, size.height, false);

  const newBounds = mainWindow.getBounds();
  const { workArea } = screen.getDisplayMatching(oldBounds);
  const nextX = clamp(anchorX - newBounds.width, workArea.x, workArea.x + workArea.width - newBounds.width);
  const nextY = clamp(anchorY - newBounds.height, workArea.y, workArea.y + workArea.height - newBounds.height);
  mainWindow.setPosition(nextX, nextY, false);
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function getFocusFollowApp() {
  const raw = config.focusFollowApp;
  return typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_FOCUS_FOLLOW_APP;
}

function applyFocusFollowConfig() {
  if (config.focusFollowEnabled && process.platform === "darwin") {
    startFocusFollow();
  } else {
    stopFocusFollow();
  }
}

function startFocusFollow() {
  if (focusPollTimer) return;
  void pollFocusOnce();
  focusPollTimer = setInterval(() => void pollFocusOnce(), FOCUS_POLL_INTERVAL_MS);
}

function stopFocusFollow() {
  if (focusPollTimer) {
    clearInterval(focusPollTimer);
    focusPollTimer = null;
  }
  focusPollFailures = 0;
  if (focusFollowHidden) {
    focusFollowHidden = false;
    showPetWindow("focus-follow-disabled");
  }
}

async function pollFocusOnce() {
  if (focusPollInFlight) return;
  focusPollInFlight = true;
  try {
    const target = getFocusFollowApp();
    const visible = await isTargetAppOnScreen(target);
    if (visible === null) {
      focusPollFailures += 1;
      if (focusPollFailures >= FOCUS_POLL_FAILURE_THRESHOLD && config.focusFollowEnabled) {
        await handleFocusFollowPersistentFailure();
      }
      return;
    }
    focusPollFailures = 0;
    if (visible && focusFollowHidden) {
      focusFollowHidden = false;
      showPetWindow("focus-follow-match");
    } else if (!visible && !focusFollowHidden) {
      focusFollowHidden = true;
      mainWindow?.hide();
    }
  } finally {
    focusPollInFlight = false;
  }
}

let lastDetectionPath: "frontwin" | "osascript" = "osascript";
async function isTargetAppOnScreen(target: string): Promise<boolean | null> {
  const bin = await resolveFrontwinBinary();
  if (bin) {
    lastDetectionPath = "frontwin";
    return runFrontwin(bin, target);
  }
  lastDetectionPath = "osascript";
  const frontmost = await getFrontmostAppName();
  if (frontmost === null) return null;
  return frontmost.toLowerCase() === target.toLowerCase();
}

function runFrontwin(bin: string, target: string): Promise<boolean | null> {
  return new Promise((resolveResult) => {
    execFile(bin, [target], { timeout: 1500 }, (error, stdout) => {
      if (error) {
        resolveResult(null);
        return;
      }
      const verdict = stdout.trim();
      if (verdict === "visible") resolveResult(true);
      else if (verdict === "hidden") resolveResult(false);
      else resolveResult(null);
    });
  });
}

async function resolveFrontwinBinary(): Promise<string | null> {
  // Cached when the helper exists; re-checked on each call when missing so a
  // mid-session rebuild (e.g. `bun run build:frontwin`) recovers without
  // restarting the app. Warning is throttled to once per 5 minutes.
  if (frontwinBinaryPath) return frontwinBinaryPath;
  if (process.platform !== "darwin") return null;

  const candidate = app.isPackaged
    ? join(process.resourcesPath, "helpers", "frontwin")
    : resolve(__dirname, "frontwin");
  try {
    await stat(candidate);
    frontwinBinaryPath = candidate;
    return candidate;
  } catch (error) {
    const now = Date.now();
    if (now - frontwinLastWarningAt > 5 * 60_000) {
      frontwinLastWarningAt = now;
      console.error(
        `OpenPets: frontwin helper not found at ${candidate}; focus-follow will fall back to frontmost-only detection ` +
          `(floating panels such as the Ghostty hotkey terminal will not be detected). ${String(error)}`,
      );
    }
    return null;
  }
}

async function handleFocusFollowPersistentFailure() {
  const target = getFocusFollowApp();
  const usedFrontwin = lastDetectionPath === "frontwin";
  const detail = usedFrontwin
    ? "The bundled window-detection helper failed repeatedly. Reinstall OpenPets, or rebuild from source with `bun run build:frontwin`, then re-enable from the tray menu."
    : "Grant Automation access to System Events in System Settings → Privacy & Security → Automation, then re-enable from the tray menu.";
  console.error(
    `OpenPets: focus-follow disabled after ${FOCUS_POLL_FAILURE_THRESHOLD} consecutive detection failures via ${lastDetectionPath}. ${detail}`,
  );
  // Re-check enabled state before showing UI: user may have toggled off between
  // the last poll and now.
  if (!config.focusFollowEnabled) return;
  await setFocusFollowEnabled(false);
  void dialog.showMessageBox({
    type: "warning",
    title: "OpenPets focus-follow disabled",
    message: `OpenPets can't tell whether ${target} is on screen, so "Hide when ${target} not on screen" has been turned off.`,
    detail,
  });
}

function getFrontmostAppName(): Promise<string | null> {
  return new Promise((resolveName) => {
    execFile(
      "osascript",
      ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'],
      { timeout: 1500 },
      (error, stdout) => {
        if (error) {
          resolveName(null);
          return;
        }
        const name = stdout.trim();
        resolveName(name || null);
      },
    );
  });
}

async function setFocusFollowEnabled(enabled: boolean) {
  config = { ...config, focusFollowEnabled: enabled };
  await saveConfig(config);
  applyFocusFollowConfig();
  updateTrayMenu();
}

function isDebugEnabled(argv: string[]) {
  return process.env.OPENPETS_DEBUG === "1" || argv.includes("--debug") || argv.includes("--openpets-debug");
}

function debugLog(message: string, details?: unknown) {
  if (!debugMode) return;
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.error(`[openpets:debug] ${message}${suffix}`);
}

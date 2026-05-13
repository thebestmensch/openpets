import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { OpenPetsState } from "@open-pets/core";
import { codexStates, getCodexStateForOpenPetsState, type CodexStateId } from "@open-pets/core";
import type { RendererPetState } from "../../preload";
import "./styles.css";

const BASE_PIXEL_SCALE = 0.5;
const DRAG_START_PX = 8;
const DIRECTION_ENTER_SPEED = 0.08;
const DIRECTION_FLIP_DISTANCE = 16;
const DIRECTION_FLIP_MIN_MS = 140;
const DIRECTION_NEUTRAL_AFTER_MS = 180;
const VELOCITY_SMOOTHING = 0.7;

type DragVisualDirection = "left" | "right" | "neutral";

const initialState: RendererPetState = {
  state: "idle",
  activePet: null,
};

export function App() {
  const [petState, setPetState] = useState<RendererPetState>(initialState);
  const [visibleMessage, setVisibleMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.openPets.onPetState((state) => setPetState(state));
    window.openPets.ready();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const message = petState.event?.message;
    if (!message) {
      setVisibleMessage(null);
      const id = requestAnimationFrame(() => window.openPets.setBubbleActive(false));
      return () => cancelAnimationFrame(id);
    }

    window.openPets.setBubbleActive(true);
    const showId = requestAnimationFrame(() => setVisibleMessage(message));
    const timeout = setTimeout(
      () => {
        setVisibleMessage(null);
        requestAnimationFrame(() => window.openPets.setBubbleActive(false));
      },
      petState.event?.state === "success" || petState.event?.state === "error" ? 5000 : 4000,
    );
    return () => {
      cancelAnimationFrame(showId);
      clearTimeout(timeout);
    };
  }, [petState.event?.message, petState.event?.timestamp, petState.event?.state]);

  return (
    <main className="overlay-shell">
      <div className={`pet-container${visibleMessage ? " has-bubble" : ""}`}>
        {visibleMessage ? <div className="speech-bubble">{visibleMessage}</div> : null}
        <PetSprite
          state={petState.state}
          scale={(petState.scale ?? 1) * BASE_PIXEL_SCALE}
          {...(petState.activePet?.spritesheetUrl
            ? { spritesheetUrl: petState.activePet.spritesheetUrl }
            : {})}
        />
      </div>
    </main>
  );
}

function PetSprite({ state, scale, spritesheetUrl }: { state: OpenPetsState; scale: number; spritesheetUrl?: string }) {
  const [interactionCodexId, setInteractionCodexId] = useState<CodexStateId | null>(null);
  const pointer = useRef<{
    id: number;
    startScreenX: number;
    startScreenY: number;
    lastScreenX: number;
    lastScreenY: number;
    lastMoveAt: number;
    neutralTimer: ReturnType<typeof setTimeout> | undefined;
    smoothedVx: number;
    visualDirection: DragVisualDirection;
    oppositeDistance: number;
    lastDirectionChangeAt: number;
    dragging: boolean;
  } | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactionToken = useRef(0);
  const latestDragPoint = useRef<{ screenX: number; screenY: number } | null>(null);
  const rafId = useRef<number | null>(null);
  const codexState = useMemo(() => {
    if (interactionCodexId) {
      return codexStates.find((item) => item.id === interactionCodexId) ?? getCodexStateForOpenPetsState(state);
    }
    return getCodexStateForOpenPetsState(state);
  }, [interactionCodexId, state]);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearNeutralTimer();
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
  }, []);

  function setInteraction(next: CodexStateId | null) {
    setInteractionCodexId((current) => (current === next ? current : next));
  }

  function clearNeutralTimer(current = pointer.current) {
    if (current?.neutralTimer) {
      clearTimeout(current.neutralTimer);
      current.neutralTimer = undefined;
    }
  }

  function scheduleNeutralTimer(current: NonNullable<typeof pointer.current>) {
    clearNeutralTimer(current);
    current.neutralTimer = setTimeout(() => {
      if (pointer.current !== current || !current.dragging) return;
      current.visualDirection = "neutral";
      current.oppositeDistance = 0;
      setInteraction("waving");
    }, DIRECTION_NEUTRAL_AFTER_MS);
  }

  function clearInteractionSoon(delayMs = 700) {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    const token = ++interactionToken.current;
    clearTimer.current = setTimeout(() => {
      if (interactionToken.current === token) setInteraction(null);
    }, delayMs);
  }

  function cancelInteractionClear() {
    interactionToken.current += 1;
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
  }

  function queueDragMove(screenX: number, screenY: number) {
    latestDragPoint.current = { screenX, screenY };
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      const point = latestDragPoint.current;
      if (!point) return;
      window.openPets.petInteraction({ type: "drag-move", screenX: point.screenX, screenY: point.screenY });
    });
  }

  function flushDragMove() {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    const point = latestDragPoint.current;
    if (point) {
      window.openPets.petInteraction({ type: "drag-move", screenX: point.screenX, screenY: point.screenY });
    }
    latestDragPoint.current = null;
  }

  function updateDragVisual(current: NonNullable<typeof pointer.current>, screenX: number, screenY: number, now: number) {
    const elapsed = Math.max(1, now - current.lastMoveAt);
    const deltaX = screenX - current.lastScreenX;
    const instantVx = deltaX / elapsed;
    current.smoothedVx = current.smoothedVx * VELOCITY_SMOOTHING + instantVx * (1 - VELOCITY_SMOOTHING);

    const speed = Math.abs(current.smoothedVx);
    const candidate: DragVisualDirection = speed >= DIRECTION_ENTER_SPEED
      ? current.smoothedVx > 0 ? "right" : "left"
      : "neutral";

    if (candidate === "neutral") {
      if (current.visualDirection !== "neutral") {
        current.visualDirection = "neutral";
        current.oppositeDistance = 0;
        current.lastDirectionChangeAt = now;
        setInteraction("waving");
      }
    } else if (current.visualDirection === "neutral") {
      current.visualDirection = candidate;
      current.oppositeDistance = 0;
      current.lastDirectionChangeAt = now;
      setInteraction(candidate === "right" ? "running-right" : "running-left");
    } else if (candidate !== current.visualDirection) {
      current.oppositeDistance += Math.abs(deltaX);
      if (
        current.oppositeDistance >= DIRECTION_FLIP_DISTANCE &&
        now - current.lastDirectionChangeAt >= DIRECTION_FLIP_MIN_MS
      ) {
        current.visualDirection = candidate;
        current.oppositeDistance = 0;
        current.lastDirectionChangeAt = now;
        setInteraction(candidate === "right" ? "running-right" : "running-left");
      }
    } else {
      current.oppositeDistance = 0;
    }

    current.lastScreenX = screenX;
    current.lastScreenY = screenY;
    current.lastMoveAt = now;
    scheduleNeutralTimer(current);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    cancelInteractionClear();
    event.currentTarget.setPointerCapture(event.pointerId);
    const now = performance.now();
    pointer.current = {
      id: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      lastMoveAt: now,
      neutralTimer: undefined,
      smoothedVx: 0,
      visualDirection: "neutral",
      oppositeDistance: 0,
      lastDirectionChangeAt: now,
      dragging: false,
    };
    setInteraction("waving");
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishPointerInteraction(event);
      return;
    }
    event.preventDefault();
    const deltaX = event.screenX - current.startScreenX;
    const deltaY = event.screenY - current.startScreenY;
    const moved = Math.hypot(deltaX, deltaY) > DRAG_START_PX;
    if (!current.dragging && moved) {
      current.dragging = true;
      window.openPets.petInteraction({ type: "drag-start", screenX: current.startScreenX, screenY: current.startScreenY });
      scheduleNeutralTimer(current);
    }
    if (current.dragging) {
      updateDragVisual(current, event.screenX, event.screenY, performance.now());
      queueDragMove(event.screenX, event.screenY);
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    finishPointerInteraction(event);
  }

  function finishPointerInteraction(event: PointerEvent<HTMLDivElement>) {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearNeutralTimer(current);
    if (current.dragging) {
      latestDragPoint.current = { screenX: event.screenX, screenY: event.screenY };
      flushDragMove();
      window.openPets.petInteraction({ type: "drag-end", screenX: event.screenX, screenY: event.screenY });
      setInteraction("waving");
      clearInteractionSoon(740);
    } else {
      window.openPets.petInteraction({ type: "click", screenX: event.screenX, screenY: event.screenY });
      setInteraction("waving");
      clearInteractionSoon(900);
    }
    pointer.current = null;
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    const current = pointer.current;
    clearNeutralTimer(current);
    if (current?.dragging) {
      latestDragPoint.current = { screenX: event.screenX, screenY: event.screenY };
      flushDragMove();
      window.openPets.petInteraction({ type: "drag-end", screenX: event.screenX, screenY: event.screenY });
    }
    pointer.current = null;
    clearInteractionSoon(200);
  }

  return (
    <div
      className="pet-hitbox"
      aria-label={`OpenPets ${state}`}
      role="img"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      <div className="pet-sprite-frame" style={{ "--pet-scale": scale } as CSSProperties}>
        {spritesheetUrl ? (
          <div
            className="pet-sprite"
            style={
              {
                "--sprite-url": `url(${spritesheetUrl})`,
                "--sprite-row": codexState.row,
                "--sprite-frames": codexState.frames,
                "--sprite-duration": `${codexState.durationMs}ms`,
              } as CSSProperties
            }
          />
        ) : (
          <div className="fallback-pet" style={{ "--pet-scale": scale } as CSSProperties}>🐾</div>
        )}
      </div>
    </div>
  );
}

export default App;

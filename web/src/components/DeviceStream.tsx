import { useEffect, useRef } from "react";
import type { Platform } from "../types";
import { PhoneMockup } from "./PhoneMockup";

const MSG_CONFIG = 1;
const MSG_VIDEO = 2;
const MSG_JPEG = 3;

const ACTION_DOWN = 0;
const ACTION_UP = 1;
const ACTION_MOVE = 2;

const KEYCODE_BACK = 4;
const KEYCODE_HOME = 3;
const KEYCODE_APP_SWITCH = 187;
const KEYCODE_ENTER = 66;
const KEYCODE_DEL = 67;

interface DeviceStreamProps {
  deviceId: string;
  platform: Platform;
  mockupId: string;
  /** When true, Esc is reserved for stop-and-save (handled in App). */
  recordingActive?: boolean;
  /** Landscape phone chrome + upright stream (device already rotated via ADB). */
  landscape?: boolean;
}

/** Which device currently receives PC keyboard input (hover or last click). */
let keyboardTargetId: string | null = null;

type TextInjector = (text: string) => void;
const textInjectors = new Map<string, TextInjector>();

/**
 * Synchronous host clipboard mirror — only from intentional copies (Ctrl+C/X).
 * Idle devices must not push their local clipboard into the browser/system clipboard.
 */
let hostClipboardMirror = "";
let hostClipboardMirrorAt = 0;

/** Last clipboard text reported by each device (for change detection). */
const deviceClipboards = new Map<string, string>();

/** Device ids with an in-flight Ctrl+C/X clipboard_get. */
const pendingClipboardGets = new Set<string>();

/** Ignore unsolicited clipboard from a device briefly after it becomes the keyboard target. */
const deviceClipboardMuteUntil = new Map<string, number>();

/** Correlate Ctrl/⌘+V keydown with the following paste event to avoid double-send. */
let pasteGestureId = 0;
let handledPasteGestureId = 0;

function rememberHostClipboard(text: string): void {
  if (!text) return;
  hostClipboardMirror = text;
  hostClipboardMirrorAt = Date.now();
}

/**
 * Apply a device→host clipboard message.
 * Unsolicited updates from a newly-armed device are muted so focusing Xiaomi to paste
 * cannot overwrite the PC clipboard with that phone's stale local clip.
 */
function ingestDeviceClipboard(deviceId: string, text: string): void {
  const prev = deviceClipboards.get(deviceId);
  const seen = deviceClipboards.has(deviceId);
  deviceClipboards.set(deviceId, text);

  if (pendingClipboardGets.delete(deviceId)) {
    rememberHostClipboard(text);
    void navigator.clipboard.writeText(text).catch(() => {
      /* ignore */
    });
    return;
  }

  // First observation while idle: track only (do not clobber host).
  if (!seen) {
    return;
  }

  if (Date.now() < (deviceClipboardMuteUntil.get(deviceId) ?? 0)) {
    return;
  }

  // On-device Copy that changed the clip — mirror into the browser/OS clipboard.
  // (Server also wl-copy's on the same change so other desktop apps see it.)
  if (text !== prev) {
    rememberHostClipboard(text);
    void navigator.clipboard.writeText(text).catch(() => {
      /* ignore */
    });
  }
}

async function resolvePasteText(clipboardData?: DataTransfer | null): Promise<string> {
  const fromEvent = clipboardData?.getData("text/plain") ?? "";
  if (fromEvent) {
    rememberHostClipboard(fromEvent);
    return fromEvent;
  }

  try {
    const fromApi = await navigator.clipboard.readText();
    if (fromApi) {
      rememberHostClipboard(fromApi);
      return fromApi;
    }
  } catch {
    /* permission denied or unsupported */
  }

  const mirrorAgeMs = Date.now() - hostClipboardMirrorAt;
  if (hostClipboardMirror && mirrorAgeMs < 120_000) {
    return hostClipboardMirror;
  }
  return "";
}

type ControlSender = (msg: Record<string, unknown>) => void;

/**
 * Ask the server to paste the OS clipboard (wl-paste) into the device via INJECT_TEXT.
 * Optional client text is only a fallback if the server cannot read the host clipboard.
 */
function pasteTextToAndroid(sendControl: ControlSender, text = ""): void {
  sendControl({ type: "paste_from_host", text });
}

export function getKeyboardTargetId(): string | null {
  return keyboardTargetId;
}

/** Inject plain text into the armed device (used for short Space after shortcut hold). */
export function injectTextToKeyboardTarget(text: string): boolean {
  if (!keyboardTargetId || !text) return false;
  const inject = textInjectors.get(keyboardTargetId);
  if (!inject) return false;
  inject(text);
  return true;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
    return true;
  }
  // Only block when focus is inside an open dialog form field, not any dialog ancestor of body.
  return Boolean(target.closest("dialog input, dialog textarea, dialog select, [contenteditable='true']"));
}

function armKeyboard(deviceId: string, stream: HTMLElement, statusEl: HTMLElement | null) {
  keyboardTargetId = deviceId;
  // Mute unsolicited clipboard sync briefly — focusing a device often re-emits its
  // local clipboard and would otherwise overwrite the PC clipboard before paste.
  deviceClipboardMuteUntil.set(deviceId, Date.now() + 1500);
  stream.classList.add("is-keyboard-hot");
  // Focus after the current pointer event so preventDefault cannot cancel it.
  window.requestAnimationFrame(() => {
    if (keyboardTargetId === deviceId) {
      stream.focus({ preventScroll: true });
    }
  });
  if (statusEl?.textContent?.startsWith("Live")) {
    statusEl.textContent = "Live · keyboard active";
  }
}

function disarmKeyboard(deviceId: string, stream: HTMLElement, statusEl: HTMLElement | null) {
  if (keyboardTargetId !== deviceId) return;
  keyboardTargetId = null;
  stream.classList.remove("is-keyboard-hot");
  if (statusEl?.textContent?.startsWith("Live")) {
    statusEl.textContent = "Live · hover or click for keyboard";
  }
}

function wsUrl(deviceId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws/stream/${encodeURIComponent(deviceId)}`;
}

export function DeviceStream({
  deviceId,
  platform,
  mockupId,
  recordingActive = false,
  landscape = false,
}: DeviceStreamProps) {
  const streamRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const videoSizeRef = useRef({ width: 0, height: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const recordingActiveRef = useRef(recordingActive);
  recordingActiveRef.current = recordingActive;

  useEffect(() => {
    if (platform !== "android") return;

    const stream = streamRef.current;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    const status = statusRef.current;
    if (!stream || !canvas || !img || !status) return;

    let closed = false;
    let decoder: VideoDecoder | null = null;
    let configured = false;

    const setStatus = (text: string) => {
      status.textContent = text;
    };

    const closeDecoder = () => {
      if (decoder && decoder.state !== "closed") {
        try {
          decoder.close();
        } catch {
          /* ignore */
        }
      }
      decoder = null;
      configured = false;
    };

    const ensureDecoder = (width: number, height: number) => {
      if (!("VideoDecoder" in window)) {
        setStatus("WebCodecs not supported in this browser");
        return;
      }
      if (width <= 0 || height <= 0) return;
      const prev = videoSizeRef.current;
      if (decoder && prev.width === width && prev.height === height) return;

      closeDecoder();
      videoSizeRef.current = { width, height };
      canvas.width = width;
      canvas.height = height;
      decoder = new VideoDecoder({
        output(frame) {
          const fw = frame.displayWidth || frame.codedWidth;
          const fh = frame.displayHeight || frame.codedHeight;
          if (fw > 0 && fh > 0 && (fw !== canvas.width || fh !== canvas.height)) {
            canvas.width = fw;
            canvas.height = fh;
            videoSizeRef.current = { width: fw, height: fh };
          }
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
          }
          frame.close();
          setStatus("Live · hover or click for keyboard");
        },
        error(err) {
          setStatus(`Decoder: ${err.message}`);
        },
      });
    };

    const configureFromConfigPacket = (payload: Uint8Array) => {
      if (!decoder) return;
      const nals = splitAnnexB(payload);
      const sps = nals.find((nal) => (nal[0] & 0x1f) === 7);
      const pps = nals.find((nal) => (nal[0] & 0x1f) === 8);
      if (!sps || !pps) return;

      try {
        if (configured && decoder.state === "configured") {
          decoder.reset();
        }
        decoder.configure({
          codec: codecFromSps(sps),
          codedWidth: canvas.width || 1080,
          codedHeight: canvas.height || 1920,
          description: buildAvcDescription(sps, pps),
        });
        configured = true;
      } catch (err) {
        configured = false;
        setStatus(`Decoder: ${err instanceof Error ? err.message : "configure failed"}`);
      }
    };

    const sendControl = (payload: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
      }
    };

    const sendKey = (keycode: number) => {
      sendControl({ type: "key", action: 0, keycode });
      sendControl({ type: "key", action: 1, keycode });
    };

    const mapPoint = (clientX: number, clientY: number) => {
      const rect = stream.getBoundingClientRect();
      const { width, height } = videoSizeRef.current;
      const x = Math.round(((clientX - rect.left) / Math.max(rect.width, 1)) * width);
      const y = Math.round(((clientY - rect.top) / Math.max(rect.height, 1)) * height);
      return {
        x: Math.max(0, Math.min(width, x)),
        y: Math.max(0, Math.min(height, y)),
        width,
        height,
      };
    };

    const sendTouch = (action: number, clientX: number, clientY: number, pressure = 1) => {
      const point = mapPoint(clientX, clientY);
      sendControl({ type: "touch", action, pressure, ...point });
    };

    const decodeVideoPacket = (payload: Uint8Array, isKey: boolean) => {
      if (!decoder || !configured) return;
      const chunk = new EncodedVideoChunk({
        type: isKey ? "key" : "delta",
        timestamp: performance.now() * 1000,
        data: annexBToAvcc(payload),
      });
      if (decoder.state === "configured") {
        decoder.decode(chunk);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      armKeyboard(deviceId, stream, status);
      stream.setPointerCapture(event.pointerId);
      draggingRef.current = true;
      sendTouch(ACTION_DOWN, event.clientX, event.clientY);
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      sendTouch(ACTION_MOVE, event.clientX, event.clientY);
      event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      sendTouch(ACTION_UP, event.clientX, event.clientY, 0);
      if (stream.hasPointerCapture(event.pointerId)) {
        stream.releasePointerCapture(event.pointerId);
      }
      armKeyboard(deviceId, stream, status);
      event.preventDefault();
    };

    const onPointerEnter = () => {
      armKeyboard(deviceId, stream, status);
    };

    const onPointerLeave = (event: PointerEvent) => {
      // setPointerCapture often synthesizes leave — keep keyboard armed while dragging/captured.
      if (draggingRef.current || stream.hasPointerCapture(event.pointerId)) return;
      if (document.activeElement === stream) return;
      disarmKeyboard(deviceId, stream, status);
    };

    const onBlur = () => {
      // Keep armed while pointer is still over the stream.
      if (stream.matches(":hover")) return;
      disarmKeyboard(deviceId, stream, status);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (keyboardTargetId !== deviceId) return;
      if (isEditableTarget(event.target)) return;

      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "v") {
          // Prefer the paste event (clipboardData). Fallback reads OS clipboard on the server.
          const gesture = ++pasteGestureId;
          window.setTimeout(() => {
            if (handledPasteGestureId >= gesture) return;
            if (keyboardTargetId !== deviceId) return;
            void (async () => {
              const text = await resolvePasteText(null);
              handledPasteGestureId = gesture;
              pasteTextToAndroid(sendControl, text);
              setStatus("Pasting from host clipboard…");
            })();
          }, 0);
          return;
        }
        if (key === "c" || key === "x") {
          event.preventDefault();
          pendingClipboardGets.add(deviceId);
          sendControl({ type: "clipboard_get", copyKey: key === "x" ? "cut" : "copy" });
          return;
        }
      }

      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        // Esc → BACK only while the pointer is on this stream; otherwise App
        // handles Focus Mode exit / Rec stop-and-save.
        if (recordingActiveRef.current || !stream.matches(":hover")) return;
        sendKey(KEYCODE_BACK);
        event.preventDefault();
        return;
      }
      // Space / Shift+Space are App-level shortcuts (hold → screenshot, Shift → Rec).
      if (event.code === "Space" || event.key === " ") return;
      if (event.key === "Home") {
        sendKey(KEYCODE_HOME);
        event.preventDefault();
        return;
      }
      if (event.key === "Meta" || event.key === "OS") {
        sendKey(KEYCODE_APP_SWITCH);
        event.preventDefault();
        return;
      }
      if (event.key === "Enter") {
        sendKey(KEYCODE_ENTER);
        event.preventDefault();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        sendKey(KEYCODE_DEL);
        event.preventDefault();
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        sendControl({ type: "text", text: event.key });
        event.preventDefault();
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      if (keyboardTargetId !== deviceId) return;
      if (isEditableTarget(event.target)) return;
      if (event.defaultPrevented) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      event.preventDefault();
      handledPasteGestureId = pasteGestureId;
      if (text) rememberHostClipboard(text);
      pasteTextToAndroid(sendControl, text);
      setStatus("Pasting from host clipboard…");
    };

    const socket = new WebSocket(wsUrl(deviceId));
    socketRef.current = socket;
    socket.binaryType = "arraybuffer";
    setStatus("Connecting…");

    socket.onopen = () => setStatus("Streaming…");

    socket.onmessage = (event) => {
      if (closed) return;

      if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data) as {
            error?: string;
            type?: string;
            text?: string;
            ok?: boolean;
            preview?: string;
            length?: number;
            source?: string;
            method?: string;
          };
          if (payload.type === "clipboard" && typeof payload.text === "string") {
            ingestDeviceClipboard(deviceId, payload.text);
            return;
          }
          if (payload.type === "paste_result") {
            if (payload.ok) {
              const preview = payload.preview ?? "";
              const short = preview.length > 40 ? `${preview.slice(0, 40)}…` : preview;
              setStatus(`Pasted ${payload.length ?? "?"} chars via ${payload.method ?? "?"}: ${short}`);
            } else {
              setStatus(payload.error ? `Paste failed: ${payload.error}` : "Paste failed");
            }
            return;
          }
          if (payload.error) setStatus(payload.error);
        } catch {
          setStatus(event.data);
        }
        return;
      }

      const buffer = new Uint8Array(event.data as ArrayBuffer);
      const type = buffer[0];

      if (type === MSG_CONFIG) {
        const view = new DataView(buffer.buffer, buffer.byteOffset + 1, 8);
        ensureDecoder(view.getUint32(0), view.getUint32(4));
        return;
      }

      if (type === MSG_VIDEO) {
        canvas.hidden = false;
        img.hidden = true;
        const flags = buffer[1];
        const payload = buffer.subarray(2);
        const isConfig = (flags & 0x01) !== 0;
        const isKey = (flags & 0x02) !== 0;

        if (isConfig) {
          configureFromConfigPacket(payload);
          return;
        }
        if (!configured) return;
        decodeVideoPacket(payload, isKey);
      }
    };

    socket.onerror = () => setStatus("Connection error");
    socket.onclose = () => {
      const current = status.textContent ?? "";
      if (!current.startsWith("scrcpy") && !current.includes("failed") && !current.includes("Decoder")) {
        setStatus("Disconnected");
      }
    };

    stream.addEventListener("pointerdown", onPointerDown);
    stream.addEventListener("pointermove", onPointerMove);
    stream.addEventListener("pointerup", onPointerUp);
    stream.addEventListener("pointercancel", onPointerUp);
    stream.addEventListener("pointerenter", onPointerEnter);
    stream.addEventListener("pointerleave", onPointerLeave);
    stream.addEventListener("blur", onBlur);
    // Single window-capture listener avoids double clipboard_set (stream + window).
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("paste", onPaste, true);
    textInjectors.set(deviceId, (text) => sendControl({ type: "text", text }));

    return () => {
      closed = true;
      if (keyboardTargetId === deviceId) keyboardTargetId = null;
      textInjectors.delete(deviceId);
      stream.removeEventListener("pointerdown", onPointerDown);
      stream.removeEventListener("pointermove", onPointerMove);
      stream.removeEventListener("pointerup", onPointerUp);
      stream.removeEventListener("pointercancel", onPointerUp);
      stream.removeEventListener("pointerenter", onPointerEnter);
      stream.removeEventListener("pointerleave", onPointerLeave);
      stream.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("paste", onPaste, true);
      stream.classList.remove("is-keyboard-hot");
      socket.close();
      socketRef.current = null;
      if (decoder && decoder.state !== "closed") {
        decoder.close();
      }
    };
  }, [deviceId, platform]);

  useEffect(() => {
    if (platform !== "ios") return;
    const stream = streamRef.current;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const status = statusRef.current;
    if (!stream || !img || !canvas || !status) return;

    let closed = false;
    let objectUrl: string | null = null;

    const sendControl = (payload: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
      }
    };

    const mapPoint = (clientX: number, clientY: number) => {
      const rect = stream.getBoundingClientRect();
      const { width, height } = videoSizeRef.current;
      const x = Math.round(((clientX - rect.left) / Math.max(rect.width, 1)) * width);
      const y = Math.round(((clientY - rect.top) / Math.max(rect.height, 1)) * height);
      return {
        x: Math.max(0, Math.min(width, x)),
        y: Math.max(0, Math.min(height, y)),
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      armKeyboard(deviceId, stream, status);
      stream.setPointerCapture(event.pointerId);
      draggingRef.current = true;
      const point = mapPoint(event.clientX, event.clientY);
      dragStartRef.current = point;
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const end = mapPoint(event.clientX, event.clientY);
      const start = dragStartRef.current;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      if (Math.hypot(dx, dy) < 8) {
        sendControl({ type: "touch", action: ACTION_UP, ...end });
      } else {
        sendControl({
          type: "touch",
          action: ACTION_MOVE,
          ...start,
          endX: end.x,
          endY: end.y,
        });
      }
      if (stream.hasPointerCapture(event.pointerId)) {
        stream.releasePointerCapture(event.pointerId);
      }
      armKeyboard(deviceId, stream, status);
      event.preventDefault();
    };

    const onPointerEnter = () => {
      armKeyboard(deviceId, stream, status);
    };

    const onPointerLeave = (event: PointerEvent) => {
      if (draggingRef.current || stream.hasPointerCapture(event.pointerId)) return;
      if (document.activeElement === stream) return;
      disarmKeyboard(deviceId, stream, status);
    };

    const onBlur = () => {
      if (stream.matches(":hover")) return;
      disarmKeyboard(deviceId, stream, status);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (keyboardTargetId !== deviceId) return;
      if (isEditableTarget(event.target)) return;

      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && event.key.toLowerCase() === "v") {
        const gesture = ++pasteGestureId;
        window.setTimeout(() => {
          if (handledPasteGestureId >= gesture) return;
          if (keyboardTargetId !== deviceId) return;
          void (async () => {
            const text = await resolvePasteText(null);
            if (!text) return;
            handledPasteGestureId = gesture;
            sendControl({ type: "text", text });
          })();
        }, 0);
        return;
      }

      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        if (recordingActiveRef.current || !stream.matches(":hover")) return;
        sendControl({ type: "key", action: 0, keycode: KEYCODE_HOME });
        event.preventDefault();
        return;
      }
      // Space / Shift+Space are App-level shortcuts (hold → screenshot, Shift → Rec).
      if (event.code === "Space" || event.key === " ") return;
      if (event.key === "Home") {
        sendControl({ type: "key", action: 0, keycode: KEYCODE_HOME });
        event.preventDefault();
        return;
      }
      if (event.key === "Enter") {
        sendControl({ type: "text", text: "\n" });
        event.preventDefault();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        sendControl({ type: "text", text: "\b" });
        event.preventDefault();
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        sendControl({ type: "text", text: event.key });
        event.preventDefault();
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      if (keyboardTargetId !== deviceId) return;
      if (isEditableTarget(event.target)) return;
      if (event.defaultPrevented) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      event.preventDefault();
      handledPasteGestureId = pasteGestureId;
      rememberHostClipboard(text);
      sendControl({ type: "text", text });
    };

    const applyScreenSize = (width: number, height: number) => {
      videoSizeRef.current = { width, height };
      sendControl({ type: "screen", width, height });
    };

    const socket = new WebSocket(wsUrl(deviceId));
    socketRef.current = socket;
    socket.binaryType = "arraybuffer";
    status.textContent = "Connecting…";

    socket.onopen = () => {
      status.textContent = "Mounting iOS…";
    };

    socket.onmessage = (event) => {
      if (closed) return;
      if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data) as { error?: string; control?: boolean };
          if (payload.error) {
            status.textContent = payload.control ? payload.error : payload.error;
          }
        } catch {
          /* ignore */
        }
        return;
      }

      const buffer = new Uint8Array(event.data as ArrayBuffer);
      if (buffer[0] === MSG_CONFIG) {
        const view = new DataView(buffer.buffer, buffer.byteOffset + 1, 8);
        applyScreenSize(view.getUint32(0), view.getUint32(4));
        return;
      }
      if (buffer[0] === MSG_JPEG) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        const blob = new Blob([buffer.subarray(1)], { type: "image/jpeg" });
        objectUrl = URL.createObjectURL(blob);
        img.onload = () => {
          if (videoSizeRef.current.width === 0 && img.naturalWidth > 0) {
            applyScreenSize(img.naturalWidth, img.naturalHeight);
          }
        };
        img.src = objectUrl;
        img.hidden = false;
        canvas.hidden = true;
        status.textContent = "Live · hover or click for keyboard";
        return;
      }
      try {
        const text = new TextDecoder().decode(buffer);
        const payload = JSON.parse(text) as { error?: string; control?: boolean };
        if (payload.error) status.textContent = payload.error;
      } catch {
        /* ignore */
      }
    };

    socket.onerror = () => {
      status.textContent = "Connection error";
    };

    socket.onclose = () => {
      if (!closed) status.textContent = "Disconnected";
    };

    stream.addEventListener("pointerdown", onPointerDown);
    stream.addEventListener("pointermove", onPointerMove);
    stream.addEventListener("pointerup", onPointerUp);
    stream.addEventListener("pointercancel", onPointerUp);
    stream.addEventListener("pointerenter", onPointerEnter);
    stream.addEventListener("pointerleave", onPointerLeave);
    stream.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("paste", onPaste, true);
    textInjectors.set(deviceId, (text) => sendControl({ type: "text", text }));

    return () => {
      closed = true;
      if (keyboardTargetId === deviceId) keyboardTargetId = null;
      textInjectors.delete(deviceId);
      stream.removeEventListener("pointerdown", onPointerDown);
      stream.removeEventListener("pointermove", onPointerMove);
      stream.removeEventListener("pointerup", onPointerUp);
      stream.removeEventListener("pointercancel", onPointerUp);
      stream.removeEventListener("pointerenter", onPointerEnter);
      stream.removeEventListener("pointerleave", onPointerLeave);
      stream.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("paste", onPaste, true);
      stream.classList.remove("is-keyboard-hot");
      socket.close();
      socketRef.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [deviceId, platform]);

  return (
    <div className="device-stream-wrap">
      <PhoneMockup mockupId={mockupId} landscape={landscape}>
        <div
          ref={streamRef}
          className="device-stream"
          tabIndex={0}
          aria-label="Device screen — hover or click to type, click to touch"
        >
          <div className="device-stream__video">
            <canvas ref={canvasRef} className="stream-canvas" hidden={platform === "ios"} />
            <img ref={imgRef} className="stream-image" alt="" hidden={platform !== "ios"} />
          </div>
        </div>
      </PhoneMockup>
      <div className="device-stream-footer">
        <span ref={statusRef} className="stream-status">
          Connecting…
        </span>
      </div>
    </div>
  );
}

function splitAnnexB(data: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      if (data[i + 2] === 1) {
        starts.push(i + 3);
        i += 2;
      } else if (i + 3 < data.length && data[i + 2] === 0 && data[i + 3] === 1) {
        starts.push(i + 4);
        i += 3;
      }
    }
  }
  if (starts.length === 0) return data.length ? [data] : [];
  const nals: Uint8Array[] = [];
  for (let i = 0; i < starts.length; i++) {
    const begin = starts[i];
    const end =
      i + 1 < starts.length ? starts[i + 1] - (data[starts[i + 1] - 3] === 0 ? 4 : 3) : data.length;
    if (end > begin) nals.push(data.subarray(begin, end));
  }
  return nals;
}

function annexBToAvcc(data: Uint8Array): Uint8Array {
  const nals = splitAnnexB(data);
  const total = nals.reduce((sum, nal) => sum + 4 + nal.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const nal of nals) {
    out[offset++] = (nal.length >> 24) & 0xff;
    out[offset++] = (nal.length >> 16) & 0xff;
    out[offset++] = (nal.length >> 8) & 0xff;
    out[offset++] = nal.length & 0xff;
    out.set(nal, offset);
    offset += nal.length;
  }
  return out;
}

function codecFromSps(sps: Uint8Array): string {
  const hex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}

function buildAvcDescription(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const config = new Uint8Array(11 + sps.length + pps.length);
  config[0] = 1;
  config[1] = sps[1];
  config[2] = sps[2];
  config[3] = sps[3];
  config[4] = 0xff;
  config[5] = 0xe1;
  config[6] = (sps.length >> 8) & 0xff;
  config[7] = sps.length & 0xff;
  config.set(sps, 8);
  const ppsOffset = 8 + sps.length;
  config[ppsOffset] = 1;
  config[ppsOffset + 1] = (pps.length >> 8) & 0xff;
  config[ppsOffset + 2] = pps.length & 0xff;
  config.set(pps, ppsOffset + 3);
  return config;
}

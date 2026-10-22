/**
 * Client-side game replay video recorder.
 * Renders both boards side-by-side on a <canvas>, walks through the move log
 * one shot at a time, and records via MediaRecorder → downloadable WebM.
 */

import type { PlacedShip } from "./battleship";

export type ReplayMove = {
  x: number;
  y: number;
  player_id: string;
  result: "miss" | "hit" | "sunk";
  sunk_ship: string | null;
};

export type ReplayInput = {
  sessionName: string;
  gridSize: number;
  hostName: string;
  guestName: string;
  hostId: string;
  guestId: string;
  hostShips: PlacedShip[];
  guestShips: PlacedShip[];
  moves: ReplayMove[];
  winnerId: string | null;
  /** ms between shots in the replay */
  frameMs?: number;
};

const CANVAS_W = 1600;
const CANVAS_H = 900;
const PAD = 40;
const GAP = 60;
const HEADER_H = 120;
const FOOTER_H = 140;

type Palette = {
  bg: string;
  panel: string;
  border: string;
  phosphor: string;
  hit: string;
  miss: string;
  ink: string;
  inkDim: string;
  inkMute: string;
};

const PAL: Palette = {
  bg: "#0a0f14",
  panel: "#111a22",
  border: "rgba(120, 200, 220, 0.15)",
  phosphor: "#3fe3c1",
  hit: "#ff6f5c",
  miss: "#5a7085",
  ink: "#dfeef2",
  inkDim: "#9fb3bd",
  inkMute: "#6a7d88",
};

export async function recordReplay(input: ReplayInput): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;

  // Stream + recorder
  const stream = canvas.captureStream(30);
  const mimeCandidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start();

  const frameMs = input.frameMs ?? 550;

  // Intro
  drawTitle(ctx, input);
  await wait(1400);

  // Progressive state: reveal moves one by one.
  const hostHitCells = new Set<string>(); // hits shown on HOST grid (fired by guest)
  const hostMissCells = new Set<string>();
  const guestHitCells = new Set<string>();
  const guestMissCells = new Set<string>();

  for (let i = 0; i <= input.moves.length; i++) {
    drawScene(ctx, input, {
      hostHitCells,
      hostMissCells,
      guestHitCells,
      guestMissCells,
      moveIndex: i,
      lastMove: i > 0 ? input.moves[i - 1] : null,
    });
    if (i < input.moves.length) {
      const m = input.moves[i];
      const targetHost = m.player_id === input.guestId; // guest shoots host grid
      const cellKey = `${m.x},${m.y}`;
      if (targetHost) {
        if (m.result === "miss") hostMissCells.add(cellKey);
        else hostHitCells.add(cellKey);
      } else {
        if (m.result === "miss") guestMissCells.add(cellKey);
        else guestHitCells.add(cellKey);
      }
    }
    await wait(frameMs);
  }

  // Outro
  drawOutro(ctx, input);
  await wait(2200);

  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  await stopped;
  return new Blob(chunks, { type: mimeType });
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // subtle grid
  ctx.strokeStyle = "rgba(63, 227, 193, 0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < CANVAS_W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_H);
    ctx.stroke();
  }
  for (let y = 0; y < CANVAS_H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_W, y);
    ctx.stroke();
  }
}

function drawTitle(ctx: CanvasRenderingContext2D, input: ReplayInput) {
  drawBackground(ctx);
  ctx.fillStyle = PAL.phosphor;
  ctx.font = "600 14px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText("VANGUARD.OS  //  ENGAGEMENT REPLAY", CANVAS_W / 2, CANVAS_H / 2 - 90);
  ctx.fillStyle = PAL.ink;
  ctx.font = "700 68px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(input.sessionName, CANVAS_W / 2, CANVAS_H / 2 - 20);
  ctx.fillStyle = PAL.inkDim;
  ctx.font = "500 24px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(
    `${input.hostName}   vs   ${input.guestName}`,
    CANVAS_W / 2,
    CANVAS_H / 2 + 30,
  );
  ctx.fillStyle = PAL.inkMute;
  ctx.font = "500 16px ui-monospace, Menlo, monospace";
  ctx.fillText(
    `GRID ${input.gridSize}×${input.gridSize}   ·   ${input.moves.length} SHOTS`,
    CANVAS_W / 2,
    CANVAS_H / 2 + 70,
  );
}

function drawOutro(ctx: CanvasRenderingContext2D, input: ReplayInput) {
  drawBackground(ctx);
  const winnerName =
    input.winnerId === input.hostId
      ? input.hostName
      : input.winnerId === input.guestId
        ? input.guestName
        : "—";
  ctx.textAlign = "center";
  ctx.fillStyle = PAL.phosphor;
  ctx.font = "600 14px ui-monospace, Menlo, monospace";
  ctx.fillText("ENGAGEMENT CLOSED", CANVAS_W / 2, CANVAS_H / 2 - 60);
  ctx.fillStyle = PAL.ink;
  ctx.font = "800 96px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("VICTORY", CANVAS_W / 2, CANVAS_H / 2 + 20);
  ctx.fillStyle = PAL.phosphor;
  ctx.font = "700 36px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(winnerName, CANVAS_W / 2, CANVAS_H / 2 + 80);
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  input: ReplayInput,
  st: {
    hostHitCells: Set<string>;
    hostMissCells: Set<string>;
    guestHitCells: Set<string>;
    guestMissCells: Set<string>;
    moveIndex: number;
    lastMove: ReplayMove | null;
  },
) {
  drawBackground(ctx);

  // Header
  ctx.textAlign = "left";
  ctx.fillStyle = PAL.phosphor;
  ctx.font = "600 12px ui-monospace, Menlo, monospace";
  ctx.fillText("VANGUARD.OS  //  REPLAY", PAD, 44);
  ctx.fillStyle = PAL.ink;
  ctx.font = "700 28px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(input.sessionName, PAD, 80);
  ctx.textAlign = "right";
  ctx.fillStyle = PAL.inkDim;
  ctx.font = "500 14px ui-monospace, Menlo, monospace";
  ctx.fillText(
    `SHOT ${st.moveIndex} / ${input.moves.length}`,
    CANVAS_W - PAD,
    44,
  );
  ctx.fillStyle = PAL.inkMute;
  ctx.fillText(`GRID ${input.gridSize}×${input.gridSize}`, CANVAS_W - PAD, 68);

  // Two boards
  const boardW = (CANVAS_W - PAD * 2 - GAP) / 2;
  const boardH = CANVAS_H - HEADER_H - FOOTER_H;
  const boardSize = Math.min(boardW, boardH);
  const leftX = PAD + (boardW - boardSize) / 2;
  const rightX = PAD + boardW + GAP + (boardW - boardSize) / 2;
  const boardY = HEADER_H;

  drawBoard(ctx, {
    x: leftX,
    y: boardY,
    size: boardSize,
    grid: input.gridSize,
    label: input.hostName,
    subtitle: "HOME FLEET",
    ships: input.hostShips,
    hits: st.hostHitCells,
    misses: st.hostMissCells,
    showShips: true,
    accent: PAL.phosphor,
    highlight:
      st.lastMove && st.lastMove.player_id === input.guestId
        ? [st.lastMove.x, st.lastMove.y]
        : null,
  });
  drawBoard(ctx, {
    x: rightX,
    y: boardY,
    size: boardSize,
    grid: input.gridSize,
    label: input.guestName,
    subtitle: "HOME FLEET",
    ships: input.guestShips,
    hits: st.guestHitCells,
    misses: st.guestMissCells,
    showShips: true,
    accent: PAL.hit,
    highlight:
      st.lastMove && st.lastMove.player_id === input.hostId
        ? [st.lastMove.x, st.lastMove.y]
        : null,
  });

  // Footer / feed
  drawFooter(ctx, input, st);
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  opts: {
    x: number;
    y: number;
    size: number;
    grid: number;
    label: string;
    subtitle: string;
    ships: PlacedShip[];
    hits: Set<string>;
    misses: Set<string>;
    showShips: boolean;
    accent: string;
    highlight: [number, number] | null;
  },
) {
  const { x, y, size, grid, ships, hits, misses, showShips, accent, highlight } = opts;
  const cell = size / grid;

  // Label
  ctx.textAlign = "left";
  ctx.fillStyle = accent;
  ctx.font = "600 12px ui-monospace, Menlo, monospace";
  ctx.fillText(opts.subtitle, x, y - 22);
  ctx.fillStyle = PAL.ink;
  ctx.font = "700 22px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(opts.label, x, y - 4);

  // Panel
  ctx.fillStyle = PAL.panel;
  ctx.strokeStyle = PAL.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - 8, y - 8, size + 16, size + 16, 10);
  ctx.fill();
  ctx.stroke();

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i <= grid; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * cell, y);
    ctx.lineTo(x + i * cell, y + size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + i * cell);
    ctx.lineTo(x + size, y + i * cell);
    ctx.stroke();
  }

  // Ships
  if (showShips) {
    ctx.fillStyle = "rgba(63, 227, 193, 0.20)";
    ctx.strokeStyle = "rgba(63, 227, 193, 0.55)";
    for (const s of ships) {
      for (const [cx, cy] of s.cells) {
        ctx.fillRect(x + cx * cell + 2, y + cy * cell + 2, cell - 4, cell - 4);
        ctx.strokeRect(x + cx * cell + 2, y + cy * cell + 2, cell - 4, cell - 4);
      }
    }
  }

  // Misses
  ctx.fillStyle = PAL.miss;
  for (const k of misses) {
    const [cx, cy] = k.split(",").map(Number);
    ctx.beginPath();
    ctx.arc(x + cx * cell + cell / 2, y + cy * cell + cell / 2, Math.max(3, cell * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  // Hits
  ctx.fillStyle = PAL.hit;
  for (const k of hits) {
    const [cx, cy] = k.split(",").map(Number);
    ctx.beginPath();
    ctx.arc(x + cx * cell + cell / 2, y + cy * cell + cell / 2, Math.max(4, cell * 0.22), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 111, 92, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + cx * cell + cell / 2, y + cy * cell + cell / 2, Math.max(6, cell * 0.36), 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Highlight of last shot on this board
  if (highlight) {
    const [hx, hy] = highlight;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x + hx * cell + 1, y + hy * cell + 1, cell - 2, cell - 2);
    ctx.lineWidth = 1;
  }
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  input: ReplayInput,
  st: { moveIndex: number; lastMove: ReplayMove | null },
) {
  const y = CANVAS_H - FOOTER_H + 20;
  ctx.textAlign = "left";
  ctx.fillStyle = PAL.inkMute;
  ctx.font = "500 12px ui-monospace, Menlo, monospace";
  ctx.fillText("TACTICAL FEED", PAD, y);

  const start = Math.max(0, st.moveIndex - 4);
  const visible = input.moves.slice(start, st.moveIndex);
  ctx.font = "500 15px ui-monospace, Menlo, monospace";
  visible.forEach((m, i) => {
    const who =
      m.player_id === input.hostId ? input.hostName : input.guestName;
    const label = `${String.fromCharCode(65 + m.x)}-${m.y + 1}`;
    const resTxt =
      m.result === "sunk"
        ? `SUNK · ${m.sunk_ship ?? ""}`
        : m.result.toUpperCase();
    const color =
      m.result === "miss"
        ? PAL.inkDim
        : m.result === "sunk"
          ? "#ffb84d"
          : PAL.hit;
    ctx.fillStyle = PAL.inkDim;
    ctx.fillText(`${who}  →  ${label}`, PAD, y + 24 + i * 20);
    ctx.fillStyle = color;
    ctx.textAlign = "right";
    ctx.fillText(resTxt, CANVAS_W - PAD, y + 24 + i * 20);
    ctx.textAlign = "left";
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

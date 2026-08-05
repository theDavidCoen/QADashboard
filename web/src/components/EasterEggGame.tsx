import { useEffect, useRef, useState } from "react";
import { createEggGameAudio, type EggGameAudio } from "../egg-game-sounds";
import { useDialogModal } from "../hooks/useDialogModal";
import { IconVolume, IconVolumeOff } from "./ActionIcons";

interface EasterEggGameProps {
  onClose: () => void;
}

type Dir = "U" | "D" | "L" | "R";

interface Entity {
  x: number;
  y: number;
  dir: Dir;
  next: Dir | null;
  homeX: number;
  homeY: number;
  frightened: boolean;
  eaten: boolean;
  eatenTicks: number;
  color: string;
}

/**
 * 21-wide maze. Row 9 is the wrap tunnel (open left/right edges),
 * connected to the playfield so Pac-Man can cross and reappear opposite.
 */
const MAZE: string[] = [
  "#####################",
  "#.........#.........#",
  "#o##.###.#.###.##.#o#",
  "#...................#",
  "#.##.#.#####.#.##.#.#",
  "#....#...#...#......#",
  "####.###.#.###.######",
  "#........A..........#",
  "####.#.##---##.#.####",
  ".....#...BCD...#.....", // tunnel — wrap for Pac-Man only
  "####.#.#######.#.####",
  "#.........#.........#",
  "####.#.#####.#.######",
  "#.........#.........#",
  "#.##.###.#.###.##.#.#",
  "#o.#.....P.....#.#.o#",
  "##.#.#.#####.#.#.#.##",
  "#....#...#...#......#",
  "#.######.#.######.#.#",
  "#...................#",
  "#####################",
];

const ROWS = MAZE.length;
const COLS = MAZE[0].length;
const CELL = 28;
const DIRS: Dir[] = ["U", "D", "L", "R"];
const DELTA: Record<Dir, { x: number; y: number }> = {
  U: { x: 0, y: -1 },
  D: { x: 0, y: 1 },
  L: { x: -1, y: 0 },
  R: { x: 1, y: 0 },
};
const OPP: Record<Dir, Dir> = { U: "D", D: "U", L: "R", R: "L" };

/** Arcade board palette — intentionally dark in both app themes. */
const BOARD = {
  bg: "#07090f",
  wallOuter: "#1d4ed8",
  wallInner: "#0b1224",
  pellet: "#e8e4d4",
  power: "#fbbf24",
  door: "#f9a8d4",
  text: "#f5f5f5",
  textMuted: "#a3a3a3",
  overlay: "rgba(0, 0, 0, 0.72)",
};

function wrapX(x: number): number {
  if (x < 0) return x + COLS;
  if (x >= COLS) return x - COLS;
  return x;
}

function cellAt(x: number, y: number, wrap: boolean): string {
  if (y < 0 || y >= ROWS) return "#";
  let cx = x;
  if (wrap) {
    cx = wrapX(x);
  } else if (x < 0 || x >= COLS) {
    return "#";
  }
  return MAZE[y][cx] ?? "#";
}

function isWall(x: number, y: number, opts: { wrap: boolean; allowDoor?: boolean }): boolean {
  const c = cellAt(x, y, opts.wrap);
  if (c === "#") return true;
  if (c === "-" && !opts.allowDoor) return true;
  return false;
}

function parseStarts(): {
  player: { x: number; y: number };
  ghosts: { x: number; y: number; color: string }[];
  pellets: Set<string>;
  power: Set<string>;
} {
  const pellets = new Set<string>();
  const power = new Set<string>();
  let player = { x: 10, y: 15 };
  const ghosts: { x: number; y: number; color: string }[] = [];
  const ghostColors = ["#ef4444", "#f472b6", "#22d3ee", "#fb923c"];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = MAZE[y][x];
      if (c === ".") pellets.add(`${x},${y}`);
      else if (c === "o") power.add(`${x},${y}`);
      else if (c === "P") player = { x, y };
      else if (c === "A" || c === "B" || c === "C" || c === "D") {
        const idx = c.charCodeAt(0) - 65;
        ghosts.push({ x, y, color: ghostColors[idx % ghostColors.length] });
      }
    }
  }
  return { player, ghosts, pellets, power };
}

/** Android robot mark (Path2D) — no mouth cut that eats the sprite. */
function drawAndroid(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  dir: Dir,
) {
  const scale = (size * 0.82) / 24;
  ctx.save();
  ctx.translate(cx, cy);
  // Nudge slightly in facing direction so motion reads without carving the icon.
  const nudge = 1.2;
  if (dir === "L") ctx.translate(-nudge, 0);
  if (dir === "R") ctx.translate(nudge, 0);
  if (dir === "U") ctx.translate(0, -nudge);
  if (dir === "D") ctx.translate(0, nudge);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.fillStyle = "#3ddc84";
  const logo = new Path2D(
    "M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 0 0-.83.26l-1.88 3.24a11.43 11.43 0 0 0-8.94 0L5.65 5.71a.643.643 0 0 0-.87-.2c-.28.18-.37.54-.2.83L6.4 9.48A10.78 10.78 0 0 0 1 18h22a10.78 10.78 0 0 0-5.4-8.52M7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5m10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5",
  );
  ctx.fill(logo);
  ctx.restore();
}

/**
 * Classic Apple logo (bitten apple + leaf), scaled from 24×24 path.
 */
function drawAppleLogo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
) {
  const scale = (size * 0.8) / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.fillStyle = color;
  const logo = new Path2D(
    "M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 2.89 1.98-.07.04-1.73 1.01-1.71 3.02.03 2.47 2.29 3.26 2.33 3.28-.02.07-.36 1.36-1.07 2.69M13 3.5c.73-.83 1.22-1.98 1.08-3.13-1.05.04-2.31.7-3.06 1.58-.67.77-1.26 2-1.11 3.16 1.17.09 2.36-.6 3.09-1.61",
  );
  ctx.fill(logo);
  ctx.restore();
}

/** Eaten ghost: just a pair of eyes while returning home. */
function drawGhostEyes(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const s = size * 0.22;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx - s * 0.7, cy, s * 0.55, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.7, cy, s * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1e3a8a";
  ctx.beginPath();
  ctx.arc(cx - s * 0.55, cy, s * 0.25, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.85, cy, s * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function openDirs(x: number, y: number, wrap: boolean, allowDoor = false): Dir[] {
  return DIRS.filter((d) => {
    const n = DELTA[d];
    return !isWall(x + n.x, y + n.y, { wrap, allowDoor });
  });
}

function pickGhostDir(g: Entity, px: number, py: number, frightened: boolean): Dir {
  // Ghosts never wrap — edges are walls for them.
  const options = openDirs(Math.round(g.x), Math.round(g.y), false, g.eaten).filter(
    (d) =>
      d !== OPP[g.dir] ||
      openDirs(Math.round(g.x), Math.round(g.y), false, g.eaten).length === 1,
  );
  if (options.length === 0) return g.dir;
  if (frightened && !g.eaten) {
    return options[Math.floor(Math.random() * options.length)];
  }
  const targetX = g.eaten ? g.homeX : px;
  const targetY = g.eaten ? g.homeY : py;
  let best = options[0];
  let bestDist = Infinity;
  for (const d of options) {
    const nx = Math.round(g.x) + DELTA[d].x;
    const ny = Math.round(g.y) + DELTA[d].y;
    const dist = (nx - targetX) ** 2 + (ny - targetY) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

function stepEntity(
  e: { x: number; y: number; dir: Dir; next: Dir | null },
  opts: { wrap: boolean; allowDoor?: boolean; speed?: number },
) {
  const speed = opts.speed ?? 1;
  const allowDoor = opts.allowDoor ?? false;
  for (let i = 0; i < speed; i++) {
    const gx = Math.round(e.x);
    const gy = Math.round(e.y);
    const aligned = Math.abs(e.x - gx) < 0.06 && Math.abs(e.y - gy) < 0.06;
    if (aligned) {
      e.x = opts.wrap ? wrapX(gx) : gx;
      e.y = gy;
      if (e.next) {
        const n = DELTA[e.next];
        if (!isWall(gx + n.x, gy + n.y, { wrap: opts.wrap, allowDoor })) {
          e.dir = e.next;
          e.next = null;
        }
      }
      const d = DELTA[e.dir];
      if (isWall(gx + d.x, gy + d.y, { wrap: opts.wrap, allowDoor })) {
        return;
      }
    }
    let nx = e.x + DELTA[e.dir].x * 0.2;
    let ny = e.y + DELTA[e.dir].y * 0.2;
    if (opts.wrap) {
      nx = wrapX(nx);
    } else {
      if (nx < 0 || nx > COLS - 1) return;
    }
    if (ny < 0 || ny > ROWS - 1) return;
    e.x = nx;
    e.y = ny;
  }
}

export function EasterEggGame({ onClose }: EasterEggGameProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogModal(dialogRef, onClose);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<EggGameAudio | null>(null);
  const mutedRef = useRef(false);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [status, setStatus] = useState<"play" | "won" | "lost">("play");
  const [muted, setMuted] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  mutedRef.current = muted;

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    audioRef.current?.setMuted(next);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const starts = parseStarts();
    const totalPellets = starts.pellets.size + starts.power.size;
    let pellets = new Set(starts.pellets);
    let power = new Set(starts.power);
    let scoreLocal = 0;
    let livesLocal = 3;
    let frightTimer = 0;
    let won = false;
    let lost = false;

    let player = {
      x: starts.player.x,
      y: starts.player.y,
      dir: "L" as Dir,
      next: null as Dir | null,
    };

    const ghosts: Entity[] = starts.ghosts.map((g) => ({
      x: g.x,
      y: g.y,
      dir: "U" as Dir,
      next: null,
      homeX: g.x,
      homeY: g.y,
      frightened: false,
      eaten: false,
      eatenTicks: 0,
      color: g.color,
    }));

    const reviveGhost = (g: Entity) => {
      g.x = g.homeX;
      g.y = g.homeY;
      g.dir = "U";
      g.eaten = false;
      g.frightened = false;
      g.eatenTicks = 0;
    };

    const resetPositions = () => {
      player.x = starts.player.x;
      player.y = starts.player.y;
      player.dir = "L";
      player.next = null;
      for (const g of ghosts) reviveGhost(g);
      frightTimer = 0;
    };

    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;

    const audio = createEggGameAudio();
    audio.setMuted(mutedRef.current);
    audioRef.current = audio;
    audio.onRoundStart();

    const onKey = (event: KeyboardEvent) => {
      if (statusRef.current !== "play") {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setScore(0);
          setLives(3);
          setStatus("play");
          setRestartKey((k) => k + 1);
        }
        return;
      }
      const map: Record<string, Dir> = {
        ArrowUp: "U",
        ArrowDown: "D",
        ArrowLeft: "L",
        ArrowRight: "R",
        w: "U",
        W: "U",
        s: "D",
        S: "D",
        a: "L",
        A: "L",
        d: "R",
        D: "R",
      };
      const dir = map[event.key];
      if (!dir) return;
      event.preventDefault();
      player.next = dir;
    };
    window.addEventListener("keydown", onKey);

    let last = performance.now();
    let acc = 0;
    const STEP = 1000 / 9;
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      acc += dt;

      while (acc >= STEP && statusRef.current === "play" && !won && !lost) {
        acc -= STEP;

        if (player.next) {
          const gx = Math.round(player.x);
          const gy = Math.round(player.y);
          if (Math.abs(player.x - gx) < 0.18 && Math.abs(player.y - gy) < 0.18) {
            const n = DELTA[player.next];
            if (!isWall(gx + n.x, gy + n.y, { wrap: true })) {
              player.dir = player.next;
              player.next = null;
              player.x = wrapX(gx);
              player.y = gy;
            }
          }
        }
        // Pac-Man only: horizontal wrap through the side tunnel.
        stepEntity(player, { wrap: true, speed: 1 });

        const px = Math.round(wrapX(player.x));
        const py = Math.round(player.y);
        player.x = wrapX(player.x);
        const key = `${px},${py}`;
        if (pellets.has(key)) {
          pellets.delete(key);
          scoreLocal += 10;
          setScore(scoreLocal);
          audio.onPellet();
        }
        if (power.has(key)) {
          power.delete(key);
          scoreLocal += 50;
          setScore(scoreLocal);
          audio.onPower();
          frightTimer = 55;
          for (const g of ghosts) {
            if (!g.eaten) g.frightened = true;
          }
        }

        if (frightTimer > 0) {
          frightTimer -= 1;
          if (frightTimer === 0) {
            for (const g of ghosts) {
              g.frightened = false;
              // Capture window ended: any still-eaten ghosts respawn with full color.
              if (g.eaten) reviveGhost(g);
            }
          }
        }

        for (const g of ghosts) {
          const gx = Math.round(g.x);
          const gy = Math.round(g.y);
          if (Math.abs(g.x - gx) < 0.12 && Math.abs(g.y - gy) < 0.12) {
            g.x = gx;
            g.y = gy;
            g.dir = pickGhostDir(g, px, py, g.frightened || frightTimer > 0);
          }
          if (g.eaten) {
            g.eatenTicks += 1;
            const homeDist = Math.hypot(g.x - g.homeX, g.y - g.homeY);
            if (homeDist < 0.7 || g.eatenTicks > 90) {
              reviveGhost(g);
            }
          }
          const speed = g.eaten ? 2 : 1;
          const allowDoor = g.eaten || (gy >= 7 && gy <= 10 && gx >= 7 && gx <= 13);
          stepEntity(g, { wrap: false, allowDoor, speed });
        }

        for (const g of ghosts) {
          const dx = Math.abs(wrapX(g.x) - wrapX(player.x));
          const dy = Math.abs(g.y - player.y);
          const dxWrap = Math.min(dx, COLS - dx);
          if (dxWrap < 0.55 && dy < 0.55) {
            if (g.frightened && !g.eaten) {
              g.eaten = true;
              g.frightened = false;
              g.eatenTicks = 0;
              scoreLocal += 200;
              setScore(scoreLocal);
              audio.onEatGhost();
            } else if (!g.eaten) {
              livesLocal -= 1;
              setLives(livesLocal);
              audio.onDeath();
              if (livesLocal <= 0) {
                lost = true;
                setStatus("lost");
                audio.onGameOver();
              } else {
                resetPositions();
              }
              break;
            }
          }
        }

        if (pellets.size === 0 && power.size === 0) {
          won = true;
          setStatus("won");
          audio.onWin();
        }
      }

      const levelProgress =
        totalPellets > 0 ? 1 - (pellets.size + power.size) / totalPellets : 1;
      const frightened = frightTimer > 0;
      audio.tickSiren({
        playing: statusRef.current === "play" && !won && !lost,
        frightened,
        levelProgress,
      });

      // Board
      ctx.fillStyle = BOARD.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const c = MAZE[y][x];
          if (c === "#") {
            ctx.fillStyle = BOARD.wallOuter;
            ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
            ctx.fillStyle = BOARD.wallInner;
            ctx.fillRect(x * CELL + 4, y * CELL + 4, CELL - 8, CELL - 8);
          } else if (c === "-") {
            ctx.fillStyle = BOARD.door;
            ctx.fillRect(x * CELL + 3, y * CELL + CELL / 2 - 1.5, CELL - 6, 3);
          }
        }
      }

      ctx.fillStyle = "rgba(29, 78, 216, 0.35)";
      ctx.fillRect(0, 9 * CELL + 4, 3, CELL - 8);
      ctx.fillRect(COLS * CELL - 3, 9 * CELL + 4, 3, CELL - 8);

      ctx.fillStyle = BOARD.pellet;
      for (const p of pellets) {
        const [sx, sy] = p.split(",").map(Number);
        ctx.beginPath();
        ctx.arc(sx * CELL + CELL / 2, sy * CELL + CELL / 2, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = BOARD.power;
      for (const p of power) {
        const [sx, sy] = p.split(",").map(Number);
        ctx.beginPath();
        ctx.arc(sx * CELL + CELL / 2, sy * CELL + CELL / 2, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      drawAndroid(
        ctx,
        wrapX(player.x) * CELL + CELL / 2,
        player.y * CELL + CELL / 2,
        CELL,
        player.dir,
      );

      for (const g of ghosts) {
        const gx = g.x * CELL + CELL / 2;
        const gy = g.y * CELL + CELL / 2;
        if (g.eaten) {
          drawGhostEyes(ctx, gx, gy, CELL);
          continue;
        }
        let color = g.color;
        if (g.frightened) {
          // Blue while vulnerable; flash white near the end — never stay grey.
          color = frightTimer < 12 && frightTimer % 2 === 0 ? "#ffffff" : "#38bdf8";
        }
        drawAppleLogo(ctx, gx, gy, CELL, color);
      }

      if (won || lost) {
        ctx.fillStyle = BOARD.overlay;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = BOARD.text;
        ctx.font = "700 24px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(won ? "You win" : "Game over", canvas.width / 2, canvas.height / 2 - 10);
        ctx.font = "500 14px system-ui, sans-serif";
        ctx.fillStyle = BOARD.textMuted;
        ctx.fillText("Enter or Restart", canvas.width / 2, canvas.height / 2 + 18);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      audioRef.current = null;
      audio.dispose();
    };
  }, [restartKey]);

  const restart = () => {
    setScore(0);
    setLives(3);
    setStatus("play");
    setRestartKey((k) => k + 1);
  };

  return (
    <dialog ref={dialogRef} className="device-picker egg-game" onClose={onClose}>
      <div className="device-picker__panel egg-game__panel">
        <header>
          <h3>Platform chase</h3>
          <div className="egg-game__header-actions">
            <button
              type="button"
              className="egg-game__mute"
              onClick={toggleMute}
              aria-label={muted ? "Unmute game sounds" : "Mute game sounds"}
              aria-pressed={muted}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <IconVolumeOff className="egg-game__mute-icon" /> : <IconVolume className="egg-game__mute-icon" />}
            </button>
            <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        <div className="egg-game__hud" aria-live="polite">
          <span>
            Score <strong>{score}</strong>
          </span>
          <span>
            Lives <strong>{lives}</strong>
          </span>
          <span className="egg-game__cast" title="Android vs Apple">
            <span className="egg-game__cast-android" aria-hidden="true" />
            <span>vs</span>
            <span className="egg-game__cast-apple" aria-hidden="true" />
          </span>
        </div>

        <div className="egg-game__stage">
          <canvas
            ref={canvasRef}
            className="egg-game__canvas"
            width={COLS * CELL}
            height={ROWS * CELL}
          />
        </div>

        <p className="egg-game__hint">Arrows or WASD · side tunnel wraps · Esc closes</p>

        <div className="modal-actions egg-game__actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={restart}>
            Restart
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Battleship bot — hunt / target algorithm.
 * Pure function of (grid size, prior moves fired BY the bot).
 * Given the history of the bot's shots and their results, it chooses the next
 * coordinate to fire at. Uses parity-based hunt search and orthogonal targeting
 * once a hit is scored.
 */

import { key as ckey, type Coord } from "./battleship";

type PriorShot = { x: number; y: number; result: "miss" | "hit" | "sunk" };

export function pickBotShot(size: number, prior: PriorShot[]): Coord {
  const fired = new Set(prior.map((s) => ckey(s.x, s.y)));

  // 1) Gather orthogonal neighbours of any unresolved HIT (hit but no sunk yet
  //    in the surrounding cluster). Simple heuristic: any HIT whose neighbours
  //    aren't all fired is still "open".
  const openHits = prior.filter(
    (s) =>
      s.result === "hit" &&
      // still open if at least one orthogonal neighbour is unfired & in bounds
      neighbours(s.x, s.y, size).some(([nx, ny]) => !fired.has(ckey(nx, ny))),
  );

  // If we have two aligned hits, extend along that line first.
  const line = detectLine(openHits);
  if (line) {
    const cand = extendLine(line, size, fired);
    if (cand) return cand;
  }

  // Otherwise, orthogonal target around the most recent open hit.
  const last = openHits[openHits.length - 1];
  if (last) {
    const options = neighbours(last.x, last.y, size).filter(
      ([nx, ny]) => !fired.has(ckey(nx, ny)),
    );
    if (options.length) return pickRandom(options);
  }

  // 2) Hunt mode — parity search (checkerboard, offset randomised).
  const parityOffset = ((size + prior.length) % 2) as 0 | 1;
  const parityCells: Coord[] = [];
  const anyCells: Coord[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (fired.has(ckey(x, y))) continue;
      anyCells.push([x, y]);
      if ((x + y) % 2 === parityOffset) parityCells.push([x, y]);
    }
  }
  if (parityCells.length) return pickRandom(parityCells);
  if (anyCells.length) return pickRandom(anyCells);

  // Shouldn't reach here in a legal game.
  return [0, 0];
}

function neighbours(x: number, y: number, size: number): Coord[] {
  const out: Coord[] = [];
  if (x > 0) out.push([x - 1, y]);
  if (x < size - 1) out.push([x + 1, y]);
  if (y > 0) out.push([x, y - 1]);
  if (y < size - 1) out.push([x, y + 1]);
  return out;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

type Line = { orient: "H" | "V"; y?: number; x?: number; cells: Coord[] };

function detectLine(openHits: PriorShot[]): Line | null {
  if (openHits.length < 2) return null;
  // Group by row and by column, look for 2+ collinear open hits.
  const byRow = new Map<number, Coord[]>();
  const byCol = new Map<number, Coord[]>();
  for (const h of openHits) {
    const r = byRow.get(h.y) ?? [];
    r.push([h.x, h.y]);
    byRow.set(h.y, r);
    const c = byCol.get(h.x) ?? [];
    c.push([h.x, h.y]);
    byCol.set(h.x, c);
  }
  for (const [y, cells] of byRow) {
    if (cells.length >= 2) return { orient: "H", y, cells: cells.sort((a, b) => a[0] - b[0]) };
  }
  for (const [x, cells] of byCol) {
    if (cells.length >= 2) return { orient: "V", x, cells: cells.sort((a, b) => a[1] - b[1]) };
  }
  return null;
}

function extendLine(line: Line, size: number, fired: Set<string>): Coord | null {
  const { orient, cells } = line;
  if (orient === "H") {
    const y = line.y!;
    const xs = cells.map((c) => c[0]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const cands: Coord[] = [];
    if (minX - 1 >= 0 && !fired.has(ckey(minX - 1, y))) cands.push([minX - 1, y]);
    if (maxX + 1 < size && !fired.has(ckey(maxX + 1, y))) cands.push([maxX + 1, y]);
    return cands.length ? pickRandom(cands) : null;
  } else {
    const x = line.x!;
    const ys = cells.map((c) => c[1]);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const cands: Coord[] = [];
    if (minY - 1 >= 0 && !fired.has(ckey(x, minY - 1))) cands.push([x, minY - 1]);
    if (maxY + 1 < size && !fired.has(ckey(x, maxY + 1))) cands.push([x, maxY + 1]);
    return cands.length ? pickRandom(cands) : null;
  }
}

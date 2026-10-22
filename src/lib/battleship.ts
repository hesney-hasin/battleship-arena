/**
 * Battleship game engine — pure functions. No I/O.
 */

export type Coord = [number, number]; // [x, y]

export type ShipSpec = { name: string; length: number; count: number };

export type PlacedShip = {
  name: string;
  length: number;
  cells: Coord[];
  hits: Coord[]; // subset of cells
};

export type CellState =
  | { kind: "empty" }
  | { kind: "ship"; shipIdx: number }
  | { kind: "miss" }
  | { kind: "hit"; shipIdx: number }
  | { kind: "sunk"; shipIdx: number };

export const DEFAULT_FLEETS: Record<number, ShipSpec[]> = {
  8: [
    { name: "Carrier", length: 4, count: 1 },
    { name: "Cruiser", length: 3, count: 1 },
    { name: "Destroyer", length: 2, count: 2 },
    { name: "Patrol", length: 1, count: 2 },
  ],
  10: [
    { name: "Carrier", length: 5, count: 1 },
    { name: "Battleship", length: 4, count: 1 },
    { name: "Cruiser", length: 3, count: 2 },
    { name: "Destroyer", length: 2, count: 1 },
  ],
  12: [
    { name: "Carrier", length: 5, count: 1 },
    { name: "Battleship", length: 4, count: 2 },
    { name: "Cruiser", length: 3, count: 2 },
    { name: "Destroyer", length: 2, count: 2 },
  ],
  14: [
    { name: "Dreadnought", length: 6, count: 1 },
    { name: "Carrier", length: 5, count: 1 },
    { name: "Battleship", length: 4, count: 2 },
    { name: "Cruiser", length: 3, count: 3 },
    { name: "Destroyer", length: 2, count: 2 },
  ],
};

export function totalShipCells(specs: ShipSpec[]): number {
  return specs.reduce((s, x) => s + x.length * x.count, 0);
}

export function shipsFromConfig(specs: ShipSpec[]): { name: string; length: number; idx: number }[] {
  const out: { name: string; length: number; idx: number }[] = [];
  let idx = 0;
  for (const s of specs) {
    for (let i = 0; i < s.count; i++) {
      out.push({ name: s.count > 1 ? `${s.name} ${i + 1}` : s.name, length: s.length, idx: idx++ });
    }
  }
  return out;
}

export function inBounds(x: number, y: number, size: number) {
  return x >= 0 && y >= 0 && x < size && y < size;
}

export function cellsForShip(x: number, y: number, length: number, orientation: "H" | "V"): Coord[] {
  const cells: Coord[] = [];
  for (let i = 0; i < length; i++) {
    cells.push(orientation === "H" ? [x + i, y] : [x, y + i]);
  }
  return cells;
}

export function canPlace(
  cells: Coord[],
  size: number,
  occupied: Set<string>,
): boolean {
  for (const [x, y] of cells) {
    if (!inBounds(x, y, size)) return false;
    if (occupied.has(`${x},${y}`)) return false;
  }
  return true;
}

export function key(x: number, y: number) { return `${x},${y}`; }

export function randomPlacement(specs: ShipSpec[], size: number): PlacedShip[] {
  const ships = shipsFromConfig(specs);
  const occupied = new Set<string>();
  const placed: PlacedShip[] = [];
  for (const s of ships) {
    let tries = 0;
    while (tries++ < 500) {
      const orientation: "H" | "V" = Math.random() < 0.5 ? "H" : "V";
      const maxX = orientation === "H" ? size - s.length : size - 1;
      const maxY = orientation === "V" ? size - s.length : size - 1;
      const x = Math.floor(Math.random() * (maxX + 1));
      const y = Math.floor(Math.random() * (maxY + 1));
      const cells = cellsForShip(x, y, s.length, orientation);
      if (canPlace(cells, size, occupied)) {
        cells.forEach(([cx, cy]) => occupied.add(key(cx, cy)));
        placed.push({ name: s.name, length: s.length, cells, hits: [] });
        break;
      }
    }
  }
  return placed;
}

export type FireResult = {
  result: "miss" | "hit" | "sunk";
  shipName?: string;
  updatedShips: PlacedShip[];
  allSunk: boolean;
};

export function applyShot(ships: PlacedShip[], x: number, y: number): FireResult {
  const next = ships.map((s) => ({ ...s, hits: [...s.hits], cells: s.cells }));
  let hitShip: PlacedShip | null = null;
  for (const s of next) {
    if (s.cells.some(([cx, cy]) => cx === x && cy === y)) {
      hitShip = s;
      if (!s.hits.some(([cx, cy]) => cx === x && cy === y)) {
        s.hits.push([x, y]);
      }
      break;
    }
  }
  if (!hitShip) {
    return { result: "miss", updatedShips: next, allSunk: false };
  }
  const sunk = hitShip.hits.length >= hitShip.length;
  const allSunk = next.every((s) => s.hits.length >= s.length);
  return {
    result: sunk ? "sunk" : "hit",
    shipName: sunk ? hitShip.name : undefined,
    updatedShips: next,
    allSunk,
  };
}

export function isSunk(ship: PlacedShip) { return ship.hits.length >= ship.length; }

export function coordLabel(x: number, y: number) {
  return `${String.fromCharCode(65 + x)}-${y + 1}`;
}

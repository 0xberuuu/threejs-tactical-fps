// MERIDIAN YARD — an original three-lane map. Units are metres. North is -Z.
// The Vanguards (attackers) spawn south and push up three lanes to two plant
// sites; the Sentinels (defenders) spawn north and hold. Every solid is an
// axis-aligned box so movement collision and line-of-sight stay cheap and
// exact. Boxes: { x, z, w, d, h, y0, mat } centred on x/z, y0 is the base.
//
//   +------------------ north wall ------------------+
//   |  A SITE (fuel)      mid-north      B SITE     |
//   |   [tanks]         warehouse        [crane]    |
//   | A-long  |  mid doors  |  B-short              |
//   |         |             |                       |
//   +------------------ south wall ------------------+
//   Vanguards spawn south, Sentinels spawn north.
export const MAP = {
  name: 'Meridian Yard',
  bounds: { minX: -32, maxX: 32, minZ: -24, maxZ: 24 },
  wallHeight: 4.5,
  // Solid boxes. mat names resolve in world.js.
  boxes: [
    // Perimeter walls.
    { x: 0, z: -24.5, w: 66, d: 1, h: 4.5, mat: 'wall' },
    { x: 0, z: 24.5, w: 66, d: 1, h: 4.5, mat: 'wall' },
    { x: -32.5, z: 0, w: 1, d: 50, h: 4.5, mat: 'wall' },
    { x: 32.5, z: 0, w: 1, d: 50, h: 4.5, mat: 'wall' },
    // A Long (west lane): container corridor.
    { x: -26, z: 10, w: 8, d: 2.6, h: 2.6, mat: 'containerRust' },
    { x: -26, z: 10, w: 8, d: 2.6, h: 2.6, y0: 2.6, mat: 'containerSlate' },
    { x: -24, z: 2, w: 2.6, d: 8, h: 2.6, mat: 'containerTeal' },
    { x: -17, z: -1, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: -18, z: -8, w: 6, d: 1, h: 3, mat: 'wall' },
    { x: -29, z: -3, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    // A site: fuel depot. Tanks are cylinders visually; their colliders are
    // the square boxes below.
    { x: -18, z: -17, w: 4.4, d: 4.4, h: 3, mat: 'tank' },
    { x: -25.5, z: -11, w: 3.2, d: 3.2, h: 2.4, mat: 'tank' },
    { x: -26, z: -17.5, w: 1, d: 8, h: 1.2, mat: 'sandbag' },
    { x: -14, z: -18, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: -28, z: -18.5, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    // Mid warehouse: four walls with a south door and an offset north door.
    { x: -5.25, z: 3, w: 7.5, d: 1, h: 3.5, mat: 'wall' },
    { x: 5.25, z: 3, w: 7.5, d: 1, h: 3.5, mat: 'wall' },
    { x: -3.5, z: -7, w: 11, d: 1, h: 3.5, mat: 'wall' },
    { x: 7, z: -7, w: 4, d: 1, h: 3.5, mat: 'wall' },
    { x: -9, z: -2, w: 1, d: 11, h: 3.5, mat: 'wall' },
    { x: 9, z: -2, w: 1, d: 11, h: 3.5, mat: 'wall' },
    { x: -4, z: -2, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: 4, z: -4, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: -2.5, z: 0.5, w: 3, d: 1.6, h: 1.15, mat: 'crateDark' },
    // Mid side passages.
    { x: -13, z: -2, w: 1, d: 6, h: 3, mat: 'wall' },
    { x: 13, z: -2, w: 1, d: 6, h: 3, mat: 'wall' },
    // B Short (east lane): crates and a scaffold stack.
    { x: 19.5, z: 9.5, w: 3, d: 3, h: 1.15, mat: 'crate' },
    { x: 25, z: 4, w: 2.6, d: 8, h: 2.6, mat: 'containerSand' },
    { x: 19, z: -8.5, w: 3.2, d: 3.2, h: 2.3, mat: 'metal' },
    { x: 29, z: 12, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: 28, z: -4, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    // B site: crane platform.
    { x: 20, z: -15.5, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: 25.5, z: -15.5, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: 18, z: -14.5, w: 1, d: 3, h: 1.2, mat: 'sandbag' },
    { x: 27, z: -17, w: 2.2, d: 2.2, h: 12, mat: 'metal' },
    { x: 27, z: -17, w: 2.2, d: 2.2, h: 1.2, y0: 12, mat: 'metalLight' },
    // Mid-yard clutter.
    { x: -12, z: 11, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: 12, z: 11, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: -6, z: 5, w: 3, d: 2, h: 1.15, mat: 'crateDark' },
    { x: 2, z: -16.5, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: -12, z: -16, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    { x: 12, z: -16, w: 2.2, d: 2.2, h: 1.15, mat: 'crate' },
    // Barrels (colliders are small squares; visuals are cylinders).
    { x: -16, z: 6, w: 1.2, d: 1.2, h: 1.2, mat: 'barrel' },
    { x: 15, z: 6, w: 1.2, d: 1.2, h: 1.2, mat: 'barrelBlue' },
    { x: -13, z: -12, w: 1.2, d: 1.2, h: 1.2, mat: 'barrelBlue' },
    { x: 16, z: -9, w: 1.2, d: 1.2, h: 1.2, mat: 'barrel' },
  ],
  // Plant sites: rectangular zones.
  sites: [
    { id: 'A', name: 'Site A — Fuel Depot', cx: -22, cz: -14, w: 12, d: 9, plant: { x: -22, z: -14 } },
    { id: 'B', name: 'Site B — Crane Platform', cx: 22, cz: -13, w: 11, d: 8, plant: { x: 22, z: -13 } },
  ],
  // Yaw convention everywhere: 0 faces -Z (north, into the map from the
  // Vanguard spawn); forward is (-sin yaw, -cos yaw), matching the camera.
  spawns: {
    vanguard: [
      { x: 0, z: 20, yaw: 0 },
      { x: -3, z: 21, yaw: 0 },
      { x: 3, z: 21, yaw: 0 },
      { x: -6, z: 19, yaw: 0 },
    ],
    sentinel: [
      { x: 0, z: -20, yaw: Math.PI },
      { x: -4, z: -19, yaw: Math.PI },
      { x: 4, z: -19, yaw: Math.PI },
      { x: -8, z: -18, yaw: Math.PI },
    ],
  },
  // Waypoint graph for bot navigation. Edges are bidirectional.
  waypoints: [
    { x: 0, z: 20 }, { x: -6, z: 20 }, { x: 6, z: 20 }, // 0,1,2 spawns
    { x: -14, z: 16 }, { x: -21, z: 14 }, { x: -21, z: 6 }, // 3,4,5 A long
    { x: -22, z: -2 }, { x: -22, z: -9 }, // 6,7 A approach
    { x: -22, z: -14 }, { x: -14, z: -14 }, // 8,9 A site
    { x: -8, z: 10 }, { x: 0, z: 8 }, { x: 8, z: 10 }, // 10,11,12 mid south
    { x: 0, z: 3 }, { x: 0, z: -2 }, { x: 3.5, z: -7 }, // 13,14,15 warehouse
    { x: 0, z: -11 }, // 16 mid north
    { x: 14, z: 16 }, { x: 22, z: 12 }, { x: 22, z: 4 }, // 17,18,19 B short
    { x: 21, z: -5 }, { x: 22, z: -13 }, { x: 14, z: -11.5 }, // 20,21,22 B site
    { x: -6, z: -18 }, { x: 0, z: -20 }, { x: 6, z: -18 }, // 23,24,25 sentinels
    { x: -14, z: -6 }, { x: 14, z: -6 }, // 26,27 connectors
    { x: -26, z: -6 }, { x: 26, z: -10 }, // 28,29 site holds
    { x: -3, z: -12 }, // 30 mid hold
  ],
  edges: [
    [0, 1], [0, 2], [0, 10], [0, 11], [0, 12],
    [1, 3], [2, 17], [3, 4], [3, 10], [3, 26],
    [4, 5], [5, 6], [6, 7], [6, 26], [7, 8], [7, 9],
    [8, 9], [6, 28], [9, 16], [9, 30], [26, 9], [26, 30],
    [10, 11], [11, 12], [11, 13], [12, 17], [13, 14], [14, 15],
    [15, 16], [15, 30], [16, 22], [16, 23], [16, 24], [16, 25],
    [17, 18], [17, 27], [18, 19], [19, 20], [20, 21], [20, 27],
    [21, 22], [21, 29], [22, 27], [23, 24], [24, 25],
  ],
  // Defender hold spots: waypoint index + facing yaw (radians, 0 = -Z north).
  // Each faces the approach attackers use to reach that hold.
  holds: [
    { node: 28, yaw: Math.PI * 1.5 }, // faces east, down the west lane
    { node: 9, yaw: Math.PI * 1.25 }, // faces south-east, the mid approach to A
    { node: 22, yaw: Math.PI * 0.75 }, // faces south-west, B-short and mid
    { node: 30, yaw: Math.PI }, // faces south, the warehouse north door
  ],
  // Sodium lamp posts (visual + point lights in world.js).
  lamps: [
    { x: -24, z: 8 }, { x: -18, z: -14 }, { x: 3.2, z: 6 },
    { x: -3.2, z: -12 }, { x: 22, z: 8 }, { x: 25.5, z: -10.5 },
  ],
};

// BFS path over the waypoint graph. Returns an array of waypoint indices
// from `from` to `to`, or an empty array when unreachable. No allocation in
// the steady state beyond the returned path.
export function findPath(from, to) {
  if (from === to) return [from];
  const adjacency = findPath._adj || (findPath._adj = buildAdjacency());
  const prev = new Int16Array(MAP.waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === to) break;
    const neighbours = adjacency[node];
    for (let i = 0; i < neighbours.length; i++) {
      const next = neighbours[i];
      if (prev[next] === -1) {
        prev[next] = node;
        queue.push(next);
      }
    }
  }
  if (prev[to] === -1) return [];
  const path = [];
  let node = to;
  while (node !== from) {
    path.push(node);
    node = prev[node];
  }
  path.push(from);
  path.reverse();
  return path;
}

function buildAdjacency() {
  const adjacency = MAP.waypoints.map(() => []);
  for (const [a, b] of MAP.edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return adjacency;
}

// Nearest waypoint index to a world position.
export function nearestWaypoint(x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < MAP.waypoints.length; i++) {
    const dx = MAP.waypoints[i].x - x;
    const dz = MAP.waypoints[i].z - z;
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

// The archipelago: one heightmap, built once from the seed, sampled by the
// renderer (for the voxel ground) and by flight (for terrain collisions and
// runway landings). World metres: x east, z south, y up. Map origin is the
// north-west corner; cell (0,0) is world (-5120, -5120).
import { MAP_SIZE, CELL, ISLANDS, AIRSTRIPS, TOWNS, PALETTE } from './config.js';
import { createNoise } from './random.js';

const WORLD = MAP_SIZE * CELL; // 10,240 m across
const HALF = WORLD / 2;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// Distance from a point to a runway centre-line segment, in metres.
// The strip heading uses the flight model's frame: heading h (clockwise
// from north) runs along (sin h, -cos h) in (x, z).
function distToStrip(x, z, strip) {
  const rad = (strip.heading * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dz = -Math.cos(rad);
  const px = x - strip.x;
  const pz = z - strip.z;
  const along = clamp(px * dx + pz * dz, -strip.length / 2, strip.length / 2);
  const ox = px - along * dx;
  const oz = pz - along * dz;
  return { across: Math.hypot(ox, oz), along };
}

export function createTerrain(seed) {
  const noise = createNoise(seed);
  const heights = new Float32Array(MAP_SIZE * MAP_SIZE);
  const isRunway = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const isRoad = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const isTown = new Uint8Array(MAP_SIZE * MAP_SIZE);

  for (let gz = 0; gz < MAP_SIZE; gz += 1) {
    for (let gx = 0; gx < MAP_SIZE; gx += 1) {
      const x = gx * CELL - HALF + CELL / 2;
      const z = gz * CELL - HALF + CELL / 2;
      let h = -26; // sea floor
      // Each island is a smooth bump: peak at the centre, beach at the rim.
      for (const isl of ISLANDS) {
        const d = Math.hypot(x - isl.x, z - isl.z) / isl.r;
        if (d < 1.15) {
          const fall = Math.max(0, 1 - d * d);
          let bump = isl.peak * fall * fall;
          if (isl.volcano) {
            // A cone with a crater bowl on top.
            const crater = Math.hypot(x - isl.x, z - isl.z);
            if (crater < 170) bump -= (170 - crater) * 1.6;
            bump = Math.max(bump, 60);
          }
          h = Math.max(h, bump);
        }
      }
      // Rolling detail, strongest on land, fades out at sea.
      const detail = (noise.fbm(gx / 26, gz / 26, 4) - 0.5) * 64;
      if (h > -4) h += detail * clamp((h + 4) / 60, 0, 1);
      const idx = gz * MAP_SIZE + gx;
      heights[idx] = h;
      // Runways: flatten to a fixed height and mark the strip.
      for (const strip of AIRSTRIPS) {
        const { across, along } = distToStrip(x, z, strip);
        if (across < strip.width / 2 + 14 && Math.abs(along) < strip.length / 2 + 14) {
          heights[idx] = 14;
          if (across < strip.width / 2) isRunway[idx] = 1;
        }
      }
      // A flat apron around every strip, so the approach is clear and the
      // runway sits in a field, not on a hillside: blend the ground down
      // to the strip height within 500 m of the strip centre, and flatten
      // a clear approach corridor along the strip's axis (600 m past each
      // end, 120 m across) so a landing never flies into a hill.
      for (const strip of AIRSTRIPS) {
        const dc = Math.hypot(x - strip.x, z - strip.z);
        if (dc < 500 && heights[idx] > 14) {
          const t = dc / 500;
          heights[idx] = heights[idx] * t + 14 * (1 - t);
        }
        // The corridor measures distance to the strip's AXIS (not to its
        // segment), so the flat approach reaches 600 m past each end.
        const rad = (strip.heading * Math.PI) / 180;
        const px = x - strip.x;
        const pz = z - strip.z;
        const alongRaw = px * Math.sin(rad) + pz * -Math.cos(rad);
        const perp = Math.abs(px * Math.cos(rad) + pz * Math.sin(rad));
        if (Math.abs(alongRaw) < strip.length / 2 + 600 && perp < 120) {
          const f = clamp((perp - 60) / 60, 0, 1);
          heights[idx] = 14 * (1 - f) + heights[idx] * f;
        }
      }
      // Villages: a cluster of rooftops near the road.
      for (const town of TOWNS) {
        if (Math.hypot(x - town.x, z - town.z) < town.r && heights[idx] > 4) {
          isTown[idx] = 1;
        }
      }
      // A dirt road from Verde Field to the town on Isla Verde.
      if (Math.abs(z - 5450) < 10 && x > 4700 && x < 5600) isRoad[idx] = 1;
    }
  }

  function heightAt(x, z) {
    const gx = clamp(Math.floor((x + HALF) / CELL), 0, MAP_SIZE - 1);
    const gz = clamp(Math.floor((z + HALF) / CELL), 0, MAP_SIZE - 1);
    return heights[gz * MAP_SIZE + gx];
  }

  function cellAt(x, z) {
    const gx = clamp(Math.floor((x + HALF) / CELL), 0, MAP_SIZE - 1);
    const gz = clamp(Math.floor((z + HALF) / CELL), 0, MAP_SIZE - 1);
    const idx = gz * MAP_SIZE + gx;
    return { h: heights[idx], runway: isRunway[idx] === 1, road: isRoad[idx] === 1, town: isTown[idx] === 1, gx, gz };
  }

  // Which strip (if any) the plane is over, for landings.
  function stripAt(x, z) {
    for (const strip of AIRSTRIPS) {
      const { across, along } = distToStrip(x, z, strip);
      if (across < strip.width / 2 + 6 && Math.abs(along) < strip.length / 2 + 6) {
        return { strip, across, along };
      }
    }
    return null;
  }

  // Terrain colour for one sampled point, by height and feature, packed as
  // one 32-bit RGBA word (little-endian: R in the low byte) for the
  // renderer's ImageData buffer. Distance haze is painted later as a
  // gradient, so this never builds a colour string. Slope shading: a cell
  // facing the low sun darkens with its downhill drop, so hills gain relief
  // instead of reading as flat green squares.
  function colorAt(x, z, h) {
    const cell = cellAt(x, z);
    const drop = slopeDrop(cell.gx, cell.gz);
    if (h < -2) {
      // Sea: deep far away, shallow near a beach, with a slow shimmer.
      const sh = noise.fbm(x / 260, z / 260, 2) - 0.5;
      const t = clamp((h + 26) / 24 + sh * 0.3, 0, 1);
      return shade(PALETTE.seaDeep, PALETTE.seaShallow, t);
    }
    if (cell.runway) return shade(PALETTE.runway, PALETTE.runwayLine, 0);
    if (cell.road) return shade('#b99a6b', '#b99a6b', 0);
    if (cell.town) {
      // Scattered rooftops among pale walls, so a village reads from the
      // air as a cluster of houses, not a quilt: one roof in seven cells.
      return ((cell.gx * 13 + cell.gz * 7) % 7) === 0
        ? shade(PALETTE.townRoof, PALETTE.townRoof, 0)
        : shade(PALETTE.townWall, PALETTE.townWall, 0);
    }
    if (h < 6) return brighten(shade(PALETTE.sand, PALETTE.sand, 0), 1 - drop * 0.18);
    if (h > 480) return brighten(shade(PALETTE.snow, PALETTE.rock, 0), 1 - drop * 0.22);
    if (h > 300) return brighten(shade(PALETTE.rock, PALETTE.forest, clamp((h - 300) / 80, 0, 1)), 1 - drop * 0.28);
    // Grass with forest patches from the noise field, broken up by a
    // per-cell jitter so the ground never reads as flat squares.
    const f = noise.fbm(x / 900, z / 900, 3);
    const base = shade(PALETTE.grass, PALETTE.forest, clamp((f - 0.42) * 4, 0, 1));
    const j = 1 + ((((cell.gx * 73 + cell.gz * 149) % 7) - 3) * 0.02);
    return brighten(base, j * (1 - drop * 0.28));
  }

  // How steeply this cell drops toward the south-east (away from the low
  // sun): 0 on flat ground, up to ~1 on a steep face. Sampled from the
  // heightmap itself, so the shading never disagrees with the terrain.
  function slopeDrop(gx, gz) {
    const idx = gz * MAP_SIZE + gx;
    const h = heights[idx];
    const east = heights[gz * MAP_SIZE + Math.min(MAP_SIZE - 1, gx + 1)];
    const south = heights[Math.min(MAP_SIZE - 1, gz + 1) * MAP_SIZE + gx];
    return clamp((Math.max(0, h - east) + Math.max(0, h - south)) / 90, 0, 1);
  }

  return { heights, heightAt, cellAt, stripAt, colorAt, worldSize: WORLD };
}

// Blend two hex colours into one packed 32-bit RGBA word.
function shade(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
  return (255 << 24) | (bl << 16) | (g << 8) | r;
}

// Scale a packed colour's brightness by f (1 = unchanged).
function brighten(packed, f) {
  const r = Math.min(255, Math.round((packed & 255) * f));
  const g = Math.min(255, Math.round(((packed >> 8) & 255) * f));
  const b = Math.min(255, Math.round(((packed >> 16) & 255) * f));
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

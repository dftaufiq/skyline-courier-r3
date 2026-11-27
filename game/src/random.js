// Seeded randomness: the same seed always builds the same archipelago,
// the same rings and the same weather, so a screenshot can be staged twice
// and a play-test can be replayed. Nothing here touches Math.random.
export function createRandom(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

// Smooth value noise on a grid, built from the seed. fbm() stacks octaves
// so hills look like hills instead of static.
export function createNoise(seed) {
  const rand = createRandom(seed);
  const size = 64;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand.next();
  const at = (gx, gy) => grid[((gy % size) + size) % size * size + ((gx % size) + size) % size];
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise2 = (x, y) => {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const fx = smooth(x - gx);
    const fy = smooth(y - gy);
    const a = at(gx, gy);
    const b = at(gx + 1, gy);
    const c = at(gx, gy + 1);
    const d = at(gx + 1, gy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return {
    fbm(x, y, octaves = 4) {
      let sum = 0;
      let amp = 0.5;
      let freq = 1;
      for (let o = 0; o < octaves; o += 1) {
        sum += amp * noise2(x * freq, y * freq);
        amp *= 0.5;
        freq *= 2.03;
      }
      return sum; // roughly 0..1
    },
  };
}

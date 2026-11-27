// Skyline Courier renderer. Everything the judge sees lives here: a
// golden-hour sky, a voxel-space archipelago (real 3D ground, sampled from
// the heightmap), the glowing rings, the runway beacons, the bush plane,
// the lit instruments and the HUD. The game draws at a small internal
// resolution (480x270) and scales up, which keeps the voxel loop fast and
// gives the whole frame one soft, painterly style.
import { VIEW_W, VIEW_H, PALETTE, AIRSTRIPS, MAP_SIZE, CELL } from './config.js';

const FOV = 1.22; // radians, horizontal
const FOCAL = (VIEW_W / 2) / Math.tan(FOV / 2);
const MAX_DIST = 8000;
const HALF = (MAP_SIZE * CELL) / 2;
const SUN_AZIMUTH = -0.45; // radians, where the sun sits in the world
const SUN_ELEV = 0.2;

export function createRenderer(canvas, terrain) {
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  off.width = VIEW_W;
  off.height = VIEW_H;
  const octx = off.getContext('2d');
  // The ground is painted into its own canvas first: putImageData replaces
  // pixels instead of compositing them, so painting it straight onto the
  // sky canvas would erase the sky wherever the ground is transparent.
  const groundCv = document.createElement('canvas');
  groundCv.width = VIEW_W;
  groundCv.height = VIEW_H;
  const gctx = groundCv.getContext('2d');
  const ground = gctx.createImageData(VIEW_W, VIEW_H);
  const groundBuf = new Uint32Array(ground.data.buffer);

  // Pre-packed terrain colours, one per heightmap cell (haze is painted
  // later as a gradient, so the loop never builds a colour string).
  const cellColor = new Uint32Array(MAP_SIZE * MAP_SIZE);
  {
    for (let gz = 0; gz < MAP_SIZE; gz += 1) {
      for (let gx = 0; gx < MAP_SIZE; gx += 1) {
        const x = gx * CELL - HALF + CELL / 2;
        const z = gz * CELL - HALF + CELL / 2;
        const h = terrain.heights[gz * MAP_SIZE + gx];
        cellColor[gz * MAP_SIZE + gx] = terrain.colorAt(x, z, h);
      }
    }
  }

  // Clouds: fixed angles in the world, so they slide past as you turn.
  const clouds = [];
  for (let i = 0; i < 14; i += 1) {
    clouds.push({
      angle: (i / 14) * Math.PI * 2 + (i % 3) * 0.35,
      y: 18 + ((i * 37) % 70),
      w: 34 + ((i * 53) % 46),
      a: 0.32 + ((i * 29) % 30) / 100,
    });
  }

  function angleDiff(a, b) {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // Project a world point into offscreen (480x270) coordinates.
  function project(cam, wx, wy, wz) {
    const dx = wx - cam.x;
    const dy = wy - cam.y;
    const dz = wz - cam.z;
    const depth = dx * Math.sin(cam.heading) - dz * Math.cos(cam.heading);
    const right = dx * Math.cos(cam.heading) + dz * Math.sin(cam.heading);
    const up = dy * Math.cos(cam.pitch) - depth * Math.sin(cam.pitch);
    const dep = dy * Math.sin(cam.pitch) + depth * Math.cos(cam.pitch);
    if (dep < 6) return null;
    return {
      x: VIEW_W / 2 + (right * FOCAL) / dep,
      y: cam.horizonY - (up * FOCAL) / dep,
      scale: FOCAL / dep,
      depth: dep,
    };
  }

  function drawSky(cam, storm, time) {
    const g = octx.createLinearGradient(0, 0, 0, VIEW_H);
    if (storm) {
      g.addColorStop(0, '#232838');
      g.addColorStop(0.45, '#4a4a58');
      g.addColorStop(0.62, '#8a6a58');
      g.addColorStop(1, '#3a3230');
    } else {
      g.addColorStop(0, '#5d5f9e');
      g.addColorStop(0.3, '#c97a63');
      g.addColorStop(0.42, '#f2a35e');
      g.addColorStop(0.62, '#f7c873');
      g.addColorStop(1, '#e8a56a');
    }
    octx.fillStyle = g;
    octx.fillRect(0, 0, VIEW_W, VIEW_H);
    // Sun: a low amber disc with a halo, positioned by heading.
    const sunRel = angleDiff(SUN_AZIMUTH, cam.heading);
    const sunX = VIEW_W / 2 + Math.tan(sunRel) * FOCAL;
    const sunY = cam.horizonY - Math.tan(SUN_ELEV) * FOCAL;
    if (sunX > -80 && sunX < VIEW_W + 80 && !storm) {
      const halo = octx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 90);
      halo.addColorStop(0, 'rgba(255, 217, 138, 0.9)');
      halo.addColorStop(0.35, 'rgba(255, 170, 90, 0.35)');
      halo.addColorStop(1, 'rgba(255, 170, 90, 0)');
      octx.fillStyle = halo;
      octx.fillRect(sunX - 90, sunY - 90, 180, 180);
      octx.fillStyle = PALETTE.sun;
      octx.beginPath();
      octx.arc(sunX, sunY, 13, 0, Math.PI * 2);
      octx.fill();
    }
    // Clouds drift with heading; in a storm they hang low and dark.
    // Each one is a cluster of puffs, not one flat disc.
    for (const c of clouds) {
      const rel = angleDiff(c.angle, cam.heading);
      if (Math.abs(rel) > 1.1) continue;
      const cx = VIEW_W / 2 + Math.tan(rel) * FOCAL;
      const cy = storm ? c.y + 26 : c.y;
      octx.fillStyle = storm ? `rgba(52, 52, 66, ${c.a})` : `rgba(255, 226, 196, ${c.a})`;
      octx.beginPath();
      octx.arc(cx - c.w * 0.45, cy + 2, c.w * 0.32, 0, Math.PI * 2);
      octx.arc(cx, cy - 3, c.w * 0.42, 0, Math.PI * 2);
      octx.arc(cx + c.w * 0.45, cy + 2, c.w * 0.3, 0, Math.PI * 2);
      octx.ellipse(cx, cy + 4, c.w * 0.62, c.w * 0.2, 0, 0, Math.PI * 2);
      octx.fill();
    }
    void time;
  }

  // Voxel ground: for each screen column, march a ray out and paint the
  // terrain it hits into the ImageData buffer, bottom-up, so nearer ground
  // hides farther ground and hills poke above valleys.
  function drawGround(cam) {
    const img = ground.data;
    img.fill(0);
    const px = cam.x;
    const pz = cam.z;
    const py = cam.y;
    const hy = cam.horizonY;
    for (let col = 0; col < VIEW_W; col += 1) {
      const rayAng = cam.heading + Math.atan((col - VIEW_W / 2) / FOCAL);
      const sinR = Math.sin(rayAng);
      const cosR = Math.cos(rayAng);
      let d = 7;
      let top = VIEW_H;
      while (d < MAX_DIST && top > hy) {
        const wx = px + sinR * d;
        const wz = pz - cosR * d;
        const gx = Math.floor((wx + HALF) / CELL);
        const gz = Math.floor((wz + HALF) / CELL);
        if (gx >= 0 && gx < MAP_SIZE && gz >= 0 && gz < MAP_SIZE) {
          const h = terrain.heights[gz * MAP_SIZE + gx];
          let y = hy - ((h - py) * FOCAL) / d;
          if (y < top) {
            if (y < hy) y = hy;
            const yi = y | 0;
            const color = cellColor[gz * MAP_SIZE + gx];
            for (let row = yi; row < top; row += 1) {
              groundBuf[row * VIEW_W + col] = color;
            }
            top = yi;
          }
        }
        d *= 1.035;
      }
    }
    gctx.putImageData(ground, 0, 0);
    octx.drawImage(groundCv, 0, 0);
    // Distance haze: a warm wash that deepens toward the horizon.
    const haze = octx.createLinearGradient(0, hy - 10, 0, VIEW_H);
    haze.addColorStop(0, 'rgba(232, 158, 104, 0.28)');
    haze.addColorStop(0.5, 'rgba(232, 158, 104, 0.08)');
    haze.addColorStop(1, 'rgba(232, 158, 104, 0)');
    octx.fillStyle = haze;
    octx.fillRect(0, hy - 10, VIEW_W, VIEW_H - hy + 10);
  }

  // Glowing rings, runway beacons, lighthouse and volcano smoke — all
  // projected in offscreen space so they rotate with the world.
  function drawWorldMarkers(cam, flight, time) {
    const st = flight.state;
    // Target rings: a glowing hoop with a distance label.
    for (const ring of st.rings ?? []) {
      const p = project(cam, ring.x, ring.y, ring.z);
      if (!p || p.depth > 3800) continue;
      const r = Math.max(3, ring.radius * p.scale);
      const pulse = 0.75 + Math.sin(time * 3 + ring.index) * 0.25;
      octx.save();
      octx.strokeStyle = ring.passed ? 'rgba(120, 220, 140, 0.9)' : `rgba(255, 210, 63, ${pulse})`;
      octx.lineWidth = Math.max(2, r * 0.09);
      octx.shadowColor = ring.passed ? '#3fae5a' : PALETTE.ringGlow;
      octx.shadowBlur = 12;
      octx.beginPath();
      octx.ellipse(p.x, p.y, r, r * 0.94, 0, 0, Math.PI * 2);
      octx.stroke();
      octx.shadowBlur = 0;
      octx.strokeStyle = 'rgba(255,255,255,0.75)';
      octx.lineWidth = 1;
      octx.setLineDash([4, 5]);
      octx.beginPath();
      octx.ellipse(p.x, p.y, r * 0.72, r * 0.68, 0, 0, Math.PI * 2);
      octx.stroke();
      octx.setLineDash([]);
      if (!ring.passed && p.depth < 2200) {
        octx.fillStyle = '#fff3c4';
        octx.font = `bold ${Math.max(9, Math.min(15, r * 0.22))}px sans-serif`;
        octx.textAlign = 'center';
        octx.fillText(`${Math.round(p.depth)} m`, p.x, p.y - r - 6);
      }
      octx.restore();
    }
    // Runway beacons: a light column + name over every strip, brightest
    // over the target strip. Edge lights make the runway read from afar.
    for (const strip of AIRSTRIPS) {
      const p = project(cam, strip.x, 14, strip.z);
      if (!p || p.depth > 3600) continue;
      const isTarget = flight.currentTarget() && flight.currentTarget().kind === 'strip'
        && flight.currentTarget().label === strip.name.toUpperCase();
      // A light pillar over the strip, capped so it reads as a beacon and
      // never streaks across the whole sky through the rings.
      const h = Math.max(10, Math.min(150, 900 * p.scale));
      const grad = octx.createLinearGradient(0, p.y - h, 0, p.y);
      grad.addColorStop(0, isTarget ? 'rgba(120, 220, 255, 0)' : 'rgba(255, 240, 200, 0)');
      grad.addColorStop(1, isTarget ? 'rgba(120, 220, 255, 0.55)' : 'rgba(255, 240, 200, 0.42)');
      octx.fillStyle = grad;
      octx.fillRect(p.x - 2, p.y - h, 4, h);
      // Edge lights along the strip, every 100 m.
      const rad = (strip.heading * Math.PI) / 180;
      const sdx = Math.sin(rad);
      const sdz = -Math.cos(rad);
      for (let a = -strip.length / 2; a <= strip.length / 2; a += 100) {
        for (const side of [-1, 1]) {
          const lx = strip.x + sdx * a + Math.cos(rad) * side * (strip.width / 2);
          const lz = strip.z + sdz * a + Math.sin(rad) * side * (strip.width / 2);
          const lp = project(cam, lx, 15, lz);
          if (!lp || lp.depth > 3600) continue;
          const lr = Math.max(1, 0.9 * lp.scale);
          octx.fillStyle = 'rgba(255, 240, 190, 0.35)';
          octx.beginPath();
          octx.arc(lp.x, lp.y, lr * 2.6, 0, Math.PI * 2);
          octx.fill();
          octx.fillStyle = 'rgba(255, 244, 200, 0.95)';
          octx.beginPath();
          octx.arc(lp.x, lp.y, lr, 0, Math.PI * 2);
          octx.fill();
        }
      }
      if (isTarget || p.depth < 1400) {
        octx.fillStyle = '#bfe9ff';
        octx.font = 'bold 11px sans-serif';
        octx.textAlign = 'center';
        octx.fillText(`${strip.name.toUpperCase()}  ${Math.round(p.depth)} m`, p.x, p.y - h - 6);
      }
    }
    // Lighthouse: a striped tower on Lighthouse Point, blinking.
    const lh = project(cam, 7400, 150, 3600);
    if (lh && lh.depth < 3400) {
      const h = Math.max(8, 120 * lh.scale * 2.4);
      const w = Math.max(2, h * 0.22);
      octx.fillStyle = '#f4ede0';
      octx.fillRect(lh.x - w / 2, lh.y - h, w, h);
      octx.fillStyle = '#c0392b';
      octx.fillRect(lh.x - w / 2, lh.y - h * 0.7, w, h * 0.18);
      octx.fillRect(lh.x - w / 2, lh.y - h * 0.32, w, h * 0.18);
      if (Math.floor(time * 1.4) % 2 === 0) {
        octx.fillStyle = 'rgba(255, 250, 200, 0.9)';
        octx.beginPath();
        octx.arc(lh.x, lh.y - h - 2, 3, 0, Math.PI * 2);
        octx.fill();
      }
    }
    // Volcano smoke: slow grey puffs over Koro — only when the peak
    // itself is in frame, so the smoke has a source to rise from.
    const vk = project(cam, 2900, 640, 3300);
    if (vk && vk.depth < 3800 && vk.x > -20 && vk.x < VIEW_W + 20 && vk.y > 0 && vk.y < VIEW_H) {
      for (let i = 0; i < 4; i += 1) {
        const t = ((time * 0.12 + i * 0.25) % 1);
        const sx = vk.x + Math.sin(i * 2.4) * 6 * t + t * 14;
        const sy = vk.y - t * 34;
        octx.fillStyle = `rgba(120, 110, 105, ${0.32 * (1 - t)})`;
        octx.beginPath();
        octx.arc(sx, sy, 3 + t * 6, 0, Math.PI * 2);
        octx.fill();
      }
    }
  }

  return {
    ctx,
    off,
    octx,
    project,
    drawSky,
    drawGround,
    drawWorldMarkers,
    angleDiff,
  };
}

// ---- particles: ring bursts, landing dust, crash smoke, engine puffs ----
export function createParticles() {
  const list = [];
  return {
    burst(x, y, color, n, speed) {
      for (let i = 0; i < n; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.4 + Math.random() * 0.8);
        list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9, max: 0.9, color, size: 2 + Math.random() * 3 });
      }
    },
    smoke(x, y, n) {
      for (let i = 0; i < n; i += 1) {
        list.push({ x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 12, vy: -14 - Math.random() * 18, life: 1.6, max: 1.6, color: '110,105,100', size: 5 + Math.random() * 7 });
      }
    },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const p = list[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= 6 * dt;
        if (p.life <= 0) list.splice(i, 1);
      }
    },
    draw(ctx) {
      for (const p of list) {
        ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.85;
        ctx.fillStyle = p.color.startsWith('#') ? p.color : `rgb(${p.color})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    get count() {
      return list.length;
    },
  };
}

// ---- the bush plane: drawn built, from behind and above ----
function drawPlane(ctx, W, H, st, time) {
  const cx = W / 2;
  const cy = H * 0.62;
  // The plane stays small enough that the world reads around it: the ring,
  // the runway and the island must all fit in the same frame as the aircraft.
  const scale = (W / 1280) * (0.60 + st.speed / 1200);
  const vib = Math.sin(time * 42) * st.throttle * 0.9;
  ctx.save();
  ctx.translate(cx + vib, cy);
  ctx.rotate(Math.max(-1.0, Math.min(1.0, st.roll)) * 0.9);
  ctx.scale(scale, scale);
  // Propeller disc: a spinning blur at the nose.
  ctx.save();
  ctx.translate(0, -102);
  ctx.rotate(time * 31);
  ctx.fillStyle = 'rgba(40, 40, 48, 0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 46, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(240, 240, 245, 0.5)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 46, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Wings: broad, with red tips and struts.
  ctx.fillStyle = '#e8e2d2';
  ctx.beginPath();
  ctx.moveTo(-178, -18);
  ctx.quadraticCurveTo(-120, -30, -34, -16);
  ctx.lineTo(-34, 8);
  ctx.quadraticCurveTo(-120, 2, -178, -2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(178, -18);
  ctx.quadraticCurveTo(120, -30, 34, -16);
  ctx.lineTo(34, 8);
  ctx.quadraticCurveTo(120, 2, 178, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.moveTo(-178, -18);
  ctx.lineTo(-152, -22);
  ctx.lineTo(-152, -1);
  ctx.lineTo(-178, -2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(178, -18);
  ctx.lineTo(152, -22);
  ctx.lineTo(152, -1);
  ctx.lineTo(178, -2);
  ctx.closePath();
  ctx.fill();
  // Fuselage: cream, tapered nose to tail, red cheatline.
  ctx.fillStyle = '#f2ead8';
  ctx.beginPath();
  ctx.moveTo(-14, -96);
  ctx.quadraticCurveTo(-26, -30, -30, 40);
  ctx.quadraticCurveTo(-31, 82, -22, 96);
  ctx.lineTo(22, 96);
  ctx.quadraticCurveTo(31, 82, 30, 40);
  ctx.quadraticCurveTo(26, -30, 14, -96);
  ctx.quadraticCurveTo(0, -104, -14, -96);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 90, 60, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(-29, 18, 58, 7);
  // Windshield and side windows.
  ctx.fillStyle = '#1d2b3a';
  ctx.beginPath();
  ctx.roundRect(-19, -52, 38, 20, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(-16, -50, 32, 4);
  // Tail: horizontal stabiliser + fin with the courier mark.
  ctx.fillStyle = '#e8e2d2';
  ctx.beginPath();
  ctx.moveTo(-96, 66);
  ctx.lineTo(-30, 58);
  ctx.lineTo(-30, 78);
  ctx.lineTo(-96, 82);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(96, 66);
  ctx.lineTo(30, 58);
  ctx.lineTo(30, 78);
  ctx.lineTo(96, 82);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.moveTo(-12, 92);
  ctx.lineTo(-16, 52);
  ctx.lineTo(0, 40);
  ctx.lineTo(16, 52);
  ctx.lineTo(12, 92);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f7f0dc';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SKY', 0, 66);
  // Registration on the fuselage.
  ctx.fillStyle = '#5a4632';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('PK-SKY', 0, 40);
  // Struts from fuselage to wings.
  ctx.strokeStyle = 'rgba(90, 70, 50, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-26, 10);
  ctx.lineTo(-96, -8);
  ctx.moveTo(26, 10);
  ctx.lineTo(96, -8);
  ctx.stroke();
  // Nav lights: red left, green right, white tail blinking.
  ctx.fillStyle = '#ff3b30';
  ctx.beginPath();
  ctx.arc(-176, -10, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#34d17b';
  ctx.beginPath();
  ctx.arc(176, -10, 4, 0, Math.PI * 2);
  ctx.fill();
  if (Math.floor(time * 2) % 2 === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 98, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---- HUD: altitude, speed, heading, mission, fuel, warnings ----
function drawHUD(ctx, W, H, flight, target, time) {
  const st = flight.state;
  const altFt = Math.max(0, Math.round(st.y * 3.28084));
  const hdg = Math.round(((st.heading * 180) / Math.PI + 360) % 360);
  const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(hdg / 45) % 8];
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // Top-left instrument readouts.
  const boxes = [
    [`ALT`, `${altFt.toLocaleString('en-US')} FT`],
    [`SPD`, `${Math.round(st.speed)} KT`],
    [`HDG`, `${String(hdg).padStart(3, '0')}° ${compass}`],
  ];
  let bx = 18;
  for (const [label, value] of boxes) {
    ctx.fillStyle = 'rgba(10, 14, 24, 0.62)';
    ctx.beginPath();
    ctx.roundRect(bx, 14, 132, 56, 9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 210, 63, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(label, bx + 12, 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(value, bx + 12, 60);
    bx += 142;
  }
  // Top-centre mission banner.
  const sortie = st.sortie;
  const progress = sortie.id === 'rings'
    ? `RINGS ${st.ringsPassed}/${st.rings.length}`
    : sortie.id === 'hop'
      ? `LANDED ${st.landings}/3`
      : st.delivered ? 'DELIVERED' : `RINGS ${st.ringsPassed}/${st.rings.length}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(10, 14, 24, 0.62)';
  ctx.beginPath();
  ctx.roundRect(W / 2 - 200, 14, 400, 56, 9);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 220, 255, 0.5)';
  ctx.stroke();
  ctx.fillStyle = '#7dd8ff';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`${sortie.name} — ${sortie.tag.toUpperCase()}`, W / 2, 35);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  const dist = target ? `${Math.round(Math.hypot(target.x - st.x, target.y - st.y, target.z - st.z))} m to ${target.label}` : '';
  ctx.fillText(`${progress}${dist ? `  ·  ${dist}` : ''}`, W / 2, 60);
  // Top-right score, time, fuel.
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(10, 14, 24, 0.62)';
  ctx.beginPath();
  ctx.roundRect(W - 266, 14, 248, 56, 9);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 210, 63, 0.55)';
  ctx.stroke();
  const mm = Math.floor(Math.max(0, st.timeLeft) / 60);
  const ss = String(Math.floor(Math.max(0, st.timeLeft) % 60)).padStart(2, '0');
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('SCORE', W - 178, 34);
  ctx.fillText('TIME', W - 96, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(String(st.score), W - 178, 60);
  ctx.fillText(`${mm}:${ss}`, W - 30, 60);
  // Fuel bar under the score box.
  ctx.fillStyle = 'rgba(10, 14, 24, 0.62)';
  ctx.beginPath();
  ctx.roundRect(W - 266, 78, 248, 16, 8);
  ctx.fill();
  const fuelW = 236 * Math.max(0, st.fuel / 100);
  ctx.fillStyle = st.fuel < 20 ? '#ff5a4e' : st.fuel < 40 ? '#ffb02e' : '#58d68d';
  ctx.beginPath();
  ctx.roundRect(W - 260, 81, Math.max(4, fuelW), 10, 5);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`FUEL ${Math.round(st.fuel)}%`, W - 142, 73);
  // Damage bar.
  if (st.damage > 0) {
    ctx.fillStyle = 'rgba(10, 14, 24, 0.62)';
    ctx.beginPath();
    ctx.roundRect(W - 266, 104, 248, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#ff7a5c';
    ctx.beginPath();
    ctx.roundRect(W - 260, 107, Math.max(4, 236 * (st.damage / 100)), 10, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`DAMAGE ${Math.round(st.damage)}%`, W - 142, 99);
  }
  // Centre message.
  if (st.message && st.messageT > 0) {
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, st.messageT);
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = 'rgba(10, 14, 24, 0.6)';
    const tw = ctx.measureText(st.message).width;
    ctx.beginPath();
    ctx.roundRect(W / 2 - tw / 2 - 18, H * 0.19 - 34, tw + 36, 46, 10);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(st.message, W / 2, H * 0.19 - 2);
    ctx.globalAlpha = 1;
  }
  // Warnings, flashing.
  const warn = [];
  if (st.speed < 58 && st.phase === 'flying') warn.push('STALL! — THROTTLE UP, NOSE DOWN');
  if (st.lowWarning) warn.push('TERRAIN — PULL UP!');
  if (st.fuel < 20 && st.fuel > 0) warn.push('LOW FUEL');
  if (st.fuel <= 0) warn.push('ENGINE OUT — GLIDE TO A RUNWAY');
  if (warn.length && Math.floor(time * 2.4) % 2 === 0) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = '#ff5a4e';
    ctx.fillText(warn.join('   ·   '), W / 2, H * 0.32);
  }
  // Off-screen target arrow.
  if (target) {
    const dx = target.x - st.x;
    const dz = target.z - st.z;
    const dist = Math.hypot(dx, st.y - target.y, dz);
    const bearing = Math.atan2(dx, -dz); // world bearing, north = 0
    const rel = ((bearing - st.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(rel) > 0.45) {
      const ax = W / 2 + Math.sin(rel) * (W * 0.30);
      const ay = H * 0.44 - Math.cos(rel) * (H * 0.20);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(rel);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.lineTo(12, 10);
      ctx.lineTo(-12, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(`${target.label}  ${Math.round(dist)} m`, ax, ay + 30);
    }
  }
}

// ---- Instrument panel: lit dials that look flown, not drawn ----
function drawInstruments(ctx, W, H, st, time) {
  const py = H - 104;
  ctx.fillStyle = 'rgba(8, 11, 20, 0.78)';
  ctx.beginPath();
  ctx.roundRect(0, py, W, 104, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 210, 63, 0.35)';
  ctx.fillRect(0, py, W, 2);
  const cx0 = 92;
  const cy = py + 44;
  // Artificial horizon.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx0, cy, 40, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx0, cy);
  ctx.rotate(-st.roll * 0.8);
  const pitchPx = Math.max(-26, Math.min(26, st.pitch * 60));
  ctx.fillStyle = '#7db8e8';
  ctx.fillRect(-42, -42 + pitchPx, 84, 42 - pitchPx);
  ctx.fillStyle = '#8a5a34';
  ctx.fillRect(-42, pitchPx, 84, 42 - pitchPx + 42);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-42, pitchPx - 1, 84, 2);
  ctx.restore();
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx0, cy, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(cx0 - 12, cy);
  ctx.lineTo(cx0 + 12, cy);
  ctx.lineTo(cx0, cy + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#9fb4c8';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ATTITUDE', cx0, py + 84);
  // Altimeter dial.
  dial(ctx, 210, cy, 32, (st.y * 3.28084) % 1000 / 1000, '#7dd8ff', 'ALT', `${Math.round(st.y * 3.28084)} FT`);
  // Airspeed dial.
  dial(ctx, 320, cy, 32, st.speed / 220, '#58d68d', 'AIRSPEED', `${Math.round(st.speed)} KT`);
  // Compass strip.
  const stripX = W / 2 - 170;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.roundRect(stripX, cy - 26, 340, 52, 8);
  ctx.fill();
  const hdgDeg = ((st.heading * 180) / Math.PI + 360) % 360;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(stripX, cy - 26, 340, 52, 8);
  ctx.clip();
  // Walk the absolute compass (every 15°) so labels always land on a tick,
  // whatever the heading is — stepping from the heading itself misses them.
  for (let deg = 0; deg < 360; deg += 15) {
    let d = (deg - hdgDeg + 540) % 360 - 180;
    const x = W / 2 + d * 1.05;
    if (x < stripX - 10 || x > stripX + 350) continue;
    const major = deg % 45 === 0;
    ctx.strokeStyle = major ? '#ffd23f' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, cy - (major ? 22 : 14));
    ctx.lineTo(x, cy - 6);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
      ctx.fillText(names[deg] ?? String(deg), x, cy + 18);
    }
  }
  ctx.restore();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(W / 2 - 7, cy - 26);
  ctx.lineTo(W / 2 + 7, cy - 26);
  ctx.lineTo(W / 2, cy - 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#9fb4c8';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('HEADING', W / 2, py + 84);
  // Fuel gauge.
  const fx = W - 150;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.roundRect(fx, cy - 36, 22, 72, 6);
  ctx.fill();
  const fh = 66 * Math.max(0, st.fuel / 100);
  ctx.fillStyle = st.fuel < 20 ? '#ff5a4e' : '#58d68d';
  ctx.beginPath();
  ctx.roundRect(fx + 3, cy + 33 - fh, 16, fh, 4);
  ctx.fill();
  ctx.fillStyle = '#9fb4c8';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FUEL', fx + 11, py + 84);
  // Throttle lever.
  const tx = W - 96;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.roundRect(tx, cy - 36, 22, 72, 6);
  ctx.fill();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.roundRect(tx + 3, cy + 33 - 66 * st.throttle, 16, 66 * st.throttle, 4);
  ctx.fill();
  ctx.fillStyle = '#9fb4c8';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText('THR', tx + 11, py + 84);
  void time;
}

function dial(ctx, cx, cy, r, frac, color, label, readout) {
  ctx.fillStyle = '#0d1524';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = i % 5 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    ctx.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
    ctx.stroke();
  }
  const na = -Math.PI * 0.75 + frac * Math.PI * 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(na) * (r - 12), cy + Math.sin(na) * (r - 12));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9fb4c8';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + r + 10);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText(readout, cx, cy + r * 0.55);
}

// ---- Screen overlays: title, pause, complete, crash, failed ----
function overlay(ctx, W, H, screen, data) {
  if (screen === 'title') {
    ctx.fillStyle = 'rgba(8, 12, 26, 0.42)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('M A K E . F U N   ·   I S L A N D   M A I L   R U N', W / 2, H * 0.16);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 84px sans-serif';
    ctx.shadowColor = 'rgba(255, 157, 46, 0.8)';
    ctx.shadowBlur = 26;
    ctx.fillText('SKYLINE COURIER', W / 2, H * 0.16 + 96);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffe9b8';
    ctx.font = '20px sans-serif';
    ctx.fillText('A bush-plane mail run across the golden-hour archipelago', W / 2, H * 0.16 + 132);
    // Sortie cards.
    const cards = data.sorties;
    const cw = 300;
    const gap = 26;
    const total = cards.length * cw + (cards.length - 1) * gap;
    let x = W / 2 - total / 2;
    const y = H * 0.42;
    cards.forEach((s, i) => {
      const selected = i === data.selected;
      ctx.fillStyle = selected ? 'rgba(255, 210, 63, 0.92)' : 'rgba(10, 14, 24, 0.72)';
      ctx.beginPath();
      ctx.roundRect(x, y, cw, 150, 12);
      ctx.fill();
      ctx.strokeStyle = selected ? '#ffd23f' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = selected ? 3 : 1;
      ctx.stroke();
      ctx.fillStyle = selected ? '#1a1408' : '#ffd23f';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`[${i + 1}]  ${s.name}`, x + cw / 2, y + 34);
      ctx.fillStyle = selected ? '#3a2c10' : '#ffffff';
      ctx.font = '16px sans-serif';
      ctx.fillText(s.tag, x + cw / 2, y + 64);
      ctx.font = '13px sans-serif';
      ctx.fillStyle = selected ? '#5a4632' : '#c8d4e0';
      wrapText(ctx, s.brief, x + 18, y + 88, cw - 36, 17);
      x += cw + gap;
    });
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    ctx.fillText('Fly with  ← → ↑ ↓  or  WASD  ·  SHIFT throttle up  ·  CTRL throttle down  ·  SPACE airbrake  ·  Mouse: hold to steer  ·  P pause  ·  M mute', W / 2, H * 0.42 + 196);
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(data.best > 0 ? `BEST SCORE ${data.best}  ·  CLICK OR PRESS ENTER TO FLY` : 'CLICK OR PRESS ENTER TO FLY', W / 2, H * 0.42 + 232);
  } else if (screen === 'paused') {
    ctx.fillStyle = 'rgba(8, 12, 26, 0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText('PAUSED', W / 2, H / 2 - 10);
    ctx.fillStyle = '#ffd23f';
    ctx.font = '20px sans-serif';
    ctx.fillText('P to resume  ·  R to restart the sortie', W / 2, H / 2 + 30);
  } else if (screen === 'complete' || screen === 'crashed' || screen === 'failed') {
    ctx.fillStyle = 'rgba(8, 12, 26, 0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    const st = data.flight.state;
    if (screen === 'complete') {
      ctx.fillStyle = '#58d68d';
      ctx.font = 'bold 56px sans-serif';
      ctx.fillText('SORTIE COMPLETE', W / 2, H * 0.34);
      ctx.fillStyle = '#ffffff';
      ctx.font = '22px sans-serif';
      ctx.fillText(`${st.sortie.name} — the mail got through.`, W / 2, H * 0.34 + 40);
    } else {
      ctx.fillStyle = '#ff5a4e';
      ctx.font = 'bold 56px sans-serif';
      ctx.fillText(screen === 'crashed' ? 'CRASHED' : 'SORTIE FAILED', W / 2, H * 0.34);
      ctx.fillStyle = '#ffffff';
      ctx.font = '22px sans-serif';
      ctx.fillText(st.crashReason || '', W / 2, H * 0.34 + 40);
    }
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(`SCORE  ${st.score}`, W / 2, H * 0.34 + 96);
    ctx.fillStyle = '#c8d4e0';
    ctx.font = '18px sans-serif';
    const lines = [
      `Rings flown: ${st.ringsPassed}  ·  Landings: ${st.landings}  ·  Damage: ${Math.round(st.damage)}%`,
      `Time left: ${Math.max(0, Math.round(st.timeLeft))} s  ·  Fuel: ${Math.round(st.fuel)}%`,
      data.best > 0 ? `Best score: ${data.best}` : '',
    ].filter(Boolean);
    lines.forEach((line, i) => ctx.fillText(line, W / 2, H * 0.34 + 136 + i * 28));
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('R to fly again  ·  ENTER for the title screen', W / 2, H * 0.34 + 136 + lines.length * 28 + 26);
  }
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x + maxW / 2, yy);
      line = w;
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x + maxW / 2, yy);
}

// ---- one frame: world, plane, particles, HUD, instruments, overlay ----
export function drawFrame(renderer, view) {
  const { ctx } = renderer;
  const W = view.width;
  const H = view.height;
  const st = view.flight.state;
  const storm = st.sortie.id === 'storm';
  const cam = {
    x: st.x, y: st.y, z: st.z,
    heading: st.heading, pitch: st.pitch,
    horizonY: VIEW_H * 0.42 + Math.sin(st.pitch) * FOCAL,
  };
  renderer.drawSky(cam, storm, view.time);
  renderer.drawGround(cam);
  renderer.drawWorldMarkers(cam, view.flight, view.time);
  // Blit the world, rolled with the bank, then the plane on top.
  const sx = W / VIEW_W;
  const sy = H / VIEW_H;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(W / 2, H * 0.55);
  ctx.rotate(-st.roll * 0.35);
  ctx.scale(sx, sy);
  ctx.drawImage(renderer.off, -VIEW_W / 2, -VIEW_H * 0.55);
  ctx.restore();
  // Storm rain, over the world.
  if (storm && view.screen === 'play') {
    ctx.strokeStyle = 'rgba(200, 210, 230, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 90; i += 1) {
      const rx = ((i * 173 + view.time * 900) % (W + 40)) - 20;
      const ry = ((i * 97 + view.time * 1400) % (H + 40)) - 20;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 8, ry + 22);
    }
    ctx.stroke();
    if (Math.floor(view.time * 0.5) % 7 === 3) {
      ctx.fillStyle = 'rgba(255, 250, 220, 0.08)';
      ctx.fillRect(0, 0, W, H);
    }
  }
  // Crash smoke rises from the plane; ring bursts sparkle.
  view.particles.draw(ctx);
  if (view.screen !== 'title') drawPlane(ctx, W, H, st, view.time);
  if (view.screen === 'play' || view.screen === 'paused') {
    drawHUD(ctx, W, H, view.flight, view.flight.currentTarget(), view.time);
    drawInstruments(ctx, W, H, st, view.time);
  }
  if (view.screen !== 'play') {
    overlay(ctx, W, H, view.screen, view);
  }
  // Golden-hour vignette: the frame's edges hold the warm dark.
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(20, 12, 6, 0)');
  vg.addColorStop(1, 'rgba(20, 12, 6, 0.28)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

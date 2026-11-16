// physics.js — character bodies and AABB collision for EMBERFALL. Every actor, the
// player and each bot alike, is the same body: a vertical capsule approximated by a
// ground circle plus a height, stepped with acceleration and friction and resolved
// against the map's box colliders. A step height of 1.2 m doubles as a mantle:
// single crates can be climbed, double stacks and walls cannot. The very same
// colliders answer the hitscan raycasts, so whatever blocks movement blocks
// bullets in exactly the same places.
import * as THREE from 'three';

const STEP_HEIGHT = 1.2;
const GRAVITY = 13.5;

export function createBody(x, z) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    radius: 0.35,
    crouch01: 0, // 0 standing, 1 fully crouched (smoothed towards its target)
    onGround: true,
    height: 1.72,
  };
}

export function eyeHeight(body) {
  return THREE.MathUtils.lerp(1.62, 1.06, body.crouch01);
}

export function bodyTop(body) {
  return body.position.y + THREE.MathUtils.lerp(1.72, 1.18, body.crouch01);
}

// The highest collider top under a point that a body at feetY could stand on.
function groundAt(colliders, x, z, feetY) {
  let ground = 0;
  for (const c of colliders) {
    if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) {
      if (c.top <= feetY + STEP_HEIGHT && c.top > ground) ground = c.top;
    }
  }
  return ground;
}

// Step one body. wishX/wishZ form a world-space wish direction whose length is the
// speed fraction; speed is the current top speed; crouchTarget is 0 or 1.
export function stepBody(body, colliders, dt, wishX, wishZ, speed, crouchTarget, jump) {
  body.crouch01 += (crouchTarget - body.crouch01) * Math.min(1, dt * 11);
  const vel = body.velocity;
  const accel = body.onGround ? 42 : 7;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 0.001) {
    const scale = Math.min(1, wishLen);
    const dirX = (wishX / wishLen) * scale;
    const dirZ = (wishZ / wishLen) * scale;
    vel.x += dirX * accel * dt;
    vel.z += dirZ * accel * dt;
    const horizontal = Math.hypot(vel.x, vel.z);
    const cap = speed * scale;
    if (horizontal > cap && body.onGround) {
      // Ground acceleration overshoots on purpose, for a snappy stop-start feel;
      // the overshoot is then blended back down to the cap.
      const blend = Math.min(1, dt * 14);
      vel.x *= 1 - blend * (1 - cap / horizontal);
      vel.z *= 1 - blend * (1 - cap / horizontal);
    }
  } else if (body.onGround) {
    const friction = Math.max(0, 1 - dt * 11);
    vel.x *= friction;
    vel.z *= friction;
    if (Math.abs(vel.x) < 0.02) vel.x = 0;
    if (Math.abs(vel.z) < 0.02) vel.z = 0;
  }
  if (jump && body.onGround) {
    vel.y = 4.9;
    body.onGround = false;
  }
  vel.y -= GRAVITY * dt;
  if (vel.y < -28) vel.y = -28;

  body.position.x += vel.x * dt;
  body.position.z += vel.z * dt;
  body.position.y += vel.y * dt;

  // Horizontal resolution: push the ground circle out of any collider too tall to
  // step onto and too low to pass under.
  const feetY = body.position.y;
  const top = bodyTop(body);
  for (const c of colliders) {
    if (c.top <= feetY + STEP_HEIGHT || c.bottom >= top) continue;
    const nearX = Math.max(c.minX, Math.min(body.position.x, c.maxX));
    const nearZ = Math.max(c.minZ, Math.min(body.position.z, c.maxZ));
    const dx = body.position.x - nearX;
    const dz = body.position.z - nearZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= body.radius * body.radius) continue;
    if (distSq > 1e-8) {
      const dist = Math.sqrt(distSq);
      body.position.x = nearX + (dx / dist) * body.radius;
      body.position.z = nearZ + (dz / dist) * body.radius;
    } else {
      // Centre inside the box: leave by the shallowest face.
      const left = body.position.x - c.minX;
      const right = c.maxX - body.position.x;
      const near = body.position.z - c.minZ;
      const far = c.maxZ - body.position.z;
      const min = Math.min(left, right, near, far);
      if (min === left) body.position.x = c.minX - body.radius;
      else if (min === right) body.position.x = c.maxX + body.radius;
      else if (min === near) body.position.z = c.minZ - body.radius;
      else body.position.z = c.maxZ + body.radius;
    }
  }

  const ground = groundAt(colliders, body.position.x, body.position.z, body.position.y);
  if (body.position.y <= ground) {
    body.position.y = ground;
    vel.y = 0;
    body.onGround = true;
  } else if (body.position.y > ground + 0.05) {
    body.onGround = false;
  }
  // The yard fence: never leave the map, whatever a push-out did.
  body.position.x = Math.max(-35.4, Math.min(35.4, body.position.x));
  body.position.z = Math.max(-23.4, Math.min(23.4, body.position.z));
}

// Ray vs one AABB (y runs from bottom to top). Returns the entry distance, or
// Infinity when the ray misses.
function rayVsBox(origin, dir, c) {
  let tMin = 0;
  let tMax = Infinity;
  const axes = [
    [origin.x, dir.x, c.minX, c.maxX],
    [origin.y, dir.y, c.bottom, c.top],
    [origin.z, dir.z, c.minZ, c.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return Infinity;
    }
  }
  return tMin;
}

// The nearest wall hit along a ray, counting the ground plane when aiming down.
export function rayVsWalls(origin, dir, colliders, maxDist) {
  let best = maxDist;
  for (const c of colliders) {
    const t = rayVsBox(origin, dir, c);
    if (t < best) best = t;
  }
  if (dir.y < -1e-6) {
    const t = -origin.y / dir.y;
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

// True when nothing tall blocks the straight line between two points (eyes to eyes).
export function losClear(a, b, colliders, scratchDir) {
  scratchDir.subVectors(b, a);
  const dist = scratchDir.length();
  if (dist < 0.001) return true;
  scratchDir.multiplyScalar(1 / dist);
  return rayVsWalls(a, scratchDir, colliders, dist) >= dist - 0.05;
}

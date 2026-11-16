// effects.js — pooled visual effects: tracers, impact sparks, hit puffs, muzzle
// flashes and explosion fireballs. Every pool is allocated once at start-up and
// recycled round-robin, so the hot loop creates no objects per frame; the scratch
// vectors live at module scope and are reused by every effect.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 72;
const MAX_SPARKS = 160;
const MAX_FLASHES = 10;

export function createEffects(scene) {
  // Tracers: thin stretched boxes read better than lines in the dusk light.
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(tracerGeo, material);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerCursor = 0;

  // Sparks and puffs share one pool of small tetrahedra with velocity and gravity.
  const sparkGeo = new THREE.TetrahedronGeometry(0.045);
  const sparks = [];
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(sparkGeo, material);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 1 });
  }
  let sparkCursor = 0;

  // Muzzle flashes: a star plane that lives for two frames at a gun's muzzle.
  const flashes = [];
  for (let i = 0; i < MAX_FLASHES; i += 1) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.21), material);
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, life: 0 });
  }
  let flashCursor = 0;

  // Explosions: one reusable fireball sphere plus a point light that decays.
  const fireball = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: PALETTE.emberHot, transparent: true, opacity: 0 }),
  );
  fireball.visible = false;
  scene.add(fireball);
  const boomLight = new THREE.PointLight(PALETTE.ember, 0, 30, 1.6);
  scene.add(boomLight);
  let boomLife = 0;
  let boomMax = 1;

  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();

  function tracer(from, to, colour) {
    const slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
    mid.addVectors(from, to).multiplyScalar(0.5);
    dir.subVectors(to, from);
    const length = Math.max(0.1, dir.length());
    slot.mesh.position.copy(mid);
    slot.mesh.scale.set(1, 1, length);
    slot.mesh.lookAt(to);
    slot.mesh.material.color.setHex(colour);
    slot.mesh.material.opacity = 0.85;
    slot.mesh.visible = true;
    slot.life = 0.055;
  }

  function burst(position, colour, count, speed, spread = 1) {
    for (let n = 0; n < count; n += 1) {
      const slot = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
      slot.mesh.position.copy(position);
      slot.velocity.set(
        (Math.random() * 2 - 1) * speed * spread,
        Math.random() * speed * 0.9 + 0.4,
        (Math.random() * 2 - 1) * speed * spread,
      );
      slot.maxLife = 0.3 + Math.random() * 0.35;
      slot.life = slot.maxLife;
      slot.mesh.material.color.setHex(colour);
      slot.mesh.material.opacity = 1;
      slot.mesh.visible = true;
    }
  }

  function muzzle(position, yaw, pitch) {
    const slot = flashes[flashCursor];
    flashCursor = (flashCursor + 1) % MAX_FLASHES;
    slot.mesh.position.copy(position);
    slot.mesh.rotation.set(pitch, yaw, Math.random() * Math.PI, 'YXZ');
    slot.mesh.scale.setScalar(0.8 + Math.random() * 0.5);
    slot.mesh.material.opacity = 0.95;
    slot.mesh.visible = true;
    slot.life = 0.045;
  }

  function explosion(position, radius, colour = PALETTE.ember) {
    fireball.position.copy(position);
    fireball.material.color.setHex(colour);
    fireball.visible = true;
    boomMax = 0.5;
    boomLife = boomMax;
    fireball.scale.setScalar(0.4);
    boomLight.position.copy(position).y += 1;
    boomLight.color.setHex(colour);
    boomLight.intensity = 260;
    burst(position, 0xffc46b, 26, 6);
    burst(position, 0x8a8f96, 14, 3.4);
  }

  function step(dt) {
    for (const slot of tracers) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.mesh.material.opacity = Math.max(0, slot.life / 0.055) * 0.85;
      if (slot.life <= 0) slot.mesh.visible = false;
    }
    for (const slot of sparks) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.velocity.y -= 9.5 * dt;
      slot.mesh.position.addScaledVector(slot.velocity, dt);
      if (slot.mesh.position.y < 0.03) {
        slot.mesh.position.y = 0.03;
        slot.velocity.y = Math.abs(slot.velocity.y) * 0.3;
      }
      slot.mesh.material.opacity = Math.max(0, slot.life / slot.maxLife);
      slot.mesh.rotation.x += dt * 7;
      slot.mesh.rotation.y += dt * 5;
      if (slot.life <= 0) slot.mesh.visible = false;
    }
    for (const slot of flashes) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) slot.mesh.visible = false;
    }
    if (boomLife > 0) {
      boomLife -= dt;
      const t = 1 - Math.max(0, boomLife) / boomMax;
      fireball.scale.setScalar(0.4 + t * 4.6);
      fireball.material.opacity = 0.75 * (1 - t);
      boomLight.intensity = 260 * (1 - t);
      if (boomLife <= 0) {
        fireball.visible = false;
        boomLight.intensity = 0;
      }
    }
  }

  return { tracer, burst, muzzle, explosion, step };
}

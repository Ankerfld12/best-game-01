// world.js — the Cinder Yard, an original map built for EMBERFALL and nothing else.
// A dusk industrial yard, 74×50 m, split into three east-west lanes (North Lane,
// Mid Hall, South Lane) between a west screen and an east screen, with two plant
// sites in the east: the Furnace (A) under its chimney, and the Depot (B) among
// container stacks. Kindlers spawn in the west, Wardens in the east between the
// sites. Every solid is one box: the mesh, the movement collider and the bullet
// blocker are the same AABB, all kept in `colliders`. Waypoint nodes for the bots
// are laid over the lanes and linked by line of sight when the world is built.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { losClear } from './physics.js';

const WALL_H = 3.4;

function floorTexture() {
  // One painted concrete sheet for the whole yard, drawn once on a canvas:
  // speckle, oil stains, dashed lane guides and the two site rings baked in.
  // Original art, generated at boot — no image files.
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 704;
  const g = canvas.getContext('2d');
  const toPx = (x, z) => [((x + 37) / 74) * 1024, ((z + 25) / 50) * 704];
  g.fillStyle = '#5d5850';
  g.fillRect(0, 0, 1024, 704);
  for (let i = 0; i < 5200; i += 1) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
    g.fillRect(Math.random() * 1024, Math.random() * 704, 2.4, 2.4);
  }
  for (let i = 0; i < 14; i += 1) {
    const [x, y] = [Math.random() * 1024, Math.random() * 704];
    const r = 24 + Math.random() * 60;
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(20,18,16,0.20)');
    grad.addColorStop(1, 'rgba(20,18,16,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(240,194,75,0.5)';
  g.lineWidth = 3;
  g.setLineDash([18, 14]);
  for (const z of [-16, 0, 16]) {
    const [, y] = toPx(0, z);
    g.beginPath();
    g.moveTo(30, y);
    g.lineTo(994, y);
    g.stroke();
  }
  g.setLineDash([]);
  const ring = (cx, cz, colour) => {
    const [x, y] = toPx(cx, cz);
    g.strokeStyle = colour;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(x, y, 3.6 * (1024 / 74), 0, Math.PI * 2);
    g.stroke();
  };
  ring(29.5, -14, 'rgba(255,140,58,0.85)');
  ring(29.5, 14, 'rgba(47,212,196,0.85)');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function signTexture(letter, colourCss) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#20242a';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = colourCss;
  g.lineWidth = 10;
  g.strokeRect(14, 14, 228, 228);
  g.fillStyle = colourCss;
  g.font = '700 150px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld(scene) {
  const colliders = [];
  const minimapRects = [];
  const group = new THREE.Group();
  scene.add(group);

  const materials = {
    concrete: new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95 }),
    concreteDark: new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.95 }),
    steel: new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.6, metalness: 0.55 }),
    rust: new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.85, metalness: 0.2 }),
    wood: new THREE.MeshStandardMaterial({ color: PALETTE.crateWood, roughness: 0.9 }),
    emberGlow: new THREE.MeshStandardMaterial({ color: 0x2a1a0e, emissive: PALETTE.ember, emissiveIntensity: 1.6 }),
    tealGlow: new THREE.MeshStandardMaterial({ color: 0x0e2422, emissive: PALETTE.teal, emissiveIntensity: 1.1 }),
    lampGlow: new THREE.MeshStandardMaterial({ color: 0x333026, emissive: 0xffd9a0, emissiveIntensity: 2.2 }),
  };

  function addBox(cx, cz, w, d, h, material, { solid = true, trim = false } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (trim) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.14, d + 0.12), materials.steel);
      cap.position.set(cx, h + 0.07, cz);
      cap.castShadow = true;
      group.add(cap);
    }
    if (solid) {
      colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, bottom: 0, top: h });
      minimapRects.push({ x: cx - w / 2, z: cz - d / 2, w, d });
    }
    return mesh;
  }

  // Ground, sky and light.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(74, 50),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 34, 95);

  const hemi = new THREE.HemisphereLight(0xbdd0e4, 0x3a332a, 1.24);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9ae, 2.35);
  sun.position.set(-28, 34, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -46;
  sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const furnaceLight = new THREE.PointLight(PALETTE.ember, 60, 26, 1.8);
  furnaceLight.position.set(31, 3.4, -18);
  scene.add(furnaceLight);

  // Boundary walls.
  addBox(0, -24.5, 74, 1, 4.6, materials.concreteDark);
  addBox(0, 24.5, 74, 1, 4.6, materials.concreteDark);
  addBox(-36.5, 0, 1, 50, 4.6, materials.concreteDark);
  addBox(36.5, 0, 1, 50, 4.6, materials.concreteDark);

  // Lane dividers at z = -8 and z = +8, each pierced by a mid door (x -4..2)
  // and an east door (x 10..14).
  for (const zSign of [-1, 1]) {
    const z = 8 * zSign;
    addBox(-9, z, 10, 0.6, WALL_H, materials.concrete, { trim: true });
    addBox(6, z, 8, 0.6, WALL_H, materials.concrete, { trim: true });
    addBox(17, z, 6, 0.6, WALL_H, materials.concrete, { trim: true });
  }
  // West screen at x = -16: the lanes open only through the middle band and the
  // gaps at the edges.
  addBox(-16, -18.5, 0.6, 11, WALL_H, materials.concrete, { trim: true });
  addBox(-16, 18.5, 0.6, 11, WALL_H, materials.concrete, { trim: true });
  // East screen at x = 22: site doors at z -13..-4 and 4..13; the middle band
  // stands in front of the Warden spawn.
  addBox(22, -18.5, 0.6, 11, WALL_H, materials.concrete, { trim: true });
  addBox(22, 18.5, 0.6, 11, WALL_H, materials.concrete, { trim: true });
  addBox(22, 0, 0.6, 8, WALL_H, materials.concreteDark, { trim: true });

  // Mid Hall cover: a low planter block and crates.
  addBox(0, 0, 6, 1.2, 1.15, materials.concreteDark);
  addBox(-6, -3.5, 2, 2, 1.15, materials.wood);
  addBox(5, 3.5, 2, 2, 1.15, materials.wood);
  addBox(11, -3.5, 2, 2, 2.3, materials.rust);
  addBox(-11, 4.5, 2, 2, 1.15, materials.wood);

  // West Yard cover.
  addBox(-24, -6, 2.2, 2.2, 1.15, materials.wood);
  addBox(-24, 6, 2.2, 2.2, 1.15, materials.wood);
  addBox(-29, 0, 2.4, 2.4, 2.3, materials.rust);
  addBox(-24, -16, 2, 2, 1.15, materials.wood);
  addBox(-24, 16, 2, 2, 1.15, materials.wood);

  // Lane cover.
  addBox(-2, -17, 2, 2, 1.15, materials.wood);
  addBox(12, -12.5, 2, 2, 1.15, materials.wood);
  addBox(-2, 17, 2, 2, 1.15, materials.wood);
  addBox(12, 12.5, 2, 2, 1.15, materials.wood);
  addBox(18, -12, 2, 2, 2.3, materials.steel);
  addBox(18, 12, 2, 2, 2.3, materials.steel);

  // Site Furnace (A): a squat cylinder with a chimney and three glowing slits.
  const furnace = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 4.6, 18), materials.rust);
  furnace.position.set(31, 2.3, -19);
  furnace.castShadow = true;
  furnace.receiveShadow = true;
  group.add(furnace);
  colliders.push({ minX: 28.9, maxX: 33.1, minZ: -21.1, maxZ: -16.9, bottom: 0, top: 4.6 });
  minimapRects.push({ x: 28.9, z: -21.1, w: 4.2, d: 4.2 });
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 3.4, 10), materials.steel);
  chimney.position.set(31, 6.2, -19);
  chimney.castShadow = true;
  group.add(chimney);
  for (let i = 0; i < 3; i += 1) {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 0.1), materials.emberGlow);
    slit.position.set(31, 1 + i * 0.9, -16.78);
    group.add(slit);
  }
  addBox(26, -10.5, 2, 2, 1.15, materials.wood);
  addBox(34, -9, 2, 2, 1.15, materials.wood);
  addBox(27.5, -16.5, 3.6, 0.8, 1.15, materials.concreteDark);

  // Site Depot (B): container stacks in rust and steel.
  addBox(30.5, 18.5, 6.4, 2.6, 2.6, materials.rust);
  addBox(30.5, 18.5, 5.2, 2.2, 1.3, materials.steel).position.y = 2.6 + 0.65;
  colliders[colliders.length - 1].top = 3.9;
  addBox(26, 10.5, 2, 2, 1.15, materials.wood);
  addBox(34, 21, 2, 2, 1.15, materials.wood);
  addBox(33.5, 12, 0.8, 3.6, 1.15, materials.concreteDark);

  // Site signs on the east boundary wall, readable down each lane.
  const signA = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: signTexture('A', '#ff8c3a') }));
  signA.position.set(35.95, 2.2, -14);
  signA.rotation.y = -Math.PI / 2;
  group.add(signA);
  const signB = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: signTexture('B', '#2fd4c4') }));
  signB.position.set(35.95, 2.2, 14);
  signB.rotation.y = -Math.PI / 2;
  group.add(signB);

  // Yard lamps: posts with warm heads along the lanes (their light is carried by
  // the emissive heads plus the hemisphere light).
  for (const [x, z] of [[-20, -8.6], [2, 8.6], [16, -8.6], [-4, -8.6], [24, 0], [-30, 10]]) {
    addBox(x, z, 0.22, 0.22, 3.1, materials.steel, { solid: false });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.34), materials.lampGlow);
    head.position.set(x, 3.2, z);
    group.add(head);
  }
  // Distant silhouettes outside the fence, for depth against the dusk sky.
  const silhouette = new THREE.MeshStandardMaterial({ color: 0x1c222b, roughness: 1 });
  for (const [x, z, w, h] of [[-52, -20, 10, 17], [-48, 14, 8, 12], [52, -8, 12, 20], [50, 18, 9, 14], [0, -44, 16, 13], [12, 44, 12, 16]]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), silhouette);
    tower.position.set(x, h / 2, z);
    group.add(tower);
  }

  const sites = [
    { id: 'A', name: 'Furnace', center: new THREE.Vector3(29.5, 0, -14), radius: 3.6, color: PALETTE.ember },
    { id: 'B', name: 'Depot', center: new THREE.Vector3(29.5, 0, 14), radius: 3.6, color: PALETTE.teal },
  ];
  const spawns = {
    kindler: [[-32.5, -4.5], [-32.5, 0], [-32.5, 4.5], [-30, 0]],
    warden: [[33, -3], [33, 3], [31, -6.5], [31, 6.5]],
  };

  // Waypoint graph for bot navigation: 34 nodes over every lane, door and site,
  // edges by distance plus a clear line at chest height (low crates never block
  // a route, since a body steps over them anyway).
  const nodeXZ = [
    [-32, 0], [-24, 0], [-18, -4], [-18, 4], [-12, 0], [-13, -9.5], [-13, 9.5],
    [-1, -4], [-1, 4], [-1, -13], [-1, 13], [8, -13], [8, 13], [12, -4], [12, 4],
    [18, -12], [18, 12], [18, 0], [25, -7], [25, 7], [29.5, -14], [29.5, 14],
    [25.5, -19], [25.5, 19], [31, 0], [27, -3], [27, 3], [-24, -14], [-24, 14],
    [4, 0], [33, -13], [33, 13], [20, -6], [20, 6],
  ];
  const nodes = nodeXZ.map(([x, z], id) => ({ id, pos: new THREE.Vector3(x, 0, z), edges: [] }));
  const eyeA = new THREE.Vector3();
  const eyeB = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const tall = colliders.filter((c) => c.top > 1.35);
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i].pos;
      const b = nodes[j].pos;
      if (a.distanceTo(b) > 14.5) continue;
      eyeA.set(a.x, 1.15, a.z);
      eyeB.set(b.x, 1.15, b.z);
      if (losClear(eyeA, eyeB, tall, scratch)) {
        nodes[i].edges.push(j);
        nodes[j].edges.push(i);
      }
    }
  }

  return { colliders, minimapRects, sites, spawns, nodes, furnaceLight };
}

// A* over the waypoint graph. Returns node ids from start to goal (the goal is
// included, the start is not), or an empty array when the goal is unreachable.
export function findPath(nodes, fromPos, toPos) {
  let start = 0;
  let goal = 0;
  let bestStart = Infinity;
  let bestGoal = Infinity;
  for (const node of nodes) {
    const ds = node.pos.distanceToSquared(fromPos);
    if (ds < bestStart) { bestStart = ds; start = node.id; }
    const dg = node.pos.distanceToSquared(toPos);
    if (dg < bestGoal) { bestGoal = dg; goal = node.id; }
  }
  if (start === goal) return [goal];
  const open = [start];
  const cameFrom = new Map();
  const gScore = new Map([[start, 0]]);
  const closed = new Set();
  while (open.length > 0) {
    let current = open[0];
    let bestF = Infinity;
    for (const id of open) {
      const f = (gScore.get(id) ?? Infinity) + nodes[id].pos.distanceTo(nodes[goal].pos);
      if (f < bestF) { bestF = f; current = id; }
    }
    if (current === goal) {
      const path = [goal];
      let cursor = goal;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor);
        if (cursor !== start) path.unshift(cursor);
      }
      return path;
    }
    open.splice(open.indexOf(current), 1);
    closed.add(current);
    for (const next of nodes[current].edges) {
      if (closed.has(next)) continue;
      const tentative = (gScore.get(current) ?? Infinity) + nodes[current].pos.distanceTo(nodes[next].pos);
      if (tentative < (gScore.get(next) ?? Infinity)) {
        cameFrom.set(next, current);
        gScore.set(next, tentative);
        if (!open.includes(next)) open.push(next);
      }
    }
  }
  return [];
}

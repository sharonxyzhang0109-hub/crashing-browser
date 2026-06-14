import * as THREE from "three";

const canvas = document.querySelector("#driveCanvas");
const speedReadout = document.querySelector("#speedReadout");
const zoneReadout = document.querySelector("#zoneReadout");
const cameraReadout = document.querySelector("#cameraReadout");
const primaryColor = document.querySelector("#primaryColor");
const stripeColor = document.querySelector("#stripeColor");
const skinGrid = document.querySelector("#skinGrid");
const skinCode = document.querySelector("#skinCode");
const avatarCode = document.querySelector("#avatarCode");
const applyCode = document.querySelector("#applyCode");
const driverName = document.querySelector("#driverName");
const avatarHead = document.querySelector("#avatarHead");
const avatarBody = document.querySelector("#avatarBody");
const brakeButton = document.querySelector("#brakeButton");
const crashAlert = document.querySelector("#crashAlert");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ee9ff);
scene.fog = new THREE.Fog(0x8ee9ff, 110, 560);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);

const sun = new THREE.DirectionalLight(0xfff7d6, 3.35);
sun.position.set(-35, 65, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xd7fbff, 0x44aa68, 1.65));

const world = new THREE.Group();
scene.add(world);

const WORLD_LIMIT = 440;
const CAR_RADIUS = 4.1;
const ROAD_SCENERY_CLEARANCE = 20;
const verticalRoads = [-330, -190, 0, 150, 305].map((x, index) => ({
  x,
  width: index === 2 ? 58 : 38
}));
const horizontalRoads = [-330, -210, -70, 75, 220, 345].map((z, index) => ({
  z,
  depth: index === 3 ? 50 : 36
}));
const colliders = [];
const tempCarCenter = new THREE.Vector2();
let brakePressed = false;

const keys = new Set();
const skins = {
  sunset: { primary: "#ff5f45", stripe: "#111827", glow: "#ffd166" },
  ocean: { primary: "#11a8fd", stripe: "#0f172a", glow: "#86efac" },
  golden: { primary: "#f8c537", stripe: "#3b2f0b", glow: "#fff3b0" },
  mint: { primary: "#39d98a", stripe: "#083344", glow: "#c7f9cc" },
  custom: { primary: "#d946ef", stripe: "#22d3ee", glow: "#f0abfc" }
};

const carState = {
  speed: 0,
  maxSpeed: 1.45,
  reverseMax: -0.55,
  acceleration: 0.032,
  braking: 0.055,
  friction: 0.982,
  turn: 0,
  heading: 0,
  cameraMode: "chase",
  crashTimer: 0
};

const zones = [
  { name: "Downtown Los Angeles", x: 0, z: 0 },
  { name: "Santa Monica Coast", x: -330, z: -180 },
  { name: "Golden Gate District", x: 305, z: -275 },
  { name: "Palm Springs Boulevard", x: 260, z: 245 },
  { name: "Redwood Park Edge", x: -280, z: 280 },
  { name: "Silicon Valley Tech Row", x: 60, z: -335 },
  { name: "Central Valley Farmland", x: -70, z: 350 }
];

function makeMat(color, roughness = 0.72, metalness = 0.05) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

const roadMat = makeMat(0x263040, 0.78);
const laneMat = makeMat(0xfff6a6, 0.5);
const sidewalkMat = makeMat(0xd3dce9, 0.72);
const grassMat = makeMat(0x35d06f, 0.82);
const sandMat = makeMat(0xffdf7e, 0.9);
const waterMat = new THREE.MeshStandardMaterial({
  color: 0x19c4ff,
  roughness: 0.28,
  metalness: 0.05
});
const curbMat = makeMat(0xe5e7eb, 0.7);
const windowMat = makeMat(0x7dd3fc, 0.2, 0.18);
const barrierMat = makeMat(0xff6b35, 0.45);

function rectOverlapsRoad(x, z, width, depth, clearance = 1.5) {
  const minX = x - width / 2 - clearance;
  const maxX = x + width / 2 + clearance;
  const minZ = z - depth / 2 - clearance;
  const maxZ = z + depth / 2 + clearance;

  return verticalRoads.some((road) => {
    const roadMinX = road.x - road.width / 2;
    const roadMaxX = road.x + road.width / 2;
    return maxX > roadMinX && minX < roadMaxX;
  }) || horizontalRoads.some((road) => {
    const roadMinZ = road.z - road.depth / 2;
    const roadMaxZ = road.z + road.depth / 2;
    return maxZ > roadMinZ && minZ < roadMaxZ;
  });
}

function safeOffRoad(x, z, width = 6, depth = 6, clearance = 3) {
  return Math.abs(x) < WORLD_LIMIT - width / 2
    && Math.abs(z) < WORLD_LIMIT - depth / 2
    && !rectOverlapsRoad(x, z, width, depth, clearance);
}

function safeScenerySpot(x, z, width = 8, depth = 8) {
  return safeOffRoad(x, z, width, depth, ROAD_SCENERY_CLEARANCE);
}

function addCollider(x, z, width, depth, label = "object") {
  if (rectOverlapsRoad(x, z, width, depth, 0.75)) return;
  colliders.push({
    minX: x - width / 2,
    maxX: x + width / 2,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
    label
  });
}

function addBox({ size, position, material, cast = true, receive = true, parent = world, collider = false, label = "object" }) {
  if (collider && parent === world && rectOverlapsRoad(position[0], position[2], size[0], size[2], 1)) {
    return null;
  }

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  if (collider && parent === world) {
    addCollider(position[0], position[2], size[0], size[2], label);
  }
  return mesh;
}

function buildGround() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(920, 920), grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  verticalRoads.forEach(({ x, width }) => {
    addBox({ size: [width, 0.08, 900], position: [x, 0.02, 0], material: roadMat, cast: false });
    addBox({ size: [width + 10, 0.09, 900], position: [x, 0.01, 0], material: curbMat, cast: false });
    for (let z = -420; z <= 420; z += 28) {
      addBox({ size: [2.2, 0.12, 12], position: [x, 0.13, z], material: laneMat, cast: false });
    }
  });

  horizontalRoads.forEach(({ z, depth }) => {
    addBox({ size: [900, 0.1, depth], position: [0, 0.04, z], material: roadMat, cast: false });
    for (let x = -420; x <= 420; x += 30) {
      addBox({ size: [13, 0.13, 2.1], position: [x, 0.15, z], material: laneMat, cast: false });
    }
    addCrosswalk(-18, z);
    addCrosswalk(18, z);
  });

  addBox({ size: [76, 0.1, 900], position: [-424, 0.04, 0], material: sandMat, cast: false });
  addBox({ size: [55, 0.12, 900], position: [-470, 0.04, 0], material: waterMat, cast: false });
  addBox({ size: [10, 0.5, 900], position: [-382, 0.25, 0], material: sidewalkMat, cast: false });

  for (let z = -390; z <= 390; z += 70) {
    if (safeOffRoad(-370, z, 10, 22, 1)) {
      addBox({ size: [10, 1.2, 22], position: [-370, 0.65, z], material: curbMat, collider: true, label: "beach wall" });
    }
  }

  for (let x = -430; x <= 430; x += 86) {
    addTrafficBarrier(x, -420);
    addTrafficBarrier(x, 420);
  }

  for (let z = -370; z <= 370; z += 86) {
    if (safeOffRoad(-430, z, 4, 24, 1)) {
      addBox({ size: [4, 2.6, 24], position: [-430, 1.3, z], material: barrierMat, collider: true, label: "edge barrier" });
    }
    if (safeOffRoad(430, z, 4, 24, 1)) {
      addBox({ size: [4, 2.6, 24], position: [430, 1.3, z], material: barrierMat, collider: true, label: "edge barrier" });
    }
  }

  addRoadShoulderDetails();
}

function buildCity() {
  const colors = [
    0x00b4ff,
    0xffd23f,
    0xff477e,
    0x45ff8f,
    0xb967ff,
    0xff8bd1,
    0x20f5d2,
    0xff8a1f
  ];
  const blocks = [];

  for (let x = -265; x <= 365; x += 70) {
    for (let z = -285; z <= 300; z += 72) {
      const beach = x < -350;
      if (!beach && (x + z) % 5 !== 0 && safeScenerySpot(x, z, 44, 44)) blocks.push([x, z]);
    }
  }

  blocks.forEach(([x, z], i) => {
    const h = 12 + ((i * 17) % 52);
    const w = 20 + (i % 4) * 5;
    const d = 20 + (i % 3) * 7;
    const building = addBox({
      size: [w, h, d],
      position: [x, h / 2, z],
      material: makeMat(colors[i % colors.length], 0.62, 0.03),
      collider: true,
      label: "building"
    });

    addBuildingDetails(building, w, h, d, i);

    const rows = Math.max(2, Math.floor(h / 10));
    const cols = Math.max(2, Math.floor(w / 7));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        addBox({
          size: [2.2, 2.6, 0.18],
          position: [-w / 2 + 4 + col * 6, -h / 2 + 5 + row * 8, -d / 2 - 0.1],
          material: windowMat,
          cast: false,
          parent: building
        });
      }
    }

    const sideRows = Math.max(2, Math.floor(h / 12));
    const sideCols = Math.max(2, Math.floor(d / 8));
    for (let row = 0; row < sideRows; row++) {
      for (let col = 0; col < sideCols; col++) {
        const y = -h / 2 + 5 + row * 9;
        const z = -d / 2 + 5 + col * 7;
        addBox({ size: [0.18, 2.4, 2], position: [-w / 2 - 0.1, y, z], material: windowMat, cast: false, parent: building });
        addBox({ size: [0.18, 2.4, 2], position: [w / 2 + 0.1, y, z], material: windowMat, cast: false, parent: building });
      }
    }
  });

  for (let i = 0; i < 92; i++) {
    const x = -365 + (i % 13) * 60;
    const z = -395 + Math.floor(i / 13) * 88;
    if (safeScenerySpot(x, z, 18, 18)) addPalm(x, z);
  }

  addParkedCars();
  addStreetDetails();
  addNeighborhoodDetails();
  addMountains();
  addBridge();
  addHollywoodSign();
}

function addBuildingDetails(building, w, h, d, index) {
  const accentColors = [0xff3d71, 0x00d1ff, 0xffd166, 0x8b5cf6, 0x34d399, 0xfb7185];
  const accentMat = makeMat(accentColors[index % accentColors.length], 0.42, 0.04);
  const trimMat = makeMat(0xf8fafc, 0.52);
  const roofMat = makeMat(0x1f2937, 0.7, 0.08);

  addBox({ size: [w + 1.8, 0.7, d + 1.8], position: [0, h / 2 + 0.35, 0], material: roofMat, parent: building });
  addBox({ size: [w + 0.7, 0.35, 0.7], position: [0, -h / 2 + 3, -d / 2 - 0.35], material: accentMat, parent: building });
  addBox({ size: [w + 0.7, 0.35, 0.7], position: [0, -h / 2 + 6.2, -d / 2 - 0.35], material: trimMat, parent: building });

  for (let x = -w / 2 + 4; x <= w / 2 - 4; x += 7) {
    addBox({ size: [3.4, 0.45, 1.8], position: [x, -h / 2 + 2.3, -d / 2 - 1], material: accentMat, parent: building });
  }

  if (h > 26) {
    addBox({ size: [4.2, 2.8, 4.2], position: [-w / 4, h / 2 + 1.75, d / 4], material: makeMat(0xdbeafe, 0.45, 0.18), parent: building });
    addBox({ size: [5.8, 0.5, 5.8], position: [w / 4, h / 2 + 0.95, -d / 5], material: accentMat, parent: building });
  }
}

function addPalm(x, z) {
  if (!safeScenerySpot(x, z, 20, 20)) return;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1, 12, 8), makeMat(0x8a5a32, 0.9));
  trunk.position.set(x, 6, z);
  trunk.castShadow = true;
  world.add(trunk);
  addCollider(x, z, 3.2, 3.2, "palm tree");

  const leafMat = makeMat(0x14f195, 0.72);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 9), leafMat);
    leaf.position.set(x, 12.2, z);
    leaf.rotation.y = (Math.PI / 3) * i;
    leaf.rotation.x = 0.24;
    leaf.castShadow = true;
    world.add(leaf);
  }
}

function addTrafficBarrier(x, z) {
  if (!safeOffRoad(x, z, 24, 4, 1)) return;
  addBox({ size: [24, 2.6, 4], position: [x, 1.3, z], material: barrierMat, collider: true, label: "traffic barrier" });
}

function addCrosswalk(x, z) {
  for (let i = -2; i <= 2; i++) {
    addBox({
      size: [14, 0.14, 2.4],
      position: [x + i * 8, 0.18, z + 19],
      material: laneMat,
      cast: false
    });
  }
}

function findNearbyOffRoad(x, z, width = 8, depth = 8) {
  const offsets = [
    [0, 0],
    [18, 18],
    [-18, 18],
    [18, -18],
    [-18, -18],
    [32, 0],
    [-32, 0],
    [0, 32],
    [0, -32]
  ];

  for (const [dx, dz] of offsets) {
    const candidateX = x + dx;
    const candidateZ = z + dz;
    if (safeScenerySpot(candidateX, candidateZ, width, depth)) {
      return { x: candidateX, z: candidateZ };
    }
  }
  return null;
}

function addRoadShoulderDetails() {
  const curbStripeMat = makeMat(0xffff66, 0.5);
  const sidewalkDotMat = makeMat(0xc7d2de, 0.82);
  const pinkMat = makeMat(0xff4fd8, 0.48);
  const blueMat = makeMat(0x34d5ff, 0.48);
  const greenMat = makeMat(0x76ff7a, 0.52);

  verticalRoads.forEach((road) => {
    const leftEdge = road.x - road.width / 2 - 6;
    const rightEdge = road.x + road.width / 2 + 6;
    for (let z = -405; z <= 405; z += 44) {
      addBox({ size: [2.4, 0.1, 12], position: [leftEdge, 0.16, z], material: curbStripeMat, cast: false });
      addBox({ size: [2.4, 0.1, 12], position: [rightEdge, 0.16, z], material: curbStripeMat, cast: false });
      addBox({ size: [1.3, 0.11, 4.5], position: [leftEdge - 3, 0.19, z + 10], material: z % 88 === 0 ? pinkMat : blueMat, cast: false });
      addBox({ size: [1.3, 0.11, 4.5], position: [rightEdge + 3, 0.19, z - 10], material: z % 88 === 0 ? greenMat : pinkMat, cast: false });
    }
  });

  horizontalRoads.forEach((road) => {
    const topEdge = road.z - road.depth / 2 - 6;
    const bottomEdge = road.z + road.depth / 2 + 6;
    for (let x = -405; x <= 405; x += 44) {
      addBox({ size: [12, 0.1, 2.4], position: [x, 0.16, topEdge], material: curbStripeMat, cast: false });
      addBox({ size: [12, 0.1, 2.4], position: [x, 0.16, bottomEdge], material: curbStripeMat, cast: false });
      addBox({ size: [4.5, 0.11, 1.3], position: [x + 10, 0.19, topEdge - 3], material: x % 88 === 0 ? blueMat : greenMat, cast: false });
      addBox({ size: [4.5, 0.11, 1.3], position: [x - 10, 0.19, bottomEdge + 3], material: x % 88 === 0 ? pinkMat : blueMat, cast: false });
      if (safeOffRoad(x, bottomEdge + 8, 3, 3, 1)) {
        addBox({ size: [2, 0.08, 2], position: [x, 0.18, bottomEdge + 8], material: sidewalkDotMat, cast: false });
      }
    }
  });
}

function addBench(x, z, rotation = 0) {
  if (!safeScenerySpot(x, z, 12, 8)) return;
  const bench = new THREE.Group();
  bench.position.set(x, 0.1, z);
  bench.rotation.y = rotation;
  world.add(bench);
  const woodMat = makeMat(0x9b5b2e, 0.78);
  const metalMat = makeMat(0x334155, 0.5, 0.2);
  addBox({ size: [8, 0.45, 1.1], position: [0, 1.2, 0], material: woodMat, parent: bench });
  addBox({ size: [8, 0.45, 0.8], position: [0, 2.1, 1], material: woodMat, parent: bench });
  addBox({ size: [0.45, 1.2, 0.45], position: [-3, 0.6, 0], material: metalMat, parent: bench });
  addBox({ size: [0.45, 1.2, 0.45], position: [3, 0.6, 0], material: metalMat, parent: bench });
  addCollider(x, z, 9, 4, "bench");
}

function addFlowerBed(x, z, width, depth, color) {
  if (!safeScenerySpot(x, z, width, depth)) return;
  const soilMat = makeMat(0x4a2f1f, 0.95);
  const flowerMat = makeMat(color, 0.72);
  addBox({ size: [width, 0.35, depth], position: [x, 0.22, z], material: soilMat, collider: true, label: "flower bed" });
  for (let px = x - width / 2 + 2; px <= x + width / 2 - 2; px += 4) {
    for (let pz = z - depth / 2 + 2; pz <= z + depth / 2 - 2; pz += 4) {
      addBox({ size: [1.1, 0.55, 1.1], position: [px, 0.65, pz], material: flowerMat, cast: false });
    }
  }
}

function addHouse(x, z, color, roofColor) {
  if (!safeScenerySpot(x, z, 34, 34)) return;
  const wallMat = makeMat(color, 0.68);
  const roofMat = makeMat(roofColor, 0.72);
  addBox({ size: [18, 9, 16], position: [x, 4.5, z], material: wallMat, collider: true, label: "house" });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(14, 8, 4), roofMat);
  roof.position.set(x, 12.6, z);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  roof.receiveShadow = true;
  world.add(roof);
  addBox({ size: [4, 5, 0.5], position: [x, 2.7, z - 8.3], material: makeMat(0x5b3418, 0.72), collider: false });
  addBox({ size: [3, 3, 0.4], position: [x - 5, 5.2, z - 8.35], material: windowMat, cast: false });
  addBox({ size: [3, 3, 0.4], position: [x + 5, 5.2, z - 8.35], material: windowMat, cast: false });
}

function addBeachUmbrella(x, z, color) {
  if (!safeScenerySpot(x, z, 12, 12)) return;
  addBox({ size: [0.55, 5, 0.55], position: [x, 2.5, z], material: makeMat(0xf8fafc, 0.55), collider: true, label: "umbrella" });
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(5, 2, 12), makeMat(color, 0.55));
  canopy.position.set(x, 5.8, z);
  canopy.castShadow = true;
  world.add(canopy);
}

function addDeciduousTree(x, z, color) {
  if (!safeScenerySpot(x, z, 20, 20)) return;
  const trunkMat = makeMat(0x7c4a25, 0.88);
  const leafMat = makeMat(color, 0.82);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.15, 7, 8), trunkMat);
  trunk.position.set(x, 3.5, z);
  trunk.castShadow = true;
  world.add(trunk);
  addCollider(x, z, 3.4, 3.4, "tree");

  const crownPositions = [
    [0, 8.2, 0],
    [-2, 7.2, 0.7],
    [2, 7.5, -0.5],
    [0.6, 9.4, 1.1]
  ];
  crownPositions.forEach(([dx, dy, dz], index) => {
    const crown = new THREE.Mesh(new THREE.SphereGeometry(index === 0 ? 3.4 : 2.5, 16, 12), leafMat);
    crown.position.set(x + dx, dy, z + dz);
    crown.castShadow = true;
    world.add(crown);
  });
}

function addPaintedPlaza(x, z, width, depth, colorA, colorB) {
  if (!safeScenerySpot(x, z, width, depth)) return;
  const baseMat = makeMat(colorA, 0.8);
  const stripeMat = makeMat(colorB, 0.62);
  addBox({ size: [width, 0.08, depth], position: [x, 0.12, z], material: baseMat, cast: false });
  for (let offset = -width / 2 + 4; offset <= width / 2 - 4; offset += 8) {
    addBox({ size: [3.2, 0.1, depth - 4], position: [x + offset, 0.18, z], material: stripeMat, cast: false });
  }
}

function addFoodStand(x, z, color, rotation = 0) {
  if (!safeScenerySpot(x, z, 18, 16)) return;
  const stand = new THREE.Group();
  stand.position.set(x, 0.15, z);
  stand.rotation.y = rotation;
  world.add(stand);

  const bodyMat = makeMat(color, 0.58);
  const roofMat = makeMat(0xfef3c7, 0.62);
  const counterMat = makeMat(0xffffff, 0.5);
  addBox({ size: [9, 5, 6], position: [0, 2.5, 0], material: bodyMat, parent: stand });
  addBox({ size: [10.5, 0.8, 7.5], position: [0, 5.5, 0], material: roofMat, parent: stand });
  addBox({ size: [8, 1.2, 0.7], position: [0, 2.8, -3.4], material: counterMat, parent: stand });
  addBox({ size: [1.2, 1.2, 0.5], position: [-3, 4.1, -3.45], material: makeMat(0xff3d71, 0.5), parent: stand });
  addBox({ size: [1.2, 1.2, 0.5], position: [0, 4.1, -3.45], material: makeMat(0x00d1ff, 0.5), parent: stand });
  addBox({ size: [1.2, 1.2, 0.5], position: [3, 4.1, -3.45], material: makeMat(0xffd166, 0.5), parent: stand });
  addCollider(x, z, 11, 9, "food stand");
}

function addPublicArt(x, z, color) {
  if (!safeScenerySpot(x, z, 14, 14)) return;
  const baseMat = makeMat(0xe5e7eb, 0.65);
  const artMat = makeMat(color, 0.32, 0.18);
  addBox({ size: [6, 0.7, 6], position: [x, 0.35, z], material: baseMat, collider: true, label: "public art" });
  const sculpture = new THREE.Mesh(new THREE.TorusKnotGeometry(2.1, 0.35, 80, 10), artMat);
  sculpture.position.set(x, 4.2, z);
  sculpture.rotation.x = 0.6;
  sculpture.rotation.z = 0.35;
  sculpture.castShadow = true;
  world.add(sculpture);
}

function addNeighborhoodDetails() {
  const houseColors = [0xf8d7a7, 0xbde0fe, 0xc7f9cc, 0xfbcfe8, 0xfef3c7];
  const roofColors = [0x8b2f2f, 0x334155, 0x7c2d12, 0x475569];
  const treeColors = [0x16a34a, 0x22c55e, 0x84cc16, 0xf59e0b, 0xef4444, 0xa855f7];
  const beachColors = [0xff5f45, 0x38bdf8, 0xfacc15, 0xa855f7, 0x22c55e];

  for (let x = -120; x <= 380; x += 86) {
    for (let z = 120; z <= 390; z += 92) {
      addHouse(x, z, houseColors[Math.abs(x + z) % houseColors.length], roofColors[Math.abs(x - z) % roofColors.length]);
      addDeciduousTree(x + 28, z - 26, treeColors[Math.abs(x - z) % treeColors.length]);
      addFlowerBed(x - 28, z + 24, 14, 8, treeColors[Math.abs(x + z + 2) % treeColors.length]);
    }
  }

  let umbrellaIndex = 0;
  for (let x = -360; x <= -405 + 120; x += 42) {
    for (let z = -360; z <= 360; z += 96) {
      addBeachUmbrella(x, z, beachColors[umbrellaIndex % beachColors.length]);
      umbrellaIndex++;
    }
  }

  for (let x = -135; x <= 35; x += 36) {
    for (let z = 285; z <= 405; z += 28) {
      addFlowerBed(x, z, 24, 10, (x + z) % 2 === 0 ? 0x22c55e : 0xf97316);
    }
  }

  [
    [-95, 38, 0],
    [94, 36, Math.PI],
    [238, -112, Math.PI / 2],
    [-258, 126, -Math.PI / 2],
    [338, 108, Math.PI / 2]
  ].forEach(([x, z, rotation]) => addBench(x, z, rotation));

  [
    [-115, 128, 42, 30, 0x99f6e4, 0xf472b6],
    [82, 140, 36, 28, 0xfef08a, 0x38bdf8],
    [242, 140, 38, 26, 0xfbcfe8, 0x22c55e],
    [-278, 278, 42, 30, 0xbfdbfe, 0xf97316]
  ].forEach(([x, z, width, depth, colorA, colorB]) => addPaintedPlaza(x, z, width, depth, colorA, colorB));

  [
    [-105, -132, 0xff3d71, 0],
    [82, -136, 0x38bdf8, Math.PI],
    [236, 136, 0xfacc15, -Math.PI / 2],
    [-286, 132, 0x22c55e, Math.PI / 2]
  ].forEach(([x, z, color, rotation]) => addFoodStand(x, z, color, rotation));

  [
    [-104, 36, 0xff3d71],
    [94, 36, 0x00d1ff],
    [236, -136, 0xffd166],
    [-286, 36, 0xa855f7]
  ].forEach(([x, z, color]) => addPublicArt(x, z, color));
}

function addParkedCar(x, z, color, rotation = 0) {
  const width = rotation === 0 ? 5.4 : 8.4;
  const depth = rotation === 0 ? 8.4 : 5.4;
  if (!safeScenerySpot(x, z, width, depth)) return false;

  const parked = new THREE.Group();
  parked.position.set(x, 0.05, z);
  parked.rotation.y = rotation;
  world.add(parked);

  addBox({ size: [4.8, 1, 8], position: [0, 0.9, 0], material: makeMat(color, 0.48, 0.18), parent: parked });
  addBox({ size: [3.5, 1, 3.5], position: [0, 1.65, -0.7], material: windowMat, parent: parked });
  addCollider(x, z, width, depth, "parked car");
  return true;
}

function addParkedCars() {
  const colors = [0xef4444, 0x38bdf8, 0xfacc15, 0xf8fafc, 0x22c55e, 0xa855f7];
  let i = 0;
  verticalRoads.filter((road) => road.x !== 0).forEach((road) => {
    const shoulderX = road.x + road.width / 2 + 8;
    for (let z = -360; z <= 345; z += 85) {
      if (addParkedCar(shoulderX, z, colors[i % colors.length], 0)) i++;
    }
  });
  horizontalRoads.filter((road) => road.z !== 75).forEach((road) => {
    const shoulderZ = road.z - road.depth / 2 - 8;
    for (let x = -260; x <= 360; x += 95) {
      if (addParkedCar(x, shoulderZ, colors[i % colors.length], Math.PI / 2)) i++;
    }
  });
}

function addStreetDetails() {
  const poleMat = makeMat(0x1f2937, 0.44, 0.25);
  const lightMat = makeMat(0xfff6b7, 0.2);
  const redMat = makeMat(0xef4444, 0.25);
  const greenMat = makeMat(0x22c55e, 0.25);
  const yellowMat = makeMat(0xfacc15, 0.25);
  verticalRoads.forEach((road) => {
    const x = road.x + road.width / 2 + 8;
    for (let z = -390; z <= 390; z += 92) {
      if (!safeScenerySpot(x, z, 8, 8)) continue;
      addBox({ size: [0.8, 11, 0.8], position: [x, 5.5, z], material: poleMat, collider: true, label: "light pole" });
      addBox({ size: [4, 0.7, 1.3], position: [x + 1.8, 11, z], material: lightMat, cast: false });
    }
  });

  horizontalRoads.forEach((road) => {
    const z = road.z + road.depth / 2 + 8;
    for (let x = -390; x <= 390; x += 92) {
      if (!safeScenerySpot(x, z, 8, 8)) continue;
      addBox({ size: [0.8, 11, 0.8], position: [x, 5.5, z], material: poleMat, collider: true, label: "light pole" });
      addBox({ size: [1.3, 0.7, 4], position: [x, 11, z + 1.8], material: lightMat, cast: false });
    }
  });

  verticalRoads.forEach((vertical) => {
    horizontalRoads.forEach((horizontal, i) => {
      const x = vertical.x + vertical.width / 2 + 6;
      const z = horizontal.z + horizontal.depth / 2 + 6;
      if (!safeScenerySpot(x, z, 8, 8)) return;
      addBox({ size: [0.7, 8, 0.7], position: [x, 4, z], material: poleMat, collider: true, label: "traffic light" });
      addBox({ size: [2.6, 5.8, 1.1], position: [x, 9.4, z], material: poleMat, collider: true, label: "traffic light" });
      addBox({ size: [1.1, 1.1, 0.3], position: [x, 11.1, z - 0.65], material: i % 3 === 0 ? greenMat : redMat, cast: false });
      addBox({ size: [1.1, 1.1, 0.3], position: [x, 9.4, z - 0.65], material: yellowMat, cast: false });
      addBox({ size: [1.1, 1.1, 0.3], position: [x, 7.7, z - 0.65], material: i % 3 === 0 ? redMat : greenMat, cast: false });
    });
  });

  const signMat = makeMat(0xffffff, 0.45);
  const postMat = makeMat(0x475569, 0.55, 0.2);
  zones.forEach((zone) => {
    const spot = findNearbyOffRoad(zone.x + 18, zone.z + 18, 14, 8);
    if (!spot) return;
    addBox({ size: [1, 7, 1], position: [spot.x, 3.5, spot.z], material: postMat, collider: true, label: "sign post" });
    addBox({ size: [12, 5, 0.8], position: [spot.x, 8.2, spot.z], material: signMat, collider: true, label: "city sign" });
  });
}

function addMountains() {
  const mountainMat = makeMat(0x7a8a6a, 0.95);
  for (let i = 0; i < 12; i++) {
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(24 + (i % 4) * 8, 42 + (i % 5) * 10, 4), mountainMat);
    mountain.position.set(-270 + i * 55, 20, 450);
    mountain.rotation.y = Math.PI / 4;
    mountain.castShadow = true;
    mountain.receiveShadow = true;
    world.add(mountain);
  }
}

function addBridge() {
  const bridgeMat = makeMat(0xe45a46, 0.64);
  addBox({ size: [135, 2, 8], position: [285, 18, -292], material: bridgeMat, collider: true, label: "bridge rail" });
  addBox({ size: [6, 54, 6], position: [230, 27, -292], material: bridgeMat, collider: true, label: "bridge tower" });
  addBox({ size: [6, 54, 6], position: [340, 27, -292], material: bridgeMat, collider: true, label: "bridge tower" });
  for (let i = 0; i < 10; i++) {
    addBox({ size: [1, 26, 1], position: [238 + i * 10, 11, -292], material: bridgeMat, collider: true, label: "bridge cable" });
  }
}

function addHollywoodSign() {
  const sign = new THREE.Group();
  sign.position.set(-300, 25, 330);
  sign.rotation.y = 0.28;
  "CALIFORNIA".split("").forEach((letter, i) => {
    const block = addBox({
      size: [5, 8, 1],
      position: [i * 6, 0, 0],
      material: makeMat(0xffffff, 0.5),
      parent: sign
    });
    block.name = letter;
  });
  world.add(sign);
  addCollider(-276, 330, 66, 8, "california sign");
}

buildGround();
buildCity();

const car = new THREE.Group();
scene.add(car);

const bodyMat = makeMat(skins.sunset.primary, 0.45, 0.22);
const stripeMat = makeMat(skins.sunset.stripe, 0.5, 0.1);
const glassMat = new THREE.MeshStandardMaterial({
  color: 0x18293d,
  roughness: 0.2,
  metalness: 0.05,
  transparent: true,
  opacity: 0.72
});
const tireMat = makeMat(0x111111, 0.85);
const rimMat = makeMat(0xd6dee9, 0.34, 0.45);
const glowMat = makeMat(skins.sunset.glow, 0.2, 0.1);

addBox({ size: [5.2, 1.2, 9], position: [0, 1.05, 0], material: bodyMat, parent: car });
addBox({ size: [3.8, 1.25, 4.2], position: [0, 2, -0.9], material: glassMat, parent: car });
addBox({ size: [5.35, 0.12, 7.8], position: [0, 1.72, 0.25], material: stripeMat, parent: car });
addBox({ size: [1.5, 0.35, 0.55], position: [-1.45, 1.2, -4.65], material: glowMat, parent: car });
addBox({ size: [1.5, 0.35, 0.55], position: [1.45, 1.2, -4.65], material: glowMat, parent: car });

const wheels = [];
for (const x of [-2.8, 2.8]) {
  for (const z of [-3, 3]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.62, 24), tireMat);
    wheel.position.set(x, 0.6, z);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    car.add(wheel);
    wheels.push(wheel);

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.68, 20), rimMat);
    rim.position.copy(wheel.position);
    rim.rotation.z = Math.PI / 2;
    rim.castShadow = true;
    car.add(rim);
    wheels.push(rim);
  }
}

const driver = new THREE.Group();
driver.position.set(0, 2.95, -0.9);
car.add(driver);
const driverHead = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 14), makeMat(0xffffff, 0.35));
driverHead.position.y = 0.55;
driver.add(driverHead);
const driverBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.85, 0.48), makeMat(skins.sunset.primary, 0.55));
driverBody.position.y = -0.1;
driver.add(driverBody);

car.position.set(0, 0.15, 20);

function applySkin(config) {
  bodyMat.color.set(config.primary);
  stripeMat.color.set(config.stripe);
  glowMat.color.set(config.glow || config.stripe);
  primaryColor.value = config.primary;
  stripeColor.value = config.stripe;
  driverBody.material.color.set(config.primary);
  avatarBody.style.background = config.primary;
}

function syncCustomSkinCode() {
  const config = {
    primary: primaryColor.value,
    stripe: stripeColor.value,
    glow: skins.custom.glow
  };
  skinCode.value = JSON.stringify(config, null, 2);
  return config;
}

function applyAvatar(config) {
  if (config.name) driverName.value = String(config.name).slice(0, 18);
  if (config.helmet) {
    driverHead.material.color.set(config.helmet);
    avatarHead.style.background = config.helmet;
  }
  if (config.jacket) {
    driverBody.material.color.set(config.jacket);
    avatarBody.style.background = config.jacket;
  }
}

function resetCar() {
  car.position.set(0, 0.15, 20);
  carState.speed = 0;
  carState.heading = 0;
  carState.crashTimer = 0;
  car.rotation.y = 0;
  crashAlert.classList.remove("show");
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function isColliding() {
  tempCarCenter.set(car.position.x, car.position.z);
  return colliders.find((box) => {
    const nearestX = THREE.MathUtils.clamp(tempCarCenter.x, box.minX, box.maxX);
    const nearestZ = THREE.MathUtils.clamp(tempCarCenter.y, box.minZ, box.maxZ);
    const dx = tempCarCenter.x - nearestX;
    const dz = tempCarCenter.y - nearestZ;
    return dx * dx + dz * dz < CAR_RADIUS * CAR_RADIUS;
  });
}

function triggerCrash(collider, previousPosition) {
  car.position.copy(previousPosition);
  carState.speed = -carState.speed * 0.32;
  carState.heading += carState.turn * -3;
  car.rotation.y = carState.heading;
  carState.crashTimer = 36;
  crashAlert.textContent = `CRASH: ${collider.label.toUpperCase()}`;
  crashAlert.classList.add("show");
}

function updateDriving() {
  const forward = keys.has("w") || keys.has("arrowup");
  const back = keys.has("s") || keys.has("arrowdown");
  const left = keys.has("a") || keys.has("arrowleft");
  const right = keys.has("d") || keys.has("arrowright");
  const brake = keys.has(" ") || brakePressed;
  const previousPosition = car.position.clone();

  if (carState.crashTimer > 0) {
    carState.crashTimer -= 1;
    if (carState.crashTimer === 0) crashAlert.classList.remove("show");
  }

  if (forward) carState.speed += carState.acceleration;
  if (back) carState.speed -= carState.acceleration * 0.75;
  if (brake) carState.speed *= 0.84;

  carState.speed = THREE.MathUtils.clamp(carState.speed, carState.reverseMax, carState.maxSpeed);
  carState.speed *= carState.friction;

  const steerPower = THREE.MathUtils.clamp(Math.abs(carState.speed) / carState.maxSpeed, 0.18, 1);
  carState.turn = 0;
  if (left) carState.turn += 0.038 * steerPower;
  if (right) carState.turn -= 0.038 * steerPower;
  if (carState.speed < 0) carState.turn *= -1;

  carState.heading += carState.turn;
  car.rotation.y = carState.heading;
  car.position.x -= Math.sin(carState.heading) * carState.speed;
  car.position.z -= Math.cos(carState.heading) * carState.speed;
  car.position.x = THREE.MathUtils.clamp(car.position.x, -WORLD_LIMIT, WORLD_LIMIT);
  car.position.z = THREE.MathUtils.clamp(car.position.z, -WORLD_LIMIT, WORLD_LIMIT);

  const collider = isColliding();
  if (collider && Math.abs(carState.speed) > 0.03) {
    triggerCrash(collider, previousPosition);
  } else if (collider) {
    car.position.copy(previousPosition);
    carState.speed = 0;
  }

  wheels.forEach((wheel) => {
    wheel.rotation.x += carState.speed * 0.9;
  });
}

function updateCamera() {
  const chaseOffset = new THREE.Vector3(
    Math.sin(carState.heading) * 14,
    8,
    Math.cos(carState.heading) * 14
  );
  const hoodOffset = new THREE.Vector3(
    -Math.sin(carState.heading) * 1.2,
    3.4,
    -Math.cos(carState.heading) * 5
  );
  const target = car.position.clone();

  if (carState.cameraMode === "hood") {
    camera.position.lerp(car.position.clone().add(hoodOffset), 0.15);
    camera.lookAt(target.x - Math.sin(carState.heading) * 40, target.y + 2, target.z - Math.cos(carState.heading) * 40);
  } else {
    camera.position.lerp(car.position.clone().add(chaseOffset), 0.1);
    camera.lookAt(target.x, target.y + 2, target.z);
  }
}

function updateHud() {
  speedReadout.textContent = `${Math.round(Math.abs(carState.speed) * 82)} mph`;
  cameraReadout.textContent = carState.cameraMode === "hood" ? "Hood camera" : "Chase camera";

  let nearest = zones[0];
  let nearestDistance = Infinity;
  zones.forEach((zone) => {
    const distance = car.position.distanceTo(new THREE.Vector3(zone.x, car.position.y, zone.z));
    if (distance < nearestDistance) {
      nearest = zone;
      nearestDistance = distance;
    }
  });
  zoneReadout.textContent = nearest.name;
}

function animate() {
  updateDriving();
  updateCamera();
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  keys.add(event.key.toLowerCase());
  if (event.key.toLowerCase() === "r") resetCar();
  if (event.key.toLowerCase() === "c") {
    carState.cameraMode = carState.cameraMode === "chase" ? "hood" : "chase";
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));

brakeButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  brakePressed = true;
  brakeButton.classList.add("pressed");
  brakeButton.setPointerCapture(event.pointerId);
});

brakeButton.addEventListener("pointerup", (event) => {
  brakePressed = false;
  brakeButton.classList.remove("pressed");
  brakeButton.releasePointerCapture(event.pointerId);
});

brakeButton.addEventListener("pointercancel", () => {
  brakePressed = false;
  brakeButton.classList.remove("pressed");
});

skinGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".skin-option");
  if (!button) return;
  document.querySelectorAll(".skin-option").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  applySkin(skins[button.dataset.skin]);
  skinCode.value = JSON.stringify(skins[button.dataset.skin], null, 2);
});

primaryColor.addEventListener("input", () => {
  applySkin(syncCustomSkinCode());
});

stripeColor.addEventListener("input", () => {
  applySkin(syncCustomSkinCode());
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    skinCode.classList.toggle("hidden", tab.dataset.tab !== "skinCode");
    avatarCode.classList.toggle("hidden", tab.dataset.tab !== "avatarCode");
  });
});

applyCode.addEventListener("click", () => {
  try {
    if (!skinCode.classList.contains("hidden")) {
      const config = JSON.parse(skinCode.value);
      applySkin({
        primary: config.primary || primaryColor.value,
        stripe: config.stripe || stripeColor.value,
        glow: config.glow || config.stripe || stripeColor.value
      });
    } else {
      applyAvatar(JSON.parse(avatarCode.value));
    }
    applyCode.textContent = "Applied";
    setTimeout(() => {
      applyCode.textContent = "Apply Code";
    }, 900);
  } catch (error) {
    applyCode.textContent = "Fix JSON";
    setTimeout(() => {
      applyCode.textContent = "Apply Code";
    }, 1200);
  }
});

driverName.addEventListener("input", () => {
  let config = {};
  try {
    config = JSON.parse(avatarCode.value);
  } catch (error) {
    config = { helmet: "#ffffff", jacket: primaryColor.value };
  }
  config.name = driverName.value;
  avatarCode.value = JSON.stringify(config, null, 2);
});

resize();
applySkin(skins.sunset);
animate();

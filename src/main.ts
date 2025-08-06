import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import * as CANNON from "cannon-es";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 1.6, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("game-container")!.appendChild(renderer.domElement);

// Physics world
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.broadphase = new CANNON.NaiveBroadphase();
(world.solver as CANNON.GSSolver).iterations = 10;

// Ground
const groundGeo = new THREE.PlaneGeometry(100, 100);
const groundMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.rotation.x = -Math.PI / 2;
scene.add(groundMesh);

const groundBody = new CANNON.Body({ mass: 0 });
groundBody.addShape(new CANNON.Plane());
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
world.addBody(groundBody);

// Player controls
const controls = new PointerLockControls(camera, renderer.domElement);
const crosshair = document.getElementById("crosshair")!;
const mainMenu = document.getElementById("main-menu")!;
const exitMessage = document.getElementById("exit-message")!;
const startGameButton = document.getElementById("start-game")!;

let isGameActive = false;

// Player physics
const playerRadius = 0.5;
const playerBody = new CANNON.Body({ mass: 1, linearDamping: 0.9 });
playerBody.addShape(new CANNON.Sphere(playerRadius));
playerBody.position.set(0, 1.6, 5);
world.addBody(playerBody);

// Gun
const gunGeo = new THREE.BoxGeometry(0.1, 0.1, 0.5);
const gunMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const gun = new THREE.Mesh(gunGeo, gunMat);
gun.position.set(0.2, -0.2, -0.5);
camera.add(gun);
scene.add(camera);

// GLB models
const glbModels: { mesh: THREE.Group; body: CANNON.Body }[] = [];
const gltfLoader = new GLTFLoader();

interface ModelConfig {
  path: string;
  position?: [number, number, number] | "random";
  scale?: number;
}

function loadGLBModel(models: ModelConfig[]) {
  models.forEach((config) => {
    gltfLoader.load(
      config.path,
      (gltf: GLTF) => {
        const model = gltf.scene.clone();
        let x, y, z;
        if (config.position === "random") {
          x = (Math.random() - 0.5) * 80;
          z = (Math.random() - 0.5) * 80;
          y = 0;
        } else {
          [x, y, z] = config.position || [0, 0, 0];
        }
        model.position.set(x, y, z);
        if (config.scale) {
          model.scale.set(config.scale, config.scale, config.scale);
        }
        scene.add(model);

        // Compute bounding box for collision
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);

        const body = new CANNON.Body({ mass: 0 }); // Static
        body.addShape(new CANNON.Box(halfExtents));
        body.position.set(x, size.y / 2, z);
        world.addBody(body);

        glbModels.push({ mesh: model, body });
      },
      undefined,
      (error: unknown) =>
        console.error(`Error loading GLB at ${config.path}:`, error as Error)
    );
  });
}

// Load models with specific configurations
loadGLBModel([
  { path: "/assets/model.glb", position: "random", scale: 1 },
  { path: "/assets/model.glb", position: [10, 0, 10], scale: 1.5 },
  { path: "/assets/model.glb", position: [-15, 0, -5] },
]);

// Particle system for muzzle flash and impact
const particleMaterial = new THREE.PointsMaterial({
  color: 0xffaa00,
  size: 0.1,
  transparent: true,
  opacity: 1,
  blending: THREE.AdditiveBlending,
});

interface Particle {
  points: THREE.Points;
  lifetimes: number[];
  velocities: THREE.Vector3[];
}

const particles: Particle[] = [];

// Bullet trajectory
interface Trajectory {
  line: THREE.Line;
  lifetime: number;
}

const trajectories: Trajectory[] = [];
const trajectoryMaterial = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 1,
  blending: THREE.AdditiveBlending,
});

function createBulletTrajectory(start: THREE.Vector3, end: THREE.Vector3) {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const line = new THREE.Line(geometry, trajectoryMaterial.clone());
  scene.add(line);
  trajectories.push({ line, lifetime: 0.1 }); // Visible for 0.1 seconds
}

// Targets
const targets: { mesh: THREE.Mesh; body: CANNON.Body }[] = [];
const targetGeo = new THREE.SphereGeometry(0.5, 32, 32);
const targetMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });

function spawnTarget() {
  const x = (Math.random() - 0.5) * 80;
  const z = (Math.random() - 0.5) * 80;
  const mesh = new THREE.Mesh(targetGeo, targetMat);
  mesh.position.set(x, 1, z);
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 1 });
  body.addShape(new CANNON.Sphere(0.5));
  body.position.set(x, 1, z);
  world.addBody(body);

  targets.push({ mesh, body });
}

// Spawn initial targets
for (let i = 0; i < 20; i++) spawnTarget();

// Movement
const velocity = new THREE.Vector3();
const moveSpeed = 5;
const keys: { [key: string]: boolean } = {};

document.addEventListener("keydown", (e) => (keys[e.code] = true));
document.addEventListener("keyup", (e) => (keys[e.code] = false));

// Shooting
const raycaster = new THREE.Raycaster();
const maxBulletDistance = 100; // Max distance for bullet trajectory if no hit
document.addEventListener("mousedown", (e) => {
  if (e.button === 0 && controls.isLocked && isGameActive) {
    // Muzzle flash effect at gun tip
    const gunTip = new THREE.Vector3(0.2, -0.2, -1).applyMatrix4(
      gun.matrixWorld
    );
    createParticleEffect(gunTip, 10, 0.2, 0.2);

    // Bullet trajectory
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(targets.map((t) => t.mesh));
    let endPoint: THREE.Vector3;
    if (intersects.length > 0) {
      endPoint = intersects[0].point;
    } else {
      // No hit, extend ray to max distance
      const direction = new THREE.Vector3();
      raycaster.ray.direction.copy(
        direction.set(0, 0, -1).applyQuaternion(camera.quaternion)
      );
      endPoint = gunTip
        .clone()
        .add(direction.multiplyScalar(maxBulletDistance));
    }
    createBulletTrajectory(gunTip, endPoint);

    // Handle target hit
    if (intersects.length > 0) {
      const hitMesh = intersects[0].object;
      const hitPoint = intersects[0].point;
      const index = targets.findIndex((t) => t.mesh === hitMesh);
      if (index !== -1) {
        // Impact effect at hit point
        createParticleEffect(hitPoint, 20, 0.5, 0.5);
        scene.remove(targets[index].mesh);
        world.removeBody(targets[index].body);
        targets.splice(index, 1);
        spawnTarget();
      }
    }
  }
});

// Menu controls
startGameButton.addEventListener("click", () => {
  controls.lock();
});

controls.addEventListener("lock", () => {
  controls.isLocked = true;
  isGameActive = true;
  mainMenu.style.display = "none";
  crosshair.style.display = "block";
  exitMessage.style.display = "block";
});

controls.addEventListener("unlock", () => {
  controls.isLocked = false;
  isGameActive = false;
  mainMenu.style.display = "flex";
  crosshair.style.display = "none";
  exitMessage.style.display = "none";
});

// Particle system for muzzle flash and impact
function createParticleEffect(
  position: THREE.Vector3,
  count: number,
  spread: number,
  lifetime: number
) {
  const vertices = new Float32Array(count * 3);
  const lifetimes: number[] = [];
  const velocities: THREE.Vector3[] = [];

  for (let i = 0; i < count; i++) {
    vertices[i * 3] = position.x + (Math.random() - 0.5) * spread;
    vertices[i * 3 + 1] = position.y + (Math.random() - 0.5) * spread;
    vertices[i * 3 + 2] = position.z + (Math.random() - 0.5) * spread;
    lifetimes.push(lifetime);
    velocities.push(
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.1
      )
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  const points = new THREE.Points(geometry, particleMaterial.clone());
  scene.add(points);

  particles.push({ points, lifetimes, velocities });
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  if (isGameActive) {
    // Movement
    velocity.set(0, 0, 0);
    if (keys["KeyW"]) velocity.z -= moveSpeed;
    if (keys["KeyS"]) velocity.z += moveSpeed;
    if (keys["KeyA"]) velocity.x -= moveSpeed;
    if (keys["KeyD"]) velocity.x += moveSpeed;

    // Apply velocity to player body
    playerBody.velocity.set(velocity.x, playerBody.velocity.y, velocity.z);

    // Sync camera with player body
    camera.position.copy(playerBody.position as any);
    controls.getObject().position.copy(playerBody.position as any);

    // Physics step
    world.step(1 / 60);

    // Sync targets
    targets.forEach((t) => {
      t.mesh.position.copy(t.body.position as any);
      t.mesh.quaternion.copy(t.body.quaternion as any);
    });

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      const positions = particle.points.geometry.attributes.position
        .array as Float32Array;

      for (let j = 0; j < particle.lifetimes.length; j++) {
        particle.lifetimes[j] -= 0.016;
        if (particle.lifetimes[j] <= 0) continue;

        positions[j * 3] += particle.velocities[j].x;
        positions[j * 3 + 1] += particle.velocities[j].y;
        positions[j * 3 + 2] += particle.velocities[j].z;
      }

      particle.points.geometry.attributes.position.needsUpdate = true;
      const initialLifetime =
        particle.lifetimes[0] > 0
          ? particle.lifetimes[0]
          : particle.lifetimes.find((lt) => lt > 0) || 1;
      (particle.points.material as THREE.PointsMaterial).opacity = Math.max(
        0,
        particle.lifetimes[0] / initialLifetime
      );
      if (particle.lifetimes.every((lt) => lt <= 0)) {
        scene.remove(particle.points);
        particles.splice(i, 1);
      }
    }

    // Update trajectories
    for (let i = trajectories.length - 1; i >= 0; i--) {
      const trajectory = trajectories[i];
      trajectory.lifetime -= 0.016;
      (trajectory.line.material as THREE.LineBasicMaterial).opacity = Math.max(
        0,
        trajectory.lifetime / 0.1
      );
      if (trajectory.lifetime <= 0) {
        scene.remove(trajectory.line);
        trajectories.splice(i, 1);
      }
    }
  }

  renderer.render(scene, camera);
}
animate();

// Window resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

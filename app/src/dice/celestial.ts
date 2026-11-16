import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { Scene } from "@babylonjs/core/scene";

interface PhysicalDie {
  config: { theme: string };
  mesh: InstancedMesh;
  scene: Scene;
}

const craterDirections = [
  [0.33, 0.42, 0.85], [-0.56, 0.4, 0.7], [0.12, -0.57, 0.81], [0.6, -0.36, -0.72],
  [-0.8, 0.45, -0.4], [0.14, 0.81, -0.57], [-0.29, -0.7, -0.65], [0.76, 0.51, 0.4],
];
const radius = 0.034;
const animations = new WeakMap<Scene, { frame: number; cores: number }>();

/** Render once per frame while the physics engine is idle and a core is visible. */
function keepRendering(scene: Scene): () => void {
  let state = animations.get(scene);
  if (!state) {
    const animation = { frame: 0, cores: 0 };
    const engine = scene.getEngine();
    const renderSettled = () => {
      animation.frame = requestAnimationFrame(renderSettled);
      if (engine.activeRenderLoops.length === 0) scene.render();
    };
    animation.frame = requestAnimationFrame(renderSettled);
    animations.set(scene, animation);
    state = animation;
  }
  const animation = state;
  animation.cores++;
  return () => {
    if (--animation.cores > 0) return;
    cancelAnimationFrame(animation.frame);
    animations.delete(scene);
  };
}

export function mountCelestialCore({ config, mesh, scene }: PhysicalDie) {
  const sun = config.theme === "sunCore";
  if (!sun && config.theme !== "moonCore") return;

  const shell = mesh.sourceMesh.material as StandardMaterial;
  if (shell.diffuseTexture) shell.diffuseTexture.hasAlpha = true;
  shell.useAlphaFromDiffuseTexture = true;
  shell.backFaceCulling = true;

  const material = (name: string, color: string, glow: number) => {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.emissiveColor = mat.diffuseColor.scale(glow);
    return mat;
  };
  const body = material("celestial-core", sun ? "#ffbc33" : "#b8d1f5", sun ? 0.65 : 0.24);
  const detail = material("celestial-detail", sun ? "#ff7728" : "#657f9e", sun ? 0.62 : 0.16);
  const core = CreateSphere("celestial-core", { diameter: 2 * radius, segments: 16 }, scene);
  core.parent = mesh;
  core.material = body;
  core.isPickable = false;

  for (let i = 0; i < craterDirections.length; i++) {
    const direction = Vector3.FromArray(craterDirections[i]).normalize();
    const feature = CreateSphere("celestial-detail", { diameter: i % 3 === 0 ? 0.022 : 0.016, segments: 8 }, scene);
    feature.parent = core;
    feature.material = detail;
    feature.isPickable = false;
    feature.position = direction.scale(sun ? radius : radius * 0.98);
    feature.rotation.z = Math.acos(direction.y);
    feature.rotation.y = Math.atan2(-direction.z, direction.x);
    feature.scaling.y = sun ? 1.9 : 0.18;
  }

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    mesh.onDisposeObservable.addOnce(() => { body.dispose(); detail.dispose(); });
    return;
  }
  const speed = sun ? 1.8 : -1.35;
  const start = performance.now();
  const rotation = scene.onBeforeRenderObservable.add(() => {
    core.rotation.y = (performance.now() - start) * speed / 1000;
  });
  const stopRendering = keepRendering(scene);
  mesh.onDisposeObservable.addOnce(() => {
    stopRendering();
    scene.onBeforeRenderObservable.remove(rotation);
    body.dispose();
    detail.dispose();
  });
}

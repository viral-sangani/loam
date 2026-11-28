/* The reading room scene: a three.js port of the approved prototype (loam-room.js).
   createRoom(canvas, opts) draws the room and the books; React (room-view.tsx) owns all HTML UI and
   feeds data in with setBooks / setPreview / setReview. Renders only while something moves. */

import * as THREE from "three";
import { loadCover, type CoverImage } from "./covers";
import { hash, type PreviewPara, type ShelfBook } from "./model";
import {
  INK,
  PAPER,
  TW,
  cassetteTex,
  drawBack,
  drawCard,
  drawEdge,
  drawFront,
  drawPage,
  drawPocket,
  drawRibbon,
  drawSpine,
  floorTex,
  grainWood,
  nightTex,
  paginate,
  plasterTex,
  printA,
  printB,
  reviewCardTex,
  rng,
  rugTex,
  shade,
  spineColours,
  type Page,
} from "./textures";

export type Stage = "room" | "shelf" | "held" | "open";
export type Face = "front" | "spine" | "back" | "edge" | "open";
export type Zone = "bookcase" | "walkman" | "review";

export type RoomState = {
  ready: boolean;
  stage: Stage;
  bookId: string | null;
  face: Face;
  cardOut: boolean;
  spread: number;
  spreads: number;
  /** The spine under the pointer (or keyboard), with where to show its label. */
  hover: { id: string; x: number; y: number } | null;
  /** A clickable thing in the room under the pointer. */
  zone: Zone | null;
  /** Books that didn't fit on the shelf. */
  overflow: number;
};

export type RoomOptions = {
  reducedMotion: boolean;
  onChange: (s: RoomState) => void;
  onError: (kind: "webgl" | "lost") => void;
  onReview: () => void;
  onListen: (bookId: string) => void;
};

export type RoomController = {
  setBooks(books: ShelfBook[]): void;
  setPreview(bookId: string, paras: PreviewPara[] | undefined): void;
  setReview(due: number): void;
  go(stage: Stage): void;
  flip(dir: 1 | -1): void;
  turn(dir: 1 | -1): void;
  setFace(f: Exclude<Face, "open">): void;
  toggleCard(): void;
  pick(id: string): void;
  /** Moves the keyboard's place along the shelf; returns the book now under it. */
  hoverStep(dir: 1 | -1): string | null;
  hoverId(id: string | null): void;
  /** Opens the held book to its first pages for the hand-off to the reader; ms to wait for the camera. */
  settleOnPage(): number;
  dispose(): void;
};

const TAU = Math.PI * 2;
const HALF = Math.PI / 2;
const EDGE_TILT = 0.5;
const OPEN_TILT = -0.3;
const PI = Math.PI;
/** Where a held book floats, in front of the lamp. */
const R = new THREE.Vector3(0.34, 1.12, -0.32);
const SHELF_Y = 0.615;
const SHELF_Z = -1.94 + 0.18;
const SHELF_START = -1.25 - 0.6 + 0.02;

type Mat = THREE.MeshStandardMaterial;

type BK = {
  b: ShelfBook;
  sig: string;
  id: string;
  cover: CoverImage | null;
  group: THREE.Group;
  pivot: THREE.Group;
  card: THREE.Mesh;
  cardBaseY: number;
  leftP: THREE.Mesh;
  rightP: THREE.Mesh;
  leaf: THREE.Group;
  leafFM: Mat;
  leafBM: Mat;
  leftM: Mat;
  rightM: Mat;
  ribbon: THREE.Mesh | null;
  tPos: THREE.Vector3;
  tQuat: THREE.Quaternion;
  tCover: number;
  tCardY: number;
  shelfPos: THREE.Vector3;
  shelfQuat: THREE.Quaternion;
  pages: Page[] | null;
  ph: number;
  pageTex: Map<number, THREE.Texture>;
  /** Everything this book owns on the GPU. */
  own: { dispose(): void }[];
  W: number;
  H: number;
  Tt: number;
};

function signature(b: ShelfBook, cover: CoverImage | null, T: number) {
  return JSON.stringify([b.guest, b.title, b.author, b.description, b.percent, b.started, b.chapter, b.audio, b.ai, b.extras, b.addedAt, !!cover, T]);
}

export function createRoom(canvas: HTMLCanvasElement, opts: RoomOptions): RoomController | null {
  const reduced = opts.reducedMotion;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch {
    opts.onError("webgl");
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const ANI = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const allTex = new Set<THREE.Texture>();
  function T(cnv: HTMLCanvasElement, rep?: [number, number]) {
    const t = new THREE.CanvasTexture(cnv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = ANI;
    if (rep) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rep[0], rep[1]);
    }
    allTex.add(t);
    return t;
  }
  function freeTex(t: THREE.Texture | null | undefined) {
    if (!t) return;
    t.dispose();
    allTex.delete(t);
  }
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#070403");
  scene.fog = new THREE.Fog("#070403", 5, 12);
  const camera = new THREE.PerspectiveCamera(36, 1.6, 0.02, 40);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2(-9, -9);

  /* lights: the prototype's values were tuned for three r149's legacy lighting, hence the PI */
  scene.add(new THREE.AmbientLight("#3a2216", 0.22 * PI));
  scene.add(new THREE.HemisphereLight("#2a3550", "#1a0f08", 0.16 * PI));
  const moon = new THREE.DirectionalLight("#7d93c4", 0.35 * PI);
  moon.position.set(2.6, 2.6, -3.2);
  scene.add(moon);
  const BULB = new THREE.Vector3(0.46, 1.6, -1.0);
  const LAMP = 3.2 * PI;
  const FILL = 1.3 * PI;
  const lampSpot = new THREE.SpotLight("#ffb36a", LAMP, 7, 1.0, 0.75, 1.1);
  lampSpot.position.copy(BULB);
  lampSpot.target.position.set(0.1, 0.4, -1.0);
  scene.add(lampSpot, lampSpot.target);
  lampSpot.castShadow = true;
  lampSpot.shadow.mapSize.set(1024, 1024);
  lampSpot.shadow.bias = -0.0006;
  lampSpot.shadow.radius = 4;
  const lampFill = new THREE.PointLight("#ff9a4d", FILL, 5.5, 1.4);
  lampFill.position.copy(BULB).add(new THREE.Vector3(0, 0.05, 0));
  scene.add(lampFill);
  const shelfLight = new THREE.PointLight("#ffbf7a", 0.9 * PI, 1.7, 1.6);
  shelfLight.position.set(-1.25, 1.04, -1.58);
  scene.add(shelfLight);
  const HAND = 2.6 * PI;
  const handLight = new THREE.SpotLight("#ffc98f", 0, 1.7, 0.36, 0.7, 1.2);
  scene.add(handLight, handLight.target);

  /* room */
  const walnut = T(grainWood("#5a3420"), [1, 1]);
  const walnutDark = T(grainWood("#3e2416"), [1, 1]);
  const mWal = std({ map: walnut, roughness: 0.62 });
  const mWalD = std({ map: walnutDark, roughness: 0.7 });
  const mBrass = std({ color: "#b88c46", roughness: 0.35, metalness: 0.85 });
  function box(w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x: number, y: number, z: number, parent?: THREE.Object3D) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    (parent ?? scene).add(o);
    return o;
  }
  function cyl(rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D, seg = 20) {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    (parent ?? scene).add(o);
    return o;
  }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 9), std({ map: T(floorTex(), [3, 2.2]), roughness: 0.72 }));
  floor.rotation.x = -HALF;
  floor.position.set(0.3, 0, 0.3);
  floor.receiveShadow = true;
  scene.add(floor);
  const wallM = std({ map: T(plasterTex("#33231a"), [6, 3]), roughness: 0.95 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), wallM);
  wall.position.set(0.3, 2.5, -2.2);
  wall.receiveShadow = true;
  scene.add(wall);
  const wallL = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), wallM);
  wallL.rotation.y = HALF;
  wallL.position.set(-3.1, 2.5, 0.3);
  wallL.receiveShadow = true;
  scene.add(wallL);
  box(12, 0.1, 0.02, mWalD, 0.3, 0.05, -2.19);
  for (let s = 0; s < 20; s++) box(0.045, 2.6, 0.035, mWal, -0.2 + s * 0.085, 1.3, -2.17);

  // window
  const win = new THREE.Group();
  win.position.set(2.45, 1.5, -2.18);
  scene.add(win);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.42), new THREE.MeshBasicMaterial({ map: T(nightTex()), toneMapped: false, color: "#9aa9c4" }));
  glass.position.z = -0.005;
  win.add(glass);
  for (const f of [
    [0, 0.73, 1.04, 0.05],
    [0, -0.73, 1.04, 0.05],
    [-0.5, 0, 0.05, 1.5],
    [0.5, 0, 0.05, 1.5],
    [0, 0, 0.03, 1.42],
    [0, 0.1, 0.92, 0.03],
  ])
    box(f[2], f[3], 0.05, mWalD, f[0], f[1], 0.01, win);
  box(1.14, 0.04, 0.16, mWalD, 0, -0.77, 0.06, win);

  // prints
  function frame(tex: HTMLCanvasElement, w: number, h: number, x: number, y: number) {
    const gq = new THREE.Group();
    gq.position.set(x, y, -2.18);
    scene.add(gq);
    box(w + 0.05, h + 0.05, 0.03, mWalD, 0, 0, 0, gq);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std({ map: T(tex), roughness: 0.9 }));
    p.position.z = 0.017;
    gq.add(p);
  }
  frame(printA(), 0.34, 0.46, -1.6, 1.68);
  frame(printB(), 0.3, 0.39, -0.98, 1.74);

  // rug
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.66), std({ map: T(rugTex()), roughness: 1 }));
  rug.rotation.x = -HALF;
  rug.position.set(0.75, 0.004, -0.8);
  rug.receiveShadow = true;
  scene.add(rug);

  // bookcase
  const BC = new THREE.Group();
  BC.position.set(-1.25, 0, -1.94);
  scene.add(BC);
  const BW = 1.3;
  const BD = 0.4;
  box(BW, 0.03, BD, mWal, 0, 0.175, 0, BC);
  box(BW, 0.03, BD, mWal, 0, 0.6, 0, BC);
  box(BW, 0.03, BD, mWal, 0, 1.105, 0, BC);
  box(0.03, 0.96, BD, mWal, -BW / 2 + 0.015, 0.64, 0, BC);
  box(0.03, 0.96, BD, mWal, BW / 2 - 0.015, 0.64, 0, BC);
  box(BW, 0.96, 0.015, mWalD, 0, 0.64, -BD / 2 + 0.008, BC);
  for (const [px, pz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    cyl(0.018, 0.011, 0.16, mWalD, px * (BW / 2 - 0.08), 0.08, pz * (BD / 2 - 0.06), BC);
  const mDrawer = std({ map: walnut, color: "#d9b49a", roughness: 0.6 });
  for (const sx of [-1, 1]) {
    box(BW / 2 - 0.04, 0.38, 0.02, mDrawer, sx * (BW / 4 - 0.006), 0.39, BD / 2 - 0.004, BC);
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), mBrass);
    k.position.set(sx * 0.08, 0.42, BD / 2 + 0.012);
    BC.add(k);
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(BW - 0.08, 0.005, 0.01), new THREE.MeshBasicMaterial({ color: "#ffc98a", toneMapped: false }));
  strip.position.set(0, 1.086, BD / 2 - 0.04);
  BC.add(strip);
  const bookend = new THREE.Group();
  bookend.position.set(-0.6, 0.615, 0.02);
  BC.add(bookend);
  box(0.006, 0.17, 0.13, mBrass, 0, 0.085, 0, bookend);
  box(0.09, 0.006, 0.13, mBrass, -0.045, 0.003, 0, bookend);
  // A second bookend holds up the last book, wherever the row ends.
  const bookendR = new THREE.Group();
  bookendR.position.set(-0.4, 0.615, 0.02);
  BC.add(bookendR);
  box(0.006, 0.17, 0.13, mBrass, 0, 0.085, 0, bookendR);
  box(0.09, 0.006, 0.13, mBrass, 0.045, 0.003, 0, bookendR);
  // Props on the shelf; they make way when the shelf fills up.
  const props = new THREE.Group();
  BC.add(props);
  (
    [
      ["#d9c7a3", 0.028],
      ["#5f7a5c", 0.022],
      ["#7a2731", 0.026],
    ] as const
  ).forEach(([col, h], i) => {
    const nb = box(0.22, h, 0.16, std({ color: col, roughness: 0.9 }), 0.36, 0.615 + h / 2 + i * 0.027, 0.02, props);
    nb.rotation.y = (i - 1) * 0.08;
  });
  const vasePts: THREE.Vector2[] = [];
  for (let vi = 0; vi <= 10; vi++) {
    const t = vi / 10;
    vasePts.push(new THREE.Vector2(0.025 + Math.sin(t * Math.PI) * 0.045 + (t > 0.85 ? 0.01 : 0), t * 0.2));
  }
  const vase = new THREE.Mesh(new THREE.LatheGeometry(vasePts, 28), std({ color: "#c9b48e", roughness: 0.55 }));
  vase.position.set(0.5, 0.615, 0.03);
  vase.castShadow = true;
  props.add(vase);
  const stemM = std({ color: "#6e5a3a", roughness: 0.9 });
  for (let si = 0; si < 3; si++) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.3), stemM);
    st.position.set(0.5 + (si - 1) * 0.03, 0.9, 0.03);
    st.rotation.z = (si - 1) * 0.25;
    props.add(st);
  }
  cyl(0.07, 0.055, 0.12, std({ color: "#d6c7aa", roughness: 0.6 }), 0.45, 1.18, 0, BC);
  const leafM = std({ color: "#4f6b3c", roughness: 0.7, side: THREE.DoubleSide });
  for (let li = 0; li < 9; li++) {
    const lf = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), leafM);
    lf.scale.set(0.35, 1.6, 0.12);
    const a = (li / 9) * TAU;
    lf.position.set(0.45 + Math.cos(a) * 0.05, 1.32, Math.sin(a) * 0.05);
    lf.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    lf.castShadow = true;
    BC.add(lf);
  }
  const clock = new THREE.Group();
  clock.position.set(-0.35, 1.12, 0.02);
  BC.add(clock);
  cyl(0.07, 0.07, 0.03, mBrass, 0, 0.08, 0, clock, 28).rotation.x = HALF;
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.058, 28), std({ color: PAPER, roughness: 0.6 }));
  dial.position.set(0, 0.08, 0.016);
  clock.add(dial);
  box(0.004, 0.04, 0.002, std({ color: INK }), 0, 0.095, 0.018, clock).rotation.z = 0.5;
  box(0.06, 0.012, 0.04, mBrass, 0, 0.006, 0, clock);
  const invisible = new THREE.MeshBasicMaterial({ visible: false });
  const bookcaseHit = new THREE.Mesh(new THREE.BoxGeometry(BW, 1.0, BD), invisible);
  bookcaseHit.position.set(0, 0.62, 0);
  BC.add(bookcaseHit);
  bookcaseHit.userData.zone = "bookcase";

  // arc floor lamp
  const lamp = new THREE.Group();
  scene.add(lamp);
  const mBlack = std({ color: "#1b1410", roughness: 0.45, metalness: 0.4 });
  cyl(0.16, 0.17, 0.03, mBlack, 0.06, 0.015, -1.58, lamp, 32);
  cyl(0.011, 0.011, 1.56, mBrass, 0.06, 0.8, -1.58, lamp);
  const arc = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.06, 1.57, -1.58), new THREE.Vector3(0.14, 1.98, -1.42), new THREE.Vector3(0.46, 1.74, -1.0));
  const arm = new THREE.Mesh(new THREE.TubeGeometry(arc, 40, 0.009, 8, false), mBrass);
  arm.castShadow = true;
  lamp.add(arm);
  const shadeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 32, 16, 0, TAU, 0, HALF * 0.95),
    std({ color: "#f0d09a", emissive: "#ffb468", emissiveIntensity: 0.62, roughness: 0.35 }),
  );
  shadeMesh.position.copy(BULB);
  lamp.add(shadeMesh);
  const shadeIn = new THREE.Mesh(new THREE.SphereGeometry(0.168, 32, 16, 0, TAU, 0, HALF * 0.95), new THREE.MeshBasicMaterial({ color: "#ffcf8e", side: THREE.BackSide, toneMapped: false }));
  shadeIn.position.copy(BULB);
  lamp.add(shadeIn);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshBasicMaterial({ color: "#fff1d6", toneMapped: false }));
  bulb.position.copy(BULB);
  lamp.add(bulb);
  {
    const glowC = document.createElement("canvas");
    glowC.width = glowC.height = 128;
    const gg = glowC.getContext("2d")!;
    const rg = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, "rgba(255,200,130,0.85)");
    rg.addColorStop(0.3, "rgba(255,170,90,0.3)");
    rg.addColorStop(1, "rgba(255,150,70,0)");
    gg.fillStyle = rg;
    gg.fillRect(0, 0, 128, 128);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T(glowC), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    glow.scale.set(0.9, 0.9, 1);
    glow.position.set(0.46, 1.52, -0.98);
    scene.add(glow);
  }

  // armchair
  const chair = new THREE.Group();
  chair.position.set(1.12, 0, -1.3);
  chair.rotation.y = -0.5;
  scene.add(chair);
  const mFab = std({ color: "#3a1016", roughness: 0.95 });
  box(0.78, 0.16, 0.72, mFab, 0, 0.36, 0, chair);
  box(0.6, 0.1, 0.6, std({ color: "#44131a", roughness: 0.95 }), 0, 0.49, 0.04, chair);
  box(0.78, 0.62, 0.14, mFab, 0, 0.74, -0.3, chair).rotation.x = -0.14;
  box(0.1, 0.2, 0.7, mFab, -0.39, 0.54, 0, chair);
  box(0.1, 0.2, 0.7, mFab, 0.39, 0.54, 0, chair);
  for (const [px, pz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    cyl(0.02, 0.012, 0.28, mWalD, px * 0.33, 0.14, pz * 0.28, chair).rotation.z = px * 0.08;

  // side table: cassette player, headphones, mug, and the review card
  const TB = new THREE.Group();
  TB.position.set(1.88, 0, -0.62);
  scene.add(TB);
  cyl(0.23, 0.23, 0.03, mWal, 0, 0.56, 0, TB, 40);
  cyl(0.025, 0.03, 0.53, mWalD, 0, 0.28, 0, TB);
  cyl(0.16, 0.17, 0.02, mWalD, 0, 0.01, 0, TB, 32);
  const walk = new THREE.Group();
  walk.position.set(-0.06, 0.575, 0.02);
  walk.rotation.y = 0.35;
  TB.add(walk);
  box(0.15, 0.03, 0.1, std({ color: "#2a1f19", roughness: 0.5, metalness: 0.2 }), 0, 0.015, 0, walk);
  let casTex = T(cassetteTex(null));
  const casMat = std({ map: casTex, roughness: 0.6 });
  const casTop = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.077), casMat);
  casTop.rotation.x = -HALF;
  casTop.position.set(0, 0.031, 0);
  walk.add(casTop);
  for (const x of [-0.019, 0.019]) cyl(0.009, 0.009, 0.004, std({ color: PAPER, roughness: 0.4 }), x, 0.033, 0.001, walk, 6);
  box(0.02, 0.008, 0.012, mBrass, 0.055, 0.034, -0.035, walk);
  const walkHit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.16), invisible);
  walkHit.position.set(0, 0.03, 0);
  walk.add(walkHit);
  walkHit.userData.zone = "walkman";
  const phones = new THREE.Group();
  phones.position.set(0.09, 0.578, -0.07);
  phones.rotation.set(-HALF, 0, 0.8);
  TB.add(phones);
  const bandM = std({ color: "#2a1a14", roughness: 0.6 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.007, 8, 24, Math.PI), bandM);
  band.castShadow = true;
  phones.add(band);
  for (const x of [-0.075, 0.075]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.024, 20), bandM);
    cup.position.set(x, -0.005, 0);
    cup.castShadow = true;
    phones.add(cup);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.003, 6, 20), mBrass);
    ring.position.set(x, -0.005, 0);
    ring.rotation.x = HALF;
    phones.add(ring);
  }
  const mug = cyl(0.033, 0.03, 0.085, std({ color: "#d9cbb0", roughness: 0.4 }), 0.12, 0.618, 0.1, TB);
  const hdl = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 6, 12, Math.PI), mug.material);
  hdl.position.set(0.155, 0.62, 0.1);
  hdl.rotation.z = -HALF;
  TB.add(hdl);
  let reviewTex: THREE.Texture | null = null;
  const reviewMat = std({ roughness: 0.85 });
  const reviewCard = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.1), reviewMat);
  reviewCard.rotation.set(-HALF, 0, 0.5);
  reviewCard.position.set(-0.08, 0.5765, 0.14);
  reviewCard.receiveShadow = true;
  reviewCard.visible = false;
  reviewCard.userData.zone = "review";
  TB.add(reviewCard);

  /* books */
  let books: BK[] = [];
  const byId = new Map<string, BK>();
  let pickables: THREE.Object3D[] = [];
  const covers = new Map<string, CoverImage | null>();
  const previews = new Map<string, PreviewPara[] | undefined>();
  const edgeV = T(drawEdge(true));
  const edgeH = T(drawEdge(false));
  const ribbonTex = T(drawRibbon("#8a2a35"));
  const pocketTex = T(drawPocket());
  const endM = std({ color: "#d9c7a3", roughness: 0.9 });
  const edgeVM = std({ map: edgeV, roughness: 0.9 });
  const edgeHM = std({ map: edgeH, roughness: 0.9 });
  const paperM = std({ color: PAPER, roughness: 0.9 });
  const ribbonM = std({ map: ribbonTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
  const pocketM = std({ map: pocketTex, transparent: true, roughness: 0.95, alphaTest: 0.5 });
  const TAB_COLOURS = ["#e0aa45", "#8fae8b", "#c0616a"];
  const tabMs = TAB_COLOURS.map((c) => std({ color: c, roughness: 0.7 }));
  let overflow = 0;
  let reviewDue = 0;

  function buildBook(b: ShelfBook, T_: number): BK {
    const cover = covers.get(b.id) ?? null;
    const own: { dispose(): void }[] = [];
    const geo = <G extends THREE.BufferGeometry>(g: G) => (own.push(g), g);
    const mat = <M extends THREE.Material>(m: M) => (own.push(m), m);
    const tex = (c: HTMLCanvasElement) => {
      const t = T(c);
      own.push({ dispose: () => freeTex(t) });
      return t;
    };
    const W = b.size.W;
    const H = b.size.H;
    const Tt = T_;
    const cb = 0.006;
    const grp = new THREE.Group();
    scene.add(grp);
    const { base } = spineColours(b, cover);
    const clothM = mat(std({ color: shade(base, -0.15), roughness: 0.9 }));
    const mFront = mat(std({ map: tex(drawFront(b, cover)), roughness: 0.72 }));
    const mBack = mat(std({ map: tex(drawBack(b, cover)), roughness: 0.75 }));
    const mSpine = mat(std({ map: tex(drawSpine(b, cover)), roughness: 0.72 }));
    const pages = new THREE.Mesh(geo(new THREE.BoxGeometry(W - 0.01, H - 0.014, Tt - cb * 2)), [edgeVM, endM, edgeHM, edgeHM, paperM, endM]);
    pages.position.set(-0.004, 0, 0);
    pages.castShadow = pages.receiveShadow = true;
    grp.add(pages);
    const pivot = new THREE.Group();
    pivot.position.set(-W / 2, 0, Tt / 2 - cb / 2);
    grp.add(pivot);
    const boardG = geo(new THREE.BoxGeometry(W, H, cb));
    const front = new THREE.Mesh(boardG, [clothM, clothM, clothM, clothM, mFront, endM]);
    front.position.x = W / 2;
    front.castShadow = true;
    pivot.add(front);
    const backB = new THREE.Mesh(boardG, [clothM, clothM, clothM, clothM, endM, mBack]);
    backB.position.z = -(Tt / 2 - cb / 2);
    backB.castShadow = true;
    grp.add(backB);
    const spine = new THREE.Mesh(geo(new THREE.BoxGeometry(cb, H, Tt)), [clothM, mSpine, clothM, clothM, clothM, clothM]);
    spine.position.x = -W / 2 - cb / 2;
    spine.castShadow = true;
    grp.add(spine);
    const pw = W - 0.016;
    const ph = H - 0.018;
    const pageG = geo(new THREE.PlaneGeometry(pw, ph));
    const leftM = mat(std({ color: "#ffffff", roughness: 0.9 }));
    const rightM = mat(std({ color: "#ffffff", roughness: 0.9 }));
    const leftP = new THREE.Mesh(pageG, leftM);
    leftP.rotation.y = Math.PI;
    // At full open both sheets meet at the hinge, just above the spine and page block.
    leftP.position.set(pw / 2, 0, -(cb / 2 + 0.0006));
    pivot.add(leftP);
    leftP.visible = false;
    const rightP = new THREE.Mesh(pageG, rightM);
    rightP.position.set((pw - W) / 2, 0, Tt / 2 + 0.0006);
    grp.add(rightP);
    rightP.visible = false;
    const leaf = new THREE.Group();
    leaf.position.set(-W / 2, 0, Tt / 2 + 0.0016);
    grp.add(leaf);
    leaf.visible = false;
    const leafFM = mat(std({ color: "#ffffff", roughness: 0.9 }));
    const leafBM = mat(std({ color: "#ffffff", roughness: 0.9 }));
    const lf1 = new THREE.Mesh(pageG, leafFM);
    lf1.position.x = pw / 2;
    leaf.add(lf1);
    const lf2 = new THREE.Mesh(pageG, leafBM);
    lf2.rotation.y = Math.PI;
    lf2.position.set(pw / 2, 0, -0.0002);
    leaf.add(lf2);
    // the reading card in its pocket on the back cover
    const card = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.105, 0.13)), mat(std({ map: tex(drawCard(b)), roughness: 0.85 })));
    card.rotation.y = Math.PI;
    const cardBaseY = -H / 2 + 0.092;
    card.position.set(-W / 2 + 0.075, cardBaseY, -Tt / 2 - 0.0012);
    grp.add(card);
    const pocket = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.12, 0.0707)), pocketM);
    pocket.rotation.y = Math.PI;
    pocket.position.set(-W / 2 + 0.075, -H / 2 + 0.047, -Tt / 2 - 0.0024);
    grp.add(pocket);
    // a ribbon at the reader's place
    let ribbon: THREE.Mesh | null = null;
    if (b.percent !== null && b.percent > 0 && b.percent < 0.995) {
      ribbon = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.011, 0.075)), ribbonM);
      const rz = Tt / 2 - cb - b.percent * (Tt - 2 * cb);
      ribbon.position.set(-W / 2 + 0.05, -H / 2 - 0.03, rz);
      ribbon.rotation.z = 0.06;
      ribbon.visible = false;
      grp.add(ribbon);
    }
    // paper tabs on the fore-edge: highlights, notes, looked-up terms
    const rr = rng(hash(b.id) + 3);
    const x = b.extras;
    const counts = [x?.highlights ?? 0, x?.notes ?? 0, x?.lookedUp ?? 0];
    const tabG = geo(new THREE.BoxGeometry(0.036, 0.018, 0.004));
    counts.forEach((count, ci) => {
      const n = count > 0 ? Math.max(1, Math.min(4, Math.ceil(count / 6))) : 0;
      for (let k = 0; k < n; k++) {
        const tb = new THREE.Mesh(tabG, tabMs[ci]);
        tb.position.set(W / 2 + 0.006, H / 2 - 0.04 - rr() * (H - 0.09), (rr() - 0.5) * (Tt - 0.02));
        grp.add(tb);
      }
    });
    const bk: BK = {
      b,
      sig: signature(b, cover, Tt),
      id: b.id,
      cover,
      group: grp,
      pivot,
      card,
      cardBaseY,
      leftP,
      rightP,
      leaf,
      leafFM,
      leafBM,
      leftM,
      rightM,
      ribbon,
      tPos: new THREE.Vector3(),
      tQuat: new THREE.Quaternion(),
      tCover: 0,
      tCardY: cardBaseY,
      shelfPos: new THREE.Vector3(),
      shelfQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, HALF, 0)),
      pages: null,
      ph: Math.round((TW * ph) / pw),
      pageTex: new Map(),
      own,
      W,
      H,
      Tt,
    };
    grp.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.userData.book = bk;
    });
    return bk;
  }

  function disposeBook(bk: BK) {
    scene.remove(bk.group);
    for (const t of bk.pageTex.values()) freeTex(t);
    bk.pageTex.clear();
    for (const o of bk.own) o.dispose();
  }

  function rebuildPickables() {
    pickables = [];
    for (const bk of books) bk.group.traverse((o) => (o as THREE.Mesh).isMesh && pickables.push(o));
    pickables.push(bookcaseHit, walkHit);
    if (reviewCard.visible) pickables.push(reviewCard);
  }

  /* state */
  const st = {
    stage: "room" as Stage,
    held: null as BK | null,
    hover: null as BK | null,
    zone: null as Zone | null,
    rotY: 0,
    tilt: 0,
    vel: 0,
    snap: 0,
    snapping: true,
    cardOut: false,
    spread: 0,
    flipping: null as { dir: 1 | -1; t: number; to: number } | null,
    face: "front" as Face,
    hx: 0,
    hy: 0,
  };
  type Cam = { pos: THREE.Vector3; look: THREE.Vector3 };
  const OPEN_N = new THREE.Vector3(0, Math.sin(-OPEN_TILT), Math.cos(OPEN_TILT));
  const CAM: Record<"room" | "shelf" | "held" | "card" | "open", Cam> = {
    room: { pos: new THREE.Vector3(0.35, 1.58, 3.5), look: new THREE.Vector3(-0.1, 0.95, -1.35) },
    shelf: { pos: new THREE.Vector3(-1.5, 1.02, -0.72), look: new THREE.Vector3(-1.52, 0.84, -1.85) },
    held: { pos: R.clone().add(new THREE.Vector3(0, 0.02, 0.84)), look: R.clone().add(new THREE.Vector3(0, -0.01, 0)) },
    card: { pos: R.clone().add(new THREE.Vector3(0.05, -0.02, 0.6)), look: R.clone().add(new THREE.Vector3(0.05, -0.04, 0)) },
    open: { pos: R.clone().add(OPEN_N.clone().multiplyScalar(0.74)), look: R.clone().add(new THREE.Vector3(0, -0.012, 0)) },
  };
  /** Portrait screens see less across: the camera steps back a little, and the room view turns to the bookcase. */
  let camScale = 1;
  const ROOM_TALL: Cam = { pos: new THREE.Vector3(-0.55, 1.5, 3.1), look: new THREE.Vector3(-0.95, 0.95, -1.5) };
  const camFor = (c0: Cam): Cam => {
    const c = c0 === CAM.room && camScale !== 1 ? ROOM_TALL : c0;
    return camScale === 1 ? c : { pos: c.look.clone().add(c.pos.clone().sub(c.look).multiplyScalar(camScale)), look: c.look };
  };
  let camT: Cam = CAM.room;
  const camPos = CAM.room.pos.clone();
  const camLook = CAM.room.look.clone();
  let active = 0;
  let last = performance.now();
  let raf = 0;
  let disposed = false;
  let down: { lx: number; ly: number; moved: number } | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!disposed) fn();
    }, ms);
    timers.add(t);
  };

  function poke(ms = 1800) {
    active = Math.max(active, performance.now() + ms);
    if (!raf && !disposed) {
      last = performance.now();
      raf = requestAnimationFrame(frameFn);
    }
  }

  const snapAngle = (a: number) => {
    const k = Math.round(a / HALF);
    let r = k * HALF;
    if ((((k % 4) + 4) % 4) === 3) r -= EDGE_TILT;
    return r;
  };
  const faceOf = (a: number): Face => (["front", "spine", "back", "edge"] as const)[(((Math.round(a / HALF) % 4) + 4) % 4) as 0 | 1 | 2 | 3];
  function emit() {
    opts.onChange({
      ready: true,
      stage: st.stage,
      bookId: st.held?.id ?? null,
      face: st.face,
      cardOut: st.cardOut,
      spread: st.spread,
      spreads: st.held?.pages ? st.held.pages.length / 2 : 0,
      hover: st.hover ? { id: st.hover.id, x: st.hx, y: st.hy } : null,
      zone: st.zone,
      overflow,
    });
  }
  function heldPose(bk: BK) {
    if (st.stage === "open") {
      bk.tPos.copy(R).add(new THREE.Vector3(bk.W / 2, 0, 0)).add(OPEN_N.clone().multiplyScalar(-bk.Tt / 2));
      bk.tQuat.setFromEuler(new THREE.Euler(OPEN_TILT, 0, 0));
    } else {
      bk.tPos.copy(R);
      bk.tQuat.setFromEuler(new THREE.Euler(st.tilt, st.rotY, 0));
    }
  }
  const pulled = (bk: BK) => bk.shelfPos.clone().add(new THREE.Vector3(0, 0.03, 0.24));
  const lifted = (bk: BK) => bk.shelfPos.clone().add(new THREE.Vector3(0, 0.03, 0.05));

  /** Screen position for a spine's label, as the camera will see it once it settles. */
  function labelAt(bk: BK) {
    const cam = camera.clone();
    const c = camFor(camT);
    cam.position.copy(c.pos);
    cam.lookAt(c.look);
    cam.updateMatrixWorld();
    const p = bk.shelfPos.clone().add(new THREE.Vector3(0, bk.H / 2 + 0.02, 0.075)).project(cam);
    st.hx = ((p.x + 1) / 2) * canvas.clientWidth;
    st.hy = ((1 - p.y) / 2) * canvas.clientHeight;
  }
  function setHover(bk: BK | null) {
    if (st.hover === bk) return;
    if (st.hover && st.hover !== st.held) st.hover.tPos.copy(st.hover.shelfPos);
    st.hover = bk;
    if (bk && bk !== st.held) bk.tPos.copy(lifted(bk));
    canvas.style.cursor = bk ? "pointer" : "default";
    poke();
    emit();
  }
  function ensurePages(bk: BK) {
    if (bk.pages) return;
    bk.pages = paginate(previews.get(bk.id) ?? null, bk.ph);
  }
  function pageTex(bk: BK, i: number) {
    let t = bk.pageTex.get(i);
    if (!t) {
      t = T(drawPage(bk.b, bk.pages![i], i, i % 2 ? "right" : "left", bk.ph));
      bk.pageTex.set(i, t);
    }
    return t;
  }
  function setMap(m: Mat, t: THREE.Texture) {
    m.map = t;
    m.needsUpdate = true;
  }
  function showSpread(bk: BK, s: number) {
    setMap(bk.leftM, pageTex(bk, s * 2));
    setMap(bk.rightM, pageTex(bk, s * 2 + 1));
  }
  function setCassette(bk: BK | null) {
    const old = casTex;
    casTex = T(cassetteTex(bk && bk.b.audio.kind === "ready" ? bk.b : null));
    setMap(casMat, casTex);
    freeTex(old);
  }

  function pick(bk: BK, instant = false) {
    if (st.held && st.held !== bk) putBack(st.held, instant);
    st.held = bk;
    st.hover = null;
    st.stage = "held";
    st.cardOut = false;
    st.spread = 0;
    bk.tCardY = bk.cardBaseY;
    st.rotY = HALF;
    st.tilt = 0;
    st.snap = 0;
    st.snapping = true;
    st.vel = 0;
    camT = CAM.held;
    canvas.style.cursor = "grab";
    if (instant || reduced) heldPose(bk);
    else {
      bk.tPos.copy(pulled(bk));
      later(() => {
        if (st.held === bk) {
          heldPose(bk);
          poke(2500);
        }
      }, 260);
    }
    ensurePages(bk);
    setCassette(bk);
    poke(2600);
    emit();
  }
  function putBack(bk: BK, instant = false) {
    bk.tCover = 0;
    bk.tCardY = bk.cardBaseY;
    bk.leftP.visible = bk.rightP.visible = false;
    bk.leaf.visible = false;
    bk.tQuat.copy(bk.shelfQuat);
    if (instant || reduced) bk.tPos.copy(bk.shelfPos);
    else {
      bk.tPos.copy(pulled(bk));
      later(() => {
        if (st.held !== bk) {
          bk.tPos.copy(bk.shelfPos);
          poke();
        }
      }, 520);
    }
    if (st.held === bk) {
      st.held = null;
      st.flipping = null;
      setCassette(null);
    }
  }
  function go(stage: Stage) {
    const bk = st.held;
    if (stage === "room" || stage === "shelf") {
      if (bk) putBack(bk);
      st.stage = stage;
      camT = CAM[stage];
      canvas.style.cursor = "default";
    } else if (stage === "open" && bk) {
      st.stage = "open";
      st.cardOut = false;
      bk.tCardY = bk.cardBaseY;
      bk.tCover = -Math.PI;
      ensurePages(bk);
      showSpread(bk, st.spread);
      bk.leftP.visible = bk.rightP.visible = true;
      heldPose(bk);
      camT = CAM.open;
      canvas.style.cursor = "default";
    } else if (stage === "held" && bk) {
      st.stage = "held";
      bk.tCover = 0;
      st.rotY = 0;
      st.snap = 0;
      st.snapping = true;
      st.tilt = 0;
      st.flipping = null;
      bk.leaf.visible = false;
      heldPose(bk);
      camT = st.cardOut ? CAM.card : CAM.held;
      later(
        () => {
          if (st.stage === "held") bk.leftP.visible = bk.rightP.visible = false;
        },
        reduced ? 0 : 700,
      );
      canvas.style.cursor = "grab";
    }
    poke(2600);
    emit();
  }
  const nearestBack = (a: number) => Math.PI + Math.round((a - Math.PI) / TAU) * TAU;
  function toggleCard() {
    const bk = st.held;
    if (!bk || st.stage !== "held") return;
    st.cardOut = !st.cardOut;
    bk.tCardY = bk.cardBaseY + (st.cardOut ? 0.068 : 0);
    if (st.cardOut) {
      st.snapping = true;
      st.snap = nearestBack(st.rotY);
    }
    camT = st.cardOut ? CAM.card : CAM.held;
    poke(2400);
    emit();
  }
  function flip(dir: 1 | -1) {
    const bk = st.held;
    if (!bk || st.stage !== "open" || st.flipping || !bk.pages) return;
    const n = st.spread + dir;
    if (n < 0 || n >= bk.pages.length / 2) return;
    const cur = st.spread;
    if (dir > 0) {
      setMap(bk.leafFM, pageTex(bk, cur * 2 + 1));
      setMap(bk.leafBM, pageTex(bk, n * 2));
      setMap(bk.rightM, pageTex(bk, n * 2 + 1));
      bk.leaf.rotation.y = 0;
    } else {
      setMap(bk.leafBM, pageTex(bk, cur * 2));
      setMap(bk.leafFM, pageTex(bk, n * 2 + 1));
      setMap(bk.leftM, pageTex(bk, n * 2));
      bk.leaf.rotation.y = -Math.PI;
    }
    bk.leaf.visible = true;
    st.flipping = { dir, t: 0, to: n };
    poke(3000);
    emit();
  }

  /* layout: books stand left to right in the order given */
  function layout() {
    const startX = SHELF_START;
    const total = books.reduce((n, bk) => n + bk.Tt + 0.004, 0);
    props.visible = total <= 0.72;
    let x = startX;
    for (const bk of books) {
      bk.shelfPos.set(x + bk.Tt / 2, SHELF_Y + bk.H / 2, SHELF_Z - bk.W / 2);
      x += bk.Tt + 0.004;
      if (bk !== st.held) {
        bk.tPos.copy(bk === st.hover ? lifted(bk) : bk.shelfPos);
        bk.tQuat.copy(bk.shelfQuat);
      }
    }
    bookendR.visible = books.length > 0 && x + 0.1 < -1.25 + BW / 2 - 0.03;
    bookendR.position.x = x + 0.002 - -1.25;
  }
  /** Thickness on the shelf: true to the word count unless the shelf is full. */
  function fitThickness(list: ShelfBook[]) {
    const room = 1.2;
    const want = list.reduce((n, b) => n + b.size.T + 0.004, 0);
    const k = want > room ? Math.max(0.3, (room - list.length * 0.004) / (want - list.length * 0.004)) : 1;
    const out: number[] = [];
    let used = 0;
    for (const b of list) {
      const t = Math.max(0.018, b.size.T * k);
      if (used + t + 0.004 > room + 1e-6) break;
      out.push(t);
      used += t + 0.004;
    }
    return out;
  }

  let drawn = false;
  function setBooks(list: ShelfBook[]) {
    const sizes = fitThickness(list);
    const shown = list.slice(0, sizes.length);
    overflow = list.length - shown.length;
    const keep = new Set(shown.map((b) => b.id));
    for (const bk of books) {
      if (!keep.has(bk.id)) {
        if (st.held === bk) {
          st.held = null;
          st.stage = "shelf";
          camT = CAM.shelf;
          setCassette(null);
        }
        if (st.hover === bk) st.hover = null;
        disposeBook(bk);
        byId.delete(bk.id);
      }
    }
    const next: BK[] = [];
    shown.forEach((b0, i) => {
      // Counts arrive only for the book in focus; a book keeps the last ones it was given.
      const known = byId.get(b0.id)?.b.extras ?? null;
      const b = b0.extras || !known ? b0 : { ...b0, extras: known, ai: b0.ai.kind === "done" && b0.ai.terms === null ? { kind: "done" as const, terms: known.terms } : b0.ai };
      if (b.coverUrl && !covers.has(b.id)) {
        covers.set(b.id, null);
        void loadCover(b.coverUrl).then((c) => {
          if (disposed || !c) return;
          covers.set(b.id, c);
          const cur = byId.get(b.id);
          if (cur) replace(cur, cur.b, cur.Tt);
        });
      }
      const old = byId.get(b.id);
      const sig = signature(b, covers.get(b.id) ?? null, sizes[i]);
      if (old && old.sig === sig) {
        old.b = b;
        next.push(old);
      } else if (old) next.push(replace(old, b, sizes[i]));
      else {
        const bk = buildBook(b, sizes[i]);
        byId.set(b.id, bk);
        next.push(bk);
        bk.group.position.set(0, -2, SHELF_Z);
      }
    });
    books = next;
    layout();
    for (const bk of books) {
      // New books appear on the shelf in place, not flying in from under the floor.
      if (bk.group.position.y < -1) {
        bk.group.position.copy(bk.shelfPos);
        bk.group.quaternion.copy(bk.shelfQuat);
      }
    }
    rebuildPickables();
    // The first draw compiles every shader. Do it now, behind the loader, so the room fades in smoothly.
    if (!drawn) {
      drawn = true;
      renderer.render(scene, camera);
    }
    poke(1200);
    emit();
  }

  /** Swaps a book's meshes for fresh ones (new data or cover), keeping where it is and what it's doing. */
  function replace(old: BK, b: ShelfBook, T_: number) {
    const bk = buildBook(b, T_);
    bk.group.position.copy(old.group.position);
    bk.group.quaternion.copy(old.group.quaternion);
    bk.tPos.copy(old.tPos);
    bk.tQuat.copy(old.tQuat);
    bk.shelfPos.copy(old.shelfPos);
    bk.tCover = old.tCover;
    bk.pivot.rotation.y = old.pivot.rotation.y;
    bk.tCardY = bk.cardBaseY + (old.tCardY - old.cardBaseY);
    bk.card.position.y = bk.cardBaseY + (old.card.position.y - old.cardBaseY);
    disposeBook(old);
    byId.set(b.id, bk);
    books = books.map((x) => (x === old ? bk : x));
    if (st.hover === old) st.hover = bk;
    if (st.held === old) {
      st.held = bk;
      st.flipping = null;
      ensurePages(bk);
      st.spread = Math.min(st.spread, bk.pages!.length / 2 - 1);
      if (st.stage === "open") {
        showSpread(bk, st.spread);
        bk.leftP.visible = bk.rightP.visible = true;
      }
      setCassette(bk);
    }
    rebuildPickables();
    poke(600);
    return bk;
  }

  function setPreview(id: string, paras: PreviewPara[] | undefined) {
    if (previews.get(id) === paras) return;
    previews.set(id, paras);
    const bk = byId.get(id);
    if (!bk) return;
    for (const t of bk.pageTex.values()) freeTex(t);
    bk.pageTex.clear();
    bk.pages = null;
    if (st.held === bk) {
      ensurePages(bk);
      st.flipping = null;
      bk.leaf.visible = false;
      st.spread = Math.min(st.spread, bk.pages!.length / 2 - 1);
      if (st.stage === "open") showSpread(bk, st.spread);
      poke(400);
      emit();
    }
  }

  function setReview(due: number) {
    if (due === reviewDue) return;
    reviewDue = due;
    reviewCard.visible = due > 0;
    freeTex(reviewTex);
    reviewTex = due > 0 ? T(reviewCardTex(due)) : null;
    reviewMat.map = reviewTex;
    reviewMat.needsUpdate = true;
    rebuildPickables();
    poke(300);
  }

  /* pointer */
  function setNdc(e: PointerEvent | WheelEvent) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    st.hx = e.clientX - r.left;
    st.hy = e.clientY - r.top;
  }
  function hit() {
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(pickables, false);
    // The bookcase's hit box encloses the books; a book behind its face still wins.
    return (h.find((x) => x.object.userData.book) ?? h[0])?.object ?? null;
  }
  function setZone(z: Zone | null) {
    if (st.zone === z) return;
    st.zone = z;
    emit();
  }
  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    setNdc(e);
    down = { lx: e.clientX, ly: e.clientY, moved: 0 };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    if (st.stage === "held") canvas.style.cursor = "grabbing";
  }
  function onMove(e: PointerEvent) {
    setNdc(e);
    if (down && st.stage === "held" && st.held) {
      const dx = e.clientX - down.lx;
      const dy = e.clientY - down.ly;
      down.lx = e.clientX;
      down.ly = e.clientY;
      down.moved += Math.abs(dx) + Math.abs(dy);
      if (down.moved > 4) {
        st.snapping = false;
        st.rotY += dx * 0.0105;
        st.tilt = Math.max(-0.5, Math.min(0.5, st.tilt + dy * 0.004));
        st.vel = dx * 0.0105 * 60;
        heldPose(st.held);
        poke();
      }
      return;
    }
    if (e.pointerType === "touch") return;
    const o = hit();
    const zone = (o?.userData.zone as Zone | undefined) ?? null;
    if (st.stage === "room" || st.stage === "shelf") {
      setHover(o && o.userData.book ? (o.userData.book as BK) : null);
      setZone(st.hover ? null : zone === "bookcase" && st.stage === "shelf" ? null : zone);
      if (zone && !st.hover) canvas.style.cursor = "pointer";
      if (st.hover) emit();
    } else if (st.stage === "held") {
      const onCard = !!o && o === st.held?.card;
      setZone(zone === "walkman" || zone === "review" ? zone : null);
      canvas.style.cursor = onCard || zone === "walkman" || zone === "review" ? "pointer" : "grab";
    }
  }
  function onUp(e: PointerEvent) {
    const d = down;
    down = null;
    if (!d) return;
    setNdc(e);
    if (st.stage === "held" && d.moved > 4) {
      st.snapping = true;
      st.snap = snapAngle(st.rotY + st.vel * 0.12);
      st.tilt = 0;
      canvas.style.cursor = "grab";
      poke();
      return;
    }
    const o = hit();
    const zone = o?.userData.zone as Zone | undefined;
    if (zone === "review") return opts.onReview();
    if (st.stage === "room" || st.stage === "shelf") {
      if (o && o.userData.book) pick(o.userData.book as BK);
      else if (zone === "bookcase" && st.stage === "room") go("shelf");
    } else if (st.stage === "held") {
      if (o && st.held && o === st.held.card) toggleCard();
      else if (zone === "walkman" && st.held && st.held.b.audio.kind === "ready") opts.onListen(st.held.id);
      canvas.style.cursor = "grab";
    } else if (st.stage === "open") flip(ndc.x >= 0 ? 1 : -1);
  }
  function onLeave() {
    if (!down && (st.stage === "room" || st.stage === "shelf")) setHover(null);
    setZone(null);
  }
  let wheelIdle: ReturnType<typeof setTimeout> | undefined;
  function onWheel(e: WheelEvent) {
    if (st.stage === "held" && st.held) {
      e.preventDefault();
      st.snapping = false;
      st.rotY += (e.deltaY + e.deltaX) * 0.004;
      heldPose(st.held);
      poke();
      clearTimeout(wheelIdle);
      wheelIdle = setTimeout(() => {
        st.snapping = true;
        st.snap = snapAngle(st.rotY);
        poke();
      }, 160);
    } else if (st.stage === "open") {
      e.preventDefault();
      if (Math.abs(e.deltaY) > 8) flip(e.deltaY > 0 ? 1 : -1);
    }
  }
  function onLost(e: Event) {
    e.preventDefault();
    opts.onError("lost");
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onLeave);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("webglcontextlost", onLost);

  /* loop */
  const tmp = new THREE.Vector3();
  function update(dt: number) {
    const kc = reduced ? 1 : 1 - Math.exp(-dt * 3.0);
    const c = camFor(camT);
    camPos.lerp(c.pos, kc);
    camLook.lerp(c.look, kc);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const bk = st.held;
    if (bk && st.stage === "held" && st.snapping) {
      const ks = reduced ? 1 : 1 - Math.exp(-dt * 7);
      st.rotY += (st.snap - st.rotY) * ks;
      st.tilt += (0 - st.tilt) * ks;
      heldPose(bk);
    }
    if (bk) {
      const f = st.stage === "open" ? "open" : faceOf(st.rotY);
      if (f !== st.face) {
        st.face = f;
        emit();
      }
    }
    for (const b of books) {
      const kb = reduced ? 1 : 1 - Math.exp(-dt * (b === st.held ? 5 : 8));
      b.group.position.lerp(b.tPos, kb);
      b.group.quaternion.slerp(b.tQuat, kb);
      b.pivot.rotation.y += (b.tCover - b.pivot.rotation.y) * (reduced ? 1 : 1 - Math.exp(-dt * 4.5));
      b.card.position.y += (b.tCardY - b.card.position.y) * kb;
      if (b.ribbon) b.ribbon.visible = b === st.held;
    }
    if (st.flipping && bk) {
      const F = st.flipping;
      F.t = Math.min(1, F.t + dt / (reduced ? 0.001 : 0.6));
      const e = F.t < 0.5 ? 2 * F.t * F.t : 1 - Math.pow(-2 * F.t + 2, 2) / 2;
      bk.leaf.rotation.y = F.dir > 0 ? -Math.PI * e : -Math.PI * (1 - e);
      if (F.t >= 1) {
        st.spread = F.to;
        showSpread(bk, st.spread);
        bk.leaf.visible = false;
        st.flipping = null;
        emit();
      }
    }
    const focus = st.stage === "held" || st.stage === "open";
    const kl = reduced ? 1 : 1 - Math.exp(-dt * 3);
    handLight.intensity += ((focus ? HAND : 0) - handLight.intensity) * kl;
    lampSpot.intensity += ((focus ? LAMP * 0.47 : LAMP) - lampSpot.intensity) * kl;
    lampFill.intensity += ((focus ? FILL * 0.46 : FILL) - lampFill.intensity) * kl;
    handLight.position.copy(camera.position).add(tmp.set(0.45, 0.55, 0.1));
    handLight.target.position.copy(R);
  }
  function frameFn(now: number) {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    renderer.render(scene, camera);
    if (now < active || down || st.flipping) raf = requestAnimationFrame(frameFn);
  }
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 52 : 36;
    camScale = w / h < 0.75 ? 1.18 : 1;
    camera.updateProjectionMatrix();
    poke(600);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  camPos.copy(camFor(CAM.room).pos);
  camLook.copy(camFor(CAM.room).look);
  update(0.016);
  renderer.render(scene, camera);
  poke(1200);
  emit();

  function hoverStep(dir: 1 | -1) {
    if (!books.length) return null;
    if (st.stage === "room") go("shelf");
    const i = st.hover ? books.indexOf(st.hover) : dir > 0 ? -1 : books.length;
    const next = books[Math.max(0, Math.min(books.length - 1, i + dir))];
    labelAt(next);
    if (st.hover === next) emit();
    else setHover(next);
    return next.id;
  }

  return {
    setBooks,
    setPreview,
    setReview,
    go,
    flip,
    toggleCard,
    turn(d) {
      if (st.stage === "held" && st.held) {
        st.snapping = true;
        st.snap = snapAngle(Math.round(st.rotY / HALF) * HALF + d * HALF);
        poke();
      }
    },
    setFace(f) {
      if (st.stage !== "held" || !st.held) return;
      const tgt = { front: 0, spine: HALF, back: Math.PI, edge: Math.PI * 1.5 - EDGE_TILT }[f];
      const k = Math.round((st.rotY - tgt) / TAU);
      st.snapping = true;
      st.snap = tgt + k * TAU;
      poke();
    },
    pick(id) {
      const bk = byId.get(id);
      if (bk) pick(bk);
    },
    hoverStep,
    hoverId(id) {
      const bk = id ? (byId.get(id) ?? null) : null;
      if (bk) labelAt(bk);
      setHover(bk);
    },
    settleOnPage() {
      if (!st.held) return 0;
      if (st.stage !== "open") {
        st.spread = 0;
        go("open");
        return reduced ? 0 : 700;
      }
      return reduced ? 0 : 250;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      clearTimeout(wheelIdle);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onLeave);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onLost);
      for (const bk of books) disposeBook(bk);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const x of mats) x.dispose();
      });
      for (const x of [endM, edgeVM, edgeHM, paperM, ribbonM, pocketM, invisible, ...tabMs]) x.dispose();
      for (const t of allTex) t.dispose();
      allTex.clear();
      renderer.dispose();
    },
  };
}

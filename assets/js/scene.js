/*
  The chip. A BGA package with a lid, a RV32I die whose floorplan lights up stage by stage,
  four metal layers carrying signal pulses, and a ball grid underneath.
  Scroll position (window.stack.p from site.js) picks a pose between keyframes.
*/
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/RoundedBoxGeometry.js";

const root = document.documentElement;
const canvas = document.getElementById("stage");
const stack = window.stack || { p: 0, stage: 0, reduce: false };

// Die floorplan in die-texture coordinates (u right, v down), 0..1.
const REGIONS = [
  { id: "imem", label: "IMEM", r: [0.08, 0.08, 0.4, 0.38], kind: "sram" },
  { id: "fetch", label: "FETCH / PC", r: [0.08, 0.4, 0.4, 0.56], kind: "logic" },
  { id: "decode", label: "DECODE + CTRL", r: [0.42, 0.08, 0.62, 0.56], kind: "logic" },
  { id: "regfile", label: "REGFILE x32", r: [0.64, 0.08, 0.92, 0.36], kind: "sram" },
  { id: "alu", label: "ALU", r: [0.64, 0.38, 0.92, 0.66], kind: "logic" },
  { id: "dmem", label: "DMEM", r: [0.08, 0.58, 0.56, 0.92], kind: "sram" },
  { id: "wb", label: "WRITEBACK", r: [0.58, 0.68, 0.92, 0.92], kind: "logic" },
];

const STAGES = [
  { color: "#6fe3e1", regions: ["imem", "fetch"] },
  { color: "#9b8cff", regions: ["decode", "regfile"] },
  { color: "#ff7ab6", regions: ["alu"] },
  { color: "#f2c14e", regions: ["dmem"] },
  { color: "#7cf29a", regions: ["wb", "regfile"] },
];

// One pose per page layer: hero, about, rv32i, work, skills, contact.
//   lift   lid: 0 seated, 0.5 hovering, 1 gone
//   spread metal layers pulled apart
//   metal  metal layer visibility
//   focus  floorplan highlight strength
//   spin   idle rotation weight
const KEYS = [
  { cam: [5.4, 4.1, 6.6], look: [0, 0.15, 0], lift: 0, spread: 0, metal: 1, focus: 0, spin: 1, accent: "#9b8cff" },
  { cam: [-6.2, 3.8, 6.0], look: [0, 0.75, 0], lift: 0.5, spread: 0.3, metal: 1, focus: 0, spin: 0.25, accent: "#6fe3e1" },
  { cam: [0.0, 5.6, 2.6], look: [0, 0, 0.1], lift: 1, spread: 0, metal: 0.05, focus: 1, spin: 0, accent: "#6fe3e1" },
  { cam: [6.4, 2.2, 4.2], look: [0, 0.9, 0], lift: 1, spread: 1, metal: 1, focus: 0.25, spin: 0.15, accent: "#e3995b" },
  { cam: [2.3, 1.7, 2.9], look: [0.1, 0.25, -0.1], lift: 1, spread: 0.55, metal: 0.45, focus: 0.6, spin: 0, accent: "#c86bff" },
  { cam: [0, 4.5, 9.4], look: [0, 0.1, 0], lift: 0, spread: 0, metal: 1, focus: 0, spin: 1, accent: "#ffffff" },
];

const DIE = 2.0;
const SUB = 4.0;
const SUB_H = 0.18;
const DIE_H = 0.1;
const DIE_TOP = SUB_H / 2 + DIE_H;

function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function ready() {
  root.classList.add("is-ready");
}

async function main() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (err) {
    root.classList.add("no-webgl");
    ready();
    return;
  }

  // Wait briefly for webfonts so the die labels render in Plex Mono.
  if (document.fonts) {
    await Promise.race([document.fonts.load('600 40px "IBM Plex Mono"'), new Promise((r) => setTimeout(r, 1200))]).catch(() => {});
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  function canvasTexture(size, draw, srgb = true) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  }

  // ---------- Textures ----------

  const dieTex = canvasTexture(2048, (g, S) => {
    const rand = rng(7);
    g.fillStyle = "#100c1f";
    g.fillRect(0, 0, S, S);

    // Thin-film sheen across the die
    const sheen = g.createLinearGradient(0, 0, S, S);
    sheen.addColorStop(0, "rgba(111,227,225,0.22)");
    sheen.addColorStop(0.5, "rgba(155,140,255,0.18)");
    sheen.addColorStop(1, "rgba(255,122,182,0.2)");
    g.fillStyle = sheen;
    g.fillRect(0, 0, S, S);

    // Standard-cell rows over the whole core
    const rowH = S * 0.0065;
    for (let y = S * 0.06; y < S * 0.94; y += rowH) {
      let x = S * 0.06;
      while (x < S * 0.94) {
        const w = 3 + rand() * 16;
        const hue = 185 + 120 * ((x + y) / (2 * S)) + rand() * 25;
        g.fillStyle = `hsla(${hue}, 70%, ${30 + rand() * 30}%, ${0.35 + rand() * 0.4})`;
        g.fillRect(x, y + 1, w, rowH - 2);
        x += w + 1 + (rand() < 0.08 ? rand() * 20 : 0);
      }
    }

    // Pad ring
    g.fillStyle = "#c9a24a";
    const pads = 36;
    const pad = S * 0.016;
    for (let k = 0; k < pads; k++) {
      const t = S * 0.05 + (k / (pads - 1)) * S * 0.9 - pad / 2;
      g.fillRect(t, S * 0.012, pad, pad);
      g.fillRect(t, S - S * 0.012 - pad, pad, pad);
      g.fillRect(S * 0.012, t, pad, pad);
      g.fillRect(S - S * 0.012 - pad, t, pad, pad);
    }

    // Macro blocks
    for (const reg of REGIONS) {
      const [u0, v0, u1, v1] = reg.r;
      const x = u0 * S;
      const y = v0 * S;
      const w = (u1 - u0) * S;
      const h = (v1 - v0) * S;
      g.fillStyle = "rgba(8,6,20,0.88)";
      g.fillRect(x, y, w, h);

      if (reg.kind === "sram") {
        const cell = S * 0.009;
        for (let cy = y + S * 0.05; cy < y + h - cell; cy += cell) {
          for (let cx = x + S * 0.012; cx < x + w - cell; cx += cell) {
            const hue = 200 + ((cx - x) / w) * 80;
            g.fillStyle = `hsla(${hue}, 60%, ${38 + rand() * 14}%, 0.75)`;
            g.fillRect(cx + 1, cy + 1, cell - 2, cell - 2);
          }
        }
      } else {
        for (let k = 0; k < (w * h) / 260; k++) {
          const cx = x + S * 0.012 + rand() * (w - S * 0.03);
          const cy = y + S * 0.05 + rand() * (h - S * 0.065);
          const hue = 260 + rand() * 80;
          g.fillStyle = `hsla(${hue}, 65%, ${35 + rand() * 25}%, 0.7)`;
          g.fillRect(cx, cy, 2 + rand() * 9, 2 + rand() * 5);
        }
      }

      g.strokeStyle = "rgba(236,234,245,0.4)";
      g.lineWidth = 3;
      g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      g.fillStyle = "rgba(236,234,245,0.92)";
      g.font = `600 ${Math.round(S * 0.024)}px "IBM Plex Mono", monospace`;
      g.textBaseline = "top";
      g.fillText(reg.label, x + S * 0.012, y + S * 0.012);
    }

    g.fillStyle = "rgba(236,234,245,0.55)";
    g.font = `500 ${Math.round(S * 0.016)}px "IBM Plex Mono", monospace`;
    g.fillText("SD-RV32I  rev A", S * 0.6, S * 0.635);
  });

  const metalTex = [0, 1, 2, 3].map((layer) =>
    canvasTexture(1024, (g, S) => {
      const rand = rng(31 + layer * 11);
      const vertical = layer % 2 === 1;
      const pitch = [7, 10, 16, 34][layer];
      const width = [2, 3, 6, 18][layer];
      g.clearRect(0, 0, S, S);
      g.fillStyle = layer === 3 ? "rgba(225,230,240,0.95)" : "rgba(232,150,95,0.95)";
      for (let lane = pitch; lane < S - pitch; lane += pitch) {
        let pos = rand() * 30;
        while (pos < S) {
          const len = 30 + rand() * (layer === 3 ? 900 : 260);
          if (vertical) g.fillRect(lane, pos, width, len);
          else g.fillRect(pos, lane, len, width);
          pos += len + 8 + rand() * 60;
        }
      }
    })
  );

  const substrateTex = canvasTexture(1024, (g, S) => {
    const rand = rng(99);
    g.fillStyle = "#123129";
    g.fillRect(0, 0, S, S);
    g.strokeStyle = "rgba(214,170,80,0.55)";
    g.lineWidth = 2;
    const c = S / 2;
    for (let k = 0; k < 220; k++) {
      const a = (k / 220) * Math.PI * 2;
      const r0 = S * 0.27;
      const x0 = c + Math.cos(a) * r0;
      const y0 = c + Math.sin(a) * r0;
      const x1 = c + Math.cos(a) * S * (0.4 + rand() * 0.08);
      const y1 = c + Math.sin(a) * S * (0.4 + rand() * 0.08);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo((x0 + x1) / 2, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    g.fillStyle = "rgba(236,234,245,0.5)";
    g.font = `500 ${Math.round(S * 0.022)}px "IBM Plex Mono", monospace`;
    g.fillText("BGA-256", S * 0.05, S * 0.95);
  });

  const lidTex = canvasTexture(1024, (g, S) => {
    const rand = rng(5);
    g.clearRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.06})`;
      g.fillRect(0, y, S, 1);
    }
    g.fillStyle = "rgba(20,22,40,0.75)";
    g.font = `800 ${Math.round(S * 0.11)}px "Anybody", sans-serif`;
    g.fillText("SD-RV32I", S * 0.08, S * 0.3);
    g.font = `500 ${Math.round(S * 0.042)}px "IBM Plex Mono", monospace`;
    g.fillText("RISC-V single-core processor", S * 0.08, S * 0.4);
    g.fillText("Verilog / FPGA proven", S * 0.08, S * 0.46);
    g.fillText("S. DRAVERIYA  2026", S * 0.08, S * 0.86);
    g.beginPath();
    g.arc(S * 0.86, S * 0.84, S * 0.03, 0, Math.PI * 2);
    g.fill();
  });

  const dotTex = canvasTexture(64, (g, S) => {
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  });

  // ---------- Geometry ----------

  const chip = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.add(chip);
  scene.add(tilt);

  const flatPlane = (w, d) => {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    return geo;
  };

  // Substrate
  const substrate = new THREE.Mesh(
    new RoundedBoxGeometry(SUB, SUB_H, SUB, 3, 0.04),
    new THREE.MeshStandardMaterial({ color: "#163a30", roughness: 0.55, metalness: 0.15 })
  );
  chip.add(substrate);
  const subTop = new THREE.Mesh(
    flatPlane(SUB - 0.08, SUB - 0.08),
    new THREE.MeshStandardMaterial({ map: substrateTex, roughness: 0.5, metalness: 0.3 })
  );
  subTop.position.y = SUB_H / 2 + 0.001;
  chip.add(subTop);

  // Ball grid
  const ballGeo = new THREE.SphereGeometry(0.07, 14, 10);
  const ballMat = new THREE.MeshStandardMaterial({ color: "#d9dce6", metalness: 1, roughness: 0.25 });
  const grid = 15;
  const pitch = 0.24;
  const balls = new THREE.InstancedMesh(ballGeo, ballMat, grid * grid);
  const m4 = new THREE.Matrix4();
  for (let i = 0, n = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++, n++) {
      m4.makeTranslation((i - (grid - 1) / 2) * pitch, -SUB_H / 2 - 0.045, (j - (grid - 1) / 2) * pitch);
      balls.setMatrixAt(n, m4);
    }
  }
  chip.add(balls);

  // Decoupling caps around the edge
  const capGeo = new THREE.BoxGeometry(0.16, 0.07, 0.08);
  const capMat = new THREE.MeshStandardMaterial({ color: "#b48a5a", roughness: 0.6 });
  const capEndMat = new THREE.MeshStandardMaterial({ color: "#e0e3ea", metalness: 1, roughness: 0.3 });
  const capSpots = [
    [-1.75, -1.2], [-1.75, -0.6], [-1.75, 0.6], [-1.75, 1.2],
    [1.75, -1.2], [1.75, 0], [1.75, 1.2], [-0.9, 1.75], [0.3, 1.75], [0.9, -1.75],
  ];
  for (const [x, z] of capSpots) {
    const cap = new THREE.Group();
    const body = new THREE.Mesh(capGeo, capMat);
    const endA = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.075, 0.085), capEndMat);
    const endB = endA.clone();
    endA.position.x = -0.08;
    endB.position.x = 0.08;
    cap.add(body, endA, endB);
    cap.position.set(x, SUB_H / 2 + 0.035, z);
    if (Math.abs(z) > 1.7) cap.rotation.y = Math.PI / 2;
    chip.add(cap);
  }

  // Die
  const dieSide = new THREE.MeshStandardMaterial({ color: "#2a2540", metalness: 0.7, roughness: 0.35 });
  const dieTop = new THREE.MeshStandardMaterial({
    map: dieTex,
    emissiveMap: dieTex,
    emissive: new THREE.Color("#ffffff"),
    emissiveIntensity: 0.3,
    metalness: 0.55,
    roughness: 0.28,
  });
  const die = new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE_H, DIE), [dieSide, dieSide, dieTop, dieSide, dieSide, dieSide]);
  die.position.y = SUB_H / 2 + DIE_H / 2;
  chip.add(die);

  // Floorplan highlight overlays: inactive blocks dim, the active stage glows.
  const overlays = REGIONS.map((reg) => {
    const [u0, v0, u1, v1] = reg.r;
    const geo = flatPlane((u1 - u0) * DIE, (v1 - v0) * DIE);
    const dim = new THREE.MeshBasicMaterial({ color: "#05040c", transparent: true, opacity: 0, depthWrite: false });
    const glow = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const x = ((u0 + u1) / 2 - 0.5) * DIE;
    const z = ((v0 + v1) / 2 - 0.5) * DIE;
    const dimMesh = new THREE.Mesh(geo, dim);
    const glowMesh = new THREE.Mesh(geo, glow);
    dimMesh.position.set(x, DIE_TOP + 0.002, z);
    glowMesh.position.set(x, DIE_TOP + 0.003, z);
    chip.add(dimMesh, glowMesh);
    return { id: reg.id, dim, glow, level: 0 };
  });

  // Metal layers with travelling signal pulses
  const metalColors = ["#ff9a5c", "#ffb27a", "#ff7ab6", "#cfe8ff"];
  const metals = metalTex.map((tex, k) => {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.02,
      metalness: 0.5,
      roughness: 0.5,
      emissive: new THREE.Color(metalColors[k]),
      emissiveMap: tex,
      emissiveIntensity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(flatPlane(DIE * 0.97, DIE * 0.97), mat);
    group.add(plane);

    const count = 46;
    const pos = new Float32Array(count * 3);
    const data = [];
    const rand = rng(200 + k);
    for (let n = 0; n < count; n++) {
      data.push({ lane: (rand() - 0.5) * DIE * 0.9, t: rand(), speed: 0.12 + rand() * 0.35 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: dotTex,
        color: metalColors[k],
        size: 0.09,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    group.add(pts);
    chip.add(group);
    return { group, mat, pts, data, vertical: k % 2 === 1 };
  });

  // Lid (integrated heat spreader)
  const lid = new THREE.Group();
  const lidBody = new THREE.Mesh(
    new RoundedBoxGeometry(3.05, 0.13, 3.05, 4, 0.05),
    new THREE.MeshStandardMaterial({ color: "#c9ccd6", metalness: 1, roughness: 0.32 })
  );
  const lidPrint = new THREE.Mesh(
    flatPlane(3.0, 3.0),
    new THREE.MeshStandardMaterial({ map: lidTex, transparent: true, metalness: 0.6, roughness: 0.5 })
  );
  lidPrint.position.y = 0.066;
  lid.add(lidBody, lidPrint);
  chip.add(lid);
  const LID_Y = DIE_TOP + 0.03 + 0.065;

  // Dust field
  const dustCount = 700;
  const dustPos = new Float32Array(dustCount * 3);
  const drand = rng(4242);
  for (let n = 0; n < dustCount; n++) {
    dustPos[n * 3] = (drand() - 0.5) * 28;
    dustPos[n * 3 + 1] = (drand() - 0.5) * 16;
    dustPos[n * 3 + 2] = (drand() - 0.5) * 28;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    map: dotTex,
    color: "#eceaf5",
    size: 0.06,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // Lights
  const key = new THREE.DirectionalLight("#ffffff", 1.6);
  key.position.set(4, 8, 5);
  scene.add(key);
  const rim = new THREE.PointLight("#9b8cff", 40, 0, 2);
  rim.position.set(-4, 3, -4);
  scene.add(rim);
  const under = new THREE.PointLight("#6fe3e1", 12, 0, 2);
  under.position.set(2, -2.5, 2);
  scene.add(under);

  // ---------- Animation state ----------

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (t) => t * t * (3 - 2 * t);

  const keyCols = KEYS.map((k) => new THREE.Color(k.accent));
  const state = {
    cam: new THREE.Vector3(...KEYS[0].cam),
    look: new THREE.Vector3(...KEYS[0].look),
    lift: 0,
    spread: 0,
    metal: 1,
    focus: 0,
    spin: 1,
    accent: keyCols[0].clone(),
  };
  const target = { cam: new THREE.Vector3(), look: new THREE.Vector3(), accent: new THREE.Color() };
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const stageColor = new THREE.Color();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let spinAngle = -0.35;
  let intro = stack.reduce ? 1 : 0;
  let width = 0;
  let height = 0;

  function poseAt(p) {
    const i = Math.min(Math.floor(p), KEYS.length - 2);
    // Hold each pose for a moment, then move.
    const f = ease(clamp((p - i - 0.12) / 0.76));
    const a = KEYS[i];
    const b = KEYS[i + 1];
    target.cam.copy(tmpA.fromArray(a.cam)).lerp(tmpB.fromArray(b.cam), f);
    target.look.copy(tmpA.fromArray(a.look)).lerp(tmpB.fromArray(b.look), f);
    target.accent.copy(keyCols[i]).lerp(keyCols[i + 1], f);
    for (const k of ["lift", "spread", "metal", "focus", "spin"]) target[k] = lerp(a[k], b[k], f);
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // On wide screens the copy sits on the left, so push the chip to the right.
    if (width >= 860) camera.setViewOffset(width, height, -width * 0.2, 0, width, height);
    else camera.setViewOffset(width, height, 0, height * 0.26, width, height);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  window.addEventListener(
    "pointermove",
    (e) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true }
  );

  const clock = new THREE.Clock();
  let first = true;

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    const k = stack.reduce ? 1 : 1 - Math.exp(-dt * 5);

    poseAt(stack.p);
    state.cam.lerp(target.cam, k);
    state.look.lerp(target.look, k);
    state.accent.lerp(target.accent, k);
    for (const key of ["lift", "spread", "metal", "focus", "spin"]) state[key] = lerp(state[key], target[key], k);

    // Page-load moment: the stack drops together and the lid lands.
    if (intro < 1) intro = Math.min(1, intro + dt / 2.2);
    const introOpen = 1 - (1 - Math.pow(1 - intro, 3));
    const spread = Math.max(state.spread, introOpen * 1.5);
    const lift = Math.max(state.lift, introOpen * 0.6);

    // Camera: further back on tall, narrow screens.
    const aspect = width / height;
    const back = aspect < 0.8 ? 1.75 : aspect < 1.2 ? 1.3 : 1;
    camera.position.copy(state.cam).sub(state.look).multiplyScalar(back).add(state.look);
    camera.lookAt(state.look);

    // Idle spin that unwinds to a readable angle when a pose needs it.
    if (!stack.reduce) spinAngle += dt * 0.22 * state.spin;
    const home = Math.round(spinAngle / (Math.PI * 2)) * Math.PI * 2;
    spinAngle = lerp(spinAngle, home, (1 - state.spin) * (1 - Math.exp(-dt * 3)));
    chip.rotation.y = spinAngle;

    // Pointer tilt
    pointer.x = lerp(pointer.x, pointer.tx, 1 - Math.exp(-dt * 4));
    pointer.y = lerp(pointer.y, pointer.ty, 1 - Math.exp(-dt * 4));
    const sway = stack.reduce ? 0 : 1 - state.focus * 0.8;
    tilt.rotation.x = pointer.y * 0.12 * sway;
    tilt.rotation.z = -pointer.x * 0.1 * sway;
    tilt.position.y = stack.reduce ? 0 : Math.sin(time * 0.8) * 0.04 * state.spin;

    // Lid
    const liftCurve = Math.pow(lift, 1.6);
    lid.position.y = LID_Y + liftCurve * 5.5;
    lid.rotation.x = Math.sin(lift * Math.PI) * -0.45;
    lid.rotation.z = Math.sin(lift * Math.PI) * 0.12;
    lid.visible = lift < 0.995;

    // Metal stack
    metals.forEach((m, n) => {
      m.group.position.y = DIE_TOP + 0.006 + n * 0.004 + spread * (n + 1) * 0.42;
      const vis = state.metal * (0.25 + 0.75 * clamp(spread * 2.5));
      m.mat.opacity = vis;
      m.mat.visible = vis > 0.01;
      m.mat.emissiveIntensity = 0.2 + 0.5 * clamp(spread);
      m.pts.material.opacity = vis * clamp(spread * 3);
      const arr = m.pts.geometry.attributes.position.array;
      const half = DIE * 0.47;
      m.data.forEach((d, j) => {
        if (!stack.reduce) d.t = (d.t + dt * d.speed) % 1;
        const along = (d.t * 2 - 1) * half;
        arr[j * 3] = m.vertical ? d.lane : along;
        arr[j * 3 + 1] = 0.01;
        arr[j * 3 + 2] = m.vertical ? along : d.lane;
      });
      m.pts.geometry.attributes.position.needsUpdate = true;
    });

    // Floorplan stage highlight
    const stage = STAGES[stack.stage] || STAGES[0];
    stageColor.set(stage.color);
    const pulse = stack.reduce ? 1 : 0.8 + 0.2 * Math.sin(time * 6);
    overlays.forEach((o) => {
      const on = stage.regions.includes(o.id) ? 1 : 0;
      o.level = lerp(o.level, on, 1 - Math.exp(-dt * 8));
      o.glow.color.copy(stageColor);
      o.glow.opacity = o.level * state.focus * 0.75 * pulse;
      o.dim.opacity = (1 - o.level) * state.focus * 0.55;
    });
    dieTop.emissiveIntensity = 0.22 + state.focus * 0.25;

    // Lights and dust follow the layer accent
    rim.color.copy(state.accent);
    under.color.copy(state.accent);
    const gold = clamp(stack.p - (KEYS.length - 2));
    dustMat.color.set("#eceaf5").lerp(state.accent, 0.35);
    dustMat.opacity = 0.45 * (1 - gold * 0.7);
    if (!stack.reduce) dust.rotation.y = time * 0.01;

    renderer.render(scene, camera);
    if (first) {
      first = false;
      ready();
    }
  }

  renderer.setAnimationLoop(tick);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
    } else {
      clock.getDelta();
      renderer.setAnimationLoop(tick);
    }
  });
}

main().catch((err) => {
  console.error(err);
  root.classList.add("no-webgl");
  ready();
});

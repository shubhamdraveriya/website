/*
  Scroll choreography for the page chrome.
  Publishes window.stack = { p, stage, reduce } which scene.js reads every frame:
    p      continuous layer index (0 = hero ... n-1 = contact)
    stage  which RV32I stage is lit (0..4)
*/
(() => {
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const layers = [...document.querySelectorAll(".layer")];
  const colors = layers.map((el) => hexToRgb(el.dataset.bg));
  const accents = ["#9b8cff", "#6fe3e1", "#6fe3e1", "#e3995b", "#c86bff", "#1d1606"];
  const navLinks = [...document.querySelectorAll(".nav a, .gauge a")];
  const stretchers = layers.map((el) => el.querySelector(".stretch"));

  const stack = (window.stack = { p: 0, stage: 0, reduce, count: layers.length });

  let anchors = [];
  let last = {};

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * (3 - 2 * t);

  // Keyframe i is reached when layer i is centred in the viewport.
  function measure() {
    const vh = window.innerHeight;
    const max = Math.max(1, document.documentElement.scrollHeight - vh);
    anchors = layers.map((el) => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      return clamp(top + el.offsetHeight / 2 - vh / 2, 0, max);
    });
    anchors[0] = 0;
    anchors[anchors.length - 1] = max;
  }

  function progressAt(y) {
    for (let i = 0; i < anchors.length - 1; i++) {
      if (y < anchors[i + 1]) {
        const span = Math.max(1, anchors[i + 1] - anchors[i]);
        return i + clamp((y - anchors[i]) / span);
      }
    }
    return anchors.length - 1;
  }

  function set(prop, value) {
    if (last[prop] !== value) {
      last[prop] = value;
      root.style.setProperty(prop, value);
    }
  }

  function frame() {
    const y = window.scrollY;
    const p = progressAt(y);
    stack.p = p;

    // Background: hold each layer colour, then cross-fade between neighbours.
    const i = Math.min(Math.floor(p), layers.length - 2);
    const f = smooth(clamp((p - i - 0.25) / 0.5));
    const a = colors[i];
    const b = colors[i + 1];
    const mix = a.map((c, k) => Math.round(c + (b[k] - c) * f));
    set("--bg", `rgb(${mix.join(",")})`);
    set("--accent", accents[Math.round(p)]);

    const total = layers.length - 1;
    set("--progress", (p / total).toFixed(4));
    set("--gp", (p / total).toFixed(4));

    // The name condenses as the lid comes off.
    set("--hw", (125 - 65 * clamp(p)).toFixed(1));

    // Section headings widen into place as their layer reaches the centre.
    stretchers.forEach((el, k) => {
      if (!el) return;
      const near = smooth(clamp(1 - Math.abs(p - k) * 1.4));
      const w = (62 + 50 * near).toFixed(1);
      if (el.dataset.w !== w) {
        el.dataset.w = w;
        el.style.setProperty("--w", w);
      }
    });

    const current = Math.round(p);
    if (last.current !== current) {
      last.current = current;
      const id = layers[current].id;
      navLinks.forEach((link) => {
        link.setAttribute("aria-current", link.getAttribute("href") === `#${id}` ? "true" : "false");
      });
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", layers[current].dataset.bg);
    }

    root.classList.toggle("on-gold", p > layers.length - 1.6);
    root.classList.toggle("is-scrolled", y > 24);

    requestAnimationFrame(frame);
  }

  // ---------- RV32I stage walkthrough ----------

  const stageButtons = [...document.querySelectorAll(".stage")];
  const note = document.querySelector(".pipe-note");
  const notes = [
    "The program counter drives instruction memory and a 32-bit instruction comes back.",
    "Opcode and funct fields set the control lines, and rs1 and rs2 are read from the register file.",
    "The ALU computes the result, or the branch and jump target.",
    "Loads and stores reach data memory. Everything else passes straight through.",
    "The result is written into rd and the PC moves on to the next instruction.",
  ];
  let pausedUntil = 0;

  function showStage(n) {
    stack.stage = n;
    stageButtons.forEach((btn, k) => {
      btn.classList.toggle("is-active", k === n);
      btn.setAttribute("aria-pressed", k === n ? "true" : "false");
    });
    if (note) note.textContent = notes[n];
  }

  stageButtons.forEach((btn, k) => {
    btn.addEventListener("click", () => {
      pausedUntil = performance.now() + 8000;
      showStage(k);
    });
  });

  if (!reduce) {
    setInterval(() => {
      const nearDie = Math.abs(stack.p - 2) < 0.75;
      if (nearDie && performance.now() > pausedUntil && !document.hidden) {
        showStage((stack.stage + 1) % stageButtons.length);
      }
    }, 1500);
  }

  showStage(0);
  measure();
  window.addEventListener("resize", measure);
  window.addEventListener("load", measure);
  if ("ResizeObserver" in window) new ResizeObserver(measure).observe(document.querySelector("main"));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  requestAnimationFrame(frame);

  // If WebGL never reports in, still reveal the page.
  setTimeout(() => root.classList.add("is-ready"), 4000);
})();

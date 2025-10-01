/* ========= CONFIG ========= */
// Replace with your deployed Cloud Function URL
const VISION_FN_URL =
  "https://us-central1-api-project-684372428277.cloudfunctions.net/ocrHttp";

/* ========= ELEMENTS ========= */
const ta = document.getElementById("cardInput");
const renderBtn = document.getElementById("renderBtn");
const examplesBtn = document.getElementById("examplesBtn");
const scanBtn = document.getElementById("scanBtn");
const CANVAS = document.getElementById("cardCanvas");

/* ========= RENDERING ENGINE (unchanged logic that already works well) ========= */
const W = CANVAS.width; // 360
const H = CANVAS.height; // 528

const suitChar = (s) =>
  ({ clubs: "♣", spades: "♠", hearts: "♥", diamonds: "♦" }[
    (s || "").toLowerCase()
  ] || "?");

const isRed = (s) =>
  (s || "").toLowerCase() === "hearts" ||
  (s || "").toLowerCase() === "diamonds";

/* Base 240x336 grid → scale up to canvas */
const BASE_W = 240,
  BASE_H = 336;
const SCALE = Math.min(W / BASE_W, H / BASE_H);
const S = (x) => x * SCALE;
const layoutScaled = (list) => list.map(([x, y]) => [S(x), S(y)]);

const LAYOUTS = (() => {
  const B = {
    2: [
      [120, 70],
      [120, 266],
    ],
    3: [
      [120, 70],
      [120, 168],
      [120, 266],
    ],
    4: [
      [72, 86],
      [168, 86],
      [72, 250],
      [168, 250],
    ],
    5: [
      [72, 86],
      [168, 86],
      [120, 168],
      [72, 250],
      [168, 250],
    ],
    6: [
      [72, 86],
      [168, 86],
      [72, 168],
      [168, 168],
      [72, 250],
      [168, 250],
    ],
    7: [
      [72, 86],
      [168, 86],
      [72, 168],
      [168, 168],
      [72, 250],
      [168, 250],
      [120, 140],
    ],
    8: [
      [72, 86],
      [168, 86],
      [72, 168],
      [168, 168],
      [72, 250],
      [168, 250],
      [120, 115],
      [120, 221],
    ],
    9: [
      [72, 86],
      [168, 86],
      [72, 168],
      [168, 168],
      [72, 250],
      [168, 250],
      [120, 115],
      [120, 168],
      [120, 221],
    ],
    10: [
      [72, 70],
      [168, 70],
      [72, 130],
      [168, 130],
      [72, 206],
      [168, 206],
      [72, 266],
      [168, 266],
      [120, 95],
      [120, 240],
    ],
    ace: [[120, 168]],
  };
  return Object.fromEntries(
    Object.entries(B).map(([k, v]) => [k, layoutScaled(v)])
  );
})();

const CARD_SCALE = {
  corner: 26,
  cornerSuit: 24,
  pips: 48,
  faceCenter: 104, // bigger centre letter
  cornerPad: 14,
};

/* Examples (file removed, per your decision) */
const EXAMPLES = {
  "Number (8♣)": { rank: "8", suit: "clubs", type: "number" },
  "Face (K♠)": { rank: "king", suit: "spades", type: "face" },
  "Ace (♦)": { rank: "ace", suit: "diamonds", type: "number" },
  Back: {
    type: "back",
    pattern: [
      "· x · x · x · x · x · x",
      "x · x · x · x · x · x ·",
      "· x · x · x · x · x · x",
      "x · x · x · x · x · x ·",
      "· x · x · x · x · x · x",
      "x · x · x · x · x · x ·",
      "· x · x · x · x · x · x",
      "x · x · x · x · x · x ·",
      "· x · x · x · x · x · x",
      "x · x · x · x · x · x ·",
      "· x · x · x · x · x · x",
      "x · x · x · x · x · x ·",
    ],
  },
  Joker: {
    rank: "ERROR",
    suit: "HACKED",
    payload: "<script>alert(JOKER!)</script>",
    type: "joker1",
  },
};

/* --- helpers for text placement --- */
function drawCornerPair(ctx, rankText, suit, color, pad, cornerFont, suitFont) {
  // top-left
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = cornerFont;
  ctx.fillText(rankText, pad, pad);
  const rankW = ctx.measureText(rankText).width;
  ctx.font = suitFont;
  ctx.textAlign = "center";
  ctx.fillText(
    suitChar(suit),
    pad + rankW / 2,
    pad + parseInt(cornerFont, 10) * 0.95
  );
  ctx.restore();

  // bottom-right (rotated)
  ctx.save();
  ctx.translate(W - pad, H - pad);
  ctx.rotate(Math.PI);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = cornerFont;
  ctx.fillText(rankText, 0, 0);
  const rankW2 = ctx.measureText(rankText).width;
  ctx.font = suitFont;
  ctx.textAlign = "center";
  ctx.fillText(suitChar(suit), rankW2 / 2, parseInt(cornerFont, 10) * 0.95);
  ctx.restore();
}

function drawPipsCentered(ctx, layout, suit, color, pipFont) {
  if (!layout || !layout.length) return;
  const xs = layout.map(([x]) => x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const dx = W / 2 - mid;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = pipFont;
  layout.forEach(([x, y]) => ctx.fillText(suitChar(suit), x + dx, y));
  ctx.restore();
}

/* Main render */
function renderCard(json) {
  const card = JSON.parse(json);
  const ctx = CANVAS.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  if (card.type === "back" && Array.isArray(card.pattern)) {
    drawBackPattern(ctx, card.pattern, {
      mode: "cover",
      inset: S(10),
      color: "#0b2f66",
    });
    return;
  }
  if (card.type && String(card.type).toLowerCase().startsWith("joker")) {
    drawJoker(ctx, card);
    return;
  }
  if (String(card.type).toLowerCase() === "face") {
    drawFace(ctx, card.rank, card.suit);
    return;
  }
  if (String(card.type).toLowerCase() === "number") {
    drawNumber(ctx, card.rank, card.suit);
    return;
  }

  ctx.fillStyle = "#333";
  ctx.font = `${Math.round(S(22))}px ui-monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Invalid card", W / 2, H / 2);
}

function drawNumber(ctx, rank, suit) {
  const color = isRed(suit) ? "red" : "black";
  const cornerFont = `${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall = `${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const pipFont = `${Math.round(S(CARD_SCALE.pips))}px ui-monospace`;
  const pad = S(CARD_SCALE.cornerPad);

  const rankText = String(rank)
    .toUpperCase()
    .replace(/^ACE$/, "A")
    .replace(/^A$/, "A");
  drawCornerPair(ctx, rankText, suit, color, pad, cornerFont, suitSmall);

  const key = String(rank).toLowerCase();
  const layout = LAYOUTS[key];
  drawPipsCentered(ctx, layout, suit, color, pipFont);
}

function drawFace(ctx, rank, suit) {
  const color = isRed(suit) ? "red" : "black";
  const cornerFont = `${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall = `${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const centerFont = `${Math.round(S(CARD_SCALE.faceCenter))}px ui-monospace`;
  const pad = S(CARD_SCALE.cornerPad);

  const letter = (rank || "?")[0].toUpperCase().replace("A", "A");
  drawCornerPair(ctx, letter, suit, color, pad, cornerFont, suitSmall);

  ctx.fillStyle = color;
  ctx.font = centerFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, W / 2, H / 2);
}

function drawJoker(ctx, card) {
  ctx.fillStyle = "#900";
  ctx.font = `${Math.round(S(40))}px ui-monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("JOKER", W / 2, H / 2);
  ctx.font = `${Math.round(S(12))}px ui-monospace`;
  if (card.payload) {
    const line = String(card.payload).replace(/\n/g, " ");
    ctx.fillText(line, W / 2, H / 2 + S(34));
  }
}

function drawBackPattern(
  ctx,
  pattern,
  { mode = "cover", inset = S(14), color = "#08326a" } = {}
) {
  const rows = pattern.map((r) => r.trim().split(/\s+/));
  const R = rows.length,
    C = Math.max(...rows.map((r) => r.length));
  const left = inset,
    top = inset,
    right = W - inset,
    bottom = H - inset;
  const Wd = right - left,
    Hd = bottom - top;
  const cell =
    mode === "cover" ? Math.max(Wd / C, Hd / R) : Math.min(Wd / C, Hd / R);
  const totalW = cell * C,
    totalH = cell * R;
  const ox = left + (Wd - totalW) / 2,
    oy = top + (Hd - totalH) / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, cell * 0.08);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const t = rows[r][c];
      const cx = ox + c * cell + cell / 2;
      const cy = oy + r * cell + cell / 2;
      drawToken(ctx, t, cx, cy, cell * 0.5);
    }
  }
  ctx.restore();
}
function drawToken(ctx, t, cx, cy, s) {
  if (t === "x" || t === "X") {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s);
    ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s);
    ctx.lineTo(cx - s, cy + s);
    ctx.stroke();
  } else if (t === "·" || t === ".") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (t === "o" || t === "O") {
    ctx.beginPath();
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (t === "-") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.4, cy);
    ctx.lineTo(cx + s * 0.4, cy);
    ctx.stroke();
  }
}

/* ========= CAMERA OVERLAY ========= */
let overlayEl = null,
  videoEl = null,
  stream = null,
  facing = "environment";

function buildOverlay() {
  if (overlayEl) return overlayEl;

  overlayEl = document.createElement("div");
  overlayEl.id = "camOverlay";
  overlayEl.innerHTML = `
    <div id="camBox">
      <video id="video" playsinline autoplay muted></video>
      <div id="camButtons">
        <button id="flipBtn" class="btn">Flip Camera</button>
        <button id="captureBtn" class="btn primary">Capture</button>
        <button id="cancelBtn" class="btn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  videoEl = overlayEl.querySelector("#video");
  const flipBtn = overlayEl.querySelector("#flipBtn");
  const captureBtn = overlayEl.querySelector("#captureBtn");
  const cancelBtn = overlayEl.querySelector("#cancelBtn");

  flipBtn.addEventListener("click", async () => {
    facing = facing === "environment" ? "user" : "environment";
    await startStream();
  });

  cancelBtn.addEventListener("click", stopCameraOverlay);

  captureBtn.addEventListener("click", async () => {
    try {
      const b64 = snapshotToBase64();
      await processImageBase64(b64);
    } catch (e) {
      console.error(e);
      alert("Capture failed. Try again.");
    } finally {
      stopCameraOverlay();
    }
  });

  return overlayEl;
}

async function openCamera() {
  buildOverlay();
  overlayEl.style.display = "flex";
  await startStream();
}
function stopCameraOverlay() {
  overlayEl.style.display = "none";
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

/* Stream helpers */
function snapshotToBase64() {
  const c = document.createElement("canvas");
  const w = videoEl.videoWidth,
    h = videoEl.videoHeight;
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(videoEl, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.92);
}

async function startStream() {
  // Stop existing tracks
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  const constraints = { video: { facingMode: facing } };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // Safari sometimes needs plain true
    stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
  }
  videoEl.srcObject = stream;
}

/* ========= OCR + SNAPPING ========= */
function normalizeScanned(s) {
  return s
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/—|–/g, "-")
    .replace(/[™©®]/g, '"') // common confusion → quote
    .replace(/[{(]\s*/g, "{")
    .replace(/\s*[)}]/g, "}")
    .replace(/\u00A0/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/(\r\n|\r)/g, "\n")
    .trim();
}

function trySnapToDeck(text) {
  // We only ever allow the 53 possibilities when the source is camera.
  // Very tolerant: look for tokens anywhere.
  const t = text.toLowerCase();

  const ranks = [
    "ace",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "jack",
    "queen",
    "king",
  ];
  const suits = ["clubs", "spades", "hearts", "diamonds"];

  // quick find
  const rank = ranks.find(
    (r) => t.includes(`"${r}"`) || t.includes(`:${r}`) || t.includes(` ${r}`)
  );
  const suit = suits.find(
    (s) => t.includes(`"${s}"`) || t.includes(`:${s}`) || t.includes(` ${s}`)
  );

  // Joker / Back shortcuts
  if (t.includes("joker") || t.includes("error") || t.includes("hacked")) {
    return JSON.stringify(
      { rank: "ERROR", suit: "HACKED", type: "joker1" },
      null,
      2
    );
  }
  if (t.includes("type") && t.includes("back")) {
    return JSON.stringify(EXAMPLES["Back"], null, 2);
  }

  if (rank && suit) {
    const isFace = ["jack", "queen", "king"].includes(rank);
    const type = isFace ? "face" : "number";
    const rankOut = rank === "ace" ? "ace" : rank;
    return JSON.stringify({ rank: rankOut, suit, type }, null, 2);
  }

  // Couldn't confidently snap → return cleaned text, user can edit
  return JSON.stringify(safeJsonGuess(text), null, 2);
}

function safeJsonGuess(text) {
  // Try to coerce into a basic object with best-effort defaults
  try {
    const j = JSON.parse(text);
    return j;
  } catch {
    // Extract tokens loosely
    const t = text.toLowerCase();
    let rank = (/\"(ace|[2-9]|10|jack|queen|king)\"/.exec(t) || [])[1] || "8";
    let suit =
      (/\"(clubs|spades|hearts|diamonds)\"/.exec(t) || [])[1] || "clubs";
    const isFace = ["jack", "queen", "king"].includes(rank);
    const type = isFace ? "face" : "number";
    return { rank, suit, type };
  }
}

async function processImageBase64(b64) {
  // Send to Vision backend
  const res = await fetch(VISION_FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: b64 }),
  });
  const data = await res.json();
  const snapped = trySnapToDeck(normalizeScanned(String(data.text || "")));

  // Put into editor (single textarea → no double text)
  ta.value = snapped;
}

/* ========= UI WIRES ========= */
renderBtn.addEventListener("click", () => {
  try {
    const json = ta.value.trim();
    if (!json) return alert("Paste or type a card JSON first.");
    renderCard(json);
  } catch (e) {
    alert("Invalid JSON");
    console.error(e);
  }
});

examplesBtn.addEventListener("click", () => {
  const keys = Object.keys(EXAMPLES);
  const key = keys[Math.floor(Math.random() * keys.length)];
  const json = JSON.stringify(EXAMPLES[key], null, 2);
  ta.value = json;
});

scanBtn.addEventListener("click", async () => {
  // Prevent mobile keyboard auto-opening at this moment
  ta.blur();
  await openCamera();
});

/* No initial render; editor starts empty per your request */

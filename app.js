/* =========================================================
   Pure Code Playing Cards — App JS (full file)
   - Editor: single-render highlight (no duplication)
   - Camera overlay: Capture + Switch Camera, Safari-safe
   - OCR: posts base64 -> Vision function URL
   - Card renderer (numbers / faces / joker / back)
   ========================================================= */

/* ---------- Elements ---------- */
const ta = document.getElementById("cardInput");
const hl = document.getElementById("hl");
const scanBtn = document.getElementById("scanBtn");
const examplesBtn = document.getElementById("examplesBtn");
const renderBtn = document.getElementById("renderBtn");
const CANVAS = document.getElementById("cardCanvas");

/* ---------- Config ---------- */
// Use an existing global if you already set it elsewhere to avoid re-declare errors.
const VISION_FN_URL =
  window.VISION_FN_URL ||
  "https://us-central1-api-project-684372428277.cloudfunctions.net/ocrHttp";

/* =========================================================
   1) EDITOR HIGHLIGHTER (no double text)
   ========================================================= */
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function highlight(jsonText) {
  let out = "";
  let i = 0,
    n = jsonText.length;
  const isDigit = (ch) => /[0-9]/.test(ch);
  const isPunc = (ch) => "{}[],:".includes(ch);

  while (i < n) {
    const ch = jsonText[i];

    // string
    if (ch === '"') {
      let j = i + 1,
        str = '"',
        escp = false;
      while (j < n) {
        const c = jsonText[j++];
        str += c;
        if (escp) {
          escp = false;
          continue;
        }
        if (c === "\\") {
          escp = true;
          continue;
        }
        if (c === '"') break;
      }
      let k = j;
      while (k < n && /\s/.test(jsonText[k])) k++;
      const cls = jsonText[k] === ":" ? "k" : "s"; // key or string
      out += `<span class="${cls}">${esc(str)}</span>`;
      i = j;
      continue;
    }

    // number
    if (isDigit(ch) || (ch === "-" && isDigit(jsonText[i + 1] || ""))) {
      let j = i + 1;
      while (j < n && /[0-9._eE+-]/.test(jsonText[j])) j++;
      out += `<span class="n">${esc(jsonText.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // punctuation
    if (isPunc(ch)) {
      out += `<span class="p">${esc(ch)}</span>`;
      i++;
      continue;
    }

    // plain
    let j = i + 1;
    while (
      j < n &&
      !(
        jsonText[j] === '"' ||
        isDigit(jsonText[j]) ||
        isPunc(jsonText[j]) ||
        (jsonText[j] === "-" && isDigit(jsonText[j + 1] || ""))
      )
    )
      j++;
    out += esc(jsonText.slice(i, j));
    i = j;
  }

  // Update only the PRE — textarea stays transparent (caret only)
  hl.innerHTML = out.replace(/\n/g, "<br>");
}

// keep highlight in sync
highlight(ta.value || "");
ta.addEventListener("input", () => highlight(ta.value));

/* =========================================================
   2) CARD RENDERING
   ========================================================= */
const W = CANVAS.width; // 360
const H = CANVAS.height; // 528

const suitChar = (s) =>
  ({ clubs: "♣", spades: "♠", hearts: "♥", diamonds: "♦" }[
    (s || "").toLowerCase()
  ] || "?");
const isRed = (s) =>
  (s || "").toLowerCase() === "hearts" ||
  (s || "").toLowerCase() === "diamonds";

/* Base 240x336 grid scaled to the canvas */
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

/* Sizing */
const CARD_SCALE = {
  corner: 26,
  cornerSuit: 24,
  pips: 48,
  faceCenter: 104, // nice and bold
  cornerPad: 14,
};

function drawCornerPair(ctx, rankText, suit, color, pad, cornerFont, suitFont) {
  // TOP-LEFT
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

  // BOTTOM-RIGHT (rotated 180°)
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

function drawBackPattern(
  ctx,
  pattern,
  { mode = "cover", inset = S(14), color = "#08326a" } = {}
) {
  const rows = pattern.map((r) => r.trim().split(/\s+/));
  const R = rows.length;
  const C = Math.max(...rows.map((r) => r.length));

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
  const offsetX = left + (Wd - totalW) / 2;
  const offsetY = top + (Hd - totalH) / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, cell * 0.08);

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const t = rows[r][c];
      const cx = offsetX + c * cell + cell / 2;
      const cy = offsetY + r * cell + cell / 2;
      if (t === "x" || t === "X") {
        ctx.beginPath();
        ctx.moveTo(cx - cell * 0.25, cy - cell * 0.25);
        ctx.lineTo(cx + cell * 0.25, cy + cell * 0.25);
        ctx.moveTo(cx + cell * 0.25, cy - cell * 0.25);
        ctx.lineTo(cx - cell * 0.25, cy + cell * 0.25);
        ctx.stroke();
      } else if (t === "·" || t === ".") {
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawNumberCard(ctx, rank, suit) {
  const color = isRed(suit) ? "red" : "black";
  const cornerFont = `${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall = `${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const pipFont = `${Math.round(S(CARD_SCALE.pips))}px ui-monospace`;
  const pad = S(CARD_SCALE.cornerPad);
  const rUp = String(rank).toUpperCase();

  drawCornerPair(ctx, rUp === "ACE" ? "A" : rUp, suit, color, pad, cornerFont, suitSmall);

  const key = String(rank).toLowerCase();
  const layout = LAYOUTS[key];
  drawPipsCentered(ctx, layout, suit, color, pipFont);
}

function drawFaceCard(ctx, rank, suit) {
  const color = isRed(suit) ? "red" : "black";
  const cornerFont = `${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall = `${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const centerFont = `${Math.round(S(CARD_SCALE.faceCenter))}px ui-monospace`;
  const pad = S(CARD_SCALE.cornerPad);

  const letter =
    (rank || "?")[0].toUpperCase() === "A" ? "A" : (rank || "?")[0].toUpperCase();
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

function renderCard(json) {
  const card = JSON.parse(json);
  const ctx = CANVAS.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  if (card.type === "back" && Array.isArray(card.pattern)) {
    drawBackPattern(ctx, card.pattern, { mode: "cover", inset: S(10), color: "#0b2f66" });
    return;
  }
  const t = String(card.type || "").toLowerCase();
  if (t.startsWith("joker")) return drawJoker(ctx, card);
  if (t === "face") return drawFaceCard(ctx, card.rank, card.suit);
  if (t === "number") return drawNumberCard(ctx, card.rank, card.suit);

  ctx.fillStyle = "#333";
  ctx.font = `${Math.round(S(22))}px ui-monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Invalid card", W / 2, H / 2);
}

/* =========================================================
   3) EXAMPLES
   ========================================================= */
const EXAMPLES = {
  "Number (8♣)": { rank: "8", suit: "clubs", type: "number" },
  "Face (K♠)": { rank: "king", suit: "spades", type: "face" },
  "Ace (♦)": { rank: "ace", suit: "diamonds", type: "number" },
  Joker: { rank: "ERROR", suit: "HACKED", payload: "<script>alert(JOKER!)</script>", type: "joker1" },
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
      "x · x · x · x · x · x ·"
    ]
  }
};

/* =========================================================
   4) CAMERA OVERLAY (Safari-safe, no dropdown)
   ========================================================= */
let overlayEl = null;
let videoEl = null;
let stream = null;
let usingFront = false;

function buildOverlay() {
  if (overlayEl) return; // already open

  overlayEl = document.createElement("div");
  overlayEl.className = "overlay"; // style in CSS; we pin to top inside iframe

  const frame = document.createElement("div");
  frame.className = "overlay-frame"; // panel

  videoEl = document.createElement("video");
  videoEl.autoplay = true;
  videoEl.playsInline = true;

  const btnRow = document.createElement("div");
  btnRow.className = "overlay-buttons";

  const captureBtn = document.createElement("button");
  captureBtn.textContent = "Capture";

  const switchBtn = document.createElement("button");
  switchBtn.textContent = "Switch Camera";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";

  btnRow.appendChild(captureBtn);
  btnRow.appendChild(switchBtn);
  btnRow.appendChild(closeBtn);

  frame.appendChild(videoEl);
  frame.appendChild(btnRow);
  overlayEl.appendChild(frame);
  document.body.appendChild(overlayEl);

  // Start camera with Safari-safe constraints
  startCamera().catch((e) =>
    alert("Could not start camera. Check permissions and try again.")
  );

  switchBtn.addEventListener("click", async () => {
    usingFront = !usingFront;
    await startCamera();
  });

  captureBtn.addEventListener("click", async () => {
    try {
      const b64 = snapshotToBase64();
      await processImageBase64(b64);
      stopCamera();
      closeOverlay();
    } catch (e) {
      console.error(e);
      alert("Capture failed. Try again.");
    }
  });

  closeBtn.addEventListener("click", () => {
    stopCamera();
    closeOverlay();
  });
}

function closeOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

function snapshotToBase64() {
  const c = document.createElement("canvas");
  const w = videoEl.videoWidth || 640;
  const h = videoEl.videoHeight || 480;
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(videoEl, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.92);
}

async function startCamera() {
  // Stop old stream
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  const facingMode = usingFront ? "user" : "environment";
  // Safari-friendly: explicit audio:false and facingMode
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode }
  });
  videoEl.srcObject = stream;
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

/* =========================================================
   5) OCR CALL + CLEANUP
   ========================================================= */
function normalizeScanned(s) {
  return s
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/—|–/g, "-")
    .replace(/[·•●◦]/g, "·")
    .replace(/\u00A0/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/(\r\n|\r)/g, "\n")
    .trim();
}

async function processImageBase64(dataURL) {
  const res = await fetch(VISION_FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataURL })
  });
  if (!res.ok) throw new Error("Vision endpoint failed");
  const { text = "" } = await res.json();

  const cleaned = normalizeScanned(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;

  ta.value = candidate;
  highlight(ta.value);
}

/* =========================================================
   6) UI HANDLERS
   ========================================================= */
scanBtn.addEventListener("click", () => buildOverlay());

examplesBtn.addEventListener("click", () => {
  const keys = Object.keys(EXAMPLES);
  const key = keys[Math.floor(Math.random() * keys.length)];
  const json = JSON.stringify(EXAMPLES[key], null, 2);
  ta.value = json;
  highlight(ta.value);
});

renderBtn.addEventListener("click", () => {
  // don’t make the button look disabled anymore — keep it clear
  try {
    renderCard(ta.value);
  } catch (e) {
    alert("Invalid JSON");
  }
});

/* No auto-render on load — user must click Render Card */

/* =========================================================
   CONFIG
   ========================================================= */

// 👉 Replace with your deployed Cloud Function URL:
const VISION_FN_URL =
  "https://us-central1-api-project-684372428277.cloudfunctions.net/ocrHttp";

/* =========================================================
   EDITOR (highlighted mirror) — caret-safe, no jumping
   ========================================================= */
const ta = document.getElementById("cardInput");
const hl = document.getElementById("hl");

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function tok(s, c) {
  return `<span class="${c}">${s}</span>`;
}

function highlight(jsonText) {
  let out = "";
  let i = 0,
    n = jsonText.length;

  const isDigit = (ch) => /[0-9]/.test(ch);
  const isPunc = (ch) => "{}[],:".includes(ch);

  while (i < n) {
    const ch = jsonText[i];

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
      const cls = jsonText[k] === ":" ? "k" : "s";
      out += tok(esc(str), cls);
      i = j;
      continue;
    }

    if (isDigit(ch) || (ch === "-" && isDigit(jsonText[i + 1] || ""))) {
      let j = i + 1;
      while (j < n && /[0-9._eE+-]/.test(jsonText[j])) j++;
      out += tok(esc(jsonText.slice(i, j)), "n");
      i = j;
      continue;
    }

    if (isPunc(ch)) {
      out += tok(esc(ch), "p");
      i++;
      continue;
    }

    let j = i + 1;
    while (j < n) {
      const c = jsonText[j];
      if (
        c === '"' ||
        isDigit(c) ||
        isPunc(c) ||
        (c === "-" && isDigit(jsonText[j + 1] || ""))
      )
        break;
      j++;
    }
    out += esc(jsonText.slice(i, j));
    i = j;
  }

  hl.innerHTML = out.replace(/\n/g, "<br>");
}

// start with empty editor
ta.value = "";
highlight(ta.value);
ta.addEventListener("input", () => highlight(ta.value));

/* =========================================================
   OCR (camera overlay -> Vision API) + SNAP-TO-53
   ========================================================= */

const scanBtn = document.getElementById("scanBtn");

// overlay nodes we create once
let overlay, videoEl, captureBtn, cancelBtn, deviceSel, isOpen = false, stream = null;

function buildOverlay() {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.id = "cameraOverlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,.8)",
    zIndex: "9999",
    display: "none",
    alignItems: "flex-start",   // anchor to top (prevents iframe-centering issues)
    justifyContent: "center",
    paddingTop: "16px"
  });

  // inner panel
  const panel = document.createElement("div");
  Object.assign(panel.style, {
    width: "min(720px, 92vw)",
    background: "#111",
    borderRadius: "12px",
    border: "1px solid #222",
    padding: "12px",
    boxShadow: "0 8px 30px rgba(0,0,0,.5)",
  });

  // video
  videoEl = document.createElement("video");
  Object.assign(videoEl, { autoplay: true, playsInline: true });
  Object.assign(videoEl.style, {
    width: "100%",
    height: "auto",
    background: "#000",
    borderRadius: "8px",
  });

  // controls row
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "8px";
  row.style.marginTop = "10px";

  deviceSel = document.createElement("select");
  deviceSel.style.flex = "1";
  deviceSel.ariaLabel = "Select camera";

  captureBtn = document.createElement("button");
  captureBtn.textContent = "Capture";
  captureBtn.className = "primary";

  cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Close";

  row.append(deviceSel, captureBtn, cancelBtn);
  panel.append(videoEl, row);
  overlay.append(panel);
  document.body.appendChild(overlay);

  // handlers
  cancelBtn.addEventListener("click", stopCameraOverlay);
  deviceSel.addEventListener("change", async () => {
    await startStreamWithDevice(deviceSel.value);
  });
  captureBtn.addEventListener("click", async () => {
    try {
      const b64 = snapshotToBase64();
      await processImageBase64(b64);
      stopCameraOverlay();
      // leave editor visible (already is)
    } catch (e) {
      console.error(e);
      alert("Capture failed. Try again.");
    }
  });
}

scanBtn.addEventListener("click", async () => {
  // prevent mobile keyboards showing (ensure focus is *not* in the textarea)
  ta.blur();
  await startCameraOverlay();
});

async function startCameraOverlay() {
  try {
    buildOverlay();
    overlay.style.display = "flex";
    isOpen = true;

    // list cameras
    const devices = await navigator.mediaDevices.enumerateDevices();
    const vids = devices.filter((d) => d.kind === "videoinput");
    deviceSel.innerHTML = "";
    vids.forEach((d, i) => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || `Camera ${i + 1}`;
      deviceSel.appendChild(o);
    });

    // start with preferred back camera where possible
    let back = vids.find((d) => /back|environment/i.test(d.label || ""));
    await startStreamWithDevice(back ? back.deviceId : (vids[0] && vids[0].deviceId));
  } catch (err) {
    console.error(err);
    alert("Could not start camera. Check permissions and try again.");
    stopCameraOverlay();
  }
}

function stopCameraOverlay() {
  if (!isOpen) return;
  isOpen = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  overlay.style.display = "none";
}

function snapshotToBase64() {
  const c = document.createElement("canvas");
  const w = (c.width = videoEl.videoWidth);
  const h = (c.height = videoEl.videoHeight);
  c.getContext("2d").drawImage(videoEl, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.92);
}

async function startStreamWithDevice(deviceId) {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  const constraints = deviceId
    ? { video: { deviceId } }
    : { video: { facingMode: "environment" } };

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
}

async function processImageBase64(dataUrl) {
  // send to Cloud Function
  const body = { image: dataUrl };
  const res = await fetch(VISION_FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Vision endpoint failed");
  const { text } = await res.json();

  const snapped = snapToCard(text);
  if (snapped) {
    ta.value = JSON.stringify(snapped, null, 2);
    highlight(ta.value);
  } else {
    // fall back: paste cleaned OCR so user can edit
    const cleaned = normalizeScanned(text);
    ta.value = cleaned;
    highlight(ta.value);
    alert("Couldn't confidently detect a specific card. The OCR text was placed in the box so you can edit or try again.");
  }
}

/* ---------- Snap OCR to exactly 53 allowed cards ---------- */

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["clubs", "spades", "hearts", "diamonds"];

function normalizeScanned(s) {
  return String(s || "")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/—|–/g, "-")
    .replace(/[™©®]/g, '"') // common OCR mistakes
    .replace(/[\u00A0]/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/(\r\n|\r)/g, "\n")
    .trim();
}

function snapToCard(raw) {
  const t = normalizeScanned(raw).toLowerCase();

  // joker / back quick exits (rare from scan but handled)
  if (/\bjoker\b/.test(t)) {
    return { rank: "ERROR", suit: "HACKED", type: "joker1", payload: "" };
  }
  if (/\bback\b/.test(t)) {
    return {
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
    };
  }

  // try to detect suit (tolerant)
  const suitMap = {
    clubs: /(club|♣)/,
    spades: /(spade|♠)/,
    hearts: /(heart|♥)/,
    diamonds: /(diamond|♦|diamonc|diainond|diam0nd)/,
  };
  let suit = null;
  for (const [k, rx] of Object.entries(suitMap)) {
    if (rx.test(t)) {
      suit = k;
      break;
    }
  }
  if (!suit) return null;

  // detect rank
  // allow text like 'ace', 'king', or symbols A,K,Q,J or numbers
  let rank = null;
  if (/\b(ace|a\b)\b/.test(t)) rank = "A";
  else if (/\b(jack|j\b)\b/.test(t)) rank = "J";
  else if (/\b(queen|q\b)\b/.test(t)) rank = "Q";
  else if (/\b(king|k\b)\b/.test(t)) rank = "K";
  else {
    const m = t.match(/\b(10|[2-9])\b/);
    if (m) rank = m[1];
  }
  if (!rank) return null;

  // build exact JSON (no file property)
  const card =
    ["J", "Q", "K"].includes(rank)
      ? { rank: rankName(rank), suit, type: "face" }
      : { rank: rankName(rank), suit, type: "number" };

  return card;
}

function rankName(r) {
  const map = { A: "ace", J: "jack", Q: "queen", K: "king" };
  return map[r] || String(r);
}

/* =========================================================
   RENDERING
   ========================================================= */

const CANVAS = document.getElementById("cardCanvas");
const W = CANVAS.width; // 360
const H = CANVAS.height; // 528

const suitChar = (s) =>
  ({ clubs: "♣", spades: "♠", hearts: "♥", diamonds: "♦" }[
    (s || "").toLowerCase()
  ] || "?");
const isRed = (s) =>
  (s || "").toLowerCase() === "hearts" ||
  (s || "").toLowerCase() === "diamonds";

/* Base 240x336 layout scaled up to 360x528 (S=1.5) */
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
  faceCenter: 104, // 30% bigger than previous 80-ish
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

  // BOTTOM-RIGHT mirrored
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

function drawPipsCentered(ctx, layout, suit, color, pipFont, yAdjust = 0) {
  if (!layout || !layout.length) return;
  const xs = layout.map(([x]) => x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const dx = W / 2 - mid;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = pipFont;
  layout.forEach(([x, y]) => ctx.fillText(suitChar(suit), x + dx, y + yAdjust));
  ctx.restore();
}

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

function drawNumberCard(ctx, rank, suit) {
  const color = isRed(suit) ? "red" : "black";
  const cornerFont = `${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall = `${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const pipFont = `${Math.round(S(CARD_SCALE.pips))}px ui-monospace`;
  const pad = S(CARD_SCALE.cornerPad);

  const r = String(rank).toUpperCase() === "ACE" ? "A" : String(rank).toUpperCase();
  drawCornerPair(ctx, r, suit, color, pad, cornerFont, suitSmall);

  const key = String(rank).toLowerCase();
  const layout = LAYOUTS[key];
  // small downward nudge so the block looks perfectly centered
  const yAdjust = 6;
  drawPipsCentered(ctx, layout, suit, color, pipFont, yAdjust);
}

function drawFaceCard(ctx, rank, suit) {
  const color = isRed(suit) ? "red" : "black";
  const cornerFont = `${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall = `${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const centerFont = `${Math.round(S(CARD_SCALE.faceCenter))}px ui-monospace`;
  const pad = S(CARD_SCALE.cornerPad);

  const letter = (rank || "?")[0].toUpperCase();
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

/* =========================================================
   UI
   ========================================================= */
const renderBtn = document.getElementById("renderBtn");
const examplesBtn = document.getElementById("examplesBtn");

// examples (no file)
const EXAMPLES = {
  "Number (8♣)": { rank: "8", suit: "clubs", type: "number" },
  "Face (K♠)": { rank: "king", suit: "spades", type: "face" },
  "Ace (♦)": { rank: "ace", suit: "diamonds", type: "number" },
  Joker: {
    rank: "ERROR",
    suit: "HACKED",
    payload: "<script>alert(JOKER!)</script>",
    type: "joker1",
  },
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
};

examplesBtn.addEventListener("click", () => {
  const keys = Object.keys(EXAMPLES);
  const key = keys[Math.floor(Math.random() * keys.length)];
  const json = JSON.stringify(EXAMPLES[key], null, 2);
  ta.value = json;
  highlight(ta.value);
});

renderBtn.addEventListener("click", () => {
  try {
    renderBtn.classList.add("busy");
    renderCard(ta.value);
  } catch {
    alert("Invalid JSON");
  } finally {
    setTimeout(() => renderBtn.classList.remove("busy"), 150);
  }
});

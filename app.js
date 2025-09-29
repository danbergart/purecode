/* ===================== 1) Highlighted editor (no cursor jump) ===================== */
const ta = document.getElementById("cardInput");
const hl = document.getElementById("hl");

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function tok(s, c) {
  return `<span class="${c}">${s}</span>`;
}
function highlight(text) {
  let out = "",
    i = 0,
    n = text.length;
  const isDigit = (ch) => /[0-9]/.test(ch);
  const isPunc = (ch) => "{}[],:".includes(ch);
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1,
        str = '"',
        escp = false;
      while (j < n) {
        const c = text[j++];
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
      while (k < n && /\s/.test(text[k])) k++;
      out += tok(esc(str), text[k] === ":" ? "k" : "s");
      i = j;
      continue;
    }
    if (isDigit(ch) || (ch === "-" && isDigit(text[i + 1] || ""))) {
      let j = i + 1;
      while (j < n && /[0-9._eE+-]/.test(text[j])) j++;
      out += tok(esc(text.slice(i, j)), "n");
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
      const c = text[j];
      if (
        c === '"' ||
        isDigit(c) ||
        isPunc(c) ||
        (c === "-" && isDigit(text[j + 1] || ""))
      )
        break;
      j++;
    }
    out += esc(text.slice(i, j));
    i = j;
  }
  hl.innerHTML = out.replace(/\n/g, "<br>");
}
highlight(ta.value);
ta.addEventListener("input", () => highlight(ta.value));

/* ===================== 2) Strict snap-to-deck for CAMERA/PHOTO ONLY ===================== */
/* Build canonical deck JSONs (52 + 2 jokers + back), exactly matching your schema. */
function canonNumber(rank, suit) {
  return JSON.stringify({ rank: String(rank), suit, type: "number" }, null, 2);
}
function canonFace(rank, suit) {
  return JSON.stringify({ rank, suit, type: "face" }, null, 2);
}
function canonBack() {
  return JSON.stringify({ type: "back" }, null, 2);
}
function canonJoker(kind = "joker1") {
  return JSON.stringify(
    {
      rank: "ERROR",
      suit: "HACKED",
      payload: "<script>\\nalert(JOKER!)</script>",
      type: kind,
    },
    null,
    2
  );
}

const SUITS = ["clubs", "diamonds", "hearts", "spades"];
const RANKS_NUM = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "ace"];
const RANKS_FACE = ["jack", "queen", "king"];
const CANON = (() => {
  const a = [];
  for (const s of SUITS) for (const r of RANKS_NUM) a.push(canonNumber(r, s));
  for (const s of SUITS) for (const r of RANKS_FACE) a.push(canonFace(r, s));
  a.push(canonJoker("joker1"), canonJoker("joker2"), canonBack());
  return a;
})();

function hardNormalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[™¨]/g, '"')
    .replace(/—|–/g, "-")
    .replace(/[·•●◦]/g, "·")
    .replace(/\u00A0/g, " ")
    .replace(/[^a-z0-9{}\[\]":,.\s]/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
}
function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}
function snapToCanonical(ocrText) {
  const cleaned = hardNormalize(ocrText);
  const si = cleaned.indexOf("{"),
    ei = cleaned.lastIndexOf("}");
  const candidate = si >= 0 && ei > si ? cleaned.slice(si, ei + 1) : cleaned;

  let best = null,
    bestDist = Infinity,
    bestLen = 1;
  for (const canon of CANON) {
    const dist = levenshtein(candidate, hardNormalize(canon));
    if (dist < bestDist) {
      bestDist = dist;
      best = canon;
      bestLen = canon.length;
    }
  }
  const score = bestDist / bestLen; // 0 perfect … 1 awful
  return score <= 0.28 ? best : null; // adjust to 0.30–0.32 if needed
}

/* ===================== 3) Camera/file OCR (uses strict snap); manual typing untouched ===================== */
const scanBtn = document.getElementById("scanBtn");
const imageInput = document.getElementById("imageInput");

/* Ensure Scan Card Code opens the native camera/photo chooser */
if (scanBtn && imageInput) {
  scanBtn.addEventListener("click", () => {
    // Re-assert camera-first hints right before opening (helps some browsers)
    imageInput.setAttribute("accept", "image/*");
    imageInput.setAttribute("capture", "environment"); // rear camera hint on mobile
    imageInput.removeAttribute("multiple");
    imageInput.click();
  });
}

/* Handle the selected/captured photo → OCR → strict snap */
imageInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (scanBtn) {
    scanBtn.disabled = true;
    scanBtn.textContent = "Scanning…";
  }
  try {
    const {
      data: { text },
    } = await Tesseract.recognize(file, "eng");
    const snapped = snapToCanonical(text);
    if (!snapped) {
      alert(
        "Couldn’t read that card. Please reshoot the whole code, flat & well lit."
      );
      // Optional: still show a closest guess so users can edit if they want:
      const fallback =
        snapToCanonical(text) || JSON.stringify({ type: "back" }, null, 2);
      ta.value = fallback;
    } else {
      ta.value = snapped; // exact canonical JSON
    }
    highlight(ta.value);
    try {
      renderCard(ta.value);
    } catch {}
  } catch (err) {
    console.error(err);
    alert("Scan failed. Try again with better lighting/focus.");
  } finally {
    if (scanBtn) {
      scanBtn.disabled = false;
      scanBtn.textContent = "Scan Card Code";
    }
    imageInput.value = "";
  }
});

/* ===================== 4) Card rendering (unchanged layout/logic) ===================== */
const CANVAS = document.getElementById("cardCanvas");
const W = CANVAS.width,
  H = CANVAS.height;

const suitChar = (s) =>
  ({ clubs: "♣", spades: "♠", hearts: "♥", diamonds: "♦" }[
    (s || "").toLowerCase()
  ] || "?");
const isRed = (s) => ["hearts", "diamonds"].includes((s || "").toLowerCase());

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
  faceCenter: 104,
  cornerPad: 14,
};

function drawCornerPair(ctx, rankText, suit, color, pad, cornerFont, suitFont) {
  // top-left
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = cornerFont;
  ctx.fillText(rankText, pad, pad);
  const w = ctx.measureText(rankText).width;
  ctx.font = suitFont;
  ctx.textAlign = "center";
  ctx.fillText(
    suitChar(suit),
    pad + w / 2,
    pad + parseInt(cornerFont, 10) * 0.95
  );
  ctx.restore();
  // bottom-right mirrored
  ctx.save();
  ctx.translate(W - pad, H - pad);
  ctx.rotate(Math.PI);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = cornerFont;
  ctx.fillText(rankText, 0, 0);
  const w2 = ctx.measureText(rankText).width;
  ctx.font = suitFont;
  ctx.textAlign = "center";
  ctx.fillText(suitChar(suit), w2 / 2, parseInt(cornerFont, 10) * 0.95);
  ctx.restore();
}

function drawPipsCentered(ctx, layout, suit, color, pipFont) {
  if (!layout?.length) return;
  const xs = layout.map((p) => p[0]);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const dx = W / 2 - mid;
  const dy = S(4); // slight optical nudge downwards
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = pipFont;
  layout.forEach(([x, y]) => ctx.fillText(suitChar(suit), x + dx, y + dy));
  ctx.restore();
}

function rankCornerText(rank) {
  const r = String(rank).toLowerCase();
  if (r === "ace") return "A";
  if (r === "jack") return "J";
  if (r === "queen") return "Q";
  if (r === "king") return "K";
  return String(rank).toUpperCase();
}

function renderCard(json) {
  const card = JSON.parse(json);
  const ctx = CANVAS.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  const type = String(card.type || "").toLowerCase();

  if (type === "back" && Array.isArray(card.pattern)) {
    drawBackPattern(ctx, card.pattern, {
      mode: "cover",
      inset: S(10),
      color: "#0b2f66",
    });
    return;
  }
  if (type.startsWith("joker")) {
    drawJoker(ctx, card);
    return;
  }
  if (type === "face") {
    drawFaceCard(ctx, card.rank, card.suit);
    return;
  }
  if (type === "number") {
    drawNumberCard(ctx, card.rank, card.suit);
    return;
  }

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
  drawCornerPair(
    ctx,
    rankCornerText(rank),
    suit,
    color,
    pad,
    cornerFont,
    suitSmall
  );
  const layout = LAYOUTS[String(rank).toLowerCase()];
  drawPipsCentered(ctx, layout, suit, color, pipFont);
}

function drawFaceCard(ctx, rank, suit) {
  const color = isRed(suit) ? "red" : "black";
  const cornerFont = `${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall = `${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const centerFont = `${Math.round(S(CARD_SCALE.faceCenter))}px ui-monospace`;
  const pad = S(CARD_SCALE.cornerPad);
  const letter = rankCornerText(rank);
  drawCornerPair(ctx, letter, suit, color, pad, cornerFont, suitSmall);
  ctx.fillStyle = color;
  ctx.font = centerFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, W / 2, H / 2);
}

function drawJoker(ctx, card) {
  ctx.fillStyle = "#900";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(S(40))}px ui-monospace`;
  ctx.fillText("JOKER", W / 2, H / 2);
  if (card.payload) {
    ctx.font = `${Math.round(S(12))}px ui-monospace`;
    ctx.fillText(
      String(card.payload).replace(/\n/g, " "),
      W / 2,
      H / 2 + S(34)
    );
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
  const offsetX = left + (Wd - totalW) / 2;
  const offsetY = top + (Hd - totalH) / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, cell * 0.08);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const t = rows[r][c],
        cx = offsetX + c * cell + cell / 2,
        cy = offsetY + r * cell + cell / 2;
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

/* ===================== 5) UI actions (manual typing unchanged) ===================== */
document.getElementById("renderBtn").addEventListener("click", () => {
  try {
    renderCard(ta.value);
  } catch {
    alert("Invalid JSON");
  }
});
document.getElementById("examplesBtn").addEventListener("click", () => {
  const examples = [
    { rank: "8", suit: "clubs", type: "number" },
    { rank: "king", suit: "spades", type: "face" },
    { rank: "ace", suit: "diamonds", type: "number" },
    {
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
    {
      rank: "ERROR",
      suit: "HACKED",
      payload: "<script>\\nalert(JOKER1!)</script>",
      type: "joker1",
    },
  ];
  const pick = examples[Math.floor(Math.random() * examples.length)];
  const json = JSON.stringify(pick, null, 2);
  ta.value = json;
  highlight(json);
  renderCard(json);
});

// initial render
try {
  renderCard(ta.value);
} catch {}

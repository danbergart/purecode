function highlight(jsonText) {
  let out = "";
  let i = 0, n = jsonText.length;
  const isDigit = (ch) => /[0-9]/.test(ch);
  const isPunc = (ch) => "{}[],:".includes(ch);

  while (i < n) {
    const ch = jsonText[i];

    if (ch === '"') {
      let j = i + 1, str = '"', escp = false;
      while (j < n) {
        const c = jsonText[j++];
        str += c;
        if (escp) { escp = false; continue; }
        if (c === "\\") { escp = true; continue; }
        if (c === '"') break;
      }
      let k = j;
      while (k < n && /\s/.test(jsonText[k])) k++;
      const cls = jsonText[k] === ":" ? "k" : "s";
      out += `<span class="${cls}">${esc(str)}</span>`;
      i = j;
      continue;
    }

    if (isDigit(ch)) {
      let j = i + 1;
      while (j < n && /[0-9._eE+-]/.test(jsonText[j])) j++;
      out += `<span class="n">${esc(jsonText.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    if (isPunc(ch)) {
      out += `<span class="p">${esc(ch)}</span>`;
      i++;
      continue;
    }

    let j = i + 1;
    while (j < n && !['"', ...'{}[],:0123456789'].includes(jsonText[j])) j++;
    out += esc(jsonText.slice(i, j));
    i = j;
  }

  // update only the PRE
  hl.innerHTML = out.replace(/\n/g, "<br>");
}

/* ==========================================================================
   TubeRank AI - frontend logic
   Sections:
   1. Helpers            2. Card definitions     3. Renderers (one per card)
   4. Text builders      5. API + generation     6. Copy / download
   7. Theme + navigation 8. Startup
   ========================================================================== */
(() => {
  "use strict";

  /* ------------------------------------------------------------------------
     1. Helpers
     ------------------------------------------------------------------------ */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);

  /** Build a DOM element. Text is always inserted as text, never as HTML (prevents XSS). */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  /** Create an <svg> that points at a symbol in the sprite inside index.html. */
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ico");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  const list = (value) => (Array.isArray(value) ? value : []);
  const wordCount = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

  let toastTimer = null;
  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 1800);
  }

  /* ------------------------------------------------------------------------
     2. Card definitions
     "request" = which backend route fills the card. Tags and hashtags share one request.
     ------------------------------------------------------------------------ */
  const CARDS = [
    { id: "titles", feature: "titles", icon: "title", label: "SEO titles", sub: "Eight options, each 70 characters or fewer", request: "titles", loading: "Writing titles" },
    { id: "description", feature: "description", icon: "text", label: "Description", sub: "Ready to paste into YouTube Studio", request: "description", loading: "Writing the description" },
    { id: "keywords", feature: "keywords", icon: "search", label: "Keyword research", sub: "Keywords, related searches and search intent", request: "keywords", loading: "Researching keywords" },
    { id: "tags", feature: "tags", icon: "tag", label: "Tags", sub: "Comma-separated for the Tags field", request: "tags_hashtags", loading: "Choosing tags", span: "half" },
    { id: "hashtags", feature: "hashtags", icon: "hash", label: "Hashtags", sub: "The first three show above your title", request: "tags_hashtags", loading: "Choosing hashtags", span: "half" },
    { id: "thumbnails", feature: "thumbnails", icon: "image", label: "Thumbnail ideas", sub: "Five concepts with image generation prompts", request: "thumbnails", loading: "Designing thumbnails" },
    { id: "shorts", feature: "shorts", icon: "phone", label: "YouTube Shorts", sub: "Five ideas with hooks and scripts", request: "shorts", loading: "Writing Shorts" },
    { id: "score", feature: "seo_score", icon: "chart", label: "SEO score", sub: "An AI audit of the results above", request: "analyze", loading: "Auditing your SEO package" },
  ];

  const state = {
    config: null,
    running: false,
    keyMissing: false,
    input: null, // the values that were submitted (used for retries and the report)
    results: {}, // card id -> data returned by the server
  };
  const cardEls = {}; // card id -> { root, body, copyBtn }

  const activeCards = () => CARDS.filter((c) => !state.config || state.config.features[c.feature] !== false);
  const cardsForRequest = (request) => activeCards().filter((c) => c.request === request);

  /* ------------------------------------------------------------------------
     3. Renderers - each returns a DOM node for a card body
     ------------------------------------------------------------------------ */

  /** Small button that copies `text`. */
  function copyButton(text, label = "Copy") {
    const btn = h("button", { class: "btn btn-ghost btn-sm", type: "button" }, icon("copy"), h("span", { text: label }));
    btn.addEventListener("click", () => copyWithFeedback(btn, typeof text === "function" ? text() : text));
    return btn;
  }

  /** A clickable chip that copies its own text. */
  function chip(text) {
    const el = h("button", { class: "chip", type: "button", title: "Copy", text });
    el.addEventListener("click", async () => {
      const ok = await copyText(text);
      el.classList.toggle("is-copied", ok);
      toast(ok ? "Copied" : "Copy failed. Select the text and copy it manually.");
      setTimeout(() => el.classList.remove("is-copied"), 1200);
    });
    return el;
  }

  const RENDER = {
    titles(d) {
      return h(
        "div",
        { class: "stack" },
        list(d.titles).map((t) => {
          const len = t.title.length;
          return h(
            "div",
            { class: "row" },
            h(
              "div",
              { class: "row-main" },
              h("div", { class: "row-title", text: t.title }),
              t.why && h("div", { class: "row-why", text: t.why }),
              h(
                "div",
                { class: "row-meta" },
                t.style && h("span", { class: "badge", text: t.style }),
                h("span", { class: `badge ${len <= 70 ? "good" : "warn"}`, text: `${len} characters` })
              )
            ),
            copyButton(t.title)
          );
        })
      );
    },

    description(d) {
      const used = [...list(d.primary_keywords_used), ...list(d.secondary_keywords_used)];
      return h(
        "div",
        { class: "stack" },
        h("div", { class: "prose", text: d.description }),
        h(
          "div",
          { class: "row-meta" },
          h("span", { class: "badge", text: `${wordCount(d.description)} words` }),
          h("span", { class: "badge", text: `${d.description.length} characters` }),
          used.length > 0 && h("span", { class: "badge", text: "Keywords placed:" }),
          used.map((k) => h("span", { class: "badge good", text: k }))
        )
      );
    },

    keywords(d) {
      const groups = [
        ["Primary keywords", d.primary],
        ["Secondary keywords", d.secondary],
        ["Long-tail keywords", d.long_tail],
        ["Related search terms", d.related_searches],
      ].filter(([, items]) => list(items).length > 0);

      const intent = d.search_intent || {};
      return h(
        "div",
        null,
        groups.map(([title, items]) =>
          h(
            "div",
            { class: "group" },
            h("div", { class: "group-head" }, h("h4", { text: title }), copyButton(() => items.join(", "), "Copy all")),
            h("div", { class: "chips" }, items.map(chip))
          )
        ),
        (intent.type || intent.explanation) &&
          h(
            "div",
            { class: "group" },
            h("div", { class: "group-head" }, h("h4", { text: "Search intent" })),
            h("div", { class: "callout" }, h("strong", { text: intent.type || "Intent" }), intent.explanation && h("p", { text: intent.explanation }))
          )
      );
    },

    tags(d) {
      const chars = list(d.tags).join(",").length;
      return h(
        "div",
        { class: "stack" },
        h("div", { class: "row-meta" }, h("span", { class: "badge", text: `${list(d.tags).length} tags` }), h("span", { class: `badge ${chars <= 500 ? "good" : "warn"}`, text: `${chars} / 500 characters` })),
        h("div", { class: "chips" }, list(d.tags).map(chip))
      );
    },

    hashtags(d) {
      return h("div", { class: "chips" }, list(d.hashtags).map(chip));
    },

    thumbnails(d) {
      return h(
        "div",
        { class: "concepts" },
        list(d.thumbnails).map((t, i) => {
          const hexes = list(t.colors).map(findHex).filter(Boolean);
          const bg = hexes.length >= 2 ? `linear-gradient(135deg, ${hexes[0]}, ${hexes[1]})` : hexes.length === 1 ? hexes[0] : "linear-gradient(135deg, #ff4b5c, #ff9a3c)";
          const bright = hexes.length > 0 && hexes.reduce((sum, c) => sum + luminance(c), 0) / hexes.length > 0.6;
          return h(
            "article",
            { class: "concept" },
            h("div", { class: "concept-art", style: { background: bg, color: bright ? "#111827" : "#ffffff", textShadow: bright ? "none" : "" }, text: t.text || t.concept }),
            h(
              "div",
              { class: "concept-body" },
              h("h4", { text: t.concept || `Concept ${i + 1}` }),
              t.design_idea && h("p", { text: t.design_idea }),
              list(t.visual_elements).length > 0 && h("ul", { class: "plain" }, list(t.visual_elements).map((v) => h("li", { text: v }))),
              list(t.colors).length > 0 &&
                h(
                  "div",
                  { class: "swatches" },
                  list(t.colors).map((c) => h("span", { class: "swatch" }, findHex(c) && h("i", { style: { background: findHex(c) } }), c))
                ),
              t.image_prompt &&
                h(
                  "div",
                  null,
                  h("div", { class: "field-label" }, "Image generation prompt", copyButton(t.image_prompt)),
                  h("div", { class: "small-box", text: t.image_prompt })
                ),
              copyButton(() => thumbnailText(t, i), "Copy concept")
            )
          );
        })
      );
    },

    shorts(d) {
      return h(
        "div",
        { class: "concepts" },
        list(d.shorts).map((s, i) =>
          h(
            "article",
            { class: "concept" },
            h(
              "div",
              { class: "concept-body" },
              h("h4", { text: s.title || `Short ${i + 1}` }),
              s.hook && h("div", null, h("div", { class: "field-label" }, "Hook (first 3 seconds)", copyButton(s.hook)), h("div", { class: "small-box", text: s.hook })),
              s.script && h("div", null, h("div", { class: "field-label" }, "Script", copyButton(s.script)), h("div", { class: "small-box", text: s.script })),
              list(s.hashtags).length > 0 && h("div", null, h("div", { class: "field-label" }, "Hashtags", copyButton(s.hashtags.join(" "))), h("div", { class: "chips" }, s.hashtags.map(chip))),
              copyButton(() => shortText(s, i), "Copy this Short")
            )
          )
        )
      );
    },

    score(d) {
      const tier = scoreTier(d.overall);
      return h(
        "div",
        null,
        h(
          "div",
          { class: "score-hero" },
          h("div", { class: "score-number" }, String(d.overall), h("small", { text: " / 100" })),
          h(
            "div",
            { class: "score-main" },
            progressBar(d.overall, tier.cls, "Overall SEO score"),
            h("div", { class: "score-verdict", text: tier.label }),
            d.summary && h("p", { class: "muted", text: d.summary })
          )
        ),
        h(
          "div",
          { class: "breakdown" },
          list(d.breakdown).map((b) =>
            h(
              "div",
              { class: "breakdown-item" },
              h("div", { class: "top" }, h("span", { text: b.label }), h("span", { text: `${b.score}/100` })),
              progressBar(b.score, scoreTier(b.score).cls, b.label),
              b.comment && h("p", { text: b.comment })
            )
          )
        ),
        list(d.suggestions).length > 0 && h("div", { class: "group" }, h("div", { class: "group-head" }, h("h4", { text: "How to improve" })), h("ol", { class: "suggestions" }, d.suggestions.map((s) => h("li", { text: s }))))
      );
    },
  };

  /** Progress bar; the fill width is animated by animateBars() after it is in the page. */
  function progressBar(value, cls, label) {
    return h(
      "div",
      { class: "bar", role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(value) },
      h("div", { class: `bar-fill ${cls}`, "data-width": String(value) })
    );
  }

  function animateBars(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => root.querySelectorAll(".bar-fill").forEach((el) => (el.style.width = `${el.dataset.width}%`))));
  }

  function scoreTier(score) {
    if (score >= 80) return { cls: "good", label: "Strong. Publish with minor polish." };
    if (score >= 60) return { cls: "warn", label: "Decent. A few changes will lift it." };
    return { cls: "bad", label: "Needs work before you publish." };
  }

  /** Pull a hex colour like #FFE600 out of text such as "Electric yellow #FFE600". */
  function findHex(text) {
    const m = String(text).match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
    if (!m) return null;
    const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    return `#${hex}`;
  }

  /** Relative brightness 0 (dark) to 1 (bright), used to pick readable text on a thumbnail preview. */
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  /* ------------------------------------------------------------------------
     4. Text builders - used by copy buttons and the TXT report
     ------------------------------------------------------------------------ */
  function thumbnailText(t, i) {
    return [
      `Thumbnail ${i + 1}: ${t.concept}`,
      `Text: ${t.text}`,
      `Design idea: ${t.design_idea}`,
      `Visual elements: ${list(t.visual_elements).join("; ")}`,
      `Colors: ${list(t.colors).join("; ")}`,
      `Image prompt: ${t.image_prompt}`,
    ].join("\n");
  }

  function shortText(s, i) {
    return [`Short ${i + 1}: ${s.title}`, `Hook: ${s.hook}`, `Script:\n${s.script}`, `Hashtags: ${list(s.hashtags).join(" ")}`].join("\n");
  }

  const TEXT = {
    titles: (d) => list(d.titles).map((t, i) => `${i + 1}. ${t.title}`).join("\n"),
    description: (d) => d.description,
    keywords: (d) => {
      const lines = [];
      if (list(d.primary).length) lines.push(`Primary keywords: ${d.primary.join(", ")}`);
      if (list(d.secondary).length) lines.push(`Secondary keywords: ${d.secondary.join(", ")}`);
      if (list(d.long_tail).length) lines.push(`Long-tail keywords: ${d.long_tail.join(", ")}`);
      if (list(d.related_searches).length) lines.push(`Related searches: ${d.related_searches.join(", ")}`);
      const intent = d.search_intent || {};
      if (intent.type || intent.explanation) lines.push(`Search intent: ${intent.type}. ${intent.explanation}`.trim());
      return lines.join("\n");
    },
    tags: (d) => list(d.tags).join(", "),
    hashtags: (d) => list(d.hashtags).join(" "),
    thumbnails: (d) => list(d.thumbnails).map(thumbnailText).join("\n\n"),
    shorts: (d) => list(d.shorts).map(shortText).join("\n\n"),
    score: (d) =>
      [
        `SEO score: ${d.overall}/100`,
        d.summary,
        "",
        "Breakdown:",
        ...list(d.breakdown).map((b) => `- ${b.label}: ${b.score}/100. ${b.comment}`),
        "",
        "Suggestions:",
        ...list(d.suggestions).map((s, i) => `${i + 1}. ${s}`),
      ].join("\n"),
  };

  /* ------------------------------------------------------------------------
     5. Cards, API calls and the generation flow
     ------------------------------------------------------------------------ */
  function buildCards() {
    const container = $("results");
    container.replaceChildren();
    for (const card of activeCards()) {
      const copyBtn = copyButton(() => TEXT[card.id](state.results[card.id]), "Copy");
      copyBtn.disabled = true;
      const body = h("div", { class: "card-body" });
      const root = h(
        "section",
        { class: "card", id: `sec-${card.id}`, "data-span": card.span || "full" },
        h(
          "header",
          { class: "card-head" },
          h("span", { class: "card-icon" }, icon(card.icon)),
          h("div", null, h("h3", { class: "card-title", text: card.label }), h("div", { class: "card-sub", text: card.sub })),
          h("div", { class: "card-actions" }, copyBtn)
        ),
        body
      );
      container.append(root);
      cardEls[card.id] = { root, body, copyBtn };
    }
  }

  function setLoading(id, text) {
    const el = cardEls[id];
    if (!el) return;
    el.copyBtn.disabled = true;
    el.body.replaceChildren(h("div", { class: "loading", role: "status" }, h("div", { class: "loading-label" }, h("span", { class: "spinner" }), text + "..."), h("div", { class: "skeleton" }), h("div", { class: "skeleton" }), h("div", { class: "skeleton" })));
  }

  function setError(id, message, onRetry) {
    const el = cardEls[id];
    if (!el) return;
    el.copyBtn.disabled = true;
    delete state.results[id];
    const retry = h("button", { class: "btn btn-ghost btn-sm", type: "button" }, icon("refresh"), h("span", { text: "Retry" }));
    retry.addEventListener("click", onRetry);
    el.body.replaceChildren(h("div", { class: "error-box", role: "alert" }, icon("alert"), h("p", { text: message }), retry));
  }

  function setResult(id, data) {
    state.results[id] = data;
    const el = cardEls[id];
    updateDownloadState();
    if (!el) return;
    el.body.replaceChildren(RENDER[id](data));
    el.copyBtn.disabled = false;
    el.root.classList.remove("just-arrived");
    void el.root.offsetWidth; // restart the arrival animation
    el.root.classList.add("just-arrived");
    animateBars(el.body);
  }

  /** POST JSON to the backend and return its `data` field. Throws Error with a readable message. */
  async function postJSON(url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 200000);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      let payload = null;
      try {
        payload = await res.json();
      } catch (_) {
        /* the body was not JSON */
      }
      if (!res.ok || !payload || payload.ok === false) {
        const err = new Error((payload && payload.error && payload.error.message) || `The server returned an error (${res.status}).`);
        err.code = payload && payload.error && payload.error.code;
        throw err;
      }
      return payload.data;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("This took too long. Try again or pick a faster model.");
      if (err instanceof TypeError) throw new Error("Could not reach the server. Check that the Flask app is running and you are online.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function handleKnownErrors(err) {
    if (err.code === "missing_api_key") {
      state.keyMissing = true;
      $("keyBanner").hidden = false;
      setBusy(state.running);
    }
  }

  /** Run one backend request (e.g. "titles") and fill the card(s) that depend on it. */
  async function runRequest(request) {
    const cards = cardsForRequest(request);
    cards.forEach((c) => setLoading(c.id, c.loading));
    try {
      const data = await postJSON(`/api/generate/${request}`, state.input);
      if (request === "tags_hashtags") {
        state.results.tags = { tags: data.tags };
        state.results.hashtags = { hashtags: data.hashtags };
        cards.forEach((c) => setResult(c.id, state.results[c.id]));
      } else {
        setResult(request, data);
      }
      return true;
    } catch (err) {
      handleKnownErrors(err);
      cards.forEach((c) => setError(c.id, err.message, () => retry(request)));
      return false;
    }
  }

  /** Send what was generated to the analyzer and show the score. */
  async function runAnalyze() {
    const scoreCard = cardsForRequest("analyze")[0];
    if (!scoreCard) return;

    // Only send the parts the analyzer needs, in a compact shape.
    const pack = {};
    if (state.results.titles) pack.titles = state.results.titles.titles.map((t) => t.title);
    if (state.results.description) pack.description = state.results.description.description;
    if (state.results.keywords) pack.keywords = state.results.keywords;
    if (state.results.tags) pack.tags = state.results.tags.tags;
    if (state.results.hashtags) pack.hashtags = state.results.hashtags.hashtags;

    if (Object.keys(pack).length === 0) {
      setError(scoreCard.id, "There is nothing to score because the other sections failed. Retry them first.", () => retry("analyze"));
      return;
    }

    setLoading(scoreCard.id, scoreCard.loading);
    try {
      const data = await postJSON("/api/analyze", { ...state.input, results: pack });
      setResult(scoreCard.id, data);
    } catch (err) {
      handleKnownErrors(err);
      setError(scoreCard.id, err.message, () => retry("analyze"));
    }
  }

  /** Retry a single failed card (and refresh the score afterwards). */
  async function retry(request) {
    if (state.running || !state.input) return;
    state.running = true;
    setBusy(true);
    try {
      if (request === "analyze") {
        await runAnalyze();
      } else if (await runRequest(request)) {
        await runAnalyze();
      }
    } finally {
      state.running = false;
      setBusy(false);
      $("progressText").textContent = "";
    }
  }

  /** The main flow: validate, call every section in parallel, then score. */
  async function generate() {
    if (state.running || state.keyMissing) return;
    const input = readForm();
    if (!validateTopic(input.topic)) return;

    state.running = true;
    state.input = input;
    state.results = {};
    updateDownloadState();
    setBusy(true);

    $("emptyState").hidden = true;
    $("results").hidden = false;
    setNavReady(true);
    buildCards();
    // The score card waits for the others.
    const scoreCard = cardsForRequest("analyze")[0];
    if (scoreCard) setLoading(scoreCard.id, "Waiting for the other sections");
    $("sec-" + (activeCards()[0] || {}).id)?.scrollIntoView({ behavior: "smooth", block: "start" });

    const requests = [...new Set(activeCards().filter((c) => c.request !== "analyze").map((c) => c.request))];
    let finished = 0;
    let succeeded = 0;
    const report = () => ($("progressText").textContent = `${finished} of ${requests.length} sections ready`);
    report();

    await Promise.all(
      requests.map(async (request) => {
        if (await runRequest(request)) succeeded += 1;
        finished += 1;
        report();
      })
    );

    $("progressText").textContent = "Scoring your SEO package...";
    await runAnalyze();

    state.running = false;
    setBusy(false);
    $("progressText").textContent = succeeded === requests.length ? "All sections ready." : `${requests.length - succeeded} section(s) failed. Use Retry on the card.`;
  }

  /* ------------------------------------------------------------------------
     6. Form helpers, copy and download
     ------------------------------------------------------------------------ */
  function readForm() {
    return {
      topic: $("topic").value.trim(),
      category: $("category").value,
      language: $("language").value,
      model: $("model").value,
    };
  }

  function validateTopic(topic) {
    const { min_input_chars: min, max_input_chars: max } = state.config.limits;
    let message = "";
    if (topic.length < min) message = `Enter at least ${min} characters about your video.`;
    else if (topic.length > max) message = `That is ${topic.length} characters. The limit is ${max}.`;
    $("topicError").textContent = message;
    $("topic").classList.toggle("has-error", Boolean(message));
    if (message) $("topic").focus();
    return !message;
  }

  function updateTopicMeta() {
    const text = $("topic").value;
    const max = state.config ? state.config.limits.max_input_chars : 12000;
    const kind = text.length > 500 || text.split("\n").length > 3 ? "script" : "topic";
    $("topicMeta").textContent = text.length ? `${text.length} / ${max} characters, treated as a ${kind}` : "0 characters";
    if (text.length >= 10) {
      $("topicError").textContent = "";
      $("topic").classList.remove("has-error");
    }
  }

  function setBusy(busy) {
    const btn = $("generateBtn");
    btn.classList.toggle("is-loading", busy);
    btn.disabled = busy || state.keyMissing;
    $("generateLabel").textContent = busy ? "Generating..." : "Generate SEO";
    btn.title = state.keyMissing ? "Add OPENROUTER_API_KEY on the server first" : "";
    ["category", "language", "model", "topic"].forEach((id) => ($(id).disabled = busy));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fallback for older browsers or non-secure pages.
      const ta = h("textarea", { style: { position: "fixed", opacity: "0" } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (_) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  async function copyWithFeedback(btn, text) {
    const ok = await copyText(text);
    const label = btn.querySelector("span");
    const original = label ? label.textContent : "";
    btn.classList.toggle("is-copied", ok);
    if (label && ok) label.textContent = "Copied";
    toast(ok ? "Copied to clipboard" : "Copy failed. Select the text and copy it manually.");
    setTimeout(() => {
      btn.classList.remove("is-copied");
      if (label) label.textContent = original;
    }, 1500);
  }

  const hasResults = () => Object.keys(state.results).length > 0;
  function updateDownloadState() {
    $("dlTxt").disabled = !hasResults();
    $("dlJson").disabled = !hasResults();
  }

  const REPORT_ORDER = ["titles", "description", "keywords", "tags", "hashtags", "thumbnails", "shorts", "score"];

  function reportText() {
    const input = state.input || {};
    const parts = [
      "YOUTUBE SEO REPORT",
      `Generated: ${new Date().toLocaleString()}`,
      `Category: ${input.category}   Language: ${input.language}   Model: ${input.model}`,
      "",
      "VIDEO TOPIC / SCRIPT",
      input.topic,
    ];
    for (const id of REPORT_ORDER) {
      if (!state.results[id]) continue;
      const card = CARDS.find((c) => c.id === id);
      parts.push("", "=".repeat(60), card.label.toUpperCase(), "=".repeat(60), TEXT[id](state.results[id]));
    }
    return parts.join("\n");
  }

  function reportJSON() {
    const r = state.results;
    return {
      generated_at: new Date().toISOString(),
      input: state.input,
      results: {
        titles: r.titles ? r.titles.titles : undefined,
        description: r.description ? r.description.description : undefined,
        keywords: r.keywords,
        tags: r.tags ? r.tags.tags : undefined,
        hashtags: r.hashtags ? r.hashtags.hashtags : undefined,
        thumbnails: r.thumbnails ? r.thumbnails.thumbnails : undefined,
        shorts: r.shorts ? r.shorts.shorts : undefined,
        seo_score: r.score,
      },
    };
  }

  function download(filename, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const a = h("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  /* ------------------------------------------------------------------------
     7. Theme and navigation
     ------------------------------------------------------------------------ */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("tuberank-theme", theme);
    } catch (_) {
      /* storage can be blocked; the theme still works for this visit */
    }
    $("themeIcon").firstElementChild.setAttribute("href", theme === "dark" ? "#i-sun" : "#i-moon");
    $("themeBtn").setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }

  function setNavReady(ready) {
    document.querySelectorAll(".nav-link[data-feature]").forEach((a) => a.classList.toggle("is-disabled", !ready));
  }

  function setActiveNav(targetId) {
    document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("is-active", a.dataset.target === targetId));
  }

  function closeSidebar() {
    $("sidebar").classList.remove("is-open");
    $("scrim").hidden = true;
    $("menuBtn").setAttribute("aria-expanded", "false");
  }

  function initNavigation() {
    $("menuBtn").addEventListener("click", () => {
      const open = $("sidebar").classList.toggle("is-open");
      $("scrim").hidden = !open;
      $("menuBtn").setAttribute("aria-expanded", String(open));
    });
    $("scrim").addEventListener("click", closeSidebar);
    document.addEventListener("keydown", (e) => e.key === "Escape" && closeSidebar());

    document.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        let target = $(link.dataset.target);
        if (!target || target.closest("[hidden]")) target = $("composer"); // results do not exist yet
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveNav(target.id);
        closeSidebar();
      });
    });

    // Highlight the sidebar link of the section currently in view.
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && setActiveNav(entry.target.id)),
      { rootMargin: "-25% 0px -65% 0px" }
    );
    observer.observe($("composer"));
    new MutationObserver(() => document.querySelectorAll(".card").forEach((c) => observer.observe(c))).observe($("results"), { childList: true });
  }

  /* ------------------------------------------------------------------------
     8. Startup
     ------------------------------------------------------------------------ */
  function fillSelect(select, items, selected) {
    select.replaceChildren(...items.map((item) => h("option", { value: item.value, text: item.label, selected: item.value === selected })));
  }

  function showLoadError(message) {
    $("composer").before(h("div", { class: "banner banner-warn", role: "alert" }, icon("alert"), h("div", { text: message })));
    $("generateBtn").disabled = true;
  }

  async function init() {
    applyTheme(document.documentElement.getAttribute("data-theme") || "light");
    $("themeBtn").addEventListener("click", () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));
    initNavigation();
    setNavReady(false);
    updateDownloadState();

    $("topic").addEventListener("input", updateTopicMeta);
    $("topic").addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") generate();
    });
    $("seoForm").addEventListener("submit", (e) => {
      e.preventDefault();
      generate();
    });
    $("dlTxt").addEventListener("click", () => download(`youtube-seo-report-${stamp()}.txt`, reportText(), "text/plain"));
    $("dlJson").addEventListener("click", () => download(`youtube-seo-report-${stamp()}.json`, JSON.stringify(reportJSON(), null, 2), "application/json"));

    // Load public settings from the backend (models, languages, limits, feature flags).
    try {
      const res = await fetch("/api/config");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error();
      state.config = body.data;
    } catch (_) {
      showLoadError("Could not load settings from the server. Start the Flask app with python app.py and reload this page.");
      return;
    }

    const cfg = state.config;
    $("brandName").textContent = cfg.app.name;
    $("brandTagline").textContent = cfg.app.tagline;
    document.title = `${cfg.app.name} | YouTube SEO Assistant`;
    fillSelect($("category"), cfg.categories.map((c) => ({ value: c, label: c })), cfg.categories[0]);
    fillSelect($("language"), cfg.languages.map((l) => ({ value: l, label: l })), cfg.languages[0]);
    fillSelect($("model"), cfg.models.map((m) => ({ value: m.id, label: m.label })), cfg.default_model);
    $("topic").maxLength = cfg.limits.max_input_chars + 2000; // soft guard; the exact limit is validated on submit

    // Hide sidebar links for features switched off in config.json.
    document.querySelectorAll(".nav-link[data-feature]").forEach((a) => {
      if (cfg.features[a.dataset.feature] === false) a.hidden = true;
    });

    // Warn early if the server has no API key.
    try {
      const health = await (await fetch("/api/health")).json();
      if (!health.api_key_configured) {
        state.keyMissing = true;
        $("keyBanner").hidden = false;
      }
    } catch (_) {
      /* the first real request will surface any connection problem */
    }
    setBusy(false);
  }

  init();
})();

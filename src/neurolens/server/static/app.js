/* NeuroLens evidence workspace — single-page app, no build step.
 * Screens are grouped Build / Evaluate / Inspect / Release per DESIGN.md §4. */
(function () {
  "use strict";

  const NAV = [
    { group: "Workspace", items: [
      { id: "home", label: "Workspace home" },
      { id: "datasets", label: "Dataset manifests" },
    ]},
    { group: "Build", items: [
      { id: "data-audit", label: "Data audit & QC" },
      { id: "cohort", label: "Target & splits" },
      { id: "features", label: "Feature catalog" },
    ]},
    { group: "Evaluate", items: [
      { id: "audit", label: "Audit dashboard" },
      { id: "comparison", label: "Run comparison" },
    ]},
    { group: "Inspect", items: [
      { id: "fairness", label: "Fairness audit" },
      { id: "reliability", label: "Reliability & OOD" },
      { id: "cases", label: "Case explorer" },
    ]},
    { group: "Release", items: [
      { id: "model-card", label: "Model card" },
      { id: "reproducibility", label: "Reproducibility" },
      { id: "export", label: "Export center" },
      { id: "glossary", label: "Help / glossary" },
    ]},
  ];

  const state = { report: null, runId: null, runs: [], cases: [], caseFilter: { flagged: false, search: "" } };

  /* ------------------------------------------------------------ utilities */
  const $ = (sel, root) => (root || document).querySelector(sel);
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }
  const isNum = v => typeof v === "number" && !Number.isNaN(v);
  function fmt(v, d) {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (!isNum(v)) return String(v);
    if (!Number.isFinite(v)) return "—";
    return v.toFixed(d === undefined ? 3 : d);
  }
  function ci(v, interval, d) {
    const point = fmt(v, d);
    if (!interval || interval.length !== 2 || !isNum(interval[0])) return point;
    return `${point} [${fmt(interval[0], d)}, ${fmt(interval[1], d)}]`;
  }
  function chip(text, kind) { return el("span", { class: `chip ${kind || "neutral"}` }, String(text)); }
  function statusChip(status) {
    const s = String(status || "").toUpperCase();
    if (s === "PASS") return chip("PASS", "pass");
    if (s === "WARN") return chip("WARN", "warn");
    if (s.indexOf("INSUFFICIENT") === 0) return chip("INSUFFICIENT DATA", "insufficient");
    if (s === "LOCKED") return chip("LOCKED", "locked");
    return chip(s || "—", "neutral");
  }
  function adequacyChip(a) {
    const s = String(a || "");
    if (s === "ADEQUATE") return chip("ADEQUATE", "pass");
    if (s === "EXPLORATORY") return chip("EXPLORATORY", "warn");
    return chip("INSUFFICIENT DATA", "insufficient");
  }
  function panel(title, actions, body) {
    return el("section", { class: "panel" }, [
      (title || actions) ? el("div", { class: "panel-head" }, [
        title ? el("h3", null, title) : null,
        actions ? el("div", { class: "pill-row" }, actions) : null,
      ]) : null,
      body,
    ]);
  }
  function evidenceCard(label, value, unit, qualifier, n) {
    return el("div", { class: "evidence-card" }, [
      el("div", { class: "ec-label" }, label),
      el("div", { class: "ec-value" }, [String(value), unit ? el("span", { class: "ec-unit" }, unit) : null]),
      qualifier ? el("div", { class: "ec-qualifier" }, qualifier) : null,
      n !== undefined && n !== null ? el("div", { class: "ec-n" }, `n = ${n}`) : null,
    ]);
  }
  function table(columns, rows, opts) {
    opts = opts || {};
    const head = el("tr", null, columns.map(c =>
      el("th", { class: c.num ? "num" : null, scope: "col" }, c.label)));
    const body = rows.map(row => el("tr", null, columns.map(c => {
      const value = c.render ? c.render(row) : row[c.key];
      const cell = el("td", { class: c.num ? "num" : null, "data-label": c.label });
      if (value instanceof Node) cell.appendChild(value);
      else if (value === null || value === undefined || value === "") cell.appendChild(el("span", { class: "missing" }, "—"));
      else cell.textContent = String(value);
      return cell;
    })));
    return el("div", { class: "table-wrap" }, el("table", null, [
      opts.caption ? el("caption", null, opts.caption) : null,
      el("thead", null, head), el("tbody", null, body),
    ]));
  }
  function emptyState(title, detail, action) {
    return el("div", { class: "state-panel" }, [
      el("h3", null, title), el("p", null, detail || ""), action || null,
    ]);
  }
  function alert(kind, title, lines) {
    return el("div", { class: `alert ${kind}`, role: kind === "risk" ? "alert" : "status" }, [
      el("strong", null, title),
      el("span", null, Array.isArray(lines) ? lines.join(" ") : (lines || "")),
    ]);
  }
  function kv(pairs) {
    const list = el("dl", { class: "kv" });
    pairs.forEach(([k, v]) => {
      list.appendChild(el("dt", null, k));
      list.appendChild(el("dd", null, v === null || v === undefined || v === "" ? "—" : String(v)));
    });
    return list;
  }
  function figure(name, caption, src) {
    if (!src) return null;
    return el("figure", { class: "plot" }, [
      el("img", { src: src, alt: caption || name }),
      el("figcaption", null, caption || name.replace(/_/g, " ")),
    ]);
  }

  /* ------------------------------------------------------------ svg charts */
  function svgIntervalChart(rows) {
    // rows: {label, value, low, high, status}
    const W = 640, rowH = 22, padL = 190, padR = 24, padT = 14, padB = 24;
    const H = padT + padB + rows.length * rowH;
    const values = rows.flatMap(r => [r.low, r.high, r.value]).filter(isNum);
    if (!values.length) return null;
    const min = Math.min(...values), max = Math.max(...values);
    const span = (max - min) || 1;
    const x = v => padL + ((v - min + span * 0.06) / (span * 1.12)) * (W - padL - padR);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    const add = (tag, attrs, text) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      if (text !== undefined) node.textContent = text;
      svg.appendChild(node);
      return node;
    };
    const zero = x(0);
    add("line", { class: "axis", x1: zero, y1: padT, x2: zero, y2: H - padB, stroke: "#687784" });
    rows.forEach((r, i) => {
      const y = padT + i * rowH + rowH / 2;
      const colour = r.status === "WARN" ? "#9A5B00" : (r.status === "INSUFFICIENT DATA" ? "#A43D45" : "#146C70");
      add("text", { x: padL - 8, y: y + 3.5, "text-anchor": "end" }, `${r.label} (n=${r.n})`);
      if (!isNum(r.low) || !isNum(r.high)) {
        add("text", { x: padL + 6, y: y + 3.5, fill: "#A43D45" }, "no estimate reported");
        return;
      }
      add("line", { x1: x(r.low), y1: y, x2: x(r.high), y2: y, stroke: colour, "stroke-width": 1.4 });
      add("circle", { cx: x(r.value), cy: y, r: 3.2, fill: colour });
    });
    add("text", { x: W - padR, y: H - 6, "text-anchor": "end" }, "error gap vs reference group");
    return svg;
  }

  function svgScatter(points, opts) {
    // points: [{x,y,flag}]
    opts = opts || {};
    const W = 560, H = 340, padL = 52, padR = 18, padT = 16, padB = 42;
    const xs = points.map(p => p.x).filter(isNum), ys = points.map(p => p.y).filter(isNum);
    if (!xs.length) return null;
    const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xSpan = (xMax - xMin) || 1, ySpan = (yMax - yMin) || 1;
    const X = v => padL + ((v - xMin) / xSpan) * (W - padL - padR);
    const Y = v => H - padB - ((v - yMin) / ySpan) * (H - padT - padB);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    const add = (tag, attrs, text) => {
      const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text !== undefined) n.textContent = text;
      svg.appendChild(n);
      return n;
    };
    for (let i = 0; i <= 4; i++) {
      const y = padT + i * (H - padT - padB) / 4;
      add("line", { class: "grid", x1: padL, y1: y, x2: W - padR, y2: y });
      add("text", { x: padL - 6, y: y + 3.5, "text-anchor": "end" },
          (yMax - i * ySpan / 4).toFixed(2));
    }
    add("line", { class: "axis", x1: padL, y1: H - padB, x2: W - padR, y2: H - padB });
    add("line", { class: "axis", x1: padL, y1: padT, x2: padL, y2: H - padB });
    points.forEach(p => {
      if (!isNum(p.x) || !isNum(p.y)) return;
      add("circle", { cx: X(p.x), cy: Y(p.y), r: 3.1,
        fill: p.flag ? "#A43D45" : "#146C70", "fill-opacity": 0.72 });
    });
    add("text", { x: (padL + W - padR) / 2, y: H - 8, "text-anchor": "middle" }, opts.xLabel || "x");
    const yl = add("text", { x: 14, y: (padT + H - padB) / 2, "text-anchor": "middle",
      transform: `rotate(-90 14 ${(padT + H - padB) / 2})` }, opts.yLabel || "y");
    yl.setAttribute("fill", "#3B4A57");
    return svg;
  }

  function svgBars(items, opts) {
    opts = opts || {};
    const W = 560, rowH = 20, padL = 210, padR = 30, padT = 10, padB = 22;
    const H = padT + padB + items.length * rowH;
    const maxAbs = Math.max(...items.map(i => Math.abs(i.value)).filter(isNum), 1e-9);
    const zeroX = padL + (W - padL - padR) / 2;
    const scale = v => (v / maxAbs) * ((W - padL - padR) / 2);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    const add = (tag, attrs, text) => {
      const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text !== undefined) n.textContent = text;
      svg.appendChild(n);
      return n;
    };
    add("line", { class: "axis", x1: zeroX, y1: padT, x2: zeroX, y2: H - padB, stroke: "#17212B" });
    items.forEach((item, i) => {
      const y = padT + i * rowH + 3;
      const v = isNum(item.value) ? item.value : 0;
      add("text", { x: padL - 8, y: y + 11, "text-anchor": "end" }, item.label);
      add("rect", { x: v >= 0 ? zeroX : zeroX + scale(v), y: y,
        width: Math.abs(scale(v)), height: rowH - 8,
        fill: item.colour || "#2E5E8C", "fill-opacity": 0.85, rx: 1 });
    });
    return svg;
  }

  /* ------------------------------------------------------------------ data */
  async function api(path) {
    const response = await fetch(path);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${response.status} ${path} ${detail}`);
    }
    return response.json();
  }

  function figureSrc(name) {
    const figures = (state.report && state.report.figures) || {};
    if (!figures[name]) return null;
    return `/api/figures/${name}.png${state.runId ? `?run=${encodeURIComponent(state.runId)}` : ""}`;
  }

  /* ---------------------------------------------------------------- screens */
  const screens = {};

  screens.home = () => {
    const r = state.report;
    const readiness = r.release_readiness || { checks: {}, blockers: [] };
    const cohort = r.cohort || {};
    const continuous = (r.tasks && r.tasks.continuous) || {};
    const metrics = continuous.metrics || {};
    const stageMetrics = ((r.tasks || {}).stage || {}).metrics || {};
    const trust = r.trust || {};
    const fairness = r.fairness || {};

    const main = el("div", null, [
      el("h1", { class: "page-display" }, r.project_name || "NeuroLens"),
      el("p", { class: "lede" }, r.research_question || ""),
    ]);

    const checks = Object.entries(readiness.checks || {});
    main.appendChild(panel(
      readiness.release_ready ? "Release readiness — no blockers" : "Release readiness — blockers present",
      [readiness.release_ready ? chip("READY", "pass") : chip("BLOCKED", "insufficient")],
      el("div", null, [
        el("div", { class: "grid grid-3" }, checks.map(([name, ok]) =>
          el("div", { class: "evidence-card" }, [
            el("div", { class: "ec-label" }, name.replace(/_/g, " ")),
            el("div", null, ok ? chip("PASS", "pass") : chip("BLOCKED", "insufficient")),
          ]))),
        (readiness.blockers || []).length
          ? alert("risk", "Blockers", (readiness.blockers || []).map(b => `• ${b}`).join("\n"))
          : null,
      ])));

    main.appendChild(el("h2", null, "Headline results"));
    main.appendChild(el("div", { class: "grid grid-4" }, [
      evidenceCard("Continuous MAE", fmt(metrics.mae), "",
        `95% CI ${ci(metrics.mae, metrics.mae_ci)}`, metrics.n),
      evidenceCard("Stage macro-F1", fmt(stageMetrics.macro_f1), "",
        `balanced accuracy ${fmt(stageMetrics.balanced_accuracy)}`, stageMetrics.n),
      evidenceCard("Interval coverage", fmt(continuous.intervals && continuous.intervals.picp), "",
        `target ${fmt(continuous.intervals && continuous.intervals.target_coverage, 2)} · mean width ${fmt(continuous.intervals && continuous.intervals.mean_interval_width)}`,
        continuous.intervals && continuous.intervals.n),
      evidenceCard("OOD AUROC (shift)", fmt(trust.ood && trust.ood.auroc_shift_detection, 2), "",
        (trust.ood && trust.ood.verdict) || "—", trust.ood && trust.ood.n),
    ]));

    main.appendChild(el("h2", null, "Cohort at a glance"));
    main.appendChild(el("div", { class: "grid grid-4" }, [
      evidenceCard("Patients indexed", cohort.n_indexed, "", "before target/exclusion rules"),
      evidenceCard("Patients analysed", cohort.n_analysed, "", `${cohort.n_excluded} excluded with reasons`),
      evidenceCard("Test partition", cohort.split && (cohort.split.counts || {}).test, "",
        `split hash ${cohort.split && cohort.split.split_hash}`),
      evidenceCard("Leakage", cohort.split && cohort.split.leakage_free ? "none" : "DETECTED", "",
        "patients shared across partitions"),
    ]));

    const mods = cohort.modalities_available || {};
    main.appendChild(panel("Modalities present in this run", null, el("div", { class: "pill-row" },
      Object.entries(mods).map(([name, present]) =>
        present ? chip(name, name === "mri" ? "mri" : name) : chip(`${name} — unavailable`, "insufficient")))));

    if ((cohort.qc_reasons && Object.keys(cohort.qc_reasons).length) || true) {
      main.appendChild(panel("Needs review", null, el("div", null, [
        table([
          { key: "reason", label: "Event" }, { key: "count", label: "Count", num: true },
        ], Object.entries(cohort.qc_reasons || {}).map(([reason, count]) => ({ reason, count })),
          { caption: "Every sample that did not reach the analysis cohort, with its reason." }),
      ])));
    }

    main.appendChild(panel("Research-use statement", null,
      alert("review", "Research prototype", r.research_use_notice)));
    return main;
  };

  screens["data-audit"] = () => {
    const c = state.report.cohort || {};
    const main = el("div", null, [el("h1", null, "Data audit & QC")]);
    main.appendChild(alert("info", "Dataset provenance",
      `${c.dataset_title || c.dataset} · ${c.dataset_version} · access: ${c.dataset_access} · license: ${c.dataset_license}`));

    main.appendChild(el("div", { class: "grid grid-4" }, [
      evidenceCard("Patients indexed", c.n_indexed), evidenceCard("Analysed", c.n_analysed),
      evidenceCard("Excluded", c.n_excluded), evidenceCard("QC events logged", c.n_qc_events),
    ]));

    main.appendChild(panel("Missingness by feature", null,
      table([{ key: "feature", label: "Feature" }, { key: "family", label: "Family" },
             { key: "missing", label: "Missing fraction", num: true }],
        Object.entries(c.feature_missingness || {}).map(([feature, value]) => ({
          feature, family: familyOf(feature), missing: fmt(value, 3),
        })).sort((a, b) => b.missing - a.missing).slice(0, 40))));

    const ledger = c.qc_ledger || [];
    main.appendChild(panel(`QC ledger (${ledger.length} events)`, null,
      table([
        { key: "stage", label: "Stage" }, { key: "entity_type", label: "Entity" },
        { key: "entity_id", label: "ID" }, { key: "reason", label: "Reason" },
        { key: "severity", label: "Severity", render: row => chip(row.severity,
            row.severity === "error" ? "insufficient" : row.severity === "warning" ? "warn" : "neutral") },
        { key: "detail", label: "Detail" },
      ], ledger.slice(0, 400), { caption: "Nothing is dropped silently — every exclusion is recorded here." })));

    main.appendChild(panel("Subgroup sizes (before adequacy judgement)", null,
      table([{ key: "axis", label: "Axis" }, { key: "subgroup", label: "Subgroup" },
             { key: "n", label: "n", num: true },
             { key: "adequacy", label: "Adequacy", render: row => adequacyChip(
                 row.n >= 30 ? "ADEQUATE" : row.n >= 10 ? "EXPLORATORY" : "INSUFFICIENT DATA") }],
        Object.entries(c.subgroup_sizes || {}).flatMap(([axis, groups]) =>
          Object.entries(groups).map(([subgroup, n]) => ({ axis, subgroup, n })))
          .sort((a, b) => a.axis.localeCompare(b.axis) || b.n - a.n))));
    return main;
  };

  screens.cohort = () => {
    const c = state.report.cohort || {};
    const t = c.target_definition || {};
    const s = c.split || {};
    const main = el("div", null, [el("h1", null, "Target definition & splits")]);

    main.appendChild(panel("Frozen target definition", [chip(t.version || "—", "locked")],
      kv([
        ["Continuous endpoint", t.outcome_measure],
        ["Index session", t.index_session], ["Outcome session", t.outcome_session],
        ["Annualised", t.annualized ? "yes" : "no"],
        ["Sign convention", t.sign_convention],
        ["Units", t.units],
        ["Stage definition", t.stage_definition],
        ["Stage cut-points", JSON.stringify(t.stage_cutpoints)],
        ["Stage labels", JSON.stringify(t.stage_labels)],
        ["Definition version", t.version],
      ])));

    main.appendChild(el("div", { class: "grid grid-2" }, [
      panel("Target distribution", null, el("div", null, [
        evidenceCard("n", (c.target_distribution || {}).n),
        figure("target_distribution", "Continuous target distribution", figureSrc("target_distribution")),
        kv(Object.entries(c.target_distribution || {}).map(([k, v]) => [k, fmt(v, 3)])),
      ])),
      panel("Stage distribution at outcome", null,
        table([{ key: "stage", label: "Stage" }, { key: "n", label: "n", num: true }],
          Object.entries(c.stage_distribution || {}).map(([stage, n]) => ({ stage, n })))),
    ]));

    const leakageOk = s.leakage_free;
    main.appendChild(panel("Split verification", [leakageOk ? chip("LEAKAGE-FREE", "pass") : chip("LEAKAGE", "insufficient")],
      el("div", null, [
        kv([
          ["Strategy", s.strategy], ["Version", s.split_version], ["Seed", s.seed],
          ["Stratified on", s.stratified_on || "none"],
          ["Split hash", s.split_hash],
          ["train / validation / test",
            `${(s.counts || {}).train} / ${(s.counts || {}).validation} / ${(s.counts || {}).test}`],
        ]),
        table([{ key: "pair", label: "Partition pair" }, { key: "shared", label: "Shared patients", num: true }],
          Object.entries(s.patient_overlap || {}).map(([pair, shared]) => ({ pair, shared }))),
      ])));

    main.appendChild(panel("Distribution-shift cohort (held out for OOD evaluation)", null,
      kv([["Definition", JSON.stringify((c.shift_cohort || {}).definition)],
          ["n in shift cohort", (c.shift_cohort || {}).n],
          ["n total", c.n_analysed]])));
    return main;
  };

  screens.features = () => {
    const c = state.report.cohort || {};
    const features = c.features || [];
    const main = el("div", null, [el("h1", null, "Feature catalog")]);
    const counts = c.modality_feature_counts || {};
    main.appendChild(el("div", { class: "pill-row" },
      Object.entries(counts).map(([family, n]) =>
        n > 0 ? el("span", null, [chip(family, family), ` ${n} feature${n === 1 ? "" : "s"}`]) : null)));
    if (!features.length) {
      main.appendChild(emptyState("No features available",
        "This dataset did not provide usable features for the configured modalities."));
      return main;
    }
    main.appendChild(panel(`Features (${features.length})`, null,
      table([{ key: "feature", label: "Feature" },
             { key: "family", label: "Family", render: row => chip(row.family, row.family) },
             { key: "label", label: "Readable label" },
             { key: "missing", label: "Missing", num: true }],
        features.map(name => ({
          feature: name, family: familyOf(name), label: labelOf(name),
          missing: fmt((c.feature_missingness || {})[name] || 0, 3),
        })),
        { caption: `Feature version ${c.target_definition ? "" : ""}${(c.features || []).length} columns. Raw and ICV-normalised volumes are kept separately where both exist.` })));
    main.appendChild(figure("global_importance", "Global permutation importance", figureSrc("global_importance")));
    return main;
  };

  screens.audit = () => {
    const r = state.report;
    const continuous = r.tasks.continuous || {};
    const stage = r.tasks.stage || {};
    const trust = r.trust || {};
    const main = el("div", null, [el("h1", null, "Audit dashboard")]);

    main.appendChild(panel("Continuous progression", [chip(continuous.model || "—", "locked")],
      el("div", null, [
        el("div", { class: "grid grid-3" }, [
          evidenceCard("MAE", fmt(continuous.metrics.mae), "", `95% CI ${ci(continuous.metrics.mae, continuous.metrics.mae_ci)}`, continuous.metrics.n),
          evidenceCard("RMSE", fmt(continuous.metrics.rmse), "", `95% CI ${ci(continuous.metrics.rmse, continuous.metrics.rmse_ci)}`, continuous.metrics.n),
          evidenceCard("R²", fmt(continuous.metrics.r2), "", `bias ${fmt(continuous.metrics.bias)}`, continuous.metrics.n),
        ]),
        figure("predicted_vs_observed", "Predicted vs observed with prediction intervals", figureSrc("predicted_vs_observed")),
        kv([["Calibration slope", fmt(continuous.calibration_regression && continuous.calibration_regression.slope)],
            ["Calibration intercept", fmt(continuous.calibration_regression && continuous.calibration_regression.intercept)],
            ["Interpretation", continuous.calibration_regression && continuous.calibration_regression.interpretation],
            ["Interval method", continuous.conformal && continuous.conformal.method],
            ["Coverage assumption", continuous.conformal && continuous.conformal.assumption],
            ["Coverage (observed / target)",
              `${fmt(continuous.intervals && continuous.intervals.picp)} / ${fmt(continuous.intervals && continuous.intervals.target_coverage, 2)}`],
            ["Mean interval width", fmt(continuous.intervals && continuous.intervals.mean_interval_width)],
            ["Winkler score", fmt(continuous.intervals && continuous.intervals.winkler_score)],
            ["Units", (r.cohort.target_definition || {}).units]]),
      ])));

    main.appendChild(panel("Disease stage", [chip(stage.model || "—", "locked")],
      el("div", null, [
        el("div", { class: "grid grid-3" }, [
          evidenceCard("Macro-F1", fmt(stage.metrics.macro_f1), "", "primary metric", stage.metrics.n),
          evidenceCard("Balanced accuracy", fmt(stage.metrics.balanced_accuracy), "", "", stage.metrics.n),
          evidenceCard("AUROC (OvR)", fmt(stage.metrics.auroc_ovr_macro), "", stage.metrics.auroc_note || "macro, one-vs-rest", stage.metrics.n),
        ]),
        alert("info", "Accuracy is not the primary metric",
          `Observed accuracy is ${fmt(stage.metrics.accuracy)}; with this class imbalance it is reported for context only.`),
        table([{ key: "label", label: "Class" }, { key: "support", label: "Support", num: true },
               { key: "predicted", label: "Predicted", num: true },
               { key: "precision", label: "Precision", num: true },
               { key: "recall", label: "Recall", num: true }, { key: "f1", label: "F1", num: true }],
          Object.entries(stage.metrics.per_class || {}).map(([label, v]) => ({
            label, support: v.support, predicted: v.predicted,
            precision: fmt(v.precision), recall: fmt(v.recall), f1: fmt(v.f1),
          }))),
        confusionTable(stage),
      ])));

    main.appendChild(panel("Reliability summary", null, el("div", null, [
      el("div", { class: "grid grid-3" }, [
        evidenceCard("Uncertainty–error ρ", fmt(trust.uncertainty_error && trust.uncertainty_error.spearman, 2), "",
          (trust.uncertainty_error && trust.uncertainty_error.verdict) || "—",
          trust.uncertainty_error && trust.uncertainty_error.n),
        evidenceCard("AURC", fmt(trust.risk_coverage && trust.risk_coverage.aurc), "",
          `MAE at 50% abstention ${fmt(trust.risk_coverage && trust.risk_coverage.mae_at_50pct_abstention)}`),
        evidenceCard("High-confidence but wrong", (trust.confident_and_wrong || {}).n, "",
          `of ${(trust.confident_and_wrong || {}).n_total} test cases`),
      ]),
      figure("risk_coverage", "Risk–coverage curve (selective prediction)", figureSrc("risk_coverage")),
    ])));

    main.appendChild(panel("Explanations", null, el("div", null, [
      figure("global_importance", "Global permutation importance", figureSrc("global_importance")),
      figure("case_attribution", "Representative case attribution", figureSrc("case_attribution")),
      alert("review", "Association, not causation",
        (r.explainability || {}).causation_notice || "Model association is not biological causation."),
    ])));

    main.appendChild(panel("Limitations", null, el("ul", null,
      (r.limitations || []).map(item => el("li", null, item)))));
    main.appendChild(panel("Known failure modes", null, el("ul", null,
      (r.known_failure_modes || []).map(item => el("li", null, item)))));
    return main;
  };

  function confusionTable(stage) {
    const matrix = stage.metrics.confusion_matrix;
    const labels = stage.metrics.confusion_labels;
    if (!matrix || !labels) return null;
    const columns = [{ key: "row", label: "Actual ↓ / Predicted →" }].concat(
      labels.map((label, i) => ({ key: `c${i}`, label, num: true })));
    const rows = matrix.map((row, i) => {
      const record = { row: labels[i] };
      row.forEach((v, j) => { record[`c${j}`] = v; });
      return record;
    });
    return table(columns, rows, { caption: "Confusion matrix on the held-out test partition." });
  }

  screens.comparison = () => {
    const cells = state.report.model_comparison || [];
    const main = el("div", null, [el("h1", null, "Run comparison")]);
    const split = state.report.cohort.split || {};
    main.appendChild(alert("info", "Identical test partition for every cell",
      `All cells below were evaluated on the same ${split.counts ? split.counts.test : "?"} held-out patients ` +
      `(split hash ${split.split_hash}). No cell used a different test set.`));

    const rows = cells.map(cell => {
      const isContinuous = cell.task === "continuous";
      return {
        name: cell.name, task: cell.task, family: cell.family, comparison: cell.comparison,
        mitigation: cell.mitigation, features: cell.n_features,
        primary: isContinuous ? fmt(cell.metrics.mae) : fmt(cell.metrics.macro_f1),
        primaryLabel: isContinuous ? "MAE" : "macro-F1",
        worst: fmt(cell.worst_group_error), overall: fmt(cell.overall_error),
        error: cell.error,
      };
    });
    main.appendChild(panel("Model cells", null,
      table([
        { key: "name", label: "Cell" },
        { key: "task", label: "Task" },
        { key: "comparison", label: "Modality set", render: row => chip(row.comparison.replace("_", " "), "mri") },
        { key: "mitigation", label: "Mitigation" },
        { key: "features", label: "Features", num: true },
        { key: "primary", label: "Primary metric", num: true,
          render: row => row.error ? el("span", { class: "missing" }, "failed") : `${row.primaryLabel} ${row.primary}` },
        { key: "overall", label: "Overall error", num: true },
        { key: "worst", label: "Worst-group error", num: true },
      ], rows, { caption: "Primary metric is MAE for the continuous task and macro-F1 for the stage task." })));

    const skipped = state.report.skipped_comparisons || [];
    if (skipped.length) {
      main.appendChild(alert("review", "Comparisons skipped",
        skipped.map(s => `${s.comparison}: ${s.reason}`).join(" · ")));
    }
    main.appendChild(figure("mitigation_tradeoff", "Overall vs worst-group error by mitigation", figureSrc("mitigation_tradeoff")));
    return main;
  };

  screens.fairness = () => {
    const fairness = state.report.fairness || {};
    const rows = fairness.rows || [];
    const axes = Array.from(new Set(rows.map(r => r.axis)));
    const main = el("div", null, [el("h1", null, "Fairness audit")]);

    main.appendChild(alert("info", "Three judgements, not one",
      "Every subgroup carries adequacy (is there enough data?), status (is the estimate concerning?), " +
      "and a gap with its own confidence interval. Only adverse gaps — worse than the reference group — are flagged."));

    const worst = fairness.worst_group || {};
    main.appendChild(el("div", { class: "grid grid-4" }, [
      evidenceCard("Worst group", worst.worst_group || "—", "", `axis ${worst.worst_axis || "—"}`, worst.worst_n),
      evidenceCard("Worst-group error", fmt(worst.worst_estimate), "", `best ${fmt(worst.best_estimate)}`),
      evidenceCard("Reportable subgroups", worst.n_reportable, "", `${worst.n_warn} flagged WARN`),
      evidenceCard("Insufficient data", worst.n_insufficient, "", "no estimate reported"),
    ]));

    const tabs = el("div", { class: "tabs", role: "tablist" });
    const body = el("div", null);
    const render = axis => {
      body.innerHTML = "";
      const subset = axis === "__all" ? rows : rows.filter(r => r.axis === axis);
      const chartRows = subset.map(r => ({ label: r.subgroup, value: r.gap, low: (r.gap_ci || [])[0],
        high: (r.gap_ci || [])[1], status: r.status, n: r.n }));
      const chart = svgIntervalChart(chartRows);
      if (chart) body.appendChild(el("figure", { class: "plot" }, [chart,
        el("figcaption", null, "Error gap vs the reference group with 95% CI. Points left of zero are better than the reference.")]));
      body.appendChild(table([
        { key: "subgroup", label: "Subgroup" },
        { key: "n", label: "n", num: true },
        { key: "estimate", label: "Error", num: true, render: r => fmt(r.estimate) },
        { key: "ci", label: "95% CI", num: true, render: r => r.status === "INSUFFICIENT DATA"
            ? el("span", { class: "missing" }, "not reported") : `[${fmt((r.ci || [])[0])}, ${fmt((r.ci || [])[1])}]` },
        { key: "gap", label: "Gap", num: true, render: r => fmt(r.gap) },
        { key: "gap_ci", label: "Gap CI", num: true, render: r => r.status === "INSUFFICIENT DATA"
            ? el("span", { class: "missing" }, "not reported") : `[${fmt((r.gap_ci || [])[0])}, ${fmt((r.gap_ci || [])[1])}]` },
        { key: "relative_gap", label: "Relative", num: true, render: r => r.relative_gap === null || !isNum(r.relative_gap)
            ? "—" : `${(r.relative_gap * 100).toFixed(1)}%` },
        { key: "calibration_gap", label: "Calib. gap", num: true, render: r => fmt(r.calibration_gap) },
        { key: "adequacy", label: "Adequacy", render: r => adequacyChip(r.adequacy) },
        { key: "status", label: "Status", render: r => statusChip(r.status) },
        { key: "note", label: "Note" },
      ], subset, { caption: `Axis: ${axis}. Reference group is the largest level of this axis, fixed before evaluation.` }));
    };
    ["__all"].concat(axes).forEach((axis, i) => {
      const button = el("button", { class: "tab", role: "tab", "aria-selected": i === 0,
        onclick: () => {
          Array.from(tabs.children).forEach(c => c.setAttribute("aria-selected", "false"));
          button.setAttribute("aria-selected", "true");
          render(axis);
        } }, axis === "__all" ? "All axes" : axis.replace(/_/g, " "));
      tabs.appendChild(button);
    });
    main.appendChild(panel("Subgroup metrics", null, el("div", null, [tabs, body])));
    render("__all");

    const intersectional = ((fairness.by_task || {}).continuous || {}).intersectional || [];
    if (intersectional.length) {
      main.appendChild(panel("Intersectional cells", null,
        table([{ key: "axes", label: "Axes" }, { key: "subgroup", label: "Cell" },
               { key: "n", label: "n", num: true },
               { key: "estimate", label: "Error", num: true, render: r => fmt(r.estimate) },
               { key: "adequacy", label: "Adequacy", render: r => adequacyChip(r.adequacy) },
               { key: "note", label: "Note" }],
          intersectional, { caption: "Intersectional analysis is reported only where cell size permits." })));
    }

    main.appendChild(panel("Mitigation comparison and selection rule", null, el("div", null, [
      kv([["Preferred model", fairness.preferred_model], ["Rationale", fairness.preferred_rationale]]),
      table([{ key: "task", label: "Task" }, { key: "mitigation", label: "Mitigation" },
             { key: "overall", label: "Overall error", num: true, render: r => fmt(r.overall) },
             { key: "worst_group", label: "Worst-group error", num: true, render: r => fmt(r.worst_group) }],
        fairness.mitigation_comparison || []),
    ])));
    return main;
  };

  screens.reliability = () => {
    const trust = state.report.trust || {};
    const continuous = state.report.tasks.continuous || {};
    const main = el("div", null, [el("h1", null, "Reliability & out-of-distribution")]);

    const assoc = trust.uncertainty_error || {};
    const kind = String(assoc.verdict || "").indexOf("no reliable") === 0 ? "risk"
      : String(assoc.verdict || "").indexOf("tracks") >= 0 ? "positive" : "review";
    main.appendChild(alert(kind, "Does uncertainty track error?",
      `Spearman ρ = ${fmt(assoc.spearman, 2)} (p = ${fmt(assoc.p_value, 3)}, n = ${assoc.n}). ${assoc.verdict || ""}`));

    main.appendChild(el("div", { class: "grid grid-3" }, [
      evidenceCard("Coverage (PICP)", fmt(continuous.intervals && continuous.intervals.picp), "",
        `target ${fmt(continuous.intervals && continuous.intervals.target_coverage, 2)}`,
        continuous.intervals && continuous.intervals.n),
      evidenceCard("Mean interval width", fmt(continuous.intervals && continuous.intervals.mean_interval_width)),
      evidenceCard("AURC", fmt(trust.risk_coverage && trust.risk_coverage.aurc), "",
        "lower is better"),
    ]));

    main.appendChild(el("div", { class: "grid grid-2" }, [
      figure("risk_coverage", "Risk–coverage curve", figureSrc("risk_coverage")),
      figure("ood_scores", "OOD score distribution by cohort", figureSrc("ood_scores")),
    ]));

    const ood = trust.ood || {};
    main.appendChild(panel("Out-of-distribution evaluation", null, el("div", null, [
      alert(String(ood.verdict || "").indexOf("does not") >= 0 ? "review" : "info",
        "Interpretation", ood.verdict || "—"),
      kv([["Method", ood.method && ood.method.method],
          ["k", ood.method && ood.method.knn_k],
          ["Threshold quantile", ood.method && ood.method.threshold_quantile],
          ["Threshold", fmt(ood.threshold)],
          ["AUROC vs shift cohort", fmt(ood.auroc_shift_detection, 3)],
          ["n shift / n in-distribution", `${ood.n_flagged_shift} / ${ood.n_in_distribution}`]]),
      table([{ key: "measure", label: "Measure" },
             { key: "in_dist", label: "In-distribution mean", num: true },
             { key: "shift", label: "Shift mean", num: true },
             { key: "difference", label: "Difference", num: true },
             { key: "ci", label: "95% CI", num: true },
             { key: "worse", label: "Shift worse?" }],
        ["absolute_error", "uncertainty", "interval_width"].filter(k => ood[k]).map(k => ({
          measure: k.replace(/_/g, " "),
          in_dist: fmt(ood[k].mean_in_distribution), shift: fmt(ood[k].mean_shift),
          difference: fmt(ood[k].difference),
          ci: `[${fmt((ood[k].difference_ci || [])[0])}, ${fmt((ood[k].difference_ci || [])[1])}]`,
          worse: ood[k].shift_is_worse ? chip("YES", "warn") : chip("no", "neutral"),
        }))),
    ])));

    const cw = trust.confident_and_wrong || {};
    main.appendChild(panel("High-confidence but wrong", null, el("div", null, [
      alert(cw.n > 0 ? "risk" : "positive", "Explicit failure mode",
        `${cw.n} of ${cw.n_total} test cases had uncertainty in the lowest quartile and absolute error in the highest quartile.`),
      kv([["Definition", cw.definition]]),
    ])));

    const points = ((continuous.predictions) || []).map(p => ({
      x: p.uncertainty, y: Math.abs(p.truth - p.prediction),
      flag: p.ood_score !== null && p.ood_threshold !== null && p.ood_score > p.ood_threshold,
    }));
    if (points.length) {
      main.appendChild(panel("Error vs uncertainty (test partition)", null, el("div", null, [
        el("figure", { class: "plot" }, [svgScatter(points,
          { xLabel: "Predictive uncertainty (ensemble SD)", yLabel: "Absolute error" }),
          el("figcaption", null, "Points in crimson are flagged out-of-distribution. A usable uncertainty measure trends upward to the right.")]),
      ])));
    }
    return main;
  };

  screens.cases = async () => {
    const main = el("div", null, [el("h1", null, "Case explorer")]);
    const toolbar = el("div", { class: "toolbar" });
    const search = el("input", { type: "search", placeholder: "Search patient id…",
      "aria-label": "Search patient id", value: state.caseFilter.search });
    const flagged = el("label", { class: "small" }, [
      el("input", { type: "checkbox", checked: state.caseFilter.flagged ? true : null }),
      " Out-of-distribution only",
    ]);
    const body = el("div", null, el("div", { class: "state-panel" }, [el("p", null, "Loading cases…")]));
    const refresh = async () => {
      state.caseFilter.search = search.value;
      state.caseFilter.flagged = flagged.querySelector("input").checked;
      const params = new URLSearchParams();
      if (state.caseFilter.flagged) params.set("flagged_only", "true");
      if (state.caseFilter.search) params.set("search", state.caseFilter.search);
      let data;
      try { data = await api(`/api/cases?${params.toString()}`); }
      catch (e) { body.innerHTML = ""; body.appendChild(emptyState("Cases unavailable", e.message)); return; }
      state.cases = data.cases;
      body.innerHTML = "";
      if (!data.cases.length) {
        body.appendChild(emptyState("No cases match",
          state.caseFilter.search || state.caseFilter.flagged
            ? "Try clearing the filters — the cohort does contain predictions."
            : "This run produced no held-out predictions."));
        return;
      }
      body.appendChild(el("p", { class: "small" }, `${data.total} case(s) in the held-out test partition.`));
      body.appendChild(table([
        { key: "patient_id", label: "Patient", render: row => el("button", { class: "case-link",
            onclick: () => { location.hash = `#/case/${encodeURIComponent(row.patient_id)}`; } }, row.patient_id) },
        { key: "truth", label: "Observed", num: true, render: row => fmt(row.truth) },
        { key: "prediction", label: "Predicted", num: true, render: row => fmt(row.prediction) },
        { key: "interval", label: "90% interval", num: true,
          render: row => `[${fmt((row.interval || [])[0])}, ${fmt((row.interval || [])[1])}]` },
        { key: "uncertainty", label: "Uncertainty", num: true, render: row => fmt(row.uncertainty) },
        { key: "ood", label: "OOD", render: row => {
            if (row.ood_score === null || row.ood_score === undefined) return chip("n/a", "neutral");
            const flaggedRow = row.ood_threshold !== null && row.ood_score > row.ood_threshold;
            return flaggedRow ? chip("OOD", "ood") : chip("in distribution", "pass");
          } },
        { key: "units", label: "Units" },
      ], data.cases));
    };
    search.addEventListener("input", () => { clearTimeout(window.__t); window.__t = setTimeout(refresh, 250); });
    flagged.addEventListener("change", refresh);
    toolbar.appendChild(search); toolbar.appendChild(flagged);
    main.appendChild(toolbar);
    main.appendChild(panel("Held-out predictions", null, body));
    refresh();
    return main;
  };

  screens.case = async (patientId) => {
    const main = el("div", null, [el("h1", null, `Case ${patientId}`)]);
    main.appendChild(alert("review", "Research prototype", state.report.research_use_notice));
    let data;
    try { data = await api(`/api/case/${encodeURIComponent(patientId)}`); }
    catch (e) { main.appendChild(emptyState("Case unavailable", e.message)); return main; }

    const p = data.prediction || {};
    const explanation = data.explanation;
    const isOod = p.ood_score !== null && p.ood_threshold !== null && p.ood_score > p.ood_threshold;

    if (isOod) {
      main.appendChild(alert("risk", "Out-of-distribution warning",
        `OOD score ${fmt(p.ood_score, 3)} exceeds the flag threshold ${fmt(p.ood_threshold, 3)}. ` +
        "This patient sits outside the model's validated feature distribution; treat the prediction with caution."));
    }

    main.appendChild(el("div", { class: "grid grid-3" }, [
      evidenceCard("Predicted progression", fmt(p.prediction), "", `90% interval [${fmt((p.interval || [])[0])}, ${fmt((p.interval || [])[1])}]`),
      evidenceCard("Observed progression", fmt(p.truth), "", data.units || ""),
      evidenceCard("Uncertainty", fmt(p.uncertainty), "", "ensemble predictive SD"),
    ]));
    main.appendChild(el("p", { class: "small" }, `Horizon and units: ${data.units || "not specified"}`));

    if (p.stage_probabilities && p.stage_classes) {
      main.appendChild(panel("Stage probabilities", null,
        el("div", { class: "grid grid-3" }, p.stage_classes.map((label, i) =>
          el("div", { class: "evidence-card" }, [
            el("div", { class: "ec-label" }, String(label)),
            el("div", { class: "bar-track" }, el("div", { class: "bar-fill",
              style: `width:${Math.round(p.stage_probabilities[i] * 100)}%` })),
            el("div", { class: "ec-qualifier" }, `${(p.stage_probabilities[i] * 100).toFixed(1)}%`),
          ])))));
    }

    if (!explanation) {
      main.appendChild(emptyState("No explanation object for this case",
        "Patient-level explanations are generated for a representative subset of cases " +
        "(highest uncertainty, largest error, most accurate, and an out-of-distribution example). " +
        "This case was not in that subset — the prediction above is still valid."));
      return main;
    }

    main.appendChild(panel("Why the model predicted this", null, el("div", null, [
      kv([["Prediction", fmt(explanation.prediction)],
          ["Base value (background mean)", fmt(explanation.base_value)],
          ["Sum of attributions", fmt(explanation.sum_of_attributions)],
          ["Explanation residual", fmt(explanation.residual)],
          ["Selection reason", explanation.selection_reason],
          ["Absolute error", fmt(explanation.absolute_error)]]),
      el("figure", { class: "plot" }, [
        svgBars(explanation.top.map(t => ({ label: t.label, value: t.attribution,
          colour: familyColour(t.family) }))),
        el("figcaption", null, "Top contributors by absolute SHAP attribution. Bars right of centre push the prediction up.")]),
      table([{ key: "label", label: "Contributor" },
             { key: "family", label: "Family", render: r => chip(r.family, r.family) },
             { key: "value", label: "Value", num: true, render: r => fmt(r.value, 2) },
             { key: "attribution", label: "Attribution", num: true, render: r => fmt(r.attribution) },
             { key: "direction", label: "Direction" }], explanation.top),
    ])));

    main.appendChild(alert("review", "Association is not causation", data.causation_notice || ""));

    if (data.subgroup_context && data.subgroup_context.length) {
      main.appendChild(panel("Subgroup reliability context", null,
        table([{ key: "axis", label: "Axis" }, { key: "subgroup", label: "Subgroup" },
               { key: "n", label: "n", num: true },
               { key: "estimate", label: "Error", num: true, render: r => fmt(r.estimate) },
               { key: "adequacy", label: "Adequacy", render: r => adequacyChip(r.adequacy) },
               { key: "status", label: "Status", render: r => statusChip(r.status) }],
          data.subgroup_context)));
    }
    main.appendChild(panel("Provenance", null, kv([
      ["Run", state.report.manifest.run_id],
      ["Dataset", state.report.cohort.dataset],
      ["Split hash", state.report.cohort.split.split_hash],
      ["Model", state.report.tasks.continuous.model],
      ["Explanation version", explanation.explanation_version],
      ["Coalitions / background", `${explanation.n_coalitions} / ${explanation.n_background}`],
    ])));
    return main;
  };

  screens["model-card"] = () => {
    const r = state.report;
    const main = el("div", null, [el("h1", null, "Model card")]);
    main.appendChild(alert("review", "Research prototype", r.research_use_notice));
    main.appendChild(panel("Model identity", null, kv([
      ["Model version", r.manifest.model_version], ["Run ID", r.manifest.run_id],
      ["Config hash", r.manifest.config_hash], ["Seed", r.manifest.seed],
      ["Created (UTC)", r.manifest.created_utc],
    ])));
    main.appendChild(panel("Intended use", null, el("p", null, r.intended_use || "")));
    main.appendChild(panel("Out of scope", null, el("ul", null, [
      "Diagnosis of any disease.", "Treatment or medication recommendations.",
      "Replacement of clinician judgement.", "Hospital production deployment.",
      "Causal claims about any biomarker.",
    ].map(t => el("li", null, t)))));
    main.appendChild(panel("Training scope", null, kv([
      ["Dataset", r.cohort.dataset], ["Version", r.cohort.dataset_version],
      ["Access tier", r.cohort.dataset_access], ["License", r.cohort.dataset_license],
      ["Citation", r.cohort.dataset_citation],
      ["Patients analysed", r.cohort.n_analysed],
      ["Modalities", JSON.stringify(r.cohort.modalities_available)],
      ["Split", JSON.stringify(r.cohort.split.counts)],
      ["Split hash", r.cohort.split.split_hash],
      ["Leakage-free", r.cohort.split.leakage_free ? "yes" : "no"],
    ])));
    main.appendChild(panel("Evaluation", null, kv([
      ["Continuous model", r.tasks.continuous.model],
      ["MAE", ci(r.tasks.continuous.metrics.mae, r.tasks.continuous.metrics.mae_ci)],
      ["Stage model", r.tasks.stage.model],
      ["Macro-F1", fmt(r.tasks.stage.metrics.macro_f1)],
      ["Coverage", fmt(r.tasks.continuous.intervals && r.tasks.continuous.intervals.picp)],
      ["Preferred configuration", r.fairness.preferred_model],
    ])));
    main.appendChild(panel("Limitations", null, el("ul", null, (r.limitations || []).map(t => el("li", null, t)))));
    main.appendChild(panel("Known failure modes", null, el("ul", null, (r.known_failure_modes || []).map(t => el("li", null, t)))));
    main.appendChild(panel("Release status", null, el("div", null, [
      r.release_readiness.release_ready ? chip("RELEASE READY", "pass") : chip("BLOCKED", "insufficient"),
      el("div", { class: "small", style: "margin-top:8px" },
        r.release_readiness.release_ready ? "All required sections and checks are present."
          : `Blockers: ${(r.release_readiness.blockers || []).join(", ")}`),
    ])));
    return main;
  };

  screens.reproducibility = () => {
    const r = state.report;
    const main = el("div", null, [el("h1", null, "Reproducibility center")]);
    main.appendChild(panel("Manifest", null, kv([
      ["Run ID", r.manifest.run_id], ["Config hash", r.manifest.config_hash],
      ["Seed", r.manifest.seed], ["Dataset", r.cohort.dataset],
      ["Dataset version", r.cohort.dataset_version],
      ["Split version", r.cohort.split.split_version],
      ["Split hash", r.cohort.split.split_hash],
      ["Target definition version", r.cohort.target_definition.version],
      ["Generated (UTC)", r.generated_utc],
      ["Runtime (seconds)", r.runtime_seconds],
    ])));
    main.appendChild(panel("Reproduce this run", null, el("div", null, [
      el("pre", { class: "mono", style: "background:#F7F8F6;border:1px solid #D9E0E2;border-radius:6px;padding:12px;overflow-x:auto" },
        r.reproduce_command || ""),
      el("p", { class: "small" }, "The configuration below is the exact configuration that produced this run."),
      el("pre", { class: "mono", style: "background:#F7F8F6;border:1px solid #D9E0E2;border-radius:6px;padding:12px;overflow-x:auto;max-height:340px;overflow-y:auto" },
        JSON.stringify(stripLarge(r), null, 2)),
    ])));
    main.appendChild(panel("Package versions", null,
      table([{ key: "name", label: "Package" }, { key: "version", label: "Version" }],
        Object.entries(r.manifest.package_versions || {}).map(([name, version]) => ({ name, version })))));
    main.appendChild(panel("Pipeline stages", null, el("ol", null,
      (r.manifest.pipeline_stages || []).map(stage => el("li", null, stage)))));
    return main;
  };

  screens.export = () => {
    const r = state.report;
    const main = el("div", null, [el("h1", null, "Export center")]);
    main.appendChild(alert("info", "What an export contains",
      "Every export carries the research-use notice, the provenance strip, all subgroup sample sizes, " +
      "adequacy statuses, limitations, and known failure modes."));
    const artifacts = [
      ["audit_report.json", "Machine-readable audit package"],
      ["audit_report.md", "Markdown audit report"],
      ["audit_report.html", "Self-contained HTML audit report"],
      ["model_card.md", "Model card"],
      ["predictions.csv", "Per-case predictions with intervals and OOD scores"],
      ["fairness_audit.csv", "Subgroup metrics with adequacy and status"],
      ["explanations.csv", "Patient-level attributions"],
      ["qc_ledger.csv", "Every exclusion with its reason"],
      ["manifest.json", "Reproducibility manifest"],
      ["config.yaml", "Exact configuration"],
    ];
    main.appendChild(panel("Artifacts", null,
      table([{ key: "name", label: "Artifact", render: row =>
          el("a", { href: `/api/artifact/${row.name}${state.runId ? `?run=${encodeURIComponent(state.runId)}` : ""}`,
                    target: "_blank", rel: "noopener" }, row.name) },
             { key: "description", label: "Contents" }],
        artifacts.map(([name, description]) => ({ name, description })))));
    main.appendChild(panel("Validation summary", null, el("div", null, [
      r.release_readiness.release_ready ? chip("RELEASE READY", "pass") : chip("BLOCKED", "insufficient"),
      el("div", { class: "small", style: "margin-top:8px" },
        Object.entries(r.release_readiness.checks || {}).map(([k, v]) => `${k}: ${v ? "pass" : "blocked"}`).join(" · ")),
    ])));
    return main;
  };

  screens.glossary = async () => {
    const main = el("div", null, [el("h1", null, "Help & glossary")]);
    main.appendChild(alert("review", "Research prototype", state.report.research_use_notice));
    let terms = [];
    try { terms = (await api("/api/glossary")).terms; } catch (e) { /* offline: fall through */ }
    main.appendChild(panel("Terms", null,
      table([{ key: "term", label: "Term" }, { key: "definition", label: "Plain-language definition" }], terms)));
    main.appendChild(panel("Reading a NeuroLens result", null, el("ol", null, [
      "Check the provenance strip: dataset, split hash, and config hash identify exactly which experiment you are reading.",
      "Check adequacy before any subgroup claim. INSUFFICIENT DATA means no estimate exists — it is not a pass.",
      "Read the interval with the point estimate. A metric without its interval and n is not a complete result.",
      "Check reliability before trusting a single case: coverage, the uncertainty–error association, and the OOD score.",
      "Treat attributions as descriptions of the model, never as biology.",
    ].map(t => el("li", null, t)))));
    return main;
  };

  screens.datasets = async () => {
    const main = el("div", null, [el("h1", null, "Dataset manifests")]);
    let data = { datasets: [] };
    try { data = await api("/api/datasets"); } catch (e) { /* ignore */ }
    main.appendChild(alert("info", "NeuroLens never generates data",
      "Every cohort is described by a versioned manifest recording license, access tier, citation, and loader. " +
      "Datasets that require a data-use agreement are ingested but never redistributed."));
    data.datasets.forEach(dataset => {
      main.appendChild(panel(dataset.title, [chip(dataset.access, dataset.access === "open" ? "pass" : "warn")],
        el("div", null, [
          kv([["Key", dataset.key], ["Version", dataset.version], ["Disease", dataset.disease],
              ["License", dataset.license], ["URL", dataset.url],
              ["Modalities", (dataset.modalities || []).join(", ")],
              ["Redistributable", dataset.redistributable ? "yes" : "no"]]),
          el("p", { class: "small" }, dataset.notes || ""),
          dataset.download_command
            ? el("pre", { class: "mono", style: "background:#F7F8F6;border:1px solid #D9E0E2;border-radius:6px;padding:12px;overflow-x:auto" },
                dataset.download_command)
            : null,
          el("p", { class: "small" }, dataset.citation || ""),
        ])));
    });
    return main;
  };

  /* --------------------------------------------------------------- helpers */
  function familyOf(feature) {
    if (feature.indexOf("mri_") === 0) return "mri";
    if (["cag_repeat_length", "dbs", "apo_e4"].indexOf(feature) >= 0) return "genetics";
    if (feature.indexOf("mmse") === 0 || feature.indexOf("bmi") === 0 || feature.indexOf("tfc") === 0) return "clinical";
    return "demographic";
  }
  function labelOf(feature) {
    return feature.replace(/^mri_(norm|raw)_/, "").replace(/_/g, " ");
  }
  function familyColour(family) {
    return { mri: "#2E5E8C", genetics: "#5B4B8A", clinical: "#5D6D2D", demographic: "#3B4A57" }[family] || "#687784";
  }
  function stripLarge(report) {
    const clone = JSON.parse(JSON.stringify(report));
    delete clone.model_comparison;
    if (clone.tasks && clone.tasks.continuous) clone.tasks.continuous.predictions = "…omitted…";
    if (clone.cohort) delete clone.cohort.qc_ledger;
    clone.figures = Object.keys(clone.figures || {});
    return clone;
  }

  /* ----------------------------------------------------------------- shell */
  function buildNav() {
    const container = $("#nav-groups");
    NAV.forEach(group => {
      const box = el("div", { class: "nav-group" }, [el("div", { class: "nav-group-label" }, group.group)]);
      group.items.forEach(item => {
        box.appendChild(el("button", { class: "nav-item", "data-route": item.id,
          onclick: () => { location.hash = `#/${item.id}`; } }, item.label));
      });
      container.appendChild(box);
    });
  }

  function setActive(route) {
    Array.from(document.querySelectorAll(".nav-item")).forEach(node => {
      if (node.getAttribute("data-route") === route) node.setAttribute("aria-current", "page");
      else node.removeAttribute("aria-current");
    });
  }

  function renderProvenance() {
    const r = state.report;
    if (!r) return;
    $("#provenance-strip").innerHTML = "";
    [["dataset", r.cohort.dataset], ["target", r.cohort.target_definition.version],
     ["split", r.cohort.split.split_hash], ["config", r.manifest.config_hash],
     ["seed", r.manifest.seed]].forEach(([label, value]) => {
      $("#provenance-strip").appendChild(el("span", null, [el("b", null, `${label} `), String(value)]));
    });
    $("#foot-hash").textContent = `run ${r.manifest.run_id} · config ${r.manifest.config_hash}`;
  }

  async function route() {
    const hash = location.hash.replace(/^#\/?/, "") || "home";
    const [route, arg] = hash.split("/");
    const screen = screens[route] || screens.home;
    setActive(screens[route] ? route : "home");
    const main = $("#main");
    main.innerHTML = "";
    main.appendChild(el("div", { class: "state-panel" }, [el("p", null, "Loading…")]));
    try {
      const node = await screen(arg ? decodeURIComponent(arg) : undefined);
      main.innerHTML = "";
      main.appendChild(node);
    } catch (error) {
      main.innerHTML = "";
      main.appendChild(emptyState("This view could not be rendered", String(error.message || error)));
    }
    window.scrollTo(0, 0);
  }

  function openDrawer(title, node) {
    $("#drawer-title").textContent = title;
    const body = $("#drawer-body");
    body.innerHTML = "";
    body.appendChild(node);
    $("#drawer").hidden = false;
    $("#drawer-close").focus();
  }
  function closeDrawer() { $("#drawer").hidden = true; }

  async function boot() {
    buildNav();
    $("#research-notice").textContent = "";
    $("#drawer-close").addEventListener("click", closeDrawer);
    $("#drawer").addEventListener("click", event => { if (event.target.id === "drawer") closeDrawer(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") closeDrawer(); });
    const toggle = $("#rail-toggle");
    toggle.addEventListener("click", () => {
      const rail = $("#rail");
      const open = rail.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    let runs;
    try {
      const [health, runList] = await Promise.all([api("/api/health"), api("/api/runs")]);
      $("#research-notice").textContent = health.research_use_notice;
      runs = runList.runs;
    } catch (error) {
      $("#main").innerHTML = "";
      $("#main").appendChild(emptyState("Could not reach the NeuroLens API",
        `${error.message}. Start it with: neurolens serve --runs-root runs`));
      return;
    }
    state.runs = runs;
    const select = $("#run-select");
    if (!runs.length) {
      $("#main").innerHTML = "";
      $("#main").appendChild(emptyState("No completed run found",
        "Run the pipeline first: neurolens run — then reload this workspace.",
        el("p", { class: "small" }, "The server looks for audit_report.json under the runs directory.")));
      return;
    }
    runs.forEach(run => select.appendChild(el("option", { value: run.run_id },
      `${run.run_id} · ${run.dataset || ""}`)));
    select.value = runs[0].run_id;
    state.runId = runs[0].run_id;
    select.addEventListener("change", async () => {
      state.runId = select.value;
      await loadReport();
      await route();
    });
    await loadReport();
    window.addEventListener("hashchange", route);
    await route();
  }

  async function loadReport() {
    try {
      state.report = await api(`/api/report${state.runId ? `?run=${encodeURIComponent(state.runId)}` : ""}`);
      renderProvenance();
    } catch (error) {
      $("#main").innerHTML = "";
      $("#main").appendChild(emptyState("Report could not be loaded", String(error.message || error)));
      throw error;
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

(function () {
  const currentScript = document.currentScript;

  // === Shadow DOM host ===
  const host = document.createElement("div");
  currentScript.insertAdjacentElement("afterend", host);
  const shadow = host.attachShadow({ mode: "open" });

  // create loader element
  const loader = document.createElement("div");
  loader.className = "loader";
  loader.textContent = "Loading data…";
  shadow.appendChild(loader);

  // === Translations ===
  // data-lang selects a JSON file of {"English string": "Translated string"}.
  // English needs no file - untranslated strings simply fall back to their
  // English key, so missing/partial language files degrade gracefully.
  // Accepts a full locale tag (e.g. "de-DE") by falling back to its base
  // language code ("de") if there's no exact-match file.
  const rawLangCode = (currentScript.getAttribute("data-lang") || "en").trim().toLowerCase();
  const baseLangCode = rawLangCode.split(/[-_]/)[0];
  const langBaseUrl = currentScript.src.replace(/\/js\/[^/]+$/, '/lang/');
  let translations = {};
  function t(str) {
    return translations[str] || str;
  }
  function fetchLang(code) {
    return fetch(`${langBaseUrl}${code}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  const translationsPromise = (rawLangCode === "en" || baseLangCode === "en")
    ? Promise.resolve({})
    : fetchLang(rawLangCode)
      .then((data) => data || (rawLangCode !== baseLangCode ? fetchLang(baseLangCode) : null))
      .then((data) => data || {});
  translationsPromise.then((loaded) => {
    translations = loaded;
    loader.textContent = t("Loading data…");
  });

  // === Load fonts using FontFace API ===
  const fontBaseUrl = currentScript.src.replace(/\/js\/[^/]+$/, '/fonts/');

  const fontRegular = new FontFace('AvenirLT', `url(${fontBaseUrl}AvenirNextLTCom-Regular.woff2)`, {
    weight: 'normal',
    style: 'normal',
    display: 'swap'
  });

  const fontDemi = new FontFace('AvenirLT', `url(${fontBaseUrl}AvenirNextLTCom-Demi.woff2)`, {
    weight: '600',
    style: 'normal',
    display: 'swap'
  });

  // Load fonts and add to document
  Promise.all([fontRegular.load(), fontDemi.load()]).then((fonts) => {
    fonts.forEach(font => document.fonts.add(font));
  }).catch(err => console.error('Font loading failed:', err));

  // === Load external stylesheet ===
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = currentScript.src.replace(/\/js\/[^/]+$/, '/css/dividend-tool.css');
  shadow.appendChild(link);

  // === Dependencies ===
  // Loaded in parallel - neither library depends on the other at load time.
  function loadScript(href) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = href;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${href}`));
      document.head.appendChild(s);
    });
  }

  const dependenciesPromise = Promise.all([
    loadScript("https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"),
    loadScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"),
  ]);

  dependenciesPromise.then(initTool).catch((err) => {
    console.error(err);
    translationsPromise.then(() => showError(t("Unable to load required libraries. Please try again later.")));
  });

  function showError(message) {
    if (loader && loader.parentNode) loader.remove();
    const p = document.createElement("p");
    p.style.color = "#555";
    p.style.fontSize = "13px";
    p.textContent = message;
    shadow.appendChild(p);
  }

  // === Main ===
  async function initTool() {
    // translationsPromise has almost certainly already resolved by the time the
    // Papa Parse/Chart.js pair finishes loading, but await it defensively so
    // `translations` is guaranteed populated before any UI is built.
    await translationsPromise;

    const csvUrl = currentScript.getAttribute("data-csv");
    if (!csvUrl) {
      shadow.innerHTML =
        "<p style='color:#555;font-size:13px'>No data-csv attribute on script.</p>";
      return;
    }

    Papa.parse(csvUrl, {
      download: true,
      header: true,
      skipEmptyLines: true,
      error: function () {
        showError(t("Unable to load dividend data. Please try again later."));
      },
      complete: function (res) {
        // --- normalise rows ---
        const rows = res.data.map((r) => {
          const obj = {};
          for (const k in r) {
            let key = k.trim().toLowerCase();
            if (key.startsWith("dividend")) key = "dividend";
            let val = (r[k] ?? "").toString().trim();

            if (key === "dividend") {
              obj.dividend = parseFloat(val.replace(/[^0-9.+-]/g, "")) || 0;
              continue;
            }
            if (key === "quarter") {
              const up = val.toUpperCase();
              const m = up.match(/^(\d{2})Q([1-4])$/);
              obj.quarter = up;
              obj.qnum = m ? parseInt(m[2], 10) : null;
              obj.yy = m ? m[1] : null;
              continue;
            }
            obj[key] = val;
          }
          obj.region = (obj.region || "").trim();
          obj.country = (obj.country || "").trim();
          obj.sector = (obj.sector || "").trim();
          obj.subsector = (obj.subsector || "").trim();
          obj.year = (obj.year || "").trim();
          return obj;
        });

        // === LABEL TRANSFORMATIONS ===
        // Centralized mapping for display labels - edit here to customize labels
        const labelMappings = {
          sector: {
            "Media & Telecommunications": "Media & Telcos"
          },
          region: {
            "Pacific Ex China, Hong Kong & Japan": "Pacific Ex China, HK & Japan",
          },
          country: {
            "United Arab Emirates": "UAE",
          },
          subsector: {
            "Auto": "Automotive",
            "Food, drink & Tobacco": "Food, Drink & Tobacco",
            "Household products": "Household Products",
            "Household services": "Household Services",
          },
          // Add more mappings as needed:
          // region: { "Original Name": "Display Name" },
          // subsector: { "Original Name": "Display Name" }
        };

        // Apply label transformations to display values, then translate the result
        function getDisplayLabel(field, value) {
          const cleaned =
            labelMappings[field] && labelMappings[field][value]
              ? labelMappings[field][value]
              : value;
          return t(cleaned);
        }

        // "Dataset A/B/C" - only the word "Dataset" is translated; the letter
        // suffix stays as-is across languages
        function datasetLabel(key) {
          return `${t("Dataset")} ${key}`;
        }

        if (loader && loader.parentNode) {
          loader.remove();
        }

        // --- all quarters sorted ---
        const allQuarters = [...new Set(rows.map((r) => r.quarter))].sort(
          (a, b) => {
            const [ya, qa] = [parseInt(a.slice(0, 2)), parseInt(a.slice(3))];
            const [yb, qb] = [parseInt(b.slice(0, 2)), parseInt(b.slice(3))];
            return ya === yb ? qa - qb : ya - yb;
          }
        );

        // --- UI wrappers ---
        const wrap = document.createElement("div");
        const barTop = document.createElement("div");
        barTop.className = "bar-top";
        const barBottom = document.createElement("div");
        barBottom.className = "bar-bottom";
        const compareBar = document.createElement("div");
        compareBar.className = "bar-compare";
        compareBar.style.display = "none";

        const out = document.createElement("div");
        out.className = "results-section";
        out.setAttribute("aria-live", "polite");
        wrap.append(barTop, barBottom, compareBar, out);
        shadow.appendChild(wrap);

        // --- selects (A) ---
        const selects = {
          region: document.createElement("select"),
          country: document.createElement("select"),
          sector: document.createElement("select"),
          subsector: document.createElement("select"),
        };

        // Selects have no visible <label>, so give each an accessible name
        // combining its dataset and field (e.g. "Dataset A — All Regions").
        const fieldAllLabelKeys = {
          region: "All Regions",
          country: "All Territories",
          sector: "All Sectors",
          subsector: "All Subsectors",
        };
        function applyFieldAriaLabels(selsObj, key) {
          for (const field in selsObj) {
            selsObj[field].setAttribute("aria-label", `${datasetLabel(key)} — ${t(fieldAllLabelKeys[field])}`);
          }
        }

        // wrap dataset A
        const blockA = document.createElement("div");
        blockA.className = "dataset-box";
        const labelA = document.createElement("span");
        labelA.className = "dataset-swatch dataset-a";
        labelA.textContent = datasetLabel("A");
        blockA.appendChild(labelA);
        blockA.append(
          selects.region,
          selects.country,
          selects.sector,
          selects.subsector
        );
        barBottom.appendChild(blockA);
        applyFieldAriaLabels(selects, "A");

        // --- add dataset links (B and C) ---
        const addDatasetLinks = document.createElement("div");
        addDatasetLinks.style.display = "flex";
        addDatasetLinks.style.gap = "0.75rem";
        addDatasetLinks.style.alignItems = "center";

        const addDatasetBLink = document.createElement("button");
        addDatasetBLink.type = "button";
        addDatasetBLink.className = "link-button";
        addDatasetBLink.textContent = `+ ${(translations["Add Dataset"] || "add dataset")} B`;

        const addDatasetCLink = document.createElement("button");
        addDatasetCLink.type = "button";
        addDatasetCLink.className = "link-button";
        addDatasetCLink.textContent = `+ ${(translations["Add Dataset"] || "add dataset")} C`;

        addDatasetLinks.append(addDatasetBLink, addDatasetCLink);
        barBottom.appendChild(addDatasetLinks);

        // track if compare modes are active
        let compareModeB = false;
        let compareModeC = false;

        // track if data visualization is visible
        let dataVisible = false;

        // format and display state
        let numberFormatMode = "billions";
        let displayMode = "years"; // default

        // --- selects (B) ---
        const selectsB = {
          region: document.createElement("select"),
          country: document.createElement("select"),
          sector: document.createElement("select"),
          subsector: document.createElement("select"),
        };

        // wrap dataset B
        const blockB = document.createElement("div");
        blockB.className = "dataset-box";
        blockB.style.display = "none";
        const labelB = document.createElement("span");
        labelB.className = "dataset-swatch dataset-b";
        labelB.textContent = datasetLabel("B");
        blockB.appendChild(labelB);
        for (const k in selectsB) blockB.appendChild(selectsB[k]);
        compareBar.appendChild(blockB);
        applyFieldAriaLabels(selectsB, "B");

        // --- selects (C) ---
        const selectsC = {
          region: document.createElement("select"),
          country: document.createElement("select"),
          sector: document.createElement("select"),
          subsector: document.createElement("select"),
        };

        // wrap dataset C
        const blockC = document.createElement("div");
        blockC.className = "dataset-box";
        blockC.style.display = "none";
        const labelC = document.createElement("span");
        labelC.className = "dataset-swatch dataset-c";
        labelC.textContent = datasetLabel("C");
        blockC.appendChild(labelC);
        for (const k in selectsC) blockC.appendChild(selectsC[k]);
        compareBar.appendChild(blockC);
        applyFieldAriaLabels(selectsC, "C");

        // --- date range and display controls container ---
        const dateRangeDiv = document.createElement("div");
        dateRangeDiv.className = "date-range-display-container";
        dateRangeDiv.style.display = "grid";
        wrap.insertBefore(dateRangeDiv, out);

        const dateRangeContainer = document.createElement("div");
        dateRangeContainer.className = "radio-group";

        const dateRangeLabel = document.createElement("div");
        dateRangeLabel.className = "radio-group-label";
        dateRangeLabel.style.display = "flex";
        dateRangeLabel.style.alignItems = "center";
        dateRangeLabel.textContent = t("Date range (inclusive)") + ":";
        dateRangeContainer.appendChild(dateRangeLabel);

        const dateRangeFields = document.createElement("div");
        dateRangeFields.className = "radio-group-fields";
        dateRangeFields.style.gap = "1rem";

        // Start date dropdowns - wrapped together
        const startGroup = document.createElement("div");
        startGroup.style.display = "flex";
        startGroup.style.gap = "0.5rem";
        startGroup.style.alignItems = "center";

        const startLabel = document.createElement("span");
        startLabel.textContent = t("From") + ": ";
        startLabel.style.fontWeight = "600";
        const startYearSelect = document.createElement("select");
        const startQuarterSelect = document.createElement("select");
        startYearSelect.setAttribute("aria-label", `${t("From")} — ${t("Year")}`);
        startQuarterSelect.setAttribute("aria-label", `${t("From")} — ${t("Quarters")}`);

        startGroup.appendChild(startLabel);
        startGroup.appendChild(startYearSelect);
        startGroup.appendChild(startQuarterSelect);

        // End date dropdowns - wrapped together
        const endGroup = document.createElement("div");
        endGroup.style.display = "flex";
        endGroup.style.gap = "0.5rem";
        endGroup.style.alignItems = "center";

        const endLabel = document.createElement("span");
        endLabel.textContent = t("To") + ": ";
        endLabel.style.fontWeight = "600";
        const endYearSelect = document.createElement("select");
        const endQuarterSelect = document.createElement("select");
        endYearSelect.setAttribute("aria-label", `${t("To")} — ${t("Year")}`);
        endQuarterSelect.setAttribute("aria-label", `${t("To")} — ${t("Quarters")}`);

        endGroup.appendChild(endLabel);
        endGroup.appendChild(endYearSelect);
        endGroup.appendChild(endQuarterSelect);

        dateRangeFields.appendChild(startGroup);
        dateRangeFields.appendChild(endGroup);

        dateRangeContainer.appendChild(dateRangeFields);
        dateRangeDiv.appendChild(dateRangeContainer);

        // --- Display by radio buttons ---
        const displayByContainer = document.createElement("div");
        displayByContainer.className = "radio-group";
        displayByContainer.style.marginTop = "1rem";

        const displayByLabel = document.createElement("div");
        displayByLabel.className = "radio-group-label";
        displayByLabel.textContent = t("Display by") + ":";
        displayByContainer.appendChild(displayByLabel);

        const displayByFields = document.createElement("div");
        displayByFields.className = "radio-group-fields";

        ["years", "quarters"].forEach((mode) => {
          const label = document.createElement("label");
          const input = document.createElement("input");
          input.type = "radio";
          input.name = "displayMode";
          input.value = mode;
          if (mode === displayMode) input.checked = true;
          input.addEventListener("change", () => {
            displayMode = mode;
            updateQuarterDropdownVisibility();
            update();
          });
          label.append(input, " " + t(mode === "years" ? "Years" : "Quarters"));
          displayByFields.appendChild(label);
        });

        displayByContainer.appendChild(displayByFields);
        dateRangeDiv.appendChild(displayByContainer);

        // --- Show Data button ---
        const showDataButton = document.createElement("button");
        showDataButton.textContent = t("Show Data");
        showDataButton.style.padding = "8px 16px 8px 16px";
        showDataButton.style.marginTop = "0.5rem";
        showDataButton.style.marginBottom = "0.5rem";
        showDataButton.style.backgroundColor = "var(--button)";
        showDataButton.style.color = "white";
        showDataButton.style.border = "none";
        showDataButton.style.borderRadius = "0";
        showDataButton.style.cursor = "pointer";
        showDataButton.style.fontSize = "14px";
        showDataButton.style.fontWeight = "600";
        showDataButton.style.transition = "background-color 0.3s ease";

        // Add hover effect
        showDataButton.addEventListener("mouseenter", () => {
          showDataButton.style.backgroundColor = "var(--button-hover)"; // darker blue on hover
        });
        showDataButton.addEventListener("mouseleave", () => {
          showDataButton.style.backgroundColor = "var(--button)";
        });

        dateRangeDiv.appendChild(showDataButton);

        // --- Helper to update .four-cols class on .dataset-box ---
        function updateDatasetBoxCols() {
          // For all dataset blocks
          [blockA, blockB, blockC].forEach(block => {
            // Find selects that are visible (not display:none)
            const selects = Array.from(block.querySelectorAll('select'));
            const visibleSelects = selects.filter(sel => sel.style.display !== 'none');
            // If only 4 selects are visible (region, country, sector, subsector), add .four-cols
            if (visibleSelects.length === 4) {
              block.classList.add('four-cols');
            } else {
              block.classList.remove('four-cols');
            }
          });
        }

        function updateCompareVisibility() {
          const anyActive = compareModeB || compareModeC;
          compareBar.style.display = anyActive ? "flex" : "none";
          blockB.style.display = compareModeB ? "grid" : "none";
          blockC.style.display = compareModeC ? "grid" : "none";
          updateDatasetBoxCols();
        }

        // --- helpers ---
        function populateSelect(sel, values, labelAll, fieldName) {
          const prev = sel.value;
          sel.innerHTML = "";
          const optAll = document.createElement("option");
          optAll.value = "";
          optAll.textContent = labelAll;
          sel.appendChild(optAll);
          values.sort().forEach((v) => {
            if (!v) return;
            const o = document.createElement("option");
            o.value = v;
            o.textContent = fieldName ? getDisplayLabel(fieldName, v) : v;
            sel.appendChild(o);
          });
          if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
        }
        const uniq = (arr) => [...new Set(arr.filter(Boolean))];

        // initial population
        populateSelect(
          selects.region,
          uniq(rows.map((r) => r.region)),
          t("All Regions"),
          "region"
        );
        populateSelect(
          selects.sector,
          uniq(rows.map((r) => r.sector)),
          t("All Sectors"),
          "sector"
        );
        function refreshCascade() {
          const regionVal = selects.region.value;
          const sectorVal = selects.sector.value;
          const afterRegion = regionVal
            ? rows.filter((r) => r.region === regionVal)
            : rows;

          const countryOptions = uniq(afterRegion.map((r) => r.country));
          populateSelect(
            selects.country,
            countryOptions,
            t("All Territories"),
            "country"
          );
          // Hide country dropdown if only one option (excluding "All Territories")
          if (countryOptions.length <= 1) {
            selects.country.style.display = "none";
          } else {
            selects.country.style.display = "inline-block";
          }

          const afterSector = sectorVal
            ? rows.filter((r) => r.sector === sectorVal)
            : rows;

          const subsectorOptions = uniq(afterSector.map((r) => r.subsector));
          populateSelect(
            selects.subsector,
            subsectorOptions,
            t("All Subsectors"),
            "subsector"
          );
          // Hide subsector dropdown if only one option (excluding "All Subsectors")
          if (subsectorOptions.length <= 1) {
            selects.subsector.style.display = "none";
          } else {
            selects.subsector.style.display = "inline-block";
          }

          updateDatasetBoxCols();
        }
        refreshCascade();

        function refreshCascadeB() {
          const regionVal = selectsB.region.value;
          const sectorVal = selectsB.sector.value;
          const afterRegion = regionVal
            ? rows.filter((r) => r.region === regionVal)
            : rows;

          const countryOptions = uniq(afterRegion.map((r) => r.country));
          populateSelect(
            selectsB.country,
            countryOptions,
            t("All Territories"),
            "country"
          );
          // Hide country dropdown if only one option (excluding "All Territories")
          if (countryOptions.length <= 1) {
            selectsB.country.style.display = "none";
          } else {
            selectsB.country.style.display = "inline-block";
          }

          const afterSector = sectorVal
            ? rows.filter((r) => r.sector === sectorVal)
            : rows;

          const subsectorOptions = uniq(afterSector.map((r) => r.subsector));
          populateSelect(
            selectsB.subsector,
            subsectorOptions,
            t("All Subsectors"),
            "subsector"
          );
          // Hide subsector dropdown if only one option (excluding "All Subsectors")
          if (subsectorOptions.length <= 1) {
            selectsB.subsector.style.display = "none";
          } else {
            selectsB.subsector.style.display = "inline-block";
          }
        }
        populateSelect(
          selectsB.region,
          uniq(rows.map((r) => r.region)),
          t("All Regions"),
          "region"
        );
        populateSelect(
          selectsB.sector,
          uniq(rows.map((r) => r.sector)),
          t("All Sectors"),
          "sector"
        );
        refreshCascadeB();

        function refreshCascadeC() {
          const regionVal = selectsC.region.value;
          const sectorVal = selectsC.sector.value;
          const afterRegion = regionVal
            ? rows.filter((r) => r.region === regionVal)
            : rows;

          const countryOptions = uniq(afterRegion.map((r) => r.country));
          populateSelect(
            selectsC.country,
            countryOptions,
            t("All Territories"),
            "country"
          );
          // Hide country dropdown if only one option (excluding "All Territories")
          if (countryOptions.length <= 1) {
            selectsC.country.style.display = "none";
          } else {
            selectsC.country.style.display = "inline-block";
          }

          const afterSector = sectorVal
            ? rows.filter((r) => r.sector === sectorVal)
            : rows;

          const subsectorOptions = uniq(afterSector.map((r) => r.subsector));
          populateSelect(
            selectsC.subsector,
            subsectorOptions,
            t("All Subsectors"),
            "subsector"
          );
          // Hide subsector dropdown if only one option (excluding "All Subsectors")
          if (subsectorOptions.length <= 1) {
            selectsC.subsector.style.display = "none";
          } else {
            selectsC.subsector.style.display = "inline-block";
          }
        }
        populateSelect(
          selectsC.region,
          uniq(rows.map((r) => r.region)),
          t("All Regions"),
          "region"
        );
        populateSelect(
          selectsC.sector,
          uniq(rows.map((r) => r.sector)),
          t("All Sectors"),
          "sector"
        );
        refreshCascadeC();

        // populate date range dropdowns
        const uniqueYears = [...new Set(allQuarters.map(q => "20" + q.slice(0, 2)))].sort();

        function populateDateSelects() {
          // Populate year dropdowns
          [startYearSelect, endYearSelect].forEach(select => {
            select.innerHTML = "";
            uniqueYears.forEach(year => {
              const option = document.createElement("option");
              option.value = year;
              option.textContent = year;
              select.appendChild(option);
            });
          });

          // Set defaults
          startYearSelect.value = uniqueYears[0];
          endYearSelect.value = uniqueYears[uniqueYears.length - 1];

          // Populate quarter dropdowns based on selected years
          updateQuarterDropdowns();
        }

        function updateQuarterDropdowns() {
          const startYear = startYearSelect.value;
          const endYear = endYearSelect.value;

          // Get available quarters for selected years
          const availableStartQuarters = allQuarters
            .filter(q => "20" + q.slice(0, 2) === startYear)
            .map(q => q.slice(2));
          const availableEndQuarters = allQuarters
            .filter(q => "20" + q.slice(0, 2) === endYear)
            .map(q => q.slice(2));

          // Populate start quarter
          startQuarterSelect.innerHTML = "";
          availableStartQuarters.forEach(quarter => {
            const option = document.createElement("option");
            option.value = quarter;
            option.textContent = quarter;
            startQuarterSelect.appendChild(option);
          });

          // Populate end quarter
          endQuarterSelect.innerHTML = "";
          availableEndQuarters.forEach(quarter => {
            const option = document.createElement("option");
            option.value = quarter;
            option.textContent = quarter;
            endQuarterSelect.appendChild(option);
          });

          // Set defaults
          if (availableStartQuarters.length > 0) {
            startQuarterSelect.value = availableStartQuarters[0];
          }
          if (availableEndQuarters.length > 0) {
            endQuarterSelect.value = availableEndQuarters[availableEndQuarters.length - 1];
          }
        }

        function updateQuarterDropdownVisibility() {
          if (displayMode === "years") {
            startQuarterSelect.style.display = "none";
            endQuarterSelect.style.display = "none";
          } else {
            startQuarterSelect.style.display = "inline-block";
            endQuarterSelect.style.display = "inline-block";
          }
        }

        populateDateSelects();

        // Set initial quarter dropdown visibility
        updateQuarterDropdownVisibility();

        dateRangeDiv.style.display = "grid";
        updateCompareVisibility();
        updateDatasetBoxCols();

        // function definitions
        function fmt(val) {
          const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
          if (numberFormatMode === "millions")
            return (
              "$" + (val / 1_000_000).toLocaleString(undefined, opts) + " m"
            );
          if (numberFormatMode === "billions")
            return (
              "$" + (val / 1_000_000_000).toLocaleString(undefined, opts) + " bn"
            );
          return "$" + val.toLocaleString(undefined, opts);
        }

        let chartRef = null;
        let canvas = null;

        // CSS custom properties never change at runtime (no live theming
        // feature), so read them from the DOM once and reuse the cached values.
        let cssVarsCache = null;
        function getCSSVars() {
          if (!cssVarsCache) {
            const cs = getComputedStyle(shadow.host);
            cssVarsCache = {
              chartText: cs.getPropertyValue("--chart-text").trim(),
              chartXAxis: cs.getPropertyValue("--chart-x-axis").trim(),
              chartGrid: cs.getPropertyValue("--chart-grid").trim(),
              datasetA: cs.getPropertyValue("--dataset-a").trim(),
              datasetB: cs.getPropertyValue("--dataset-b").trim(),
              datasetC: cs.getPropertyValue("--dataset-c").trim(),
            };
          }
          return cssVarsCache;
        }

        // Reuses a single canvas/Chart instance across renders (both years and
        // quarters views use the same "bar" type), mutating data + calling
        // .update() instead of destroying and recreating the chart each time.
        // This also avoids replaying the "grow from zero" bar animation on
        // every minor filter change.
        function renderChart(container, labels, datasets) {
          if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.setAttribute("role", "img");
          }
          // Bar chart has no separate accessible text alternative on-screen
          // (the equivalent table is collapsed by default), so summarize it here.
          canvas.setAttribute(
            "aria-label",
            `${t("Chart Data")}: ${datasets.map((d) => d.label).join(", ")}`
          );
          // Attach to the live DOM before Chart.js measures/renders, since
          // out.innerHTML = "" just detached it (a detached canvas has a
          // zero-size container, which Chart.js would otherwise render at).
          container.appendChild(canvas);
          if (!chartRef) {
            const vars = getCSSVars();
            chartRef = new Chart(canvas.getContext("2d"), {
              type: "bar",
              data: { labels, datasets },
              options: {
                responsive: true,
                plugins: {
                  legend: {
                    display: true,
                    labels: {
                      color: vars.chartText,
                    },
                  },
                },
                scales: {
                  x: {
                    grid: {
                      display: false,
                    },
                    ticks: {
                      color: vars.chartXAxis,
                    },
                    border: {
                      color: vars.chartXAxis,
                    },
                  },
                  y: {
                    beginAtZero: true,
                    border: {
                      display: false,
                    },
                    grid: {
                      color: vars.chartGrid,
                    },
                    ticks: {
                      color: vars.chartText,
                      callback: (val) => {
                        if (numberFormatMode === "millions")
                          return "$" + val / 1e6 + " m";
                        if (numberFormatMode === "billions")
                          return "$" + val / 1e9 + " bn";
                        return "$" + val.toLocaleString();
                      },
                    },
                  },
                },
              },
            });
          } else {
            chartRef.data.labels = labels;
            chartRef.data.datasets = datasets;
            chartRef.update();
          }
        }

        // === UPDATE FUNCTION ===
        function update() {
          out.innerHTML = "";

          // If data is not visible yet, just return early
          if (!dataVisible) {
            return;
          }

          const filteredA = rows.filter(
            (r) =>
              (!selects.region.value || r.region === selects.region.value) &&
              (!selects.country.value || r.country === selects.country.value) &&
              (!selects.sector.value || r.sector === selects.sector.value) &&
              (!selects.subsector.value ||
                r.subsector === selects.subsector.value)
          );
          const filteredB = compareModeB
            ? rows.filter(
              (r) =>
                (!selectsB.region.value ||
                  r.region === selectsB.region.value) &&
                (!selectsB.country.value ||
                  r.country === selectsB.country.value) &&
                (!selectsB.sector.value ||
                  r.sector === selectsB.sector.value) &&
                (!selectsB.subsector.value ||
                  r.subsector === selectsB.subsector.value)
            )
            : null;
          const filteredC = compareModeC
            ? rows.filter(
              (r) =>
                (!selectsC.region.value ||
                  r.region === selectsC.region.value) &&
                (!selectsC.country.value ||
                  r.country === selectsC.country.value) &&
                (!selectsC.sector.value ||
                  r.sector === selectsC.sector.value) &&
                (!selectsC.subsector.value ||
                  r.subsector === selectsC.subsector.value)
            )
            : null;

          const cssVars = getCSSVars();
          const activeDatasets = [
            { key: "A", label: datasetLabel("A"), color: cssVars.datasetA, filtered: filteredA },
          ];
          if (filteredB) {
            activeDatasets.push({ key: "B", label: datasetLabel("B"), color: cssVars.datasetB, filtered: filteredB });
          }
          if (filteredC) {
            activeDatasets.push({ key: "C", label: datasetLabel("C"), color: cssVars.datasetC, filtered: filteredC });
          }

          // === ALWAYS IN RANGE MODE ===
          const startQuarter = startYearSelect.value.slice(-2) + startQuarterSelect.value;
          const endQuarter = endYearSelect.value.slice(-2) + endQuarterSelect.value;
          const startIdx = allQuarters.indexOf(startQuarter);
          const endIdx = allQuarters.indexOf(endQuarter);
          if (startIdx === -1 || endIdx === -1) return;

          const labels = allQuarters.slice(startIdx, endIdx + 1);
          const valuesByKey = {};
          activeDatasets.forEach(d => {
            // Group once per dataset (O(rows)) instead of re-filtering the
            // dataset's rows for every quarter in the range (O(rows x quarters)).
            const totalsByQuarter = new Map();
            d.filtered.forEach((r) => {
              totalsByQuarter.set(r.quarter, (totalsByQuarter.get(r.quarter) || 0) + (r.dividend || 0));
            });
            valuesByKey[d.key] = labels.map((code) => totalsByQuarter.get(code) || 0);
          });

          // format toggle (same as non-range mode, now before chart/table)
          const formatWrap = document.createElement("div");
          formatWrap.className = "radio-group";

          const formatLabel = document.createElement("div");
          formatLabel.className = "radio-group-label";
          formatLabel.textContent = t("Number format") + ":";
          formatWrap.appendChild(formatLabel);

          const formatFields = document.createElement("div");
          formatFields.className = "radio-group-fields";

          const formatLabels = {
            billions: t("USD billions"),
            millions: t("USD millions"),
            full: t("Full USD")
          };
          ["billions", "millions", "full"].forEach((mode) => {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "numFormat";
            input.value = mode;
            if (mode === numberFormatMode) input.checked = true;
            input.addEventListener("change", () => {
              numberFormatMode = mode;
              update();
            });
            label.append(input, " " + formatLabels[mode]);
            formatFields.appendChild(label);
          });

          formatWrap.appendChild(formatFields);
          out.appendChild(formatWrap);

          if (displayMode === "years") {
            // === YEARLY VIEW ===
            const years = {};
            labels.forEach((code, idx) => {
              const year = "20" + code.slice(0, 2);
              if (!years[year]) years[year] = {};
              activeDatasets.forEach(d => {
                years[year][d.key] = (years[year][d.key] || 0) + (valuesByKey[d.key][idx] || 0);
              });
            });

            const yearLabels = Object.keys(years).sort();

            // chart
            const datasets = activeDatasets.map(d => ({
              label: d.label,
              data: yearLabels.map(y => years[y][d.key] || 0),
              backgroundColor: d.color,
            }));
            renderChart(out, yearLabels, datasets);

            // table
            const table = document.createElement("table");
            const trh = document.createElement("tr");
            trh.innerHTML = `<th>${t("Year")}</th>${activeDatasets.map(d => `<th>${d.label}</th>`).join("")}`;
            table.appendChild(trh);

            yearLabels.forEach((year) => {
              const tr = document.createElement("tr");
              let rowHtml = `<td>${year}</td>`;
              activeDatasets.forEach(d => {
                rowHtml += `<td>${fmt(years[year][d.key] || 0)}</td>`;
              });
              tr.innerHTML = rowHtml;
              table.appendChild(tr);
            });

            const trG = document.createElement("tr");
            trG.style.fontWeight = "700";
            const grandTotals = activeDatasets.map(d => yearLabels.reduce((sum, y) => sum + (years[y][d.key] || 0), 0));
            trG.innerHTML = `<td>${t("Grand total")}</td>${grandTotals.map(val => `<td>${fmt(val)}</td>`).join("")}`;
            table.appendChild(trG);

            // Create collapsible chart data section for years view
            const chartDataSection = document.createElement("div");
            const chartDataTitle = document.createElement("button");
            chartDataTitle.type = "button";
            chartDataTitle.className = "link-button chart-data-toggle";
            chartDataTitle.textContent = t("Chart Data");
            chartDataTitle.style.color = "var(--button-hover)";
            chartDataTitle.setAttribute("aria-expanded", "false");
            chartDataTitle.setAttribute("aria-controls", "chart-data-table");

            const tableWrap = document.createElement("div");
            tableWrap.id = "chart-data-table";
            tableWrap.className = "table-wrap";
            tableWrap.style.display = "none"; // collapsed by default
            tableWrap.appendChild(table);

            chartDataTitle.addEventListener("click", () => {
              const expanding = tableWrap.style.display === "none";
              tableWrap.style.display = expanding ? "block" : "none";
              chartDataTitle.textContent = t("Chart Data") + (expanding ? " ▼" : " ▶");
              chartDataTitle.setAttribute("aria-expanded", expanding ? "true" : "false");
            });

            // Set initial state
            chartDataTitle.textContent = t("Chart Data") + " ▶";

            chartDataSection.appendChild(chartDataTitle);
            chartDataSection.appendChild(tableWrap);
            out.appendChild(chartDataSection);
            return;
          }

          // === QUARTERLY VIEW ===
          const datasets = activeDatasets.map(d => ({
            label: d.label,
            data: valuesByKey[d.key],
            backgroundColor: d.color,
          }));
          renderChart(out, labels, datasets);

          // table
          const table = document.createElement("table");
          const trh = document.createElement("tr");
          const quarters = ["Q1", "Q2", "Q3", "Q4"];
          trh.innerHTML = `<th>${t("Year")}</th>${quarters
            .map(q => activeDatasets.map(d => `<th>${q} ${d.label}</th>`).join(""))
            .join("")}${activeDatasets.map(d => `<th>${t("Total")} ${d.label}</th>`).join("")}`;
          table.appendChild(trh);

          const yearData = {};
          activeDatasets.forEach(d => { yearData[d.key] = {}; });
          const grandTotals = {};
          activeDatasets.forEach(d => { grandTotals[d.key] = 0; });

          labels.forEach((code, idx) => {
            const yy = "20" + code.slice(0, 2);
            const q = "Q" + code.slice(3);
            activeDatasets.forEach(d => {
              if (!yearData[d.key][yy]) {
                yearData[d.key][yy] = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
              }
              const val = valuesByKey[d.key][idx] || 0;
              yearData[d.key][yy][q] += val;
              grandTotals[d.key] += val;
            });
          });

          Object.keys(yearData["A"] || {})
            .sort()
            .forEach((year) => {
              const tr = document.createElement("tr");
              let rowHtml = `<td>${year}</td>`;
              const totalsPerDataset = {};
              activeDatasets.forEach(d => { totalsPerDataset[d.key] = 0; });
              quarters.forEach((q) => {
                activeDatasets.forEach(d => {
                  const val = (yearData[d.key][year] && yearData[d.key][year][q]) || 0;
                  totalsPerDataset[d.key] += val;
                  rowHtml += `<td>${fmt(val)}</td>`;
                });
              });
              activeDatasets.forEach(d => {
                rowHtml += `<td>${fmt(totalsPerDataset[d.key])}</td>`;
              });
              tr.innerHTML = rowHtml;
              table.appendChild(tr);
            });

          const trG = document.createElement("tr");
          trG.style.fontWeight = "700";
          trG.innerHTML = `<td>${t("Grand total")}</td>${quarters
            .map(() => activeDatasets.map(() => `<td></td>`).join(""))
            .join("")}${activeDatasets.map(d => `<td>${fmt(grandTotals[d.key] || 0)}</td>`).join("")}`;
          table.appendChild(trG);

          // Create collapsible chart data section
          const chartDataSection = document.createElement("div");
          const chartDataTitle = document.createElement("button");
          chartDataTitle.type = "button";
          chartDataTitle.className = "link-button chart-data-toggle";
          chartDataTitle.textContent = t("Chart Data");
          chartDataTitle.style.color = "var(--button)";
          chartDataTitle.setAttribute("aria-expanded", "false");
          chartDataTitle.setAttribute("aria-controls", "chart-data-table");

          const tableWrap = document.createElement("div");
          tableWrap.id = "chart-data-table";
          tableWrap.className = "table-wrap";
          tableWrap.style.display = "none"; // collapsed by default
          tableWrap.appendChild(table);

          chartDataTitle.addEventListener("click", () => {
            const expanding = tableWrap.style.display === "none";
            tableWrap.style.display = expanding ? "block" : "none";
            chartDataTitle.textContent = t("Chart Data") + (expanding ? " ▼" : " ▶");
            chartDataTitle.setAttribute("aria-expanded", expanding ? "true" : "false");
          });

          // Set initial state
          chartDataTitle.textContent = t("Chart Data") + " ▶";

          chartDataSection.appendChild(chartDataTitle);
          chartDataSection.appendChild(tableWrap);
          out.appendChild(chartDataSection);
          return;
        }

        // --- END UPDATE FUNCTION ---

        // --- events ---
        selects.region.addEventListener("change", () => {
          refreshCascade();
          update();
        });
        selects.sector.addEventListener("change", () => {
          refreshCascade();
          update();
        });
        selects.country.addEventListener("change", update);
        selects.subsector.addEventListener("change", update);
        selectsB.region.addEventListener("change", () => {
          refreshCascadeB();
          update();
        });
        selectsB.sector.addEventListener("change", () => {
          refreshCascadeB();
          update();
        });
        selectsB.country.addEventListener("change", update);
        selectsB.subsector.addEventListener("change", update);
        selectsC.region.addEventListener("change", () => {
          refreshCascadeC();
          update();
        });
        selectsC.sector.addEventListener("change", () => {
          refreshCascadeC();
          update();
        });
        selectsC.country.addEventListener("change", update);
        selectsC.subsector.addEventListener("change", update);

        addDatasetBLink.addEventListener("click", () => {
          compareModeB = !compareModeB;
          addDatasetBLink.textContent = compareModeB ? `- ${(translations["Remove Dataset"] || "remove dataset")} B` : `+ ${(translations["Add Dataset"] || "add dataset")} B`;
          updateCompareVisibility();
          update();
        });

        addDatasetCLink.addEventListener("click", () => {
          compareModeC = !compareModeC;
          addDatasetCLink.textContent = compareModeC ? `- ${(translations["Remove Dataset"] || "remove dataset")} C` : `+ ${(translations["Add Dataset"] || "add dataset")} C`;
          updateCompareVisibility();
          update();
        });

        // Date range dropdown event listeners
        startYearSelect.addEventListener("change", () => {
          updateQuarterDropdowns();
          update();
        });
        endYearSelect.addEventListener("change", () => {
          updateQuarterDropdowns();
          update();
        });
        startQuarterSelect.addEventListener("change", update);
        endQuarterSelect.addEventListener("change", update);

        // Show Data button event listener
        showDataButton.addEventListener("click", () => {
          dataVisible = true;
          showDataButton.style.display = "none";
          update();
        });

        update();
      },
    });
  }
})();

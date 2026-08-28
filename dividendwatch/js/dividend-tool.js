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

  // === External loaders ===
  function loadExternal(href, type, cb) {
    if (type === "css") {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      shadow.appendChild(link);
      if (cb) cb();
    } else {
      const s = document.createElement("script");
      s.src = href;
      s.onload = cb;
      document.head.appendChild(s);
    }
  }

  // === Dependencies ===
  loadExternal(
    "https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js",
    "js",
    () => {
      loadExternal(
        "https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.8/dist/umd/popper.min.js",
        "js",
        () => {
          loadExternal(
            "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
            "js",
            initTool
          );
        }
      );
    }
  );

  // === Main ===
  function initTool() {
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
          if (!obj.yy && obj.year && obj.qnum) {
            obj.yy = obj.year.slice(-2);
            obj.quarter = `${obj.yy}Q${obj.qnum}`;
          }
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
            "Food, drink & Tobacco": "Food, Drink & Tobacco",
            "Household products": "Household Products",
            "Household services": "Household Services",
          },
          // Add more mappings as needed:
          // region: { "Original Name": "Display Name" },
          // subsector: { "Original Name": "Display Name" }
        };

        // Apply label transformations to display values
        function getDisplayLabel(field, value) {
          if (labelMappings[field] && labelMappings[field][value]) {
            return labelMappings[field][value];
          }
          return value;
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
        wrap.append(barTop, barBottom, compareBar, out);
        shadow.appendChild(wrap);

        // --- Helper to create info icon with popover ---
        function createInfoIcon(text) {
          const icon = document.createElement('span');
          icon.className = 'info-icon';
          icon.textContent = 'i';

          const popover = document.createElement('div');
          popover.className = 'popover';
          popover.style.display = 'none';
          popover.innerHTML = `
            <div>${text}</div>
            <div class="popover-arrow" data-popper-arrow></div>
          `;
          shadow.appendChild(popover);

          let popperInstance = null;

          const handleOutsideClick = (e) => {
            if (!icon.contains(e.target) && !popover.contains(e.target)) {
              popover.style.display = 'none';
              if (popperInstance) {
                popperInstance.destroy();
                popperInstance = null;
              }
              document.removeEventListener('click', handleOutsideClick);
            }
          };

          icon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (popover.style.display === 'none') {
              // Close any other open popovers first
              document.querySelectorAll('.popover').forEach(p => {
                if (p !== popover && p.style.display === 'block') {
                  p.style.display = 'none';
                }
              });

              popover.style.display = 'block';
              popperInstance = Popper.createPopper(icon, popover, {
                placement: 'top',
                modifiers: [
                  {
                    name: 'offset',
                    options: {
                      offset: [0, 8],
                    },
                  },
                ],
              });

              // Add outside click listener
              setTimeout(() => document.addEventListener('click', handleOutsideClick), 0);
            } else {
              popover.style.display = 'none';
              if (popperInstance) {
                popperInstance.destroy();
                popperInstance = null;
              }
              document.removeEventListener('click', handleOutsideClick);
            }
          });

          return icon;
        }

        // --- selects (A) ---
        const selects = {
          region: document.createElement("select"),
          country: document.createElement("select"),
          sector: document.createElement("select"),
          subsector: document.createElement("select"),
          year: document.createElement("select"),
          quarter: document.createElement("select"),
        };

        // wrap dataset A
        const blockA = document.createElement("div");
        blockA.className = "dataset-box";
        const labelA = document.createElement("span");
        labelA.className = "dataset-swatch dataset-a";
        labelA.textContent = "Dataset A";
        blockA.appendChild(labelA);
        blockA.append(
          selects.region,
          selects.country,
          selects.sector,
          selects.subsector,
          selects.year,
          selects.quarter
        );
        barBottom.appendChild(blockA);

        // --- add dataset links (B and C) ---
        const addDatasetLinks = document.createElement("div");
        addDatasetLinks.style.display = "flex";
        addDatasetLinks.style.gap = "0.75rem";
        addDatasetLinks.style.alignItems = "center";

        const addDatasetBLink = document.createElement("div");
        addDatasetBLink.textContent = "+ add dataset B";
        addDatasetBLink.style.cursor = "pointer";
        addDatasetBLink.style.color = "var(--button-hover)";
        addDatasetBLink.style.fontSize = "14px";
        addDatasetBLink.style.userSelect = "none";

        const addDatasetCLink = document.createElement("div");
        addDatasetCLink.textContent = "+ add dataset C";
        addDatasetCLink.style.cursor = "pointer";
        addDatasetCLink.style.color = "var(--button-hover)";
        addDatasetCLink.style.fontSize = "14px";
        addDatasetCLink.style.userSelect = "none";

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
        labelB.textContent = "Dataset B";
        blockB.appendChild(labelB);
        for (const k in selectsB) blockB.appendChild(selectsB[k]);
        compareBar.appendChild(blockB);

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
        labelC.textContent = "Dataset C";
        blockC.appendChild(labelC);
        for (const k in selectsC) blockC.appendChild(selectsC[k]);
        compareBar.appendChild(blockC);

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
        dateRangeLabel.textContent = "Date range (inclusive):";
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
        startLabel.textContent = "From: ";
        startLabel.style.fontWeight = "600";
        const startYearSelect = document.createElement("select");
        const startQuarterSelect = document.createElement("select");

        startGroup.appendChild(startLabel);
        startGroup.appendChild(startYearSelect);
        startGroup.appendChild(startQuarterSelect);

        // End date dropdowns - wrapped together
        const endGroup = document.createElement("div");
        endGroup.style.display = "flex";
        endGroup.style.gap = "0.5rem";
        endGroup.style.alignItems = "center";

        const endLabel = document.createElement("span");
        endLabel.textContent = "To: ";
        endLabel.style.fontWeight = "600";
        const endYearSelect = document.createElement("select");
        const endQuarterSelect = document.createElement("select");

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
        displayByLabel.textContent = "Display by:";
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
          label.append(input, " " + mode[0].toUpperCase() + mode.slice(1));
          displayByFields.appendChild(label);
        });

        displayByContainer.appendChild(displayByFields);
        dateRangeDiv.appendChild(displayByContainer);

        // --- Show Data button ---
        const showDataButton = document.createElement("button");
        showDataButton.textContent = "Show Data";
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
          "All Regions",
          "region"
        );
        populateSelect(
          selects.sector,
          uniq(rows.map((r) => r.sector)),
          "All Sectors",
          "sector"
        );
        populateSelect(
          selects.year,
          uniq(rows.map((r) => r.year)),
          "All Years",
          "year"
        );
        populateSelect(
          selects.quarter,
          ["Q1", "Q2", "Q3", "Q4"],
          "All Quarters",
          "quarter"
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
            "All Territories",
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
            "All Subsectors",
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
            "All Territories",
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
            "All Subsectors",
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
          "All Regions",
          "region"
        );
        populateSelect(
          selectsB.sector,
          uniq(rows.map((r) => r.sector)),
          "All Sectors",
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
            "All Countries",
            "country"
          );
          // Hide country dropdown if only one option (excluding "All Countries")
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
            "All Subsectors",
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
          "All Regions",
          "region"
        );
        populateSelect(
          selectsC.sector,
          uniq(rows.map((r) => r.sector)),
          "All Sectors",
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

        // defaults - always in "display mode" (previously range mode)
        selects.year.style.display = "none";
        selects.quarter.style.display = "none";
        dateRangeDiv.style.display = "grid";
        updateCompareVisibility();
        updateDatasetBoxCols();

        // function definitions
        function fmt(val) {
          const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
          if (numberFormatMode === "millions")
            return (
              "$" + (val / 1_000_000).toLocaleString(undefined, opts) + "m"
            );
          if (numberFormatMode === "billions")
            return (
              "$" + (val / 1_000_000_000).toLocaleString(undefined, opts) + "bn"
            );
          return "$" + val.toLocaleString(undefined, opts);
        }

        let chartRef = null;

        function getCSSVar(varName) {
          return getComputedStyle(shadow.host).getPropertyValue(varName).trim();
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

          const activeDatasets = [
            { key: "A", label: "Dataset A", color: getCSSVar("--dataset-a"), filtered: filteredA },
          ];
          if (filteredB) {
            activeDatasets.push({ key: "B", label: "Dataset B", color: getCSSVar("--dataset-b"), filtered: filteredB });
          }
          if (filteredC) {
            activeDatasets.push({ key: "C", label: "Dataset C", color: getCSSVar("--dataset-c"), filtered: filteredC });
          }

          // === ALWAYS IN RANGE MODE ===
          const startQuarter = startYearSelect.value.slice(-2) + startQuarterSelect.value;
          const endQuarter = endYearSelect.value.slice(-2) + endQuarterSelect.value;
          const startIdx = allQuarters.indexOf(startQuarter);
          const endIdx = allQuarters.indexOf(endQuarter);
          if (startIdx === -1 || endIdx === -1) return;

          const labels = [];
          const valuesByKey = {};
          activeDatasets.forEach(d => { valuesByKey[d.key] = []; });

          for (let i = startIdx; i <= endIdx; i++) {
            const code = allQuarters[i];
            labels.push(code);
            activeDatasets.forEach(d => {
              const total = d.filtered
                .filter((r) => r.quarter === code)
                .reduce((s, r) => s + (r.dividend || 0), 0);
              valuesByKey[d.key].push(total);
            });
          }

          // format toggle (same as non-range mode, now before chart/table)
          const formatWrap = document.createElement("div");
          formatWrap.className = "radio-group";

          const formatLabel = document.createElement("div");
          formatLabel.className = "radio-group-label";
          formatLabel.textContent = "Number format:";
          formatWrap.appendChild(formatLabel);

          const formatFields = document.createElement("div");
          formatFields.className = "radio-group-fields";

          const formatLabels = {
            billions: "USD billions",
            millions: "USD millions",
            full: "Full USD"
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
            const canvas = document.createElement("canvas");
            out.appendChild(canvas);
            const datasets = activeDatasets.map(d => ({
              label: d.label,
              data: yearLabels.map(y => years[y][d.key] || 0),
              backgroundColor: d.color,
            }));

            if (chartRef) chartRef.destroy();
            chartRef = new Chart(canvas.getContext("2d"), {
              type: "bar",
              data: { labels: yearLabels, datasets },
              options: {
                responsive: true,
                plugins: {
                  legend: {
                    display: true,
                    labels: {
                      color: getCSSVar("--chart-text"),
                    },
                  }
                },
                scales: {
                  x: {
                    grid: {
                      display: false,
                    },
                    ticks: {
                      color: getCSSVar("--chart-x-axis"),
                    },
                    border: {
                      color: getCSSVar("--chart-x-axis"),
                    }
                  },
                  y: {
                    beginAtZero: true,
                    border: {
                      display: false,
                    },
                    grid: {
                      color: getCSSVar("--chart-grid"),
                    },
                    ticks: {
                      color: getCSSVar("--chart-text"),
                      callback: (val) => {
                        if (numberFormatMode === "millions")
                          return "$" + val / 1e6 + "m";
                        if (numberFormatMode === "billions")
                          return "$" + val / 1e9 + "bn";
                        return "$" + val.toLocaleString();
                      },
                    },
                  },
                },
              },
            });

            // table
            const table = document.createElement("table");
            const trh = document.createElement("tr");
            trh.innerHTML = `<th>Year</th>${activeDatasets.map(d => `<th>${d.label}</th>`).join("")}`;
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
            trG.innerHTML = `<td>Grand total</td>${grandTotals.map(val => `<td>${fmt(val)}</td>`).join("")}`;
            table.appendChild(trG);

            // Create collapsible chart data section for years view
            const chartDataSection = document.createElement("div");
            const chartDataTitle = document.createElement("div");
            chartDataTitle.textContent = "Chart Data";
            chartDataTitle.style.fontWeight = "600";
            chartDataTitle.style.fontSize = "14px";
            chartDataTitle.style.cursor = "pointer";
            chartDataTitle.style.marginTop = "1rem";
            chartDataTitle.style.marginBottom = "0.5rem";
            chartDataTitle.style.userSelect = "none";
            chartDataTitle.style.color = "var(--button-hover)";

            const tableWrap = document.createElement("div");
            tableWrap.className = "table-wrap";
            tableWrap.style.display = "none"; // collapsed by default
            tableWrap.appendChild(table);

            chartDataTitle.addEventListener("click", () => {
              if (tableWrap.style.display === "none") {
                tableWrap.style.display = "block";
                chartDataTitle.textContent = "Chart Data ▼";
              } else {
                tableWrap.style.display = "none";
                chartDataTitle.textContent = "Chart Data ▶";
              }
            });

            // Set initial state
            chartDataTitle.textContent = "Chart Data ▶";

            chartDataSection.appendChild(chartDataTitle);
            chartDataSection.appendChild(tableWrap);
            out.appendChild(chartDataSection);
            return;
          }

          // === QUARTERLY VIEW ===
          const canvas = document.createElement("canvas");
          out.appendChild(canvas);

          const datasets = activeDatasets.map(d => ({
            label: d.label,
            data: valuesByKey[d.key],
            backgroundColor: d.color,
          }));

          if (chartRef) chartRef.destroy();
          chartRef = new Chart(canvas.getContext("2d"), {
            type: "bar",
            data: { labels, datasets },
            options: {
              responsive: true,
              plugins: {
                legend: {
                  display: true,
                  labels: {
                    color: getCSSVar("--chart-text"),
                  },
                }
              },
              scales: {
                x: {
                  grid: {
                    display: false,
                  },
                  ticks: {
                    color: getCSSVar("--chart-x-axis"),
                  },
                  border: {
                    color: getCSSVar("--chart-x-axis"),
                  },
                },
                y: {
                  beginAtZero: true,
                  border: {
                    display: false,
                  },
                  grid: {
                    color: getCSSVar("--chart-grid"),
                  },
                  ticks: {
                    color: getCSSVar("--chart-text"),
                    callback: (val) => {
                      if (numberFormatMode === "millions")
                        return "$" + val / 1e6 + "m";
                      if (numberFormatMode === "billions")
                        return "$" + val / 1e9 + "bn";
                      return "$" + val.toLocaleString();
                    },
                  },
                },
              },
            },
          });

          // table
          const table = document.createElement("table");
          const trh = document.createElement("tr");
          const quarters = ["Q1", "Q2", "Q3", "Q4"];
          trh.innerHTML = `<th>Year</th>${quarters
            .map(q => activeDatasets.map(d => `<th>${q} ${d.label}</th>`).join(""))
            .join("")}${activeDatasets.map(d => `<th>Total ${d.label}</th>`).join("")}`;
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
          trG.innerHTML = `<td>Grand total</td>${quarters
            .map(() => activeDatasets.map(() => `<td></td>`).join(""))
            .join("")}${activeDatasets.map(d => `<td>${fmt(grandTotals[d.key] || 0)}</td>`).join("")}`;
          table.appendChild(trG);

          // Create collapsible chart data section
          const chartDataSection = document.createElement("div");
          const chartDataTitle = document.createElement("div");
          chartDataTitle.textContent = "Chart Data";
          chartDataTitle.style.fontWeight = "600";
          chartDataTitle.style.fontSize = "14px";
          chartDataTitle.style.cursor = "pointer";
          chartDataTitle.style.marginTop = "1rem";
          chartDataTitle.style.marginBottom = "0.5rem";
          chartDataTitle.style.userSelect = "none";
          chartDataTitle.style.color = "var(--button)";

          const tableWrap = document.createElement("div");
          tableWrap.className = "table-wrap";
          tableWrap.style.display = "none"; // collapsed by default
          tableWrap.appendChild(table);

          chartDataTitle.addEventListener("click", () => {
            if (tableWrap.style.display === "none") {
              tableWrap.style.display = "block";
              chartDataTitle.textContent = "Chart Data ▼";
            } else {
              tableWrap.style.display = "none";
              chartDataTitle.textContent = "Chart Data ▶";
            }
          });

          // Set initial state
          chartDataTitle.textContent = "Chart Data ▶";

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
        selects.year.addEventListener("change", update);
        selects.quarter.addEventListener("change", update);
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
          addDatasetBLink.textContent = compareModeB ? "- remove dataset B" : "+ add dataset B";
          updateCompareVisibility();
          update();
        });

        addDatasetCLink.addEventListener("click", () => {
          compareModeC = !compareModeC;
          addDatasetCLink.textContent = compareModeC ? "- remove dataset C" : "+ add dataset C";
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

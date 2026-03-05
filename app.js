/* Flow: Consent/Login (w/ Group Assignment) → 4 cases → Debrief
   Completion = Purchase/Confirm (shows confirmation screen)
   Abandonment = Cancel/Exit (skips confirmation, ONLY allowed on Review step)
   Scripted price change: first time entering Review step, +/-20% per condition
*/

const SCREENS = [
  "screen-consent",
  "screen-task",
  "screen-confirmed",
  "screen-debrief",
];

const $ = (id) => document.getElementById(id);

const statusText = $("statusText");
const siteNameEl = $("siteName");

const stepButtons = [
  $("step0Btn"),
  $("step1Btn"),
  $("step2Btn"),
  $("step3Btn"),
];

// --- Conditions (4 cases) ---
const CONDITIONS = [
  { key: "LI_INC", context: "Food",   direction: "Increase", deltaPct: +0.20, siteKey: "Eatsly"     },
  { key: "LI_DEC", context: "Food",   direction: "Decrease", deltaPct: -0.20, siteKey: "QuickBite"  },
  { key: "HI_INC", context: "Flight", direction: "Increase", deltaPct: +0.20, siteKey: "SkyBook"    },
  { key: "HI_DEC", context: "Flight", direction: "Decrease", deltaPct: -0.20, siteKey: "FlyCentre"  },
];

// Latin-square style order rotation 
const ORDERS = [
  ["LI_INC", "LI_DEC", "HI_INC", "HI_DEC"], // Group 1 (index 0)
  ["LI_DEC", "HI_INC", "HI_DEC", "LI_INC"], // Group 2 (index 1)
  ["HI_INC", "HI_DEC", "LI_INC", "LI_DEC"], // Group 3 (index 2)
  ["HI_DEC", "LI_INC", "LI_DEC", "HI_INC"], // Group 4 (index 3)
];

const SITE_THEMES = {
  Study:     { title: "Shopping Task Study", accent: "#111111" },
  Eatsly:    { title: "Eatsly",              accent: "#1f7a3a" },
  QuickBite: { title: "QuickBite",           accent: "#222222" },
  SkyBook:   { title: "SkyBook",             accent: "#0f4c81" },
  FlyCentre: { title: "FlyCentre",           accent: "#6b4f2a" },
};

function setTheme(siteKey){
  const t = SITE_THEMES[siteKey] || SITE_THEMES.Study;
  siteNameEl.textContent = t.title;
  document.documentElement.style.setProperty("--accent", t.accent);
}

// --- Image naming scheme (put in /images) ---
const FOOD_CASES = [
  { name: "Lunch Combo", desc: "Sandwich + drink", basePrice: 14.99, imageSrc: "images/food_1.jpg", imageAlt: "Sandwich combo meal" },
  { name: "Sushi Bowl", desc: "Salmon bowl + miso soup", basePrice: 16.49, imageSrc: "images/food_2.jpg", imageAlt: "Sushi bowl meal" },
  { name: "Pizza Slice Deal", desc: "2 slices + soft drink", basePrice: 12.99, imageSrc: "images/food_3.jpg", imageAlt: "Pizza slices and drink" },
];

const FLIGHT_CASES = [
  {
    name: "Round-trip Flight",
    from: "Toronto (YYZ)", to: "Tokyo (NRT)",
    dateOut: "May 10", dateBack: "May 24",
    basePrice: 1249.99,
    imageSrc: "images/flight_1.jpg",
    imageAlt: "Airplane flying over city",
    details: ["1 Stop", "Carry-on & checked bag included", "Economy (standard)"],
  },
  {
    name: "Round-trip Flight",
    from: "Toronto (YYZ)", to: "London (LHR)",
    dateOut: "Jun 05", dateBack: "Jun 12",
    basePrice: 989.99,
    imageSrc: "images/flight_2.jpg",
    imageAlt: "Airplane on the tarmac",
    details: ["Nonstop", "Carry-on included", "Economy (standard)"],
  },
  {
    name: "Round-trip Flight",
    from: "Toronto (YYZ)", to: "Paris (CDG)",
    dateOut: "Jul 02", dateBack: "Jul 15",
    basePrice: 1059.99,
    imageSrc: "images/flight_3.jpg",
    imageAlt: "Airplane wing in the sky",
    details: ["1 stop", "Carry-on included", "Economy (standard)"],
  },
];

// --- State ---
const state = {
  participantId: "",
  groupAssignment: null,
  order: [],           
  currentIndex: 0,     
  active: null,        
  currentStep: 0,
  maxStepReached: 0,
  runs: [],
  autoTimer: null,
};

// --- Helpers ---
function nowISO(){ return new Date().toISOString(); }
function money(n){ return `$${n.toFixed(2)}`; }

function showScreen(id){
  for(const s of SCREENS){
    const el = $(s);
    if (el) el.classList.toggle("hidden", s !== id);
  }
}

function setStatus(text){ statusText.textContent = text; }

function makeOrderId(){
  const a = Math.floor(100000 + Math.random()*900000);
  const b = Math.floor(1000 + Math.random()*9000);
  return `#${a}-${b}`;
}

// --- Run creation ---
function getConditionByKey(key){
  const c = CONDITIONS.find(x => x.key === key);
  if(!c) throw new Error("Unknown condition: " + key);
  return c;
}

function startCase(index){
  state.currentIndex = index;

  const condKey = state.order[index];
  const cond = getConditionByKey(condKey);

  state.active = {
    runKey: cond.key,
    condition: cond,
    availableProducts: cond.context === "Food" ? FOOD_CASES : FLIGHT_CASES,
    product: null, // Starts as null, user must select one

    basePrice: 0,
    currentPrice: 0,

    t0iso: nowISO(),
    t0ms: Date.now(),

    priceChanged: false,
    priceChangeAtMs: null,
    priceBefore: null,
    priceAfter: null,

    outcome: null,             
    outcomeAtMs: null,
    rtAfterPriceChangeMs: null,
    orderId: null,

    events: [],
  };

  state.currentStep = 0;
  state.maxStepReached = 0;

  // Theme + status + progress pill
  setTheme(cond.siteKey);
  setStatus(`Case ${index + 1} of 4`);
  $("pillProgress").textContent = `Case ${index + 1} of 4`;

  $("taskHint").textContent = "Please proceed through the checkout steps.";

  showScreen("screen-task");
  updateStepButtons();
  renderStep();
}

// --- Steps UI ---
function updateStepButtons(){
  stepButtons.forEach((btn, i) => {
    btn.classList.toggle("active", i === state.currentStep);
    const locked = i > state.maxStepReached;
    btn.classList.toggle("locked", locked);
    btn.setAttribute("aria-disabled", locked ? "true" : "false");
  });
}

function setActiveStep(step){
  if(step < 0 || step > 3) return;
  if(step > state.maxStepReached) return;
  state.currentStep = step;
  updateStepButtons();
  renderStep();
}

function renderMedia(product){
  if(product.imageSrc && product.imageSrc.trim()){
    return `<div class="imgPh"><img src="${product.imageSrc}" alt="${product.imageAlt}"></div>`;
  }
  return `<div class="imgPh">Add image<br><span class="tiny">${product.imageAlt}</span></div>`;
}

function renderStep(){
  const panel = $("stepContent");
  const run = state.active;
  const cond = run.condition;
  // Use a placeholder if product not yet selected
  const p = run.product || { name: "—", desc: "—", basePrice: 0, from: "—", to: "—" };

  const step = state.currentStep;

  // Scripted price change on first entry to Review (step 3)
  if(step === 3 && !run.priceChanged){
    run.priceChanged = true;
    run.priceChangeAtMs = Date.now() - run.t0ms;
    run.priceBefore = run.currentPrice;
    run.currentPrice = +(run.basePrice * (1 + cond.deltaPct));
    run.priceAfter = run.currentPrice;
    run.events.push({ t: nowISO(), type: "price_change", before: run.priceBefore, after: run.priceAfter, deltaPct: cond.deltaPct, atMs: run.priceChangeAtMs });
  }

  run.events.push({ t: nowISO(), type: "step_view", step, stepName: ["browse","cart","checkout","review"][step] });

  const badge = run.priceChanged
    ? `<span class="badge warn">Price updated</span>`
    : `<span class="badge ok">Price stable</span>`;

  const flightSummary = (cond.context === "Flight" && run.product)
    ? `
      <div class="cardBlock" style="margin-top:14px;">
        <div style="font-weight:650;">Trip summary</div>
        <div class="muted" style="margin-top:6px;">
          From: <strong>${p.from}</strong><br>
          To: <strong>${p.to}</strong><br>
          Depart: <strong>${p.dateOut}</strong> • Return: <strong>${p.dateBack}</strong>
        </div>
      </div>
    ` : "";

  const sidePrice = `
    <div class="priceBox">
      <div class="priceRow"><span class="muted">${cond.context === "Flight" ? "Fare" : "Item"}</span><span>${p.name}</span></div>
      <div class="priceRow"><span class="muted">Details</span><span>${cond.context === "Flight" && run.product ? `${p.from} → ${p.to}` : p.desc}</span></div>
      <hr style="border:none;border-top:1px solid #e6e6e6;margin:10px 0;">
      <div class="priceRow"><span class="muted">Current price</span><span><strong>${run.product ? money(run.currentPrice) : "—"}</strong></span></div>
      <div class="priceRow"><span class="muted">Status</span><span>${badge}</span></div>
      ${run.priceChanged ? `<div class="priceRow"><span class="muted">Original price</span><span>${money(run.priceBefore)}</span></div>` : ""}
    </div>
  `;

  const leftBase = (title, subtitle, extraHTML="") => `
    <div class="cardBlock">
      <div style="display:flex; gap:12px; align-items:flex-start;">
        ${renderMedia(p)}
        <div style="flex:1;">
          <div style="font-weight:750; font-size:18px;">${title}</div>
          <div class="muted" style="margin-top:4px;">${subtitle}</div>
          ${extraHTML}
        </div>
      </div>
    </div>
  `;

  const backBtn = $("btnBack");
  const nextBtn = $("btnNext");

  // Browse Step (0)
  if(step === 0){
    const products = run.availableProducts;
    
    // Generate the list of 3 items
    const listHTML = products.map((prod, idx) => {
      const isSelected = run.product === prod;
      const detailsHTML = cond.context === "Flight"
        ? `<div class="muted" style="margin-top:4px;">${prod.from} → ${prod.to}<br>${prod.dateOut} - ${prod.dateBack}</div>
           <ul class="muted" style="margin:6px 0 0; padding-left:18px; font-size:13px;">
             ${(prod.details || []).map(d => `<li>${d}</li>`).join("")}
           </ul>`
        : `<div class="muted" style="margin-top:4px;">${prod.desc}</div>`;

      return `
        <div class="selectableCard ${isSelected ? 'selected' : ''}" data-idx="${idx}">
          <div style="display:flex; gap:12px; align-items:flex-start;">
            ${renderMedia(prod)}
            <div style="flex:1;">
              <div style="display:flex; justify-content:space-between;">
                <div style="font-weight:750; font-size:18px;">${prod.name}</div>
                <div style="font-weight:750; font-size:16px;">${money(prod.basePrice)}</div>
              </div>
              ${detailsHTML}
            </div>
          </div>
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="storeLayout">
        <div>
          <div class="cardBlock">
             <div style="font-weight:750; font-size:18px;">${cond.context === "Food" ? "Select a meal" : "Select a flight"}</div>
             <div class="muted" style="margin-top:4px;">Choose one option to proceed with your purchase.</div>
             <div class="productGrid">
               ${listHTML}
             </div>
          </div>
        </div>
        <div>
          ${sidePrice}
          <div class="cardBlock" style="margin-top:14px;">
            <div style="font-weight:650;">Instructions</div>
            <div class="muted" style="margin-top:6px;">
              Select an option to add it to your cart, then proceed through checkout.
            </div>
          </div>
        </div>
      </div>
    `;

    panel.querySelectorAll('.selectableCard').forEach(el => {
      el.addEventListener('click', () => {
        const idx = el.getAttribute('data-idx');
        run.product = products[idx];
        run.basePrice = run.product.basePrice;
        run.currentPrice = run.product.basePrice;
        renderStep(); 
      });
    });

    backBtn.style.display = "none";
    backBtn.disabled = true;

    nextBtn.style.display = "inline-block";
    nextBtn.disabled = !run.product;
    nextBtn.textContent = cond.context === "Food" ? "Add to Cart" : "Select Flight";
    return;
  }

  // Cart (Step 1)
  if(step === 1){
    panel.innerHTML = `
      <div class="storeLayout">
        <div>
          ${leftBase("Cart", "Your selection is in your cart. Proceed to checkout when ready.")}
          ${flightSummary}
          <div class="cardBlock" style="margin-top:14px;">
            <div style="font-weight:650;">Cart items</div>
            <div class="muted" style="margin-top:6px;">1 × ${p.name}</div>
          </div>
        </div>
        <div>
          ${sidePrice}
          <div class="cardBlock" style="margin-top:14px;">
            <div style="font-weight:650;">Next step</div>
            <div class="muted" style="margin-top:6px;">Proceed to checkout to continue.</div>
          </div>
        </div>
      </div>
    `;
    backBtn.style.display = "inline-block";
    backBtn.disabled = false;
    nextBtn.style.display = "inline-block";
    nextBtn.disabled = false;
    nextBtn.textContent = "Proceed to Checkout";
    return;
  }

  // Checkout (Step 2)
  if(step === 2){
    panel.innerHTML = `
      <div class="storeLayout">
        <div>
          ${leftBase("Checkout", "Enter checkout preferences (simulated).")}
          ${flightSummary}
          <div class="cardBlock" style="margin-top:14px;">
            <label class="field">
              <span class="muted">Payment method (simulated)</span>
              <select>
                <option>Credit card</option>
                <option>Debit card</option>
                <option>PayPal</option>
              </select>
            </label>
            <label class="field">
              <span class="muted">${cond.context === "Food" ? "Pickup/Delivery (simulated)" : "Fare options (simulated)"}</span>
              <select>
                ${cond.context === "Food"
                  ? `<option>Pickup</option><option>Delivery</option>`
                  : `<option>Standard</option><option>Flex</option>`}
              </select>
            </label>
          </div>
        </div>
        <div>
          ${sidePrice}
          <div class="cardBlock" style="margin-top:14px;">
            <div style="font-weight:650;">Order summary</div>
            <div class="muted" style="margin-top:6px;">Review next to confirm your purchase.</div>
          </div>
        </div>
      </div>
    `;
    backBtn.style.display = "inline-block";
    backBtn.disabled = false;
    nextBtn.style.display = "inline-block";
    nextBtn.disabled = false;
    nextBtn.textContent = "Go to Review";
    return;
  }

  // Review (Step 3)
  panel.innerHTML = `
    <div class="storeLayout">
      <div>
        ${leftBase("Review", "Review the final price and confirm your purchase.")}
        ${flightSummary}
        <div class="cardBlock" style="margin-top:14px;">
          ${run.priceChanged ? `
            <div class="notice">
              <strong>Notice:</strong> The price changed compared to earlier steps.
            </div>
          ` : ""}
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn primary" id="btnPurchaseConfirm">Purchase/Confirm</button>
            <button class="btn danger" id="btnCancelFromReview">Cancel / Abandon Cart</button>
          </div>
        </div>
      </div>
      <div>
        ${sidePrice}
        <div class="cardBlock" style="margin-top:14px;">
          <div style="font-weight:650;">Secure checkout (simulated)</div>
          <div class="muted" style="margin-top:6px;">No real payment is processed.</div>
        </div>
      </div>
    </div>
  `;

  $("btnPurchaseConfirm").addEventListener("click", () => finishRun("purchase_confirm"));
  $("btnCancelFromReview").addEventListener("click", () => finishRun("cancel_exit"));

  backBtn.style.display = "inline-block";
  backBtn.disabled = false;
  nextBtn.style.display = "none"; // Hide standard next button, replaced by confirm/cancel
}

// --- Finish run ---
function showConfirmed(run){
  run.orderId = makeOrderId();
  const c = run.condition;
  const p = run.product || { from: "?", to: "?", dateOut: "?", dateBack: "?", name: "?" };

  const lines = (c.context === "Flight")
    ? `
      <div><strong>Confirmation:</strong> ${run.orderId}</div>
      <div><strong>Route:</strong> ${p.from} → ${p.to}</div>
      <div><strong>Dates:</strong> ${p.dateOut} – ${p.dateBack}</div>
      <div><strong>Total:</strong> ${money(run.currentPrice)}</div>
    `
    : `
      <div><strong>Order:</strong> ${run.orderId}</div>
      <div><strong>Item:</strong> ${p.name}</div>
      <div><strong>Total:</strong> ${money(run.currentPrice)}</div>
    `;

  $("confirmedDetails").innerHTML = lines;

  showScreen("screen-confirmed");
  setStatus(`Case ${state.currentIndex + 1} confirmed`);

  // Auto-continue countdown
  const hint = $("autoContinueHint");
  let seconds = 3;
  hint.textContent = `Continuing in ${seconds}…`;

  if(state.autoTimer) clearInterval(state.autoTimer);
  state.autoTimer = setInterval(() => {
    seconds -= 1;
    if(seconds <= 0){
      clearInterval(state.autoTimer);
      state.autoTimer = null;
      proceedNext();
    }else{
      hint.textContent = `Continuing in ${seconds}…`;
    }
  }, 900);
}

function finishRun(outcome){
  const run = state.active;
  if(!run) return;

  run.outcome = outcome;
  run.outcomeAtMs = Date.now() - run.t0ms;

  if(run.priceChanged){
    run.rtAfterPriceChangeMs = run.outcomeAtMs - run.priceChangeAtMs;
  }

  run.events.push({
    t: nowISO(),
    type: "run_end",
    outcome,
    outcomeAtMs: run.outcomeAtMs,
    rtAfterPriceChangeMs: run.rtAfterPriceChangeMs
  });

  // Store the run now
  state.runs.push(run);
  state.active = null;

  if(outcome === "purchase_confirm"){
    showConfirmed(state.runs[state.runs.length - 1]);
  } else {
    // Cancel goes straight to next case
    proceedNext();
  }
}

function proceedNext(){
  if(state.autoTimer){
    clearInterval(state.autoTimer);
    state.autoTimer = null;
  }

  const nextIndex = state.currentIndex + 1;

  if(nextIndex < 4){
    startCase(nextIndex);
  } else {
    // Done 4 cases → debrief (Surveys removed)
    setTheme("Study");
    setStatus("Debrief / Export");
    showScreen("screen-debrief");
  }
}

// --- Export ---
function buildExport(){
  return {
    meta: {
      version: "v5_NoSurvey",
      exportedAt: nowISO(),
      participantId: state.participantId,
      groupAssignment: `Group ${state.groupAssignment + 1}`,
      order: state.order,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
    },
    runs: state.runs,
  };
}

function download(filename, content, mime){
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportJSON(){
  const data = buildExport();
  download(`${state.participantId || "participant"}_session.json`, JSON.stringify(data, null, 2), "application/json");
  $("debugLog").textContent = JSON.stringify(data.runs, null, 2);
}

function toCSV(rows){
  return rows.map(r => r.map(cell => {
    const s = String(cell ?? "");
    if(/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(",")).join("\n");
}

function exportCSV(){
  const data = buildExport();
  const rows = [];
  rows.push([
    "participantId", "groupAssignment", "caseIndex", "conditionKey", "siteKey", "context", "direction", "deltaPct",
    "caseName", "caseSummary", "basePrice", "priceBefore", "priceAfter",
    "outcome", "orderId", "durationMs", "rtAfterPriceChangeMs", "t0iso"
  ]);

  data.runs.forEach((run, idx) => {
    const c = run.condition;
    const p = run.product || {};
    const summary = (c.context === "Flight")
      ? (p.from ? `${p.from} → ${p.to} (${p.dateOut}–${p.dateBack})` : "")
      : (p.desc || "");

    rows.push([
      data.meta.participantId,
      data.meta.groupAssignment,
      idx + 1,
      c.key,
      c.siteKey,
      c.context,
      c.direction,
      c.deltaPct,
      p.name || "None Selected",
      summary,
      run.basePrice,
      run.priceBefore ?? "",
      run.priceAfter ?? "",
      run.outcome ?? "",
      run.orderId ?? "",
      run.outcomeAtMs ?? "",
      run.rtAfterPriceChangeMs ?? "",
      run.t0iso
    ]);
  });

  download(`${state.participantId || "participant"}_session.csv`, toCSV(rows), "text/csv");
}

// --- Wiring ---
function init(){
  setTheme("Study");
  setStatus("Not started");
  showScreen("screen-consent");

  stepButtons.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      if(i <= state.maxStepReached){
        setActiveStep(i);
      }
    });
  });

  $("btnConsentStart").addEventListener("click", () => {
    const pid = $("participantId").value.trim();
    const groupVal = $("groupAssignment").value;
    const ok = $("consentCheck").checked;
    
    if(!pid){ alert("Please enter a Participant ID."); return; }
    if(groupVal === ""){ alert("Please select a Group Assignment."); return; }
    if(!ok){ alert("Please confirm that the external consent form is completed."); return; }

    state.participantId = pid;
    state.groupAssignment = parseInt(groupVal, 10);
    state.order = ORDERS[state.groupAssignment];
    
    state.runs = [];
    state.currentIndex = 0;
    state.active = null;

    // START CASE 1 OF 4 directly (skipping demographic screen)
    startCase(0);
  });

  $("btnBack").addEventListener("click", () => {
    if(state.currentStep > 0) setActiveStep(state.currentStep - 1);
  });

  $("btnNext").addEventListener("click", () => {
    const s = state.currentStep;
    if(s < 3){
      state.maxStepReached = Math.max(state.maxStepReached, s + 1);
      setActiveStep(s + 1);
    }
  });

  $("btnConfirmedContinue").addEventListener("click", () => {
    proceedNext();
  });

  $("btnExportJSON").addEventListener("click", exportJSON);
  $("btnExportCSV").addEventListener("click", exportCSV);

  $("btnResetAll").addEventListener("click", () => {
    if(!confirm("Reset everything for the next participant?")) return;
    location.reload();
  });
}

init();
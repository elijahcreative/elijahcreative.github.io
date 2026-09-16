(function () {
  "use strict";

  const SETTINGS_KEY = "cellSignalConfig";
  const MAX_PENDING = 50;
  const app = {
    isOffice: false,
    workbookName: "Excel-munkafüzet",
    groups: [],
    contacts: [],
    rules: [],
    changes: [],
    email: {
      salutation: "Kedves Kollégák!",
      subject: "Excel-változás: {sheet} {address}"
    },
    eventRegistered: false,
    noticeTimer: null,
    confirmResolve: null
  };

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", function () {
    bindUi();
    renderAll();
  });

  if (window.Office) {
    Office.onReady(async function (info) {
      app.isOffice = info.host === Office.HostType.Excel;
      if (!info.host) {
        setStatus("Előnézeti mód", "active");
        await loadConfig();
        return;
      }
      if (!app.isOffice) {
        setStatus("Excel szükséges", "error");
        showNotice("A CellSignal Excelben használható.", true);
        return;
      }

      await initializeWorkbook();
    });
  } else {
    setStatus("Előnézeti mód", "active");
  }

  function bindUi() {
    $("emailForm").addEventListener("submit", saveEmailSettings);
    $("ruleForm").addEventListener("submit", addRuleFromForm);
    $("useSelectionButton").addEventListener("click", useSelectedRange);
    $("ruleList").addEventListener("click", handleRuleAction);
    $("changeBatchActions").addEventListener("click", handleBatchChangeAction);
    $("confirmAllowButton").addEventListener("click", function () { closeConfirm(true); });
    $("confirmCancelButton").addEventListener("click", function () { closeConfirm(false); });
  }

  async function initializeWorkbook() {
    try {
      await loadConfig();
      await Excel.run(async function (context) {
        const workbook = context.workbook;
        workbook.load("name");
        await context.sync();
        app.workbookName = workbook.name || app.workbookName;
        $("workbookName").textContent = app.workbookName;

        if (!app.eventRegistered) {
          workbook.worksheets.onChanged.add(handleWorksheetChanged);
          await context.sync();
          app.eventRegistered = true;
        }
      });
      renderAll();
    } catch (error) {
      setStatus("Figyelés szünetel", "error");
      showNotice(getErrorMessage(error), true);
    }
  }

  async function loadConfig() {
    let config = null;
    if (app.isOffice && Office.context.document && Office.context.document.settings) {
      config = Office.context.document.settings.get(SETTINGS_KEY);
      if (typeof config === "string") {
        try { config = JSON.parse(config); } catch (_) { config = null; }
      }
    }
    if (!config) {
      try {
        config = JSON.parse(localStorage.getItem(storageKey()) || "null");
      } catch (_) {
        config = null;
      }
    }
    app.groups = config && Array.isArray(config.groups) ? config.groups : [];
    app.contacts = config && Array.isArray(config.contacts) ? config.contacts : [];
    app.rules = config && Array.isArray(config.rules) ? config.rules : [];
    app.changes = config && Array.isArray(config.changes) ? config.changes : [];
    app.email = {
      salutation: config && config.email && config.email.salutation
        ? config.email.salutation
        : firstSavedRuleValue("salutation", "Kedves Kollégák!"),
      subject: config && config.email && config.email.subject
        ? config.email.subject
        : firstSavedRuleValue("subject", "Excel-változás: {sheet} {address}")
    };
    $("salutationInput").value = app.email.salutation;
    $("subjectInput").value = app.email.subject;
    renderAll();
  }

  async function saveConfig() {
    const config = {
      groups: app.groups,
      contacts: app.contacts,
      rules: app.rules,
      changes: app.changes.slice(0, MAX_PENDING),
      email: app.email
    };
    if (app.isOffice && Office.context.document && Office.context.document.settings) {
      Office.context.document.settings.set(SETTINGS_KEY, JSON.stringify(config));
      await new Promise(function (resolve, reject) {
        Office.context.document.settings.saveAsync(function (result) {
          if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
          else reject(result.error || new Error("A beállításokat nem sikerült menteni."));
        });
      });
    } else {
      localStorage.setItem(storageKey(), JSON.stringify(config));
    }
  }

  function storageKey() {
    return "cellSignal:" + app.workbookName;
  }

  async function useSelectedRange() {
    if (!app.isOffice) {
      showNotice("A kijelölés Excelben érhető el.");
      return;
    }
    try {
      await Excel.run(async function (context) {
        const range = context.workbook.getSelectedRange();
        const sheet = range.worksheet;
        range.load("address");
        sheet.load("name");
        await context.sync();
        $("sheetInput").value = sheet.name;
        $("addressInput").value = normalizeAddress(range.address);
        $("addressInput").focus();
        showNotice("A kijelölt tartomány bekerült az új szabályba.");
      });
    } catch (error) {
      showNotice(getErrorMessage(error), true);
    }
  }

  async function addRuleFromForm(event) {
    event.preventDefault();
    const sheet = $("sheetInput").value.trim();
    const address = normalizeAddress($("addressInput").value.trim());
    if (!sheet || !address) {
      showNotice("Add meg a munkalapot és a cellát vagy tartományt.", true);
      return;
    }

    const duplicate = app.rules.find(function (rule) {
      return rule.sheet === sheet && normalizeAddress(rule.address) === address;
    });
    if (duplicate) {
      showNotice("Ehhez a cellához már tartozik figyelési szabály.", true);
      return;
    }

    app.rules.unshift({
      id: createId(),
      sheet,
      address,
      groupId: "",
      contactIds: [],
      recipients: [],
      enabled: true
    });
    await saveConfig();
    event.target.reset();
    renderAll();
    showNotice("A figyelési szabály elmentve.");
  }

  async function saveEmailSettings(event) {
    event.preventDefault();
    app.email.salutation = $("salutationInput").value.trim() || "Kedves Kollégák!";
    app.email.subject = $("subjectInput").value.trim() || "Excel-változás: {sheet} {address}";
    await saveConfig();
    renderChanges();
    showNotice("Az e-mail-beállítások elmentve.");
  }

  async function handleRuleAction(event) {
    const button = event.target.closest("button[data-rule-action]");
    if (!button) return;
    if (button.dataset.ruleAction === "show") {
      const rule = app.rules.find((item) => item.id === button.dataset.ruleId);
      if (rule) await showRuleRange(rule);
      return;
    }
    if (button.dataset.ruleAction === "delete") {
      const rule = app.rules.find((item) => item.id === button.dataset.ruleId);
      if (!rule) return;
      const confirmed = await showConfirm(
        "Figyelés törlése",
        "Biztosan törlöd ezt a figyelést? A hozzá tartozó új változásokat ezután nem gyűjtjük."
      );
      if (!confirmed) return;
      app.rules = app.rules.filter((item) => item.id !== rule.id);
      await saveConfig();
      renderAll();
      showNotice("A figyelési szabály törölve.");
      return;
    }
    if (button.dataset.ruleAction === "delete-group") {
      const group = app.groups.find((item) => item.id === button.dataset.ruleId);
      if (!group) return;
      app.groups = app.groups.filter((item) => item.id !== group.id);
      await saveConfig();
      renderAll();
      showNotice("A címzettcsoport törölve.");
      return;
    }
    if (button.dataset.ruleAction === "delete-contact") {
      app.contacts = app.contacts.filter((item) => item.id !== button.dataset.ruleId);
      await saveConfig();
      renderAll();
      showNotice("A címzett törölve.");
    }
  }

  async function handleBatchChangeAction(event) {
    const button = event.target.closest("button[data-batch-action]");
    if (!button) return;
    if (!app.changes.length) return;
    if (button.dataset.batchAction === "clear") {
      const confirmed = await showConfirm(
        "Változások törlése",
        "Biztosan törlöd az összes küldésre váró változást?"
      );
      if (!confirmed) return;
      app.changes = [];
      await saveConfig();
      renderAll();
      showNotice("A változáslista törölve.");
      return;
    }
    if (button.dataset.batchAction === "mail") {
      await openMailDraftForChanges();
    }
  }

  async function handleWorksheetChanged(event) {
    try {
      const contextResult = await Excel.run(async function (context) {
        const sheet = context.workbook.worksheets.getItem(event.worksheetId);
        const range = sheet.getRange(event.address);
        sheet.load("name");
        range.load(["values", "text"]);
        await context.sync();
        return { sheetName: sheet.name, values: range.values, text: range.text };
      });

      const address = normalizeAddress(event.address);
      const matchingRules = app.rules.filter(function (rule) {
        return rule.enabled && rule.sheet === contextResult.sheetName && rangesIntersect(rule.address, address);
      });
      if (!matchingRules.length) return;

      for (const rule of matchingRules) {
        const singleCellDetails = event.details && !Array.isArray(event.details.valueBefore);
        const before = singleCellDetails ? event.details.valueBefore : "Több cella";
        const after = singleCellDetails ? event.details.valueAfter : summarizeValues(contextResult.values, contextResult.text);
        app.changes.unshift({
          id: createId(),
          ruleId: rule.id,
          sheet: contextResult.sheetName,
          address,
          before: formatValue(before),
          after: formatValue(after),
          source: event.source || "Local",
          createdAt: new Date().toISOString(),
          state: "pending",
          error: ""
        });
      }
      app.changes = app.changes.slice(0, MAX_PENDING);
      await saveConfig();
      renderAll();
    } catch (error) {
      showNotice("A változás észlelve, de a részleteket nem sikerült beolvasni: " + getErrorMessage(error), true);
    }
  }

  async function showRuleRange(rule) {
    if (!app.isOffice) {
      showNotice("A cellák megmutatása Excelben érhető el.");
      return;
    }
    try {
      await Excel.run(async function (context) {
        const sheet = context.workbook.worksheets.getItem(rule.sheet);
        const range = sheet.getRange(rule.address);
        sheet.activate();
        range.select();
        await context.sync();
      });
      showNotice("A figyelt tartomány kijelölve.");
    } catch (error) {
      showNotice("A figyelt tartományt nem sikerült kijelölni: " + getErrorMessage(error), true);
    }
  }

  async function openMailDraftForChanges() {
    const changes = sortedChanges();
    if (!changes.length) return;
    const subject = buildBatchSubject(changes);
    const body = buildMailBody(changes);
    const mailto = "mailto:"
      + "?subject=" + encodeURIComponent(subject)
      + "&body=" + encodeURIComponent(body);
    try {
      window.location.href = mailto;
      showNotice("Az új e-mail megnyílt. Ellenőrizd, formázd és küldd el a levelező alkalmazásban.");
    } catch (error) {
      await saveConfig();
      renderAll();
      showNotice("Az e-mail ablakát nem sikerült megnyitni: " + getErrorMessage(error), true);
    }
  }

  function buildBatchSubject(changes) {
    const first = changes[0] || {};
    const base = app.email.subject || "Excel-változás: {sheet} {address}";
    if (changes.length === 1) return template(base, first);
    return "Excel-változások: " + app.workbookName + " (" + changes.length + " cella)";
  }

  function buildMailBody(changes) {
    const rows = changes.map(function (change) {
      return "- " + change.sheet + "!" + change.address + ": " + change.before + " → " + change.after;
    });
    return [
      app.email.salutation || "Kedves Kollégák!",
      "",
      "A(z) " + app.workbookName + " munkafüzetben az alábbi cellák értéke változott:",
      "",
      rows.join("\n"),
      "",
      "Összesen: " + changes.length + " változás"
    ].join("\n");
  }

  function renderAll() {
    renderRules();
    renderChanges();
    refreshMonitorStatus();
  }

  function renderRules() {
    const list = $("ruleList");
    if (!app.rules.length) {
      list.innerHTML = "<p class=\"muted\">Még nincs figyelési szabály. Válassz ki egy cellát, majd mentsd el.</p>";
      return;
    }
    list.innerHTML = app.rules.map(function (rule) {
      return "<div class=\"rule-row " + (rule.enabled ? "rule-active" : "rule-disabled") + "\">"
        + "<div><div class=\"rule-name\">" + escapeHtml(rule.sheet) + "!" + escapeHtml(rule.address) + "</div>"
        + "<div class=\"rule-meta\">" + escapeHtml(rule.enabled ? "Élesített figyelés" : "Szüneteltetve") + "</div></div>"
        + "<div class=\"row-actions\"><button class=\"button button-secondary button-small\" type=\"button\" data-rule-action=\"show\" data-rule-id=\"" + escapeHtml(rule.id) + "\">Mutasd</button>"
        + "<button class=\"button button-danger\" type=\"button\" data-rule-action=\"delete\" data-rule-id=\"" + escapeHtml(rule.id) + "\">Törlés</button></div>"
        + "</div>";
    }).join("");
  }

  function renderChanges() {
    $("pendingCount").textContent = String(app.changes.length);
    const list = $("changeList");
    $("changeBatchActions").hidden = !app.changes.length;
    if (!app.changes.length) {
      list.innerHTML = "<div class=\"empty-state\"><span class=\"empty-icon\" aria-hidden=\"true\">↗</span><p>Még nincs küldésre váró változás.</p><small>Szerkessz egy figyelt cellát az Excelben.</small></div>";
      return;
    }
    list.innerHTML = sortedChanges().map(function (change) {
      const error = change.state === "error";
      return "<article class=\"change-item " + (error ? "is-error" : "") + "\">"
        + "<div class=\"change-topline\"><div class=\"change-location\">" + escapeHtml(change.sheet) + "!" + escapeHtml(change.address) + "</div>"
        + "<div class=\"change-time\">" + escapeHtml(formatTime(change.createdAt)) + "</div></div>"
        + "<div class=\"change-values\"><span class=\"value-chip\" title=\"Előző érték\">" + escapeHtml(change.before) + "</span><span class=\"value-arrow\">→</span><span class=\"value-chip\" title=\"Új érték\">" + escapeHtml(change.after) + "</span></div>"
        + (change.error ? "<small class=\"error-text\">" + escapeHtml(change.error) + "</small>" : "")
        + "</article>";
    }).join("");
  }

  function sortedChanges() {
    return app.changes.slice().sort(function (left, right) {
      const sheetCompare = String(left.sheet || "").localeCompare(String(right.sheet || ""), "hu", { sensitivity: "base" });
      if (sheetCompare) return sheetCompare;
      const addressCompare = compareAddress(left.address, right.address);
      if (addressCompare) return addressCompare;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }

  function compareAddress(left, right) {
    const a = parseRange(left);
    const b = parseRange(right);
    if (a && b) {
      if (a.top !== b.top) return a.top - b.top;
      if (a.left !== b.left) return a.left - b.left;
      if (a.bottom !== b.bottom) return a.bottom - b.bottom;
      return a.right - b.right;
    }
    return normalizeAddress(left).localeCompare(normalizeAddress(right), "hu", { numeric: true, sensitivity: "base" });
  }

  function setStatus(text, state) {
    const status = $("monitorStatus");
    if (!status) return;
    status.className = "status " + (state ? "is-" + state : "");
    $("monitorStatusText").textContent = text;
  }

  function refreshMonitorStatus() {
    if (!app.isOffice) {
      setStatus("Előnézeti mód", "active");
      return;
    }
    if (!app.eventRegistered) return;
    const activeRules = app.rules.filter((rule) => rule.enabled).length;
    if (activeRules) {
      setStatus(activeRules === 1 ? "1 élesített figyelés" : activeRules + " élesített figyelés", "active");
    } else {
      setStatus("Nincs élesített figyelés", "");
    }
  }

  function showNotice(message, isError) {
    const notice = $("notice");
    if (!notice) return;
    window.clearTimeout(app.noticeTimer);
    notice.hidden = false;
    notice.className = "notice" + (isError ? " is-error" : "");
    notice.textContent = message;
    app.noticeTimer = window.setTimeout(function () { notice.hidden = true; }, 5000);
  }

  function showConfirm(title, message) {
    const dialog = $("confirmDialog");
    $("confirmTitle").textContent = title;
    $("confirmMessage").textContent = message;
    dialog.hidden = false;
    $("confirmAllowButton").focus();
    return new Promise(function (resolve) {
      app.confirmResolve = resolve;
    });
  }

  function closeConfirm(allowed) {
    const dialog = $("confirmDialog");
    dialog.hidden = true;
    if (app.confirmResolve) app.confirmResolve(Boolean(allowed));
    app.confirmResolve = null;
  }

  function normalizeAddress(value) {
    return String(value || "").replace(/\$/g, "").replace(/^.*!/g, "").toUpperCase();
  }

  function rangesIntersect(left, right) {
    const a = parseRange(left);
    const b = parseRange(right);
    if (!a || !b) return normalizeAddress(left) === normalizeAddress(right);
    return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
  }

  function parseRange(value) {
    const parts = normalizeAddress(value).split(":");
    const first = parseCell(parts[0]);
    const last = parseCell(parts[1] || parts[0]);
    if (!first || !last) return null;
    return { left: Math.min(first.col, last.col), right: Math.max(first.col, last.col), top: Math.min(first.row, last.row), bottom: Math.max(first.row, last.row) };
  }

  function parseCell(value) {
    const match = /^([A-Z]+)(\d+)$/.exec(String(value || "").trim());
    if (!match) return null;
    let col = 0;
    for (const char of match[1]) col = col * 26 + char.charCodeAt(0) - 64;
    return { col, row: Number(match[2]) };
  }

  function splitRecipients(value) {
    return String(value || "").split(/[;,]/).map((item) => item.trim()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
  }

  function summarizeValues(values, text) {
    const flat = (text || values || []).flat ? (text || values).flat() : [];
    const clean = flat.map(formatValue).filter(Boolean);
    if (!clean.length) return "Üres érték";
    return clean.length > 4 ? clean.slice(0, 4).join(", ") + "…" : clean.join(", ");
  }

  function formatValue(value) {
    if (value === null || typeof value === "undefined" || value === "") return "Üres";
    if (Array.isArray(value)) return value.map(formatValue).join(", ");
    return String(value);
  }

  function template(value, change) {
    return String(value || "").replace(/\{sheet\}/g, change.sheet).replace(/\{address\}/g, change.address).replace(/\{before\}/g, change.before).replace(/\{after\}/g, change.after);
  }

  function formatTime(value) {
    try { return new Date(value).toLocaleString("hu-HU", { hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; }
  }

  function createId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]; });
  }

  function getErrorMessage(error) {
    return error && error.message ? error.message : String(error || "Ismeretlen hiba");
  }

  function firstSavedRuleValue(key, fallback) {
    const saved = app.rules.find((rule) => rule && rule[key]);
    return saved ? saved[key] : fallback;
  }

  function getRuleRecipients(rule) {
    const recipients = [];
    app.groups.forEach(function (group) {
      if (!group.ruleId || group.ruleId === rule.id || group.id === rule.groupId) {
        recipients.push.apply(recipients, group.recipients || []);
      }
    });
    app.contacts.forEach(function (contact) {
      if (!contact.ruleId || contact.ruleId === rule.id) recipients.push(contact.email);
    });
    recipients.push.apply(recipients, rule.recipients || []);
    return Array.from(new Set(recipients.filter(Boolean)));
  }
})();

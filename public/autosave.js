(() => {
  const timers = new WeakMap();
  const fadeTimers = new WeakMap();
  const boundRows = new WeakSet();

  function values(row) {
    syncTieWinner(row);
    const data = {};
    for (const input of row.querySelectorAll("select, input[type='hidden']")) {
      if (!input.name) continue;
      if (input.disabled) continue;
      if (input.required && !input.value) return null;
      data[input.name] = input.value;
    }
    return data;
  }

  function scores(row) {
    const scoreA = row.querySelector('[name="score_a"]');
    const scoreB = row.querySelector('[name="score_b"]');
    if (!scoreA || !scoreB || scoreA.value === "" || scoreB.value === "") return null;
    return { scoreA: Number(scoreA.value), scoreB: Number(scoreB.value) };
  }

  function syncTieWinner(row) {
    const wrapper = row.querySelector(".tie-winner");
    const select = wrapper?.querySelector('[name="winner_team_id"]');
    if (!wrapper || !select) return;
    const picked = scores(row);
    const isTie = picked && picked.scoreA === picked.scoreB;
    wrapper.classList.toggle("is-hidden", !isTie);
    select.disabled = !isTie;
    select.required = Boolean(isTie);
    if (!isTie) select.value = "";
  }

  function state(row, text, mode = "") {
    const target = row.querySelector(".save-state");
    if (!target) return;
    window.clearTimeout(fadeTimers.get(target));
    target.className = `save-state ${mode}`;
    target.textContent = text;
    if (mode === "saved") {
      fadeTimers.set(
        target,
        window.setTimeout(() => {
          target.classList.add("is-fading");
          window.setTimeout(() => {
            target.textContent = "";
            target.className = "save-state";
          }, 500);
        }, 1100),
      );
    }
  }

  function editableInputs(row) {
    return [...row.querySelectorAll("select, input[type='hidden']")].filter((input) => input.name);
  }

  function captureDrafts(board) {
    const drafts = new Map();
    const active = document.activeElement;
    let focused = null;
    for (const row of board.querySelectorAll(".autosave-row[data-save-url]")) {
      const fields = editableInputs(row).map((input) => ({ name: input.name, value: input.value }));
      drafts.set(row.dataset.saveUrl, fields);
      if (row.contains(active) && active.name) {
        focused = { saveUrl: row.dataset.saveUrl, name: active.name };
      }
    }
    return { drafts, focused };
  }

  function restoreDrafts(board, snapshot) {
    if (!snapshot) return;
    for (const row of board.querySelectorAll(".autosave-row[data-save-url]")) {
      const fields = snapshot.drafts.get(row.dataset.saveUrl);
      if (!fields) continue;
      for (const field of fields) {
        const input = editableInputs(row).find((item) => item.name === field.name);
        if (input) input.value = field.value;
      }
      syncTieWinner(row);
    }
    if (snapshot.focused) {
      const row = [...board.querySelectorAll(".autosave-row[data-save-url]")].find(
        (item) => item.dataset.saveUrl === snapshot.focused.saveUrl,
      );
      editableInputs(row || document.createElement("div"))
        .find((input) => input.name === snapshot.focused.name)
        ?.focus();
    }
  }

  async function refreshBoard() {
    const board = document.querySelector("#pronos-board");
    if (!board) return;
    const snapshot = captureDrafts(board);
    const response = await fetch(board.dataset.refreshUrl || window.location.href, {
      headers: { "X-Requested-With": "fetch" },
    });
    if (!response.ok) return;
    const html = await response.text();
    const next = new DOMParser().parseFromString(html, "text/html").querySelector("#pronos-board");
    if (!next) return;
    board.replaceWith(next);
    restoreDrafts(next, snapshot);
    initAutosave(next);
    window.lucide?.createIcons();
  }

  async function save(row) {
    const payload = values(row);
    if (!payload) return;
    state(row, "", "saving");
    row.classList.add("is-saving");
    try {
      const response = await fetch(row.dataset.saveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "Erreur d'enregistrement.");
      state(row, "Enregistré", "saved");
      if (json.refresh || row.dataset.refreshOnSave === "true") {
        window.setTimeout(() => refreshBoard(), 350);
      }
    } catch (error) {
      state(row, error.message, "error");
    } finally {
      row.classList.remove("is-saving");
    }
  }

  function initAutosave(scope = document) {
    for (const row of scope.querySelectorAll(".autosave-row")) {
      if (boundRows.has(row)) continue;
      boundRows.add(row);
      syncTieWinner(row);
      row.addEventListener("change", (event) => {
        if (!event.target.matches("select, input")) return;
        syncTieWinner(row);
        window.clearTimeout(timers.get(row));
        timers.set(row, window.setTimeout(() => save(row), 250));
      });
    }
  }

  initAutosave();
})();

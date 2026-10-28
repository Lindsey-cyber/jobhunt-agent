// SYNTHETIC: a minimal stand-in for Greenhouse's react-select v5 markup
// (class prefix "select__", combobox input, listbox rendered only while open).
document.querySelectorAll(".select__container").forEach((container) => {
  const control = container.querySelector(".select__control");
  const input = container.querySelector("input.select__input");
  const valueBox = container.querySelector(".select__value-container");
  const options = JSON.parse(container.dataset.options);
  const close = () => container.querySelector(".select__menu")?.remove();
  const choose = (text) => {
    valueBox.querySelector(".select__placeholder, .select__single-value")?.remove();
    const v = document.createElement("div");
    v.className = "select__single-value";
    v.textContent = text;
    valueBox.prepend(v);
    container.querySelector("input[type=hidden]").value = text;
    close();
  };
  control.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (container.querySelector(".select__menu")) return close();
    const menu = document.createElement("div");
    menu.className = "select__menu";
    const list = document.createElement("div");
    list.className = "select__menu-list";
    list.setAttribute("role", "listbox");
    list.id = `react-select-${input.id}-listbox`;
    options.forEach((text, i) => {
      const o = document.createElement("div");
      o.className = "select__option";
      o.setAttribute("role", "option");
      o.id = `react-select-${input.id}-option-${i}`;
      o.textContent = text;
      o.addEventListener("click", () => choose(text));
      list.append(o);
    });
    menu.append(list);
    container.append(menu);
    input.setAttribute("aria-controls", list.id);
    input.focus();
  });
  input.addEventListener("keydown", (e) => e.key === "Escape" && close());
});

document.querySelector("#application-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const missing = [...form.querySelectorAll("[aria-required=true], [required]")].filter((el) => {
    if (el.classList.contains("file-upload")) return !el.querySelector("input[type=file]").files.length;
    if (el.classList.contains("select__input")) return !el.closest(".select__container").querySelector("input[type=hidden]").value;
    return !el.value;
  });
  if (missing.length) {
    document.querySelector("#errors").textContent = `Please complete ${missing.length} required field(s)`;
    return;
  }
  const body = {};
  for (const [k, v] of new FormData(form)) body[k] = v instanceof File ? v.name : v;
  await fetch(location.pathname + "/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  location.href = location.pathname + "/confirmation";
});

(form) => {
  const labelText = (el) => {
    const by = (el.getAttribute("aria-labelledby") || "").split(/\s+/)[0];
    const node = (by && document.getElementById(by)) || (el.id && form.querySelector(`label[for="${el.id}"]`));
    return node ? node.textContent || "" : el.getAttribute("aria-label") || "";
  };
  const required = (el, label) =>
    el.getAttribute("aria-required") === "true" || el.hasAttribute("required") || /\*\s*$/.test(label.trim());
  const out = [];

  for (const el of form.querySelectorAll("input, textarea, select")) {
    if (el.closest(".select__container") && !el.matches('input.select__input[role="combobox"]')) continue;
    if (el.tagName === "INPUT" && ["hidden", "submit", "button", "radio", "checkbox"].includes(el.type)) continue;
    const label = labelText(el);
    const kind = el.matches('[role="combobox"]')
      ? "combobox"
      : el.tagName === "TEXTAREA"
        ? "textarea"
        : el.tagName === "SELECT"
          ? "select"
          : el.type === "file"
            ? "file"
            : "text";
    const options = el.tagName === "SELECT" ? [...el.options].filter((o) => o.value !== "").map((o) => o.text.trim()) : [];
    const fileRequired = el.type === "file" && el.closest('[aria-required="true"]') !== null;
    out.push({ id: el.id || el.name, label, kind, required: required(el, label) || fileRequired, options });
  }

  for (const fs of form.querySelectorAll("fieldset")) {
    const inputs = [...fs.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
    if (inputs.length === 0) continue;
    const legend = (fs.querySelector("legend") || {}).textContent || "";
    out.push({
      id: inputs[0].name,
      label: legend,
      kind: inputs[0].type,
      required: required(fs, legend) || inputs.some((i) => i.required),
      options: inputs.map((i) => ((i.labels && i.labels[0] && i.labels[0].textContent) || i.value).trim()),
    });
  }
  return out;
}

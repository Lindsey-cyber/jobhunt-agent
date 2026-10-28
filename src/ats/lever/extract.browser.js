(form) => {
  // Lever renders each question as li.application-question (or div in the EEO
  // block) with a .application-label and native inputs named after the field.
  const text = (el) => (el ? el.textContent : "").replace(/\s+/g, " ").trim();
  const out = [];
  const seen = new Set();
  for (const q of form.querySelectorAll(".application-question")) {
    const labelEl = q.querySelector(".application-label .text") || q.querySelector(".application-label");
    if (!labelEl) continue;
    const required = !!q.querySelector(".application-label .required, .required-field") || !!q.querySelector("[required]");
    const label = text(labelEl).replace(/\s*✱\s*$/, "");
    const inputs = [...q.querySelectorAll("input, textarea, select")].filter(
      (el) => el.type !== "hidden" && el.type !== "submit" && el.id !== "customPronounsOption" && el.id !== "customPronounsTextField",
    );
    if (inputs.length === 0) continue;
    const first = inputs[0];
    const name = first.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (first.type === "radio" || first.type === "checkbox") {
      const group = inputs.filter((i) => i.name === name);
      out.push({ id: name, label, kind: first.type, required, options: group.map((i) => i.value) });
    } else if (first.tagName === "SELECT") {
      out.push({ id: name, label, kind: "select", required, options: [...first.options].filter((o) => o.value !== "").map((o) => o.text.trim()) });
    } else {
      out.push({ id: name, label, kind: first.tagName === "TEXTAREA" ? "textarea" : first.type === "file" ? "file" : "text", required, options: [] });
    }
  }
  return out;
}

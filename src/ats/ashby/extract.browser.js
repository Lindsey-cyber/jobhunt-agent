// Runs in the page. Plain JS so the inner functions survive (tsx rewrites them).
// Every Ashby question carries a data-field-path (its id): text questions on the
// field entry itself, radio and checkbox groups on a div around a fieldset.
(root) => {
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const fields = [];
  for (const entry of root.querySelectorAll("[data-field-path]")) {
    if (entry.parentElement && entry.parentElement.closest("[data-field-path]")) continue;
    const id = entry.getAttribute("data-field-path");
    const title = entry.querySelector(".ashby-application-form-question-title");
    const label = text(title);
    const requiredMark = Boolean(title && /_required_/.test(title.className));
    const anyRequired = Boolean(entry.querySelector("[required]"));
    const required = requiredMark || anyRequired;

    // The phone entry also carries the SMS consent radios; they are their own question.
    const consent = entry.querySelectorAll('input[type="radio"][name="communicationConsent"]');
    if (consent.length) {
      fields.push({
        id: "communicationConsent",
        label: "Do you consent to receive text messages about your application?",
        kind: "radio",
        required: false,
        options: [...consent].map((r) => (r.value === "given" ? "Yes" : "No")),
      });
    }

    // System fields: the name box is the full name; education history is one
    // composite block the adapter fills from a single value.
    if (id === "_systemfield_name") {
      fields.push({ id, label: "Full Name", kind: "text", required, options: [] });
      continue;
    }
    if (id === "_systemfield_education_history") {
      fields.push({ id, label: "Education History", kind: "text", required, options: [] });
      continue;
    }

    let kind = "text";
    let options = [];
    if (entry.querySelector('input[type="file"]')) kind = "file";
    else if (entry.querySelector(".ashby-application-form-input-yesno")) {
      kind = "radio";
      options = [...entry.querySelectorAll("button[data-option]")].map((b) => text(b) || b.getAttribute("data-option"));
    } else if (entry.querySelector('input[type="radio"]:not([name="communicationConsent"])')) {
      kind = "radio";
      options = [...entry.querySelectorAll('input[type="radio"]')].map((r) => text(entry.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.value);
    } else if (entry.querySelector('input[type="checkbox"]')) {
      kind = "checkbox";
      options = [...entry.querySelectorAll('input[type="checkbox"]')].map((c) => text(entry.querySelector(`label[for="${CSS.escape(c.id)}"]`)) || c.name);
    } else if (entry.querySelector('input[role="combobox"]')) kind = "combobox";
    else if (entry.querySelector("textarea")) kind = "textarea";
    else if (entry.querySelector("select")) {
      kind = "select";
      options = [...entry.querySelectorAll("select option")].map(text).filter(Boolean);
    } else if (!entry.querySelector("input")) continue;

    fields.push({ id, label, kind, required, options });
  }
  return fields;
};

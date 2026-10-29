// Runs in the page. Plain JS so the inner functions survive (tsx rewrites them).
// Workday wraps each question in [data-automation-id^="formField-"]; the label
// (or a fieldset legend) holds the question and a trailing "*" marks it required.
(root) => {
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const page = root.querySelector('[data-automation-id="applyFlowPage"]') || root;
  const fields = [];
  for (const box of page.querySelectorAll('[data-automation-id^="formField-"]')) {
    if (box.parentElement && box.parentElement.closest('[data-automation-id^="formField-"]')) continue;
    if (box.closest('[aria-hidden="true"]')) continue;
    const id = box.getAttribute("data-automation-id").slice("formField-".length);
    const head = box.querySelector("legend") || box.querySelector("label");
    const raw = text(head);
    let label = raw.replace(/\*+\s*$/, "").trim();
    // The preferred-name block repeats "First Name"/"Last Name"; say which.
    if (/^preferredName--/.test(id)) label = `Preferred ${label}`;
    // The resume block's upload is labelled "Upload a file (5MB max)".
    if (box.querySelector('[id^="resumeAttachments"]')) label = "Resume/CV";
    const required = /\*\s*$/.test(raw) || Boolean(box.querySelector('[aria-required="true"], [required]'));
    let kind = "text";
    let options = [];
    if (box.querySelector('input[type="file"]')) kind = "file";
    else if (box.querySelector('[data-automation-id="dateInputWrapper"], [data-automation-id^="dateSection"]')) kind = "date";
    else if (box.querySelector('button[aria-haspopup="listbox"]')) kind = "listbox";
    else if (box.querySelector('[data-automation-id="multiselectInputContainer"], [data-uxi-widget-type="selectinput"]')) kind = "combobox";
    else if (box.querySelector('input[type="radio"]')) {
      kind = "radio";
      options = [...box.querySelectorAll('input[type="radio"]')].map((r) => text(box.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.value);
    } else if (box.querySelector('input[type="checkbox"]')) {
      kind = "checkbox";
      options = [...box.querySelectorAll('input[type="checkbox"]')].map((c) => text(box.querySelector(`label[for="${CSS.escape(c.id)}"]`)) || label);
    } else if (box.querySelector("textarea")) kind = "textarea";
    else if (!box.querySelector("input")) continue;
    if (box.querySelector('input[readonly], input[disabled]') && kind === "text") continue;
    fields.push({ id, label, kind, required, options });
  }
  return fields;
}

"""Deterministic verified-answer matching before the browser asks an LLM to navigate."""

import re


class FormReview(Exception):
    pass


def normalize(value):
    return re.sub(r"[^a-z0-9]", "", value.lower().replace("(required)", "").replace("(optional)", ""))


def answer_for(element, answers):
    label = element.get("group_label") or element.get("label", "")
    candidates = []
    for key, answer in answers.items():
        names = [answer.get("question", ""), *answer.get("aliases", [])]
        if normalize(label) and normalize(label) in {normalize(n) for n in names if n}:
            # Repeated work/education fields need an explicit section, never a guessed record.
            section = answer.get("section", "")
            if section and normalize(section) != normalize(element.get("section", "")):
                continue
            if element.get("repeated") and not section:
                continue
            candidates.append((key, answer))
    return candidates[0] if len(candidates) == 1 else None


def deterministic_action(elements, answers):
    for el in elements:
        if el.get("disabled") or el.get("readonly"):
            continue
        kind = el.get("type", "")
        if kind == "file" and not el.get("value") and re.search(r"resume|\bcv\b", el["label"], re.I):
            return {
                "action": "upload",
                "element_id": el["id"],
                "answer_key": "",
                "reason": "Native resume input",
            }
        if kind in {"password", "hidden", "checkbox", "submit", "button", "file"}:
            continue
        found = answer_for(el, answers)
        if not found:
            continue
        if (
            kind != "radio"
            and sum(
                normalize(x.get("label", "")) == normalize(el.get("label", ""))
                and x.get("section", "") == el.get("section", "")
                and x.get("tag") in {"input", "select", "textarea"}
                for x in elements
            )
            > 1
        ):
            raise FormReview("Repeated question needs an unambiguous section/index: " + el["label"])
        key, answer = found
        if kind == "radio":
            if (
                normalize(el.get("option_label", "")) != normalize(answer["value"])
                or el.get("value") == "true"
            ):
                continue
            op = "check"
        elif el.get("role") == "combobox" and el.get("tag") != "select":
            if normalize(el.get("value", "")) == normalize(answer["value"]):
                continue
            op = "combobox"
        elif el.get("tag") == "select":
            if normalize(el.get("selected_label", "")) == normalize(answer["value"]):
                continue
            op = "select"
        elif el.get("tag") in {"input", "textarea"}:
            # Never overwrite prefilled personal information silently.
            if el.get("value"):
                if el["value"].strip() != answer["value"].strip():
                    raise FormReview("Existing value differs from verified answer: " + el["label"])
                continue
            op = "fill"
        else:
            continue
        return {
            "action": op,
            "element_id": el["id"],
            "answer_key": key,
            "reason": "Exact verified question match",
        }
    return None


EXTRACT = r"""() => {
 const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
 const labelled = e => (e.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>document.getElementById(id)?.innerText || '').join(' ').trim();
 const label = e => [...(e.labels || [])].map(x=>x.innerText).join(' ').trim() || e.getAttribute('aria-label') || labelled(e) || e.getAttribute('placeholder') || e.innerText || e.name || '';
 const fields = [...document.querySelectorAll('input,select,textarea,button,a[href],[role="button"],[role="combobox"]')];
 // Native file inputs are often visually hidden behind an upload button.
 return fields.filter(e=>visible(e) || e.type==='file').slice(0,400).map((e,i)=>{
   e.setAttribute('data-jh-id',String(i));
   const group=e.closest('fieldset,[role="radiogroup"],[data-automation-id="formField"]');
   const groupLabel=group ? (group.querySelector('legend')?.innerText || group.getAttribute('aria-label') || labelled(group) || group.querySelector('label')?.innerText || '') : '';
   const section=e.closest('section,[data-automation-id="workExperience"],[data-automation-id="education"]');
   const sectionLabel=section?.querySelector('h2,h3,h4,legend')?.innerText || '';
   return {id:String(i),tag:e.tagName.toLowerCase(),type:e.type || '',role:e.getAttribute('role') || '',
    label:label(e).slice(0,600),group_label:e.type==='radio' ? groupLabel.slice(0,600) : '',option_label:e.type==='radio' ? label(e).slice(0,300) : '',section:sectionLabel,
    repeated:!!(section && /experience|education/i.test(sectionLabel)),disabled:!!e.disabled,readonly:!!e.readOnly,
    required:!!e.required || e.getAttribute('aria-required')==='true',
    value:e.type==='file' ? (e.files.length ? '[uploaded]' : '') : (e.type==='radio' || e.type==='checkbox' ? String(e.checked) : e.value || e.getAttribute('data-value') || e.getAttribute('aria-valuetext') || (e.getAttribute('role')==='combobox' && e.tagName!=='INPUT' ? e.innerText : '') || ''),
    selected_label:e.options ? e.selectedOptions[0]?.text || '' : '',
    href:e.tagName==='A' ? e.href : null,options:e.options ? [...e.options].map(o=>({value:o.value,label:o.text})) : []};
 });
}"""


def required_issues(elements, answers):
    issues = []
    for el in elements:
        if not el.get("required") or el.get("disabled") or el.get("type") == "hidden":
            continue
        kind = el.get("type")
        if kind == "file":
            if not el.get("value"):
                issues.append("Missing file: " + el["label"])
            continue
        found = answer_for(el, answers)
        if not found:
            issues.append(
                "Required question has no unique verified answer: " + (el.get("group_label") or el["label"])
            )
            continue
        _, answer = found
        if kind == "radio":
            group = [
                x
                for x in elements
                if x.get("type") == "radio" and x.get("group_label") == el.get("group_label")
            ]
            if not any(
                x.get("value") == "true"
                and x.get("option_label", "").strip().casefold() == answer["value"].strip().casefold()
                for x in group
            ):
                issues.append("Required radio group is not verified: " + el["group_label"])
        else:
            value = el.get("selected_label", "") if el.get("tag") == "select" else el.get("value", "")
            expected = answer["value"]
            if kind == "tel":
                value, expected = re.sub(r"\D", "", value), re.sub(r"\D", "", expected)
            if value.strip() != expected.strip():
                issues.append("Required answer is missing or differs from profile: " + el["label"])
    return list(dict.fromkeys(issues))

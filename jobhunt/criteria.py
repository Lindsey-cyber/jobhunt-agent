import re

from bs4 import BeautifulSoup

ROLE = re.compile(
    r"machine learning|\bml\b|\bai\b|artificial intelligence|\bllm\b|research engineer|data engineer", re.I
)
SENIOR = re.compile(r"\b(senior|sr\.?|staff|principal|lead|director|manager|head of|distinguished)\b", re.I)
EARLY = re.compile(
    r"new grad|entry.?level|junior|early.?career|university grad|engineer\s+(?:i|1)\b|\bjr\.?\b|\b0\s*(?:[-–]|to)\s*2\b|\b[012]\+? years?",
    re.I,
)
NO_SPONSOR = re.compile(
    r"(?:no|without)\s+(?:visa\s+)?sponsorship|(?:cannot|can't|unable to|not able to|will not|do not|does not|won't)\s+(?:provide|offer|support)?\s*(?:visa\s+)?sponsor|"
    r"sponsorship\s+(?:(?:is|will be)\s+)?(?:not (?:available|provided|offered|supported)|unavailable)|sponsorship will not be (?:provided|offered)|"
    r"(?:must|require[sd]?).{0,80}unrestricted.{0,40}(?:authorization|right to work)|"
    r"work authorization.{0,30}must be unrestricted|"
    r"(?:work authorization|authorization to work).{0,100}without.{0,60}sponsorship|"
    r"(?:authorized|eligible)\s+to\s+work.{0,90}without.{0,40}sponsorship",
    re.I,
)
US = re.compile(
    r"\bunited states\b|\bu\.?s\.?a?\b|new york|san francisco|seattle|boston|austin|chicago|los angeles",
    re.I,
)
US_STATE = re.compile(
    r",\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b"
)


def text(html):
    return BeautifulSoup(html or "", "html.parser").get_text(" ", strip=True)


def evaluate(title, location, description):
    body = text(description)
    if not ROLE.search(title):
        return "rejected", "Role outside AI/ML/data/research engineering"
    if SENIOR.search(title):
        return "rejected", "Senior role"
    restrictions = []
    for match in NO_SPONSOR.finditer(body):
        before, after = body[max(0, match.start() - 30) : match.start()], body[match.end() : match.end() + 40]
        if match.group(0).lower().startswith("without") and re.search(r"with or\s*$", before, re.I):
            continue
        if match.group(0).lower().startswith("no") and re.match(
            r"\s+(?:restrictions|limitations)", after, re.I
        ):
            continue
        restrictions.append(match.group(0))
    if restrictions:
        return "rejected", "Explicit sponsorship/work authorization restriction"
    if re.search(
        r"(?:must|require[sd]?).{0,70}(?:us|u\.s\.)\s+(?:citizenship|citizen)|us citizens only", body, re.I
    ):
        return "review", "Citizenship requirement must be checked against verified profile"
    high = re.search(
        r"\b(?:[3-9]|1\d)\s*(?:\+|[-–]\s*\d+)?\s*years?\s+(?:of\s+)?(?:relevant |professional |industry |work )?experience",
        body,
        re.I,
    )
    if high:
        context = body[max(0, high.start() - 50) : high.end() + 60]
        if not re.search(r"preferred|nice to have|bonus", context, re.I):
            if EARLY.search(title):
                return "review", "Conflicting early-career title and experience requirement"
            if re.search(r"required|require|minimum|at least|must", context, re.I):
                return "rejected", "Required experience exceeds 0–2 years"
            return "review", "Experience requirement needs verification"
    if not (US.search(location) or US_STATE.search(location)):
        return "review", "US eligibility of location needs verification"
    if not EARLY.search(title + " " + body):
        return "review", "Early-career eligibility needs verification"
    return "queued", "Matches criteria; missing sponsorship information is allowed"

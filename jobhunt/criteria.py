import re

from bs4 import BeautifulSoup

ROLE = re.compile(
    r"machine learning|\bml\b|\bai\b|artificial intelligence|\bllm\b|research engineer|data engineer", re.I
)
SENIOR = re.compile(r"\b(senior|sr\.?|staff|principal|lead|director|manager|head of|distinguished)\b", re.I)
EARLY = re.compile(
    r"new grad|entry.?level|junior|early.?career|university grad|engineer\s+i\b|\b0\s*[-–]\s*2\b|\b[012]\+? years",
    re.I,
)
NO_SPONSOR = re.compile(
    r"(?:no|without)\s+(?:visa\s+)?sponsorship|(?:cannot|can't|unable to|not able to|will not|do not|does not|won't)\s+(?:provide|offer|support)?\s*(?:visa\s+)?sponsor|"
    r"sponsorship\s+(?:(?:is|will be)\s+)?(?:not (?:available|provided|offered|supported)|unavailable)|sponsorship will not be (?:provided|offered)|"
    r"(?:must|require[sd]?).{0,80}unrestricted.{0,40}(?:authorization|right to work)|"
    r"work authorization.{0,30}must be unrestricted|"
    r"(?:work authorization|authorization to work).{0,100}without.{0,60}sponsorship|"
    r"(?:must|require[sd]?).{0,80}(?:us|u\.s\.)\s+(?:citizenship|citizen)|"
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
    if NO_SPONSOR.search(body):
        return "rejected", "Explicit sponsorship/work authorization restriction"
    if re.search(
        r"\b(?:[3-9]|1\d)\s*(?:\+|[-–]\s*\d+)?\s*years?\s+(?:of\s+)?(?:relevant |professional |industry |work )?experience",
        body,
        re.I,
    ) and not EARLY.search(title):
        return "rejected", "Experience requirement exceeds 0–2 years"
    if not (US.search(location) or US_STATE.search(location)):
        return "review", "US eligibility of location needs verification"
    if not EARLY.search(title + " " + body):
        return "review", "Early-career eligibility needs verification"
    return "queued", "Matches criteria; missing sponsorship information is allowed"

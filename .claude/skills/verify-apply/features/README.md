# jobhunt-agent verification map

This directory is the maintained source for what each ATS adapter can do and how to prove it. Read the index, then the ATS file you are about to drive.

## Baseline preconditions

- A disposable `JH_DATA_DIR` holding `profile.yaml` from `examples/` and a `resume.pdf`.
- The fixture server on `http://127.0.0.1:4173` for anything that submits.
- `npm run -s jh -- doctor` reports that data dir.

## Driving conventions

- One `jh apply` per URL per data dir. A second run on a confirmed key must print `already confirmed`.
- Prefer label text and ARIA roles. Field ids in Greenhouse (`question_<n>`) differ per job.
- Real postings are driven at `trust: draft` unless the candidate set otherwise.

## Proof and skip reporting

- Report each feature with the run dir that proves it.
- A feature only exercised on a SYNTHETIC fixture is reported as "verified on synthetic fixture", never as verified on the ATS.
- An entry point you could not reach is reported with the command and the unmet precondition.

## Feature entry contract

Each ATS file has an H1, one paragraph, then exactly these H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with jh`, `Gotchas`.

## ATS

- [Greenhouse](./greenhouse.md) covers text, combobox, file upload and EEO fields on job-boards.greenhouse.io.

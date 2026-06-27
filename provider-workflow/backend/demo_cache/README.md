# Demo Cache

Cached API responses for demo mode. When demo mode is active (via the
`X-Demo-Mode: true` request header or the `Ctrl+Shift+D` toggle in the UI),
the backend returns these cached responses instead of calling live AWS APIs.

## Synthetic Data Notice

> **All data in this directory is synthetic.** No real Protected Health
> Information (PHI), Personally Identifiable Information (PII), or live AWS
> resource identifiers are present in any file in this folder.
>
> | Patient identity | Type |
> |---|---|
> | Elena Rodriguez (b. 1962-07-15) | Synthetic |
> | Diego Ramirez (b. 1985-11-22) | Synthetic |
> | Márcia Oliveria (b. 1963-03-08) | Synthetic |
>
> Patient IDs, MRNs, JobIds, and FHIR resource UUIDs in these files are
> randomly generated values, not references to any real datastore. Clinical
> details (conditions, vital signs, procedures, medications) are
> illustrative scenarios written for the demo and do not represent real
> patient encounters.

If you fork this sample and connect it to real patient data, **never commit
recorded API responses to source control**. The `DEMO_RECORD=true` recording
flow described below should only be used against synthetic test datastores.

## File Layout

| File | Purpose |
|---|---|
| `patients_default.json` | Master list of demo patients (id, name, DOB, MRN) |
| `patient_insights_<mrn>.json` | Cached Amazon Connect Health Patient Insights output per patient |
| `synthesize_previsit_<mrn>.json` | Cached Amazon Bedrock pre-visit narrative synthesis output |
| `streaming_outputs_default.json` | Cached SOAP notes, medical codes, and after-visit summary from one ambient-documentation session |

## Recording New Cache Data (development only)

Set `DEMO_RECORD=true` when running the backend against a synthetic-data
HealthLake datastore. All API responses will be saved to this folder
automatically. Switch off recording once cached, and the data will be served
in demo mode.

**Do not run `DEMO_RECORD=true` against any HealthLake datastore that contains
real patient data.** Doing so will write live PHI to disk and into this
directory, which would then be at risk of accidental commit.

## Adding New Demo Patients

1. Add an entry to `patients_default.json` with a new synthetic identity
   (use the [Synthea](https://synthea.mitre.org/) project for realistic
   synthetic FHIR data if you need richer demo content).
2. Generate corresponding `patient_insights_<mrn>.json` and
   `synthesize_previsit_<mrn>.json` files by running the backend with
   `DEMO_RECORD=true` against your synthetic dataset.
3. Update `config.py` `DEMO_CACHE` mapping to include the new MRN prefix.

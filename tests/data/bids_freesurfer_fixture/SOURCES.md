# Test fixture: real FreeSurfer output + real demographics

These files are **real data**, included only so the NeuroLens ingestors can be
tested against genuine FreeSurfer output. They are not part of any NeuroLens
analysis cohort.

| File | Source | License |
|---|---|---|
| `sub-*/stats/aseg.stats` | `ReproNim/how-would-repronim-4`, `subjects/<ID>/stats/aseg.stats` (ABIDE subjects) | CC-BY 4.0 |
| `demographics.csv` | `ReproNim/how-would-repronim-4`, `demographics.csv` | CC-BY 4.0 |
| `README.md` | same repository | CC-BY 4.0 |

`participants.tsv` is a mechanical BIDS renaming of the real `demographics.csv`
rows for the seven subjects whose `aseg.stats` are included here
(`participant_id = "sub-" + subject ID`). No values were altered, imputed, or
invented.

The seven subjects: CMU_0050646, KKI_0050778, NYU_0050965, Pitt_50014,
SBL_51556, UM_0050404, USM_50470.

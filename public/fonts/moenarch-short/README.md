# Packaged video fonts

Unmodified Adobe font releases, bundled under the SIL Open Font License 1.1. The adjacent license files include the copyright notices. No external font service or OS font installation is needed.

- [Source Serif 4, release 4.005R](https://github.com/adobe-fonts/source-serif/tree/2823e993c53fca27c5c8749f529b56a5a7c77b6b): `WOFF2/TTF/SourceSerif4-Semibold.ttf.woff2` and `SourceSerif4-It.ttf.woff2`.
- [Source Sans 3, release 3.052R](https://github.com/adobe-fonts/source-sans/tree/ed1808970eb3c7301c9a523bee26473ba0bb62fa): `WOFF2/VF/SourceSans3VF-Upright.ttf.woff2` (variable weight).

Both cover the Latin text and accents used by the EN/DE/ES specimen. Other scripts are not a newly guaranteed typography surface; existing wide-glyph rejection/fit checks remain in force.

SHA-256 of the bundled, unmodified font bytes:

- `SourceSans3-Variable.woff2`: `5f16566f7a40d39b339ad26be151fa5a1ab1f0c2574c7a2e619765584a1acbd8`
- `SourceSerif4-Italic.woff2`: `ca3b17ed1e3e668ffd9e03385cfd46e1b095df783de53710d25d41241496026b`
- `SourceSerif4-Semibold.woff2`: `457a13ac92e977d82e376038a2daac7fdb5433610910bf5787bdf6c1c3781865`

Width bounds were calibrated from the packaged glyph advances at serif 600, serif italic 400 and sans 400/560. Narrow ASCII punctuation includes a 0.548 em backtick; extended Latin includes a 0.971 em accented W; the three-em dash reaches 2.314 em. Browser acceptance independently measures advances and actual text fragments. The plan remains pure and does not measure the DOM.

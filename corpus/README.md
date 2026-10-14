# Foundation evaluation corpus

`manifest.json` is the inventory and annotation source. The 14 committed fixtures are original synthetic test texts, dedicated to the public domain under [CC0-1.0](licenses/CC0-1.0.txt). They contain no copied third-party prose or private documents. Every item records its source, licence, SHA-256, language, features, annotated headings and expected blocks in reading order. PDF page labels start at 41; paragraph numbers restart at 1 per document.

Coverage includes English, Russian, Uzbek Latin/Cyrillic, Turkish and Arabic; a long HTML book; linked parts of an article; PDF books with and without outlines; two columns; running margins; line-break hyphenation; and footnotes. Both formats include a canary instruction. These controlled documents test the foundation's mechanics. They do not establish extraction or interpretive quality on naturally occurring publications. Add openly licensed natural texts before F-08 acceptance, without removing these regressions.

Regenerate with `npm run corpus:generate`. It must leave committed bytes unchanged. `npm test` checks hashes and compares actual browser extraction with the annotations. Fixtures should be changed with their generator, annotations and evidence together.

Private texts belong only in ignored `corpus/private/` and `corpus/local-manifest.json`. Never add their text or model answers to Git or CI artifacts. A future local corpus runner may read that manifest; the current probes intentionally use only the committed manifest.

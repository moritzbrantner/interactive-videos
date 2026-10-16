# ADR 0002: Generated narration is committed through Git LFS and verified against its lock

- Status: Accepted (owner decision on #82, 2026-10-16)
- Date: 2026-10-16
- Related issues: #82 (Nicaea I pilot, slice 1), #61, #17; asset-tooling#30
- Related decisions: Decision Atlas 3.22, 3.24; ADR 0001

## Context

The Seven Councils episodes are narrated with Kokoro-82M (`hexgrad/Kokoro-82M` at
`f3ff3571791e39611d31c381e3a41a3af07b4987`), run locally through asset-tooling's
`audio.model.generate@2` operation and its Kokoro adapter (asset-tooling `502e955`). The model
needs a hash-locked Python 3.12 venv with torch and a 363 MB model bundle. Running it in CI or in
the Pages workflow would put torch and the model on every build, and Kokoro's output is labelled
`approximate`: a fixed seed and thread count replay byte-identically on one machine, but nothing
promises the same bytes on another. A build that regenerates the narration could therefore change
the published audio, and its subtitle timing, without any change to the episode.

## Decision

- The generated narration WAVs are **committed to the repository through Git LFS**
  (`.gitattributes`: `src/content/councils/*/narration/*.wav`), together with the request that
  produced them. CI and Pages check out with `lfs: true`.
- Each narration slot of the VideoSpec is **locked** to the full AssetRef the operation produced
  (sha256, byte length, asset-tooling's canonical audio metadata and its provenance, which names
  `audio.model.generate@2` and the `model.zip` input digest). The lock is the authority.
- The sidecar request manifest declares such a slot as a **committed request**
  (`docs/specs/videospec-v2-assets.md` §1.6): `committed` (the file), `operation`, `adapter`,
  `parameters` (model id and revision, prompt, seed, sample rate, channels, voice, the versioned
  pronunciation lexicon), `inputs` (the model bundle AssetRef) and `evidence` (Apache-2.0 and the
  upstream training-data caveat, Decision 3.24).
- `materializeProject` treats a committed request as provenance, never as an instruction: it does
  not look up or execute the operation, it verifies the committed bytes against the lock (an LFS
  pointer, a missing file or tampered bytes fail closed naming the slot), stores them in the
  asset-tooling store and reports `status: committed` with the request's operation and no cache
  key. No model, process or network is reachable from it (render.architecture.test.ts).
- **Regeneration is an explicit local step**,
  `scripts/narration/regenerate-nicaea-325.ts`, outside the build, verify and CI paths. It
  imports asset-tooling from a local checkout at the pinned upstream revision (it does not change
  the `asset-tooling` package pin the app uses), runs each scene through `runAssetOperation`
  (operation-result reuse: an unchanged request is a verified hit), copies the outputs into the
  repository, derives the subtitle cue timing from the generated audio (cue boundaries on measured
  pauses) and rewrites the spec locks and the sidecar. The result is reviewed and committed like
  any other change.

## Consequences

- CI and Pages stay free of Python, torch and the model; the served narration is byte-for-byte
  the reviewed one, and the subtitles stay aligned with it.
- Regenerated narration changes the locks and the cue timing in one reviewable commit; a stale
  WAV or a stale lock fails materialization (`asset-lock-mismatch`) instead of shipping.
- A checkout without LFS objects fails with an LFS diagnostic rather than serving pointer files.
- Git LFS storage and bandwidth now hold the narration (about 7 MB for Nicaea I).
- Human-recorded narration (Decision 3.22) can later replace a committed slot as a `local`
  request without changing this mechanism.

# Review of the attached Iran-validation patch ending at 82942c1

Date: 2026-10-19. Input: owner-attached `seyra-vm2-review.patch`.

Patch SHA-256: `82545567beae9a9c53b566c482f3bdbe5a7ebdde905aa42fad58e70e9037cb0b`.
Reported base: `9f0d7925eef0d43fc157cdd64b557b962df457a6`.
Reported last commit: `82942c1296e638c8715c021fee49aeb7c540a703`.

**Decision: both geocoder corrections are accepted within this review's scope. The nine commits may be preserved on `feat/map-services-v1` by a normal push to the draft PR. This is not merge or production acceptance. Address the validation-harness findings and operational issues below before final acceptance.**

## Patch integrity and scope

All nine mail patches applied sequentially without conflicts to an isolated copy of the known base. Final Git blob hashes match every one of the 423 changed paths, including the binary screenshots. The mail headers identify nine commits, from `f244a25` through `82942c1`. This verifies the received patch contents; it is not a reconstruction/authentication of Git commit objects on the owner's VM.

Product-code changes are confined to `apps/ops/src/geocoder-preprocess.ts` and its tests. Other executable changes are the lock-writer's preparation-environment notes and new validation scripts. The patch also contains relocked images and the replacement-VM evidence. At the initial GitHub check, PR #1 remained draft at `9f0d792`; the nine commits were not remotely available.

## Geocoder fixes accepted

| Commit | Assessment |
| --- | --- |
| `2df015f844e26031c49f192adc881618cb37ed36` | The text-value helper accepts scalar strings and direct string-array elements. Address arrays pass through unchanged while their text contributes synonyms. The string-only crash is reproduced on the baseline and absent in the patched stream transform. Original display names and Persian-digit house numbers are preserved. |
| `6a665aeff4e78cac99515c0aaa5f67f27b51d727` | Rejecting synonym tokens whose original or normalized form contains no Unicode letter/number is appropriate for the recorded Photon failure. Both `?,؟` and `????,؟؟؟؟` are removed while useful Persian synonyms remain. This narrow correction is consistent with the same real-data preprocessing task; it does not require a separate feature intake. |

Independent reviewer execution: **10/10 targeted checks PASS**, Node `v24.19.0`, using the actual old/new TypeScript preprocessors and shared normalization. The checks reproduce both baseline defects, exercise mixed address values, original display preservation, digit synonyms and the release marker, and compare four previously supported fixture streams. Their JSONL output is byte-identical; synonyms and statistics also match.

The independent checks did not run the Photon analyzer or the full Iran PBF. Real-analyzer refusal and later successful staging/import evidence are included in the patch and were inspected. No PBF, container image archive or live VM was available to this reviewer.

For this narrow compatibility repair, no reason was found to invalidate previously successful releases. This must not become a general rule that OPS changes cannot affect dataset construction: preprocessing runs inside OPS, so future output-changing transformations need explicit pipeline version/fingerprint treatment.

## New validation-harness findings

### V1 — P2: update verification happens after the install/bootstrap actions

Location: `tests/validation/iran-offline-host.sh:178–188`.

The update phase calculates the digest, then removes/copies the install tree and invokes the newly copied wrapper's `bootstrap-load`. Only afterward does the condition compare the digest to `UPDATE_SUMS_DIGEST`. Even a rejected update also assigns the new BUNDLE for later phases.

Independent reproduction runs that actual update block with Docker/CLI boundary recorders and temporary files. With a deliberately wrong expected digest, the install files are copied and bootstrap is invoked before `FAIL U1` is reported.

Required correction: verify the out-of-band digest and all listed bundle file checksums with trusted current tools before modifying the installed tree or executing any incoming wrapper. A failed gate must return failure and skip dependent phases. Test wrong digest and corrupted payload cases with zero install changes/bootstrap calls.

The recorded successful r3 update has a matching digest, so this finding does not claim that its actual bundle was untrusted or that its successful import is invalid.

### V2 — P2: browser PASS omits console errors and required visits

Location: `tests/validation/iran-browser.mjs:140–142`.

The audit records console errors and visits but only checks external requests, RTL-plugin requests and failed requests when deciding its exit status. Evaluating the actual predicate confirms that a console-error fixture or a missing required visit still returns success.

Required correction: require zero console errors and all declared required visits to succeed, or report explicitly separate result categories whose aggregate cannot silently be green. Keep exploratory geographic/ranking quality distinct from owner acceptance.

The final recorded report actually has zero console errors and all six visits found. This gap weakens future automation; it does not falsify those recorded values.

## Existing operational issues confirmed or retained

1. **Capacity guard and sampling.** The 229,845,082-byte PBF yields a default guard of 9,193,803,280 bytes, while the recorded build has a larger transient storage requirement. `importer.ts` samples free space only after each step, so its manifest minimum misses the within-step low-water mark. Define a conservative, documented Iran capacity policy from measured evidence plus explicit headroom, retain meaningful guard enforcement, and measure inside long steps. Do not present the current multiplier as a sufficient Iran sizing guarantee.
2. **Bundle permissions.** The patch records root-owned mode-0600 image archives and an operator ownership workaround. `bundleExport` does not normalize ownership/readability after `docker save`. Fix the defined operator access path without widening secret permissions or requiring an undocumented root workaround.
3. **Readiness incident.** The first Iran browser run's two `/health/ready` 503s and matching console errors are retained. Later clean runs do not establish their cause. This remains an unresolved incident, not a reproduced root-cause finding. Collect bounded cold-start/cancellation/load diagnostics before changing readiness semantics or timeouts.
4. **Low-zoom tile size.** The recorded ~2.1 MB tile and ~2.1 s sequential response are real observations to assess against agreed UI/load targets. Do not weaken the map catalog or initiate a provider replacement without a measured design decision.

The capacity/permission issues predate the received code changes and were honestly recorded during this run. They are still acceptance work even though the reported VM had enough space and the ownership workaround allowed testing.

## Evidence cross-checks

- Recomputed `ds-20261017-2d2c87f31d11` from the release manifest's source hash, pipeline fingerprint, data-component image IDs and asset digest; all seven data-component IDs match the final lock. The manifest has status `validated` and all five staging checks pass.
- Full recorded source SHA-256: `7060fbb5b6ae23acb20b3a376df8404ebec43c81fbc3b71b78f7cbf9c312198f`.
- Final OPS image: `sha256:489d2a4003f20cce6f044867630cf9b2053b425b72c716987b938ebe14faf2c9`. Recorded r3 SHA256SUMS digest: `9c4e87daf2c97cbf1b69b12a4bf0b821a3adab62d47ef71c0a96fae97aa969f8`. Image/archive binaries were not independently rehashed here.
- The smoke JSON contains 23/33 hit@1 and 32/33 hit@5, 14 expected routing statuses, six proximity checks, 32 POI checks and 27 tile/style requests. These are exploratory fixtures, not owner-approved quality or capacity acceptance. Top-k/radius hits do not guarantee an exact address match.
- The final browser report contains 511 requests, zero external/failed/console errors and six found visits. Two attached map screenshots were visually inspected: Azadi Square and the Bazargan region render with Persian labels. Browser requests were not independently replayed.
- The five backed-up control-event rows are byte-identical to the restored rows. Import/activation logs and the recorded ready provider identities support rebuilding/serving the same dataset from the original PBF without included backup sources.
- Both preserved egress-counter records show zero packets in the non-local DROP counter. They are run evidence, not a network capture repeated by this reviewer.
- The restore summary is explicitly marked reconstructed and matches the retained progress records. Do not rewrite it as an uninterrupted harness PASS. Freeze the script revision/copy during future long runs.
- The final r3 L14 evidence has `start rc=0, prune rc=0`; that particular execution did not demonstrate a busy refusal. Other lifecycle/race cases supply exclusion evidence. Avoid claiming every run exercised that branch.
- Syntax checks passed for the new shell/JavaScript validation scripts and changed lock writer. The reported full 149 unit, 137 integration and Docker/offline suites were not repeated by this reviewer.

## Next action

The owner can normally push the nine local commits to the existing draft feature branch. No merge, force push, credentials publication or main change is needed. Then use `prompts/CLAUDE_VM2_OPERATIONAL_FOLLOWUP.md` for the focused follow-up work. Preserve the running restored Iran host and original input. New Auth/Relation/SOS requirements intake remains separate.

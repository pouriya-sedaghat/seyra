# Windows issuance finding: time-zone-dependent validation at 352bd9a

**One confirmed P2 finding: normalize certificate times before comparing them.** This finding follows the owner's first real Windows issuance run. The earlier F1/F2/N1/N2 source fixes remain accepted.

Affected source: `infra/tls/lan-pki/windows/SeyraPki.psm1`, `Test-SeyraLeafCert`:

```powershell
Assert-Seyra ([datetime]$c.validity.start -le (Get-Date).ToUniversalTime().AddMinutes(1)) 'already valid'
```

The left operand can be a Local `DateTime` while the right operand is UTC. The comparison therefore uses different wall-clock scales. In Windows PowerShell 5.1 on the owner's UTC+03:30 system, a valid leaf was falsely rejected immediately after signing. In a negative-offset zone the same error can admit a future NotBefore at this check; the existing independent chain verifier must continue rejecting certificates outside their real validity interval.

## Observed evidence

The owner supplied actual Windows PowerShell 5.1 output, not a Linux model:

| Observation | Result |
| --- | --- |
| Folder acceptance W1–W7 | 14 checks, zero failures, cleanup OK, exit 0 |
| Full acceptance W1–W10 after correctly declining W8 | 17 checks, zero failures, cleanup OK, exit 0 |
| Pinned Windows Step CLI | 0.31.0; archive hash matched; Authenticode reported NotSigned |
| Root and issuing CA creation | Encrypted keys; extension checks passed; issuing CA verified against its root |
| Leaf signing | Certificate written; SAN, public-key binding, usages, issuer and lifetime checks passed; failed at `already valid` |
| Local zone | Iran Standard Time, UTC+03:30 |
| Parsed NotBefore | `DateTimeKind.Local` |
| Original comparison | False |
| Comparison after converting the left operand to UTC | True |

The public transcript omits the real endpoint, account, exact issuance folder names and certificate metadata. The reviewer inspected the source and the owner's diagnostic output; the reviewer did not execute PowerShell on Windows.

The first W8 attempt had failed because the owner selected Yes where the test required No. The corrected run passed. This is not an additional trust-store finding.

## Issuance recovery

The owner has three issuance attempt directories. Only one contains `server.crt`. The supplied directory-count guard correctly refuses to guess among them. Do not delete the attempts or select the newest folder automatically. Use the explicitly identified candidate, verify its stored CSR/manifest and certificate against the existing request and issuers, and verify the actual signature chain and validity before exporting it. The current leaf may be reusable; no CA, VM key or CSR regeneration is required to correct this comparison.

Check the related CA/leaf validity comparisons and `Export-PublicPacket.ps1`'s renewal date calculation. Use an explicit, consistent UTC interpretation, retaining the meaning of the timestamps across Windows PowerShell 5.1 and PowerShell 7. Preserve validation limits and fail on malformed or ambiguous time inputs.

Regression evidence should exercise UTC, UTC+03:30 and a negative-offset zone, including both a valid backdated leaf and a genuinely future NotBefore. Keep machine time and its configured zone unchanged on the owner's PC.

## Scope

This is an off-host Windows-tooling correction. It needs no image rebuild, operational bundle export, Iran import, live certificate replacement, service restart or LAN publication. Preserve the successful real-Windows acceptance results and all existing keys. Prepare a versioned, hashed script update and a recovery procedure for the existing leaf. Keep PR #1 draft, leave `main` unchanged and do not push the feature branch on the owner's behalf.

Primary behavior references:
- [Microsoft: DateTime.Parse and time-zone conversion](https://learn.microsoft.com/en-us/dotnet/api/system.datetime.parse?view=netframework-4.8.1)
- [Microsoft: DateTime.Compare ignores Kind](https://learn.microsoft.com/en-us/dotnet/api/system.datetime.compare?view=netframework-4.8.1)

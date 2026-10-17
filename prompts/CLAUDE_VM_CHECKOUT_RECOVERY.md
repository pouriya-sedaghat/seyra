# Recover the missing Seyra checkout on the VM

The screenshots show that the Claude session cannot find `/home/user/seyra` on its connected VM and the opened terminal has no clone output. This does not yet demonstrate a GitHub fetch/network failure: a local checkout has to exist first.

Use the VM shell available to this session. The canonical, public repository is:

`https://github.com/pouriya-sedaghat/seyra.git`

The intended local checkout is `/home/user/seyra`. The Iran PBF is a separate owner input under `/home/user`; do not alter it.

1. Run `hostname`, `id -un`, `pwd` and `ls -ld /home/user /home/user/seyra` to establish the actual execution environment and path. Report the observed facts; do not substitute the Windows shell or the previous cloud session.
2. If `/home/user/seyra` does not exist, run the following yourself in that VM shell and inspect its exit code/output:

   `git clone https://github.com/pouriya-sedaghat/seyra.git /home/user/seyra`

   If the path exists, verify `git -C /home/user/seyra rev-parse --show-toplevel`, `git -C /home/user/seyra status --short --branch` and `git -C /home/user/seyra remote get-url origin`. Preserve existing work. If the path is non-empty but not a checkout, or belongs to a different repository, report it without deleting, resetting or overwriting anything.
3. Once the checkout exists and origin is the intended Seyra repository, run:

   `git -C /home/user/seyra fetch origin`

   Then read:

   `git -C /home/user/seyra show origin/review/map-services-pr1-9f0d792:prompts/CLAUDE_IRAN_VM_PREFLIGHT.md`

   If a single-branch fetch configuration omits the review branch, inspect the refspec and fetch that exact ref explicitly:

   `git -C /home/user/seyra fetch origin refs/heads/review/map-services-pr1-9f0d792:refs/remotes/origin/review/map-services-pr1-9f0d792`

   Then repeat the `git show` command.
4. Follow the updated VM preflight and its full validation prompt. Inspect/select `feat/map-services-v1` while preserving unrelated local changes. Keep PR #1 draft. The VM's Internet connection is authorized for preparation/image acquisition; isolated product operation must still be validated offline.

Do not ask for the URL again or enumerate unrelated repositories in the `gh` account. Do not treat the user saying "I cloned it" as evidence that a command succeeded in this shell. Clone directly with the URL above when the target path is absent. No GitHub login/account switch is normally needed to clone this public repository over HTTPS; if credentials, proxy policy or an access error actually block it, return sanitized command/error evidence rather than changing authentication globally.

If terminal/file access is unavailable, identify that missing capability. If clone/fetch fails, return the actual command, exit code and sanitized stderr. Do not disable TLS verification, erase credentials or restart unrelated services as a guess. The first success criterion is a verified checkout plus readable preflight prompt on this VM; then continue the authorized validation task.

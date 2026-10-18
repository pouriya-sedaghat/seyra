# syntax=docker/dockerfile:1
# TEST TOOLING ONLY (never part of the product bundle). Runs the repository's bash harnesses
# (lifecycle, security, offline, restore) unchanged as root on a host where the operator account
# has Docker access but no sudo: those harnesses read 0400 secrets owned by container UIDs and
# change provider-owned paths. Same pinned bases as the product images.
#
#   docker build -t seyra-test-runner:local -f tests/validation/runner.Dockerfile tests/validation
#   docker run --rm --network host -v /var/run/docker.sock:/var/run/docker.sock \
#     -v "$PWD:$PWD" -w "$PWD" seyra-test-runner:local tests/lifecycle/lifecycle.sh
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG DOCKER_CLI_IMAGE=docker:29.8.2-cli@sha256:35cfcf893c20f2931f4909151b5407aaaeab711277de7ce8b8f521f095d54c32
ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
FROM ${NODE_IMAGE} AS nodebin
FROM ${DOCKER_CLI_IMAGE} AS dockercli
FROM ${UBUNTU_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates coreutils curl jq iproute2 \
      util-linux procps findutils gawk sed grep \
    && rm -rf /var/lib/apt/lists/*
COPY --from=nodebin /usr/local/bin/node /usr/local/bin/node
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
ENTRYPOINT ["bash"]

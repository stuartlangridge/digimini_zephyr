#!/bin/bash

necho () {
    echo "########################################################################"
    printf '%s\n' "$1" | fold -s -w 72
    echo "########################################################################"
    tput sgr0;
}
cecho () {
    # green
    echo -en '\E[0;32m'
    necho "$@"
}
recho () {
    # red
    echo -en '\E[0;31m'
    necho "$@"
}

cat <<"EOF"
Welcome to Stuart's environment setup for building MicroPython for nRF
devices  like the nRF52840 Dongle, using the Zephyr environment.
                           ..ooOOoo..
This script ensures that the environment is set up the right way every
time, and also acts as documentation so I remember how to do it.
You run this script and that's it: it sets up the environment, gets
all the micropython stuff, builds it, and flashes it.
So if you change micropython at all, just re-run this script.
It is clever enough to not repeat things (like fetching micropython)
if it doesn't need to.
EOF

cecho "First, get Zephyr, following their get-started guide at \
https://docs.zephyrproject.org/latest/develop/getting_started/index.html"

echo "We need a bunch of dependencies from apt. Get them if necessary."
sudo apt -qqq install --no-install-recommends git cmake ninja-build gperf \
  ccache dfu-util device-tree-compiler wget python3-dev python3-venv python3-tk \
  xz-utils file make gcc gcc-multilib g++-multilib libsdl2-dev libmagic1


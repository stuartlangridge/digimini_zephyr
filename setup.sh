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
D=$(readlink -f $(dirname "$0"))
if [ "$VIRTUAL_ENV" != "" ]; then
  recho "Don't run this setup script while you're already in a Python virtualenv."
  exit 2
fi


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

if [ -f "$D"/mpvenv/pyvenv.cfg ]; then
  echo "Looks like you already have a virtualenv; good."
else
  echo "You don't yet have a virtualenv, so we create it."
  python3 -m venv "$D"/mpvenv
fi
source "$D"/mpvenv/bin/activate

echo "We need the Zephyr builder, west (West! Jim West! desperado!) to do stuff"
pip install -q west

echo ...and Zephyr itself.
if [ -d "$D"/zephyrproject ]; then
  echo Looks lke zephyr init has already been run, so skipping it
else
  west init "$D"/zephyrproject
fi
cd "$D"/zephyrproject
# this is annoyingly chatty. Don't wanna hide it, so we live with it
west -qqq update || exit 1
west zephyr-export
west packages pip --install -- --quiet

cecho "OK that's Zephyr itself. Now we need the Zephyr SDK."
cd "$D"/zephyrproject/zephyr
mkdir -p "$D"/zephyr-sdk-install/extract
west sdk install \
  --install-base "$D"/zephyr-sdk-install/extract \
  --install-dir zephyr-sdk-latest


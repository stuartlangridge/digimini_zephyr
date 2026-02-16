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
Welcome to Stuart's deployment script for our app to an nRF52840 dongle
running micropython.
EOF

cecho "First we check if you have an nRF52840 dongle (P10059) both plugged in and running micropython"
lsusb | grep -q "2fe3:0100 NordicSemiconductor USB-DEV"
if [ $? == 0 ]; then
    echo "...you do. Let's begin!"
else
    recho "You either don't have the P10059 dongle plugged in, or you do, and it's not running micropython. You want to be running setup.sh instead first to install the firmware."
    exit 1
fi

if [ ! -f "$D"/app/server/mplib_deps.txt ]; then
  recho "I expected to see app/server/mplib_deps.txt with micropython-lib \
  dependencies in it and didn't, so I'm aborting."
fi

cecho "Installing micropython-lib dependencies"
# remove #comments from line
egrep -v '^#|^\s*$' "$D"/app/server/mplib_deps.txt | while read -r dep; do
  # split line by / and take last
  dirname=${dep##*/}
  if mpremote fs ls /flash/lib/$dirname > /dev/null; then
    echo micropython-lib $dep is already installed
  else
    echo Installing micropython-lib dependency $dep
    mpremote mip install $dep
  fi
done

echo For now we simply run our app without actually storing it on the device
echo Eventually this will package it up, but this is ok for iterating

mpremote run "$D"/app/server/app.py

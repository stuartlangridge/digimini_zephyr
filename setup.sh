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

cecho "First we check if you have an nRF52840 dongle (P10059) both plugged in and at the bootloader!"
lsusb | grep -q "1915:521f Nordic Semiconductor ASA Open DFU Bootloader"
if [ $? == 0 ]; then
    cecho "...you do. Let's begin!"
else
    recho "You either don't have the P10059 dongle plugged in, or you do, and it's not at the bootloader. If it's plugged in, then it should have a pulsing red LED. If it doesn't, then press the reset button (tiny, on the bottom side of the metal box above the N logo)."
    exit 1
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

cecho "Getting micropython-lib for extra stdlib stuff such as aioble"
# we can't use mpremote mip install because we don't have a filesystem setup
if [ -f "$D"/micropython-lib/README.md ]; then
  echo "Looks like you already have micropython-lib; good. Let's update it."
  pushd "$D"/micropython-lib
  git pull
  popd
else
  git clone git@github.com:micropython/micropython-lib.git "$D"/micropython-lib/
fi

if [ -f "$D"/mpvenv/pyvenv.cfg ]; then
  echo "Looks like you already have a virtualenv; good."
else
  echo "You don't yet have a virtualenv, so we create it."
  python3 -m venv "$D"/mpvenv
fi
source "$D"/mpvenv/bin/activate

echo Checking for nrfutil which is needed for build and flashing
which nrfutil > /dev/null || pip3 install nrfutil

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

cecho "We need to work with a known version of Zephyr because that's \
what MicroPython supports (see ports/zephyr/README)."
# https://github.com/zephyrproject-rtos/zephyr/discussions/53847
pushd "$D"/zephyrproject/zephyr
git checkout v4.2.1
popd
# and we need to update again
west -qqq update || exit 1

west zephyr-export
west packages pip --install -- --quiet

cecho "OK that's Zephyr itself. Now we need the Zephyr SDK."
cd "$D"/zephyrproject/zephyr
mkdir -p "$D"/zephyr-sdk-install/extract
west sdk install \
  --install-base "$D"/zephyr-sdk-install/extract \
  --install-dir zephyr-sdk-latest

cecho "OK! Next, let's get micropython."
if [ -f "$D"/micropython/README.md ]; then
  cecho "...looks like you already have it. Result."
else
  # get our fork, until our changes are merged upstream, in our branch
  git clone --depth=1 --single-branch --branch=digimini-zephyr \
    git@github.com:stuartlangridge/micropython.git "$D"/micropython/
fi

cecho And now we build micropython itself
BOARD=nrf52840dongle
west build -p always -b $BOARD "$D"/micropython/ports/zephyr || exit 1

# we can't use "west flash" here, according to the nRF52840 Dongle page at
# https://docs.zephyrproject.org/latest/boards/nordic/nrf52840dongle/doc/index.html
# so we package and flash with nrfutil
# zephyrproject/zephyr/build/zephyr/zephyr.hex is the built file

nrfutil nrf5sdk-tools pkg generate \
         --hw-version 52 \
         --sd-req=0x00 \
         --application build/zephyr/zephyr.hex \
         --application-version 1 \
         "$D"/micropython-built.zip || exit 1

nrfutil nrf5sdk-tools dfu usb-serial \
  -pkg "$D"/micropython-built.zip -p /dev/ttyACM0

cecho "Connect to its Python repl with 'picocom /dev/ttyACM0' \
Exit with Ctrl-A Ctrl-X \
\
Alternatively use mpremote (apt install micropython-mpremote) \
$ mpremote # gives you a python shell
$ mpremote run something.py # runs something.py on the device
If it claims there's no device, it might need sudo.

To deploy and run OUR program (rather than the micropython firmware
on which it depends) do 'bash deploy.sh'.
"
